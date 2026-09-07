import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  analyses,
  auditEvents,
  clients,
  complaints,
  idempotencyRecords,
  importDrafts,
  reports,
  responseRevisions,
  workspaces,
} from '@/server/db/schema';
import { applyRetention, expireDrafts, retentionPreview } from '@/server/services/retention';
import { deleteClient } from '@/server/services/delete-client';
import { ForbiddenError } from '@/server/require-membership';
import { resetDatabase, closeDatabase, testDb } from '../helpers/database';
import { createWorkspaceWithOwner, addAnalyst, type TestUser } from '../helpers/auth';
import { seedReportAndComplaint } from '../helpers/scenario';
import { call } from '../helpers/api';
import * as analysesRoute from '@/app/api/analyses/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import { requireMembership } from '@/server/require-membership';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

const DAY = 86_400_000;

async function analysisFor(user: TestUser, key = `k-${Math.random()}`) {
  const seed = await seedReportAndComplaint(user);
  const created = await call<{ id: string }>(analysesRoute.POST, {
    method: 'POST',
    path: '/api/analyses',
    user,
    headers: { 'idempotency-key': key },
    body: { reportId: seed.reportId, complaintId: seed.complaintId },
  });
  expect(created.status).toBe(201);
  return { ...seed, analysisId: created.data.id };
}

/** Backdates a row so a cutoff can be exercised without waiting. */
async function backdate(analysisId: string, days: number) {
  const when = new Date(Date.now() - days * DAY);
  await testDb().update(analyses).set({ createdAt: when }).where(eq(analyses.id, analysisId));
  await testDb()
    .update(responseRevisions)
    .set({ createdAt: when })
    .where(eq(responseRevisions.analysisId, analysisId));
}

async function backdateReport(reportId: string, days: number) {
  await testDb()
    .update(reports)
    .set({ createdAt: new Date(Date.now() - days * DAY) })
    .where(eq(reports.id, reportId));
}

async function setRetention(workspaceId: string, days: number | null) {
  await testDb().update(workspaces).set({ retentionDays: days }).where(eq(workspaces.id, workspaceId));
}

// ---------------------------------------------------------------------------
// AC-21 retention
// ---------------------------------------------------------------------------

