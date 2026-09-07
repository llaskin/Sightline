import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as analysesRoute from '@/app/api/analyses/route';
import * as analysisRoute from '@/app/api/analyses/[id]/route';
import { analyses, complaints as complaintsTable, responseTemplates } from '@/server/db/schema';
import { resetDatabase, closeDatabase, testDb } from '../helpers/database';
import { createWorkspaceWithOwner, type TestUser } from '../helpers/auth';
import { call } from '../helpers/api';
import { seedReportAndComplaint } from '../helpers/scenario';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

type Analysis = {
  id: string;
  diagnosis: string;
  ruleVersion: string;
  result: {
    diagnosis: string;
    complaintAssessment: string;
    evidenceStrength: string;
    findings: Array<{ ruleId: string; values: Record<string, number | null> }>;
  };
  response: { revision: number; generatedText: string; editedText: string | null };
};

function createAnalysis(
  user: TestUser,
  body: Record<string, unknown>,
  key = `key-${Math.random()}`,
) {
  return call<Analysis>(analysesRoute.POST, {
    method: 'POST',
    path: '/api/analyses',
    user,
    headers: { 'idempotency-key': key },
    body,
  });
}

// ---------------------------------------------------------------------------
// Creating an analysis
// ---------------------------------------------------------------------------

