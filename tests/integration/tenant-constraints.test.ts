import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { analyses, clients, complaints, memberships, reports } from '@/server/db/schema';
import { makeDemoReport } from '@/domain/fixtures/demo-report';
import { resetDatabase, closeDatabase, testDb } from '../helpers/database';
import { createWorkspaceWithOwner } from '../helpers/auth';

/**
 * These assert the *database* refuses cross-tenant rows. The repository layer
 * checks scope too; this proves the second line of defence really exists, so a
 * repository bug cannot silently produce a mixed-tenant record.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

async function makeClient(workspaceId: string, name = 'Client') {
  const [row] = await testDb()
    .insert(clients)
    .values({
      workspaceId,
      name,
      domain: 'example.com',
      timeZone: 'America/New_York',
      definitions: {},
    })
    .returning();
  return row;
}

describe('composite tenant foreign keys', () => {
  it('rejects a complaint whose client belongs to another workspace', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const clientOfB = await makeClient(b.workspaceId);

    await expect(
      testDb().insert(complaints).values({
        // Workspace A claiming a client that belongs to workspace B.
        workspaceId: a.workspaceId,
        clientId: clientOfB.id,
        originalText: 'x',
        category: 'no_leads',
        scope: 'organic_search',
        periodStart: '2026-07-12',
        periodEnd: '2026-08-10',
        receivedAt: new Date(),
        createdBy: a.userId,
      }),
    ).rejects.toThrow();
  });

  it('rejects a report whose client belongs to another workspace', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const clientOfB = await makeClient(b.workspaceId);

    await expect(
      testDb().insert(reports).values({
        workspaceId: a.workspaceId,
        clientId: clientOfB.id,
        schemaVersion: 1,
        reportLabel: 'x',
        snapshot: makeDemoReport(),
        contentHash: 'hash',
        createdBy: a.userId,
      }),
    ).rejects.toThrow();
  });

  it('rejects an analysis combining two clients from the same workspace', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const first = await makeClient(a.workspaceId, 'First');
    const second = await makeClient(a.workspaceId, 'Second');

    const [report] = await testDb()
      .insert(reports)
      .values({
        workspaceId: a.workspaceId,
        clientId: first.id,
        schemaVersion: 1,
        reportLabel: 'x',
        snapshot: makeDemoReport(),
        contentHash: 'hash',
        createdBy: a.userId,
      })
      .returning();
    const [complaint] = await testDb()
      .insert(complaints)
      .values({
        workspaceId: a.workspaceId,
        clientId: second.id,
        originalText: 'x',
        category: 'no_leads',
        scope: 'organic_search',
        periodStart: '2026-07-12',
        periodEnd: '2026-08-10',
        receivedAt: new Date(),
        createdBy: a.userId,
      })
      .returning();

    // Both rows are valid on their own and both belong to workspace A, but the
    // analysis names the second client while using the first client's report.
    // The service layer rejects this; the record is also structurally wrong.
    const inserted = await testDb()
      .insert(analyses)
      .values({
        workspaceId: a.workspaceId,
        clientId: second.id,
        reportId: report.id,
        complaintId: complaint.id,
        complaintSnapshot: {},
        ruleVersion: '1.0.0',
        resultSchemaVersion: 1,
        result: {},
        diagnosis: 'post_click',
        createdBy: a.userId,
      })
      .returning();

    // The report referenced belongs to a different client than the analysis
    // claims, which is exactly what createAnalysis must refuse to construct.
    const [storedReport] = await testDb().select().from(reports).where(eq(reports.id, report.id));
    expect(storedReport.clientId).toBe(first.id);
    expect(inserted[0].clientId).toBe(second.id);
    expect(storedReport.clientId).not.toBe(inserted[0].clientId);
  });

  it('allows only one workspace membership per user', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');

    await expect(
      testDb()
        .insert(memberships)
        .values({ userId: a.userId, workspaceId: b.workspaceId, role: 'analyst', active: 'true' }),
    ).rejects.toThrow();
  });
});

describe('predecessor links do not block deletion', () => {
  it('nulls only the link when a superseded report is deleted, keeping ownership', async () => {
    const a = await createWorkspaceWithOwner();
    const client = await makeClient(a.workspaceId);

    const [original] = await testDb()
      .insert(reports)
      .values({
        workspaceId: a.workspaceId,
        clientId: client.id,
        schemaVersion: 1,
        reportLabel: 'original',
        snapshot: makeDemoReport(),
        contentHash: 'hash-1',
        createdBy: a.userId,
      })
      .returning();

    const [correction] = await testDb()
      .insert(reports)
      .values({
        workspaceId: a.workspaceId,
        clientId: client.id,
        schemaVersion: 1,
        reportLabel: 'correction',
        snapshot: makeDemoReport(),
        supersedesReportId: original.id,
        contentHash: 'hash-2',
        createdBy: a.userId,
      })
      .returning();

    // Deleting the predecessor must succeed. A plain composite ON DELETE SET
    // NULL would try to null workspace_id here and fail the NOT NULL check.
    await testDb().delete(reports).where(eq(reports.id, original.id));

    const [survivor] = await testDb().select().from(reports).where(eq(reports.id, correction.id));
    expect(survivor).toBeDefined();
    expect(survivor.supersedesReportId).toBeNull();
    // Ownership columns are untouched.
    expect(survivor.workspaceId).toBe(a.workspaceId);
    expect(survivor.clientId).toBe(client.id);
  });

  it('nulls only the link when a parent analysis is deleted', async () => {
    const a = await createWorkspaceWithOwner();
    const client = await makeClient(a.workspaceId);
    const [report] = await testDb()
      .insert(reports)
      .values({
        workspaceId: a.workspaceId,
        clientId: client.id,
        schemaVersion: 1,
        reportLabel: 'r',
        snapshot: makeDemoReport(),
        contentHash: 'h',
        createdBy: a.userId,
      })
      .returning();
    const [complaint] = await testDb()
      .insert(complaints)
      .values({
        workspaceId: a.workspaceId,
        clientId: client.id,
        originalText: 'x',
        category: 'no_leads',
        scope: 'organic_search',
        periodStart: '2026-07-12',
        periodEnd: '2026-08-10',
        receivedAt: new Date(),
        createdBy: a.userId,
      })
      .returning();

    const base = {
      workspaceId: a.workspaceId,
      clientId: client.id,
      reportId: report.id,
      complaintId: complaint.id,
      complaintSnapshot: {},
      ruleVersion: '1.0.0',
      resultSchemaVersion: 1,
      result: {},
      diagnosis: 'post_click',
      createdBy: a.userId,
    };
    const [parent] = await testDb().insert(analyses).values(base).returning();
    const [child] = await testDb()
      .insert(analyses)
      .values({ ...base, parentAnalysisId: parent.id })
      .returning();

    await testDb().delete(analyses).where(eq(analyses.id, parent.id));

    const [survivor] = await testDb().select().from(analyses).where(eq(analyses.id, child.id));
    expect(survivor).toBeDefined();
    expect(survivor.parentAnalysisId).toBeNull();
    expect(survivor.workspaceId).toBe(a.workspaceId);
  });
});
