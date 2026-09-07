import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as importsRoute from '@/app/api/imports/route';
import * as importRoute from '@/app/api/imports/[id]/route';
import * as validateRoute from '@/app/api/imports/[id]/validate/route';
import * as commitRoute from '@/app/api/imports/[id]/commit/route';
import * as reportsRoute from '@/app/api/reports/route';
import * as reportRoute from '@/app/api/reports/[id]/route';
import * as clientsRoute from '@/app/api/clients/route';
import { reports, importDrafts, idempotencyRecords } from '@/server/db/schema';
import { makeDemoReport } from '@/domain/fixtures/demo-report';
import { resetDatabase, closeDatabase, testDb } from '../helpers/database';
import { createWorkspaceWithOwner, type TestUser } from '../helpers/auth';
import { call } from '../helpers/api';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

type Draft = { id: string; revision: number; state: string; contentHash: string | null };
type Report = { id: string; reportLabel: string; snapshot: unknown; supersedesReportId: string | null };

async function makeClient(user: TestUser) {
  const response = await call<{ id: string }>(clientsRoute.POST, {
    method: 'POST',
    path: '/api/clients',
    user,
    body: { name: 'Northstar Services', domain: 'example.com', timeZone: 'America/New_York' },
  });
  return response.data;
}

/** A complete draft payload equal to the fictional demo report. */
function demoPayload() {
  const report = makeDemoReport();
  return {
    metadata: report.metadata,
    datasets: report.datasets,
    sources: report.sources,
    selectedForm: report.selectedForm,
    formDefinitionAcknowledged: report.formDefinitionAcknowledged,
    trendGranularity: report.trendGranularity,
  };
}