describe('creating an analysis', () => {
  it('produces the demo result and saves it with its first response revision', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);

    const created = await createAnalysis(owner, {
      reportId: seed.reportId,
      complaintId: seed.complaintId,
    });

    expect(created.status).toBe(201);
    expect(created.data.result.diagnosis).toBe('post_click');
    expect(created.data.result.complaintAssessment).toBe('unverified');
    expect(created.data.result.evidenceStrength).toBe('moderate');
    expect(created.data.ruleVersion).toBe('1.0.0');
    expect(created.data.response.revision).toBe(1);
    expect(created.data.response.generatedText).toContain('+74%');
    expect(created.data.response.editedText).toBeNull();
  });

  it('moves the complaint from open to analyzed', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    await createAnalysis(owner, { reportId: seed.reportId, complaintId: seed.complaintId });

    const [complaint] = await testDb()
      .select()
      .from(complaintsTable)
      .where(eq(complaintsTable.id, seed.complaintId));
    expect(complaint.status).toBe('analyzed');
  });

  it('refuses a report and complaint belonging to different clients', async () => {
    const owner = await createWorkspaceWithOwner();
    const first = await seedReportAndComplaint(owner, { clientName: 'First' });
    const second = await seedReportAndComplaint(owner, { clientName: 'Second' });

    const mismatched = await createAnalysis(owner, {
      reportId: first.reportId,
      complaintId: second.complaintId,
    });
    expect(mismatched.status).toBe(422);

    const all = await testDb().select().from(analyses);
    expect(all).toHaveLength(0);
  });

  it('refuses a report from another workspace', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const seedA = await seedReportAndComplaint(a);
    const seedB = await seedReportAndComplaint(b);

    const denied = await createAnalysis(a, {
      reportId: seedB.reportId,
      complaintId: seedA.complaintId,
    });
    expect(denied.status).toBe(404);
  });

  it('creates only one analysis for a repeated request key', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);

    const first = await createAnalysis(
      owner,
      { reportId: seed.reportId, complaintId: seed.complaintId },
      'retry',
    );
    const second = await createAnalysis(
      owner,
      { reportId: seed.reportId, complaintId: seed.complaintId },
      'retry',
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.data.id).toBe(first.data.id);
    expect((await testDb().select().from(analyses))).toHaveLength(1);
  });

  it('saves an insufficient-evidence result as a real analysis rather than failing', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner, { tinyTraffic: true });

    const created = await createAnalysis(owner, {
      reportId: seed.reportId,
      complaintId: seed.complaintId,
    });
    expect(created.status).toBe(201);
    expect(created.data.result.diagnosis).toBe('insufficient_evidence');
    expect(created.data.response.generatedText.length).toBeGreaterThan(0);
  });

  it('records a predecessor when reanalysing, without altering the original', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const first = await createAnalysis(owner, {
      reportId: seed.reportId,
      complaintId: seed.complaintId,
    });

    const second = await createAnalysis(owner, {
      reportId: seed.reportId,
      complaintId: seed.complaintId,
      parentAnalysisId: first.data.id,
    });
    expect(second.status).toBe(201);
    expect(second.data.id).not.toBe(first.data.id);

    const [original] = await testDb().select().from(analyses).where(eq(analyses.id, first.data.id));
    expect(original.parentAnalysisId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-01 / AC-18 — persistence and immutability
// ---------------------------------------------------------------------------

describe('AC-18 historical immutability', () => {
  it('does not recompute a saved result when the complaint text later changes', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const created = await createAnalysis(owner, {
      reportId: seed.reportId,
      complaintId: seed.complaintId,
    });

    await testDb()
      .update(complaintsTable)
      .set({ originalText: 'Completely different wording', category: 'traffic_down' })
      .where(eq(complaintsTable.id, seed.complaintId));

    const reread = await call<Analysis & { complaintSnapshot: { originalText: string; category: string } }>(
      analysisRoute.GET,
      { path: `/api/analyses/${created.data.id}`, user: owner, params: { id: created.data.id } },
    );

    // The snapshot preserves what was analysed, not what the complaint says now.
    expect(reread.data.complaintSnapshot.category).toBe('no_leads');
    expect(reread.data.complaintSnapshot.originalText).not.toBe('Completely different wording');
    expect(reread.data.result.diagnosis).toBe('post_click');
  });

  it('keeps a stored result unchanged when the rule version moves on', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const created = await createAnalysis(owner, {
      reportId: seed.reportId,
      complaintId: seed.complaintId,
    });

    // Simulate an upgraded engine having written a different historical result.
    await testDb()
      .update(analyses)
      .set({ ruleVersion: '0.9.0', diagnosis: 'search_acquisition', result: { ...created.data.result, diagnosis: 'search_acquisition', ruleVersion: '0.9.0' } })
      .where(eq(analyses.id, created.data.id));

    const reread = await call<Analysis>(analysisRoute.GET, {
      path: `/api/analyses/${created.data.id}`,
      user: owner,
      params: { id: created.data.id },
    });
    // The read returns exactly what was stored; it never re-runs today's rules.
    expect(reread.data.ruleVersion).toBe('0.9.0');
    expect(reread.data.result.diagnosis).toBe('search_acquisition');
  });

  it('keeps the response template snapshot even after the template is edited', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const created = await createAnalysis(owner, {
      reportId: seed.reportId,
      complaintId: seed.complaintId,
    });
    const originalText = created.data.response.generatedText;

    await testDb()
      .update(responseTemplates)
      .set({ body: 'Hi {{client_name}}, replaced entirely. {{sender_name}}' })
      .where(eq(responseTemplates.workspaceId, owner.workspaceId));

    const reread = await call<Analysis>(analysisRoute.GET, {
      path: `/api/analyses/${created.data.id}`,
      user: owner,
      params: { id: created.data.id },
    });
    expect(reread.data.response.generatedText).toBe(originalText);
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe('history', () => {
  it('filters by client and diagnosis and paginates', async () => {
    const owner = await createWorkspaceWithOwner();
    const first = await seedReportAndComplaint(owner, { clientName: 'First' });
    const second = await seedReportAndComplaint(owner, { clientName: 'Second' });
    await createAnalysis(owner, { reportId: first.reportId, complaintId: first.complaintId });
    await createAnalysis(owner, { reportId: second.reportId, complaintId: second.complaintId });

    const byClient = await call<{ items: Analysis[] }>(analysesRoute.GET, {
      path: `/api/analyses?clientId=${first.clientId}`,
      user: owner,
    });
    expect(byClient.data.items).toHaveLength(1);

    const byDiagnosis = await call<{ items: Analysis[] }>(analysesRoute.GET, {
      path: '/api/analyses?diagnosis=post_click',
      user: owner,
    });
    expect(byDiagnosis.data.items).toHaveLength(2);

    const none = await call<{ items: Analysis[] }>(analysesRoute.GET, {
      path: '/api/analyses?diagnosis=measurement_issue',
      user: owner,
    });
    expect(none.data.items).toHaveLength(0);
  });

  it('does not return full result snapshots in a listing', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    await createAnalysis(owner, { reportId: seed.reportId, complaintId: seed.complaintId });

    const list = await call<{ items: Array<Record<string, unknown>> }>(analysesRoute.GET, {
      path: '/api/analyses',
      user: owner,
    });
    expect(list.data.items[0]).not.toHaveProperty('result');
    expect(list.data.items[0]).toHaveProperty('diagnosis');
  });

  it('does not list another workspace’s analyses', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const seed = await seedReportAndComplaint(b);
    await createAnalysis(b, { reportId: seed.reportId, complaintId: seed.complaintId });

    const list = await call<{ items: Analysis[] }>(analysesRoute.GET, {
      path: '/api/analyses',
      user: a,
    });
    expect(list.data.items).toHaveLength(0);
  });
});