describe('AC-21 retention', () => {
  it('does nothing when a workspace keeps everything', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await analysisFor(owner);
    await backdate(seed.analysisId, 900);

    const applied = await applyRetention({ now: new Date() });
    expect(applied.analysesDeleted).toBe(0);
    expect(await testDb().select().from(analyses)).toHaveLength(1);
  });

  it('deletes analyses and their response revisions past the cutoff', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const old = await analysisFor(owner, 'old');
    await backdate(old.analysisId, 120);

    const applied = await applyRetention({ now: new Date() });
    expect(applied.analysesDeleted).toBe(1);
    expect(await testDb().select().from(analyses)).toHaveLength(0);
    expect(await testDb().select().from(responseRevisions)).toHaveLength(0);
  });

  it('treats the cutoff boundary exactly: 90 days old survives, 91 does not', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const justInside = await analysisFor(owner, 'inside');
    await backdate(justInside.analysisId, 89);

    expect((await applyRetention({ now: new Date() })).analysesDeleted).toBe(0);

    await backdate(justInside.analysisId, 91);
    expect((await applyRetention({ now: new Date() })).analysesDeleted).toBe(1);
  });

  it('keeps an old report that a retained analysis still references', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const seed = await analysisFor(owner, 'recent');
    // The report is old, but its analysis is recent and must be readable.
    await backdateReport(seed.reportId, 200);

    const applied = await applyRetention({ now: new Date() });
    expect(applied.analysesDeleted).toBe(0);
    expect(applied.reportsDeleted).toBe(0);
    expect(await testDb().select().from(reports)).toHaveLength(1);
  });

  it('deletes an old report once no retained analysis references it', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const seed = await analysisFor(owner, 'stale');
    await backdate(seed.analysisId, 200);
    await backdateReport(seed.reportId, 200);

    const applied = await applyRetention({ now: new Date() });
    expect(applied.analysesDeleted).toBe(1);
    expect(applied.reportsDeleted).toBe(1);
    expect(await testDb().select().from(reports)).toHaveLength(0);
  });

  it('keeps complaints and clients, which go only by explicit deletion', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const seed = await analysisFor(owner, 'keepc');
    await backdate(seed.analysisId, 200);
    await backdateReport(seed.reportId, 200);

    await applyRetention({ now: new Date() });
    expect(await testDb().select().from(complaints)).toHaveLength(1);
    expect(await testDb().select().from(clients)).toHaveLength(1);
  });

  it('removes idempotency records whose result no longer exists', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const seed = await analysisFor(owner, 'idem');
    expect((await testDb().select().from(idempotencyRecords)).length).toBeGreaterThan(0);

    await backdate(seed.analysisId, 200);
    await backdateReport(seed.reportId, 200);
    const applied = await applyRetention({ now: new Date() });

    expect(applied.idempotencyRecordsDeleted).toBeGreaterThan(0);
    const remaining = await testDb().select().from(idempotencyRecords);
    // Nothing points at a deleted result.
    expect(remaining.every((row) => row.operation !== 'create-analysis')).toBe(true);
  });

  it('is safe to run twice', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const seed = await analysisFor(owner, 'twice');
    await backdate(seed.analysisId, 200);
    await backdateReport(seed.reportId, 200);

    const first = await applyRetention({ now: new Date() });
    const second = await applyRetention({ now: new Date() });
    expect(first.analysesDeleted).toBe(1);
    expect(second.analysesDeleted).toBe(0);
    expect(second.reportsDeleted).toBe(0);
  });

  it('reports counts without deleting anything in preview mode', async () => {
    const owner = await createWorkspaceWithOwner();
    await setRetention(owner.workspaceId, 90);
    const seed = await analysisFor(owner, 'dry');
    await backdate(seed.analysisId, 200);
    await backdateReport(seed.reportId, 200);

    const preview = await retentionPreview({ now: new Date() });
    expect(preview.analysesDeleted).toBe(1);
    // Nothing was actually removed.
    expect(await testDb().select().from(analyses)).toHaveLength(1);
  });

  it('does not touch another workspace with no retention set', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    await setRetention(a.workspaceId, 90);

    const oldA = await analysisFor(a, 'a-old');
    const oldB = await analysisFor(b, 'b-old');
    await backdate(oldA.analysisId, 200);
    await backdate(oldB.analysisId, 200);

    await applyRetention({ now: new Date() });
    const remaining = await testDb().select().from(analyses);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workspaceId).toBe(b.workspaceId);
  });
});