async function draftReadyToCommit(user: TestUser, clientId: string, overrides = {}) {
  const created = await call<Draft>(importsRoute.POST, {
    method: 'POST',
    path: '/api/imports',
    user,
    body: { clientId },
  });
  expect(created.status).toBe(201);

  const saved = await call<Draft>(importRoute.PATCH, {
    method: 'PATCH',
    path: `/api/imports/${created.data.id}`,
    user,
    params: { id: created.data.id },
    body: { expectedRevision: created.data.revision, ...demoPayload(), ...overrides },
  });
  expect(saved.status).toBe(200);

  const validated = await call<Draft & { errors: unknown[] }>(validateRoute.POST, {
    method: 'POST',
    path: `/api/imports/${created.data.id}/validate`,
    user,
    params: { id: created.data.id },
    body: { expectedRevision: saved.data.revision },
  });
  expect(validated.status).toBe(200);
  expect(validated.data.state).toBe('validated');
  expect(validated.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
  return validated.data;
}

function commit(user: TestUser, draft: Draft, key: string, body: Record<string, unknown> = {}) {
  return call<Report>(commitRoute.POST, {
    method: 'POST',
    path: `/api/imports/${draft.id}/commit`,
    user,
    params: { id: draft.id },
    headers: { 'idempotency-key': key },
    body: { expectedRevision: draft.revision, contentHash: draft.contentHash, ...body },
  });
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('committing a validated draft', () => {
  it('creates one immutable report and marks the draft committed', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    const committed = await commit(owner, draft, 'key-1');
    expect(committed.status).toBe(201);
    expect(committed.data.reportLabel).toBe('10 August 2026 Report');

    const stored = await call<Report>(reportRoute.GET, {
      path: `/api/reports/${committed.data.id}`,
      user: owner,
      params: { id: committed.data.id },
    });
    expect(stored.status).toBe(200);

    const rows = await testDb().select().from(importDrafts).where(eq(importDrafts.id, draft.id));
    expect(rows[0].state).toBe('committed');
  });

  it('lists reports filtered by client', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);
    await commit(owner, draft, 'key-list');

    const list = await call<{ items: Report[] }>(reportsRoute.GET, {
      path: `/api/reports?clientId=${client.id}`,
      user: owner,
    });
    expect(list.data.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-13 — retries, concurrency and staleness
// ---------------------------------------------------------------------------

describe('AC-13 idempotency', () => {
  it('returns the same report for a repeated commit, creating only one', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    const first = await commit(owner, draft, 'double-click');
    const second = await commit(owner, draft, 'double-click');

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.data.id);
    expect(second.body.replayed).toBe(true);

    const all = await testDb().select().from(reports);
    expect(all).toHaveLength(1);
  });

  it('creates exactly one report when the same key is committed in parallel', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    const results = await Promise.all([
      commit(owner, draft, 'parallel'),
      commit(owner, draft, 'parallel'),
      commit(owner, draft, 'parallel'),
    ]);

    const succeeded = results.filter((r) => r.status === 201 || r.status === 200);
    expect(succeeded.length).toBe(3);
    const ids = new Set(succeeded.map((r) => r.data.id));
    expect(ids.size).toBe(1);

    const all = await testDb().select().from(reports);
    expect(all).toHaveLength(1);
  });

  it('rejects the same key with a different request body', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const first = await draftReadyToCommit(owner, client.id);
    await commit(owner, first, 'reused-key');

    const second = await draftReadyToCommit(owner, client.id);
    const conflict = await commit(owner, second, 'reused-key');
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('requires an idempotency key on commit', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    const missing = await call(commitRoute.POST, {
      method: 'POST',
      path: `/api/imports/${draft.id}/commit`,
      user: owner,
      params: { id: draft.id },
      body: { expectedRevision: draft.revision, contentHash: draft.contentHash },
    });
    expect(missing.status).toBe(422);
  });
});

describe('AC-13 staleness', () => {
  it('rejects a commit whose content hash no longer matches the edited draft', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    // An edit invalidates validation and increments the revision.
    const edited = await call<Draft>(importRoute.PATCH, {
      method: 'PATCH',
      path: `/api/imports/${draft.id}`,
      user: owner,
      params: { id: draft.id },
      body: { expectedRevision: draft.revision, ...demoPayload(), metadata: { ...demoPayload().metadata, reportLabel: 'Changed' } },
    });
    expect(edited.data.state).toBe('draft');
    expect(edited.data.contentHash).toBeNull();

    const stale = await commit(owner, draft, 'stale-key');
    expect(stale.status).toBe(409);

    const all = await testDb().select().from(reports);
    expect(all).toHaveLength(0);
  });

  it('rejects a commit with a stale revision', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    const stale = await commit(owner, { ...draft, revision: draft.revision - 1 }, 'stale-rev');
    expect(stale.status).toBe(409);
  });

  it('refuses to commit a draft that was never validated', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const created = await call<Draft>(importsRoute.POST, {
      method: 'POST',
      path: '/api/imports',
      user: owner,
      body: { clientId: client.id },
    });
    const saved = await call<Draft>(importRoute.PATCH, {
      method: 'PATCH',
      path: `/api/imports/${created.data.id}`,
      user: owner,
      params: { id: created.data.id },
      body: { expectedRevision: created.data.revision, ...demoPayload() },
    });

    const result = await call(commitRoute.POST, {
      method: 'POST',
      path: `/api/imports/${created.data.id}/commit`,
      user: owner,
      params: { id: created.data.id },
      headers: { 'idempotency-key': 'unvalidated' },
      body: { expectedRevision: saved.data.revision, contentHash: 'a'.repeat(64) },
    });
    expect(result.status).toBe(409);
  });

  it('refuses to commit an expired draft', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    await testDb()
      .update(importDrafts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(importDrafts.id, draft.id));

    const expired = await commit(owner, draft, 'expired');
    expect(expired.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Validation failures never create a report
// ---------------------------------------------------------------------------

describe('validation failures', () => {
  it('reports field errors and refuses to validate an incomplete draft', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const created = await call<Draft>(importsRoute.POST, {
      method: 'POST',
      path: '/api/imports',
      user: owner,
      body: { clientId: client.id },
    });

    const payload = demoPayload();
    // Lead sessions exceeding sessions is structurally invalid.
    payload.datasets.organic[1].leadSessions = 999_999;
    const saved = await call<Draft>(importRoute.PATCH, {
      method: 'PATCH',
      path: `/api/imports/${created.data.id}`,
      user: owner,
      params: { id: created.data.id },
      body: { expectedRevision: created.data.revision, ...payload },
    });

    const validated = await call<{ ok: boolean; errors: Array<{ field: string | null }> }>(
      validateRoute.POST,
      {
        method: 'POST',
        path: `/api/imports/${created.data.id}/validate`,
        user: owner,
        params: { id: created.data.id },
        body: { expectedRevision: saved.data.revision },
      },
    );
    expect(validated.status).toBe(200);
    expect(validated.data.ok).toBe(false);
    expect(validated.data.errors.length).toBeGreaterThan(0);

    const all = await testDb().select().from(reports);
    expect(all).toHaveLength(0);
  });

  it('caps returned errors while reporting the true total', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const created = await call<Draft>(importsRoute.POST, {
      method: 'POST',
      path: '/api/imports',
      user: owner,
      body: { clientId: client.id },
    });
    const payload = demoPayload();
    // Many invalid landing-page paths at once.
    payload.datasets.landingPages = Array.from({ length: 150 }, (_, i) => ({
      period: 'current' as const,
      path: `no-leading-slash-${i}`,
      sessions: 1,
    }));
    const saved = await call<Draft>(importRoute.PATCH, {
      method: 'PATCH',
      path: `/api/imports/${created.data.id}`,
      user: owner,
      params: { id: created.data.id },
      body: { expectedRevision: created.data.revision, ...payload },
    });
    const validated = await call<{ ok: boolean; errors: unknown[]; totalErrorCount: number }>(
      validateRoute.POST,
      {
        method: 'POST',
        path: `/api/imports/${created.data.id}/validate`,
        user: owner,
        params: { id: created.data.id },
        body: { expectedRevision: saved.data.revision },
      },
    );
    expect(validated.data.ok).toBe(false);
    expect(validated.data.errors.length).toBeLessThanOrEqual(100);
    expect(validated.data.totalErrorCount).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation and corrections
// ---------------------------------------------------------------------------

describe('tenant isolation', () => {
  it('refuses a draft for a client in another workspace', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const clientOfB = await makeClient(b);

    const denied = await call(importsRoute.POST, {
      method: 'POST',
      path: '/api/imports',
      user: a,
      body: { clientId: clientOfB.id },
    });
    expect(denied.status).toBe(404);
  });

  it('refuses to read or commit another workspace’s draft', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const clientOfB = await makeClient(b);
    const draftOfB = await draftReadyToCommit(b, clientOfB.id);

    const read = await call(importRoute.GET, {
      path: `/api/imports/${draftOfB.id}`,
      user: a,
      params: { id: draftOfB.id },
    });
    expect(read.status).toBe(404);

    const committed = await commit(a, draftOfB, 'foreign');
    expect(committed.status).toBe(404);
  });

  it('refuses to read another workspace’s report', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const clientOfB = await makeClient(b);
    const draft = await draftReadyToCommit(b, clientOfB.id);
    const report = await commit(b, draft, 'k');

    const denied = await call(reportRoute.GET, {
      path: `/api/reports/${report.data.id}`,
      user: a,
      params: { id: report.data.id },
    });
    expect(denied.status).toBe(404);
  });
});

describe('AC-18 corrections preserve the original', () => {
  it('creates a new report linked to its predecessor, leaving the original intact', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const first = await draftReadyToCommit(owner, client.id);
    const original = await commit(owner, first, 'original');

    const correctedPayload = demoPayload();
    correctedPayload.datasets.organic[1].sessions = 12_600;
    correctedPayload.datasets.trafficTrend![5].sessions = 12_600;
    const second = await draftReadyToCommit(owner, client.id, correctedPayload);
    const corrected = await commit(owner, second, 'correction', {
      supersedesReportId: original.data.id,
    });

    expect(corrected.status).toBe(201);
    expect(corrected.data.supersedesReportId).toBe(original.data.id);

    // The original snapshot is byte-for-byte unchanged.
    const [storedOriginal] = await testDb()
      .select()
      .from(reports)
      .where(eq(reports.id, original.data.id));
    const snapshot = storedOriginal.snapshot as { datasets: { organic: Array<{ sessions: number }> } };
    expect(snapshot.datasets.organic[1].sessions).toBe(12_540);
  });

  it('refuses a predecessor belonging to another client', async () => {
    const owner = await createWorkspaceWithOwner();
    const clientA = await makeClient(owner);
    const clientB = await makeClient(owner);
    const draftA = await draftReadyToCommit(owner, clientA.id);
    const reportA = await commit(owner, draftA, 'a');

    const draftB = await draftReadyToCommit(owner, clientB.id);
    const denied = await commit(owner, draftB, 'b', { supersedesReportId: reportA.data.id });
    expect(denied.status).toBe(404);
  });
});

describe('rollback', () => {
  it('leaves no idempotency record when the commit fails', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await makeClient(owner);
    const draft = await draftReadyToCommit(owner, client.id);

    const failed = await commit(owner, draft, 'will-fail', {
      supersedesReportId: '00000000-0000-4000-8000-000000000000',
    });
    expect(failed.status).toBe(404);

    const keys = await testDb().select().from(idempotencyRecords);
    expect(keys).toHaveLength(0);
    const all = await testDb().select().from(reports);
    expect(all).toHaveLength(0);
  });
});