describe('draft expiry', () => {
  it('purges drafts past their expiry and leaves current ones', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const [draft] = await testDb()
      .insert(importDrafts)
      .values({
        workspaceId: owner.workspaceId,
        clientId: seed.clientId,
        payload: {},
        expiresAt: new Date(Date.now() - DAY),
        createdBy: owner.userId,
      })
      .returning();
    await testDb().insert(importDrafts).values({
      workspaceId: owner.workspaceId,
      clientId: seed.clientId,
      payload: {},
      expiresAt: new Date(Date.now() + DAY),
      createdBy: owner.userId,
    });

    const purged = await expireDrafts({ now: new Date() });
    expect(purged.draftsDeleted).toBe(1);
    const remaining = await testDb().select().from(importDrafts);
    expect(remaining.every((row) => row.id !== draft.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-21 client deletion
// ---------------------------------------------------------------------------

describe('AC-21 owner deletion of a client', () => {
  it('removes every dependent record in one transaction', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await analysisFor(owner, 'del');
    const context = await requireMembership(owner.headers);

    const result = await deleteClient(context, seed.clientId, 'Northstar Services');
    expect(result.deleted).toBe(true);

    expect(await testDb().select().from(clients)).toHaveLength(0);
    expect(await testDb().select().from(complaints)).toHaveLength(0);
    expect(await testDb().select().from(reports)).toHaveLength(0);
    expect(await testDb().select().from(analyses)).toHaveLength(0);
    expect(await testDb().select().from(responseRevisions)).toHaveLength(0);
    expect(await testDb().select().from(importDrafts)).toHaveLength(0);
  });

  it('retains only an opaque audit event with no client name, domain or content', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await analysisFor(owner, 'audit');
    const context = await requireMembership(owner.headers);
    await deleteClient(context, seed.clientId, 'Northstar Services');

    const events = await testDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'client.deleted'));
    expect(events).toHaveLength(1);

    const serialised = JSON.stringify(events[0]);
    expect(serialised).not.toContain('Northstar');
    expect(serialised).not.toContain('example.com');
    expect(serialised).not.toContain('leads');
  });

  it('requires the typed client name to match exactly', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await analysisFor(owner, 'typed');
    const context = await requireMembership(owner.headers);

    await expect(deleteClient(context, seed.clientId, 'northstar services')).rejects.toThrow();
    await expect(deleteClient(context, seed.clientId, 'Wrong Name')).rejects.toThrow();
    expect(await testDb().select().from(clients)).toHaveLength(1);
  });

  it('refuses an analyst', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);
    const seed = await analysisFor(owner, 'analyst');
    const context = await requireMembership(analyst.headers);

    await expect(deleteClient(context, seed.clientId, 'Northstar Services')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await testDb().select().from(clients)).toHaveLength(1);
  });

  it('refuses a client in another workspace and deletes nothing', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const seed = await analysisFor(b, 'foreign');
    const context = await requireMembership(a.headers);

    await expect(deleteClient(context, seed.clientId, 'Northstar Services')).rejects.toThrow();
    expect(await testDb().select().from(clients)).toHaveLength(1);
  });

  it('prunes idempotency records pointing at the deleted analyses', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await analysisFor(owner, 'prune');
    const context = await requireMembership(owner.headers);
    await deleteClient(context, seed.clientId, 'Northstar Services');

    const remaining = await testDb().select().from(idempotencyRecords);
    expect(remaining).toHaveLength(0);
  });
});

describe('deletion over HTTP', () => {
  it('deletes through the API when the owner types the name correctly', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await analysisFor(owner, 'http');

    const response = await call(clientRoute.DELETE, {
      method: 'DELETE',
      path: `/api/clients/${seed.clientId}`,
      user: owner,
      params: { id: seed.clientId },
      body: { confirmName: 'Northstar Services' },
    });
    expect(response.status).toBe(204);
    expect(await testDb().select().from(clients)).toHaveLength(0);
  });

  it('returns 422 when the typed name does not match', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await analysisFor(owner, 'http-bad');

    const response = await call(clientRoute.DELETE, {
      method: 'DELETE',
      path: `/api/clients/${seed.clientId}`,
      user: owner,
      params: { id: seed.clientId },
      body: { confirmName: 'wrong' },
    });
    expect(response.status).toBe(422);
    expect(await testDb().select().from(clients)).toHaveLength(1);
  });

  it('returns 403 for an analyst and 404 for another workspace', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);
    const other = await createWorkspaceWithOwner('Agency B');
    const seed = await analysisFor(owner, 'http-roles');

    const denied = await call(clientRoute.DELETE, {
      method: 'DELETE',
      path: `/api/clients/${seed.clientId}`,
      user: analyst,
      params: { id: seed.clientId },
      body: { confirmName: 'Northstar Services' },
    });
    expect(denied.status).toBe(403);

    const foreign = await call(clientRoute.DELETE, {
      method: 'DELETE',
      path: `/api/clients/${seed.clientId}`,
      user: other,
      params: { id: seed.clientId },
      body: { confirmName: 'Northstar Services' },
    });
    expect(foreign.status).toBe(404);
    expect(await testDb().select().from(clients)).toHaveLength(1);
  });
});
