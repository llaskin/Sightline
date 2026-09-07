import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as analysesRoute from '@/app/api/analyses/route';
import * as responseRoute from '@/app/api/analyses/[id]/response/route';
import * as regenerateRoute from '@/app/api/analyses/[id]/response/regenerate/route';
import * as templatesRoute from '@/app/api/templates/route';
import { resetDatabase, closeDatabase } from '../helpers/database';
import { createWorkspaceWithOwner, type TestUser } from '../helpers/auth';
import { call } from '../helpers/api';
import { seedReportAndComplaint } from '../helpers/scenario';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

type Response = {
  revision: number;
  generatedText: string;
  editedText: string | null;
  isEdited: boolean;
};

async function analysisWithResponse(user: TestUser) {
  const seed = await seedReportAndComplaint(user);
  const created = await call<{ id: string; response: Response }>(analysesRoute.POST, {
    method: 'POST',
    path: '/api/analyses',
    user,
    headers: { 'idempotency-key': `a-${seed.reportId}` },
    body: { reportId: seed.reportId, complaintId: seed.complaintId },
  });
  expect(created.status).toBe(201);
  return { analysisId: created.data.id, response: created.data.response };
}

function save(user: TestUser, analysisId: string, editedText: string, expectedRevision: number) {
  return call<Response>(responseRoute.PATCH, {
    method: 'PATCH',
    path: `/api/analyses/${analysisId}/response`,
    user,
    params: { id: analysisId },
    body: { editedText, expectedRevision },
  });
}

describe('saving a draft', () => {
  it('appends a revision and keeps the generated text separate from the edit', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);
    const original = response.generatedText;

    const saved = await save(owner, analysisId, 'My own wording for the client.', response.revision);
    expect(saved.status).toBe(200);
    expect(saved.data.revision).toBe(2);
    expect(saved.data.editedText).toBe('My own wording for the client.');
    // The engine's own text is preserved, not overwritten.
    expect(saved.data.generatedText).toBe(original);
    expect(saved.data.isEdited).toBe(true);
  });

  it('keeps every revision in history', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);
    await save(owner, analysisId, 'First edit', response.revision);
    await save(owner, analysisId, 'Second edit', response.revision + 1);

    const history = await call<{ items: Response[] }>(responseRoute.GET, {
      path: `/api/analyses/${analysisId}/response`,
      user: owner,
      params: { id: analysisId },
    });
    expect(history.data.items).toHaveLength(3);
    expect(history.data.items[0].revision).toBe(3);
  });

  it('rejects a draft longer than the documented cap', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);
    const tooLong = await save(owner, analysisId, 'a'.repeat(10_001), response.revision);
    expect(tooLong.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// AC-15 — conflicts
// ---------------------------------------------------------------------------

describe('AC-15 concurrent editing', () => {
  it('lets exactly one of two simultaneous saves win and hands the other the server text', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);

    const [first, second] = await Promise.all([
      save(owner, analysisId, 'Editor one wording', response.revision),
      save(owner, analysisId, 'Editor two wording', response.revision),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflicted = first.status === 409 ? first : second;
    expect(conflicted.code).toBe('REVISION_CONFLICT');
    // The losing caller is told the current revision and given the server's
    // text, so their own unsaved wording can be reconciled rather than lost.
    expect(conflicted.body.error.latestRevision).toBe(2);
    expect(typeof conflicted.body.error.serverText).toBe('string');
  });

  it('reports a conflict for a stale expected revision', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);
    await save(owner, analysisId, 'First', response.revision);

    const stale = await save(owner, analysisId, 'Second', response.revision);
    expect(stale.status).toBe(409);
    expect(stale.body.error.serverText).toBe('First');
  });
});

// ---------------------------------------------------------------------------
// Regeneration
// ---------------------------------------------------------------------------

describe('regeneration', () => {
  it('creates a new revision without destroying the previous edit', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);
    const edited = await save(owner, analysisId, 'Hand-written wording', response.revision);

    const regenerated = await call<Response>(regenerateRoute.POST, {
      method: 'POST',
      path: `/api/analyses/${analysisId}/response/regenerate`,
      user: owner,
      params: { id: analysisId },
      body: { expectedRevision: edited.data.revision },
    });
    expect(regenerated.status).toBe(200);
    expect(regenerated.data.revision).toBe(3);
    expect(regenerated.data.editedText).toBeNull();

    // The earlier hand-written revision is still in history.
    const history = await call<{ items: Response[] }>(responseRoute.GET, {
      path: `/api/analyses/${analysisId}/response`,
      user: owner,
      params: { id: analysisId },
    });
    expect(history.data.items.some((r) => r.editedText === 'Hand-written wording')).toBe(true);
  });

  it('refuses to regenerate over a stale revision', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);
    await save(owner, analysisId, 'Edit', response.revision);

    const stale = await call(regenerateRoute.POST, {
      method: 'POST',
      path: `/api/analyses/${analysisId}/response/regenerate`,
      user: owner,
      params: { id: analysisId },
      body: { expectedRevision: response.revision },
    });
    expect(stale.status).toBe(409);
  });

  it('renders from the saved result rather than re-running the rules', async () => {
    const owner = await createWorkspaceWithOwner();
    const { analysisId, response } = await analysisWithResponse(owner);

    const custom = await call<{ id: string }>(templatesRoute.POST, {
      method: 'POST',
      path: '/api/templates',
      user: owner,
      body: {
        name: 'Short',
        body: 'Hi {{client_name}}. {{evidence_summary}} {{caveats}} {{next_steps}} {{sender_name}}',
      },
    });

    const regenerated = await call<Response>(regenerateRoute.POST, {
      method: 'POST',
      path: `/api/analyses/${analysisId}/response/regenerate`,
      user: owner,
      params: { id: analysisId },
      body: { expectedRevision: response.revision, templateId: custom.data.id },
    });
    expect(regenerated.status).toBe(200);
    // Same stored evidence, new wrapper.
    expect(regenerated.data.generatedText).toContain('+74%');
    expect(regenerated.data.generatedText).toContain('Hi Northstar Services.');
  });

  it('refuses a template from another workspace', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const { analysisId, response } = await analysisWithResponse(a);
    const templateOfB = await call<{ id: string }>(templatesRoute.POST, {
      method: 'POST',
      path: '/api/templates',
      user: b,
      body: { name: 'B', body: 'Hi {{client_name}} {{sender_name}}' },
    });

    const denied = await call(regenerateRoute.POST, {
      method: 'POST',
      path: `/api/analyses/${analysisId}/response/regenerate`,
      user: a,
      params: { id: analysisId },
      body: { expectedRevision: response.revision, templateId: templateOfB.data.id },
    });
    expect(denied.status).toBe(404);
  });
});

describe('tenant isolation', () => {
  it('refuses to read or save another workspace’s response', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const { analysisId, response } = await analysisWithResponse(b);

    const read = await call(responseRoute.GET, {
      path: `/api/analyses/${analysisId}/response`,
      user: a,
      params: { id: analysisId },
    });
    expect(read.status).toBe(404);

    const written = await save(a, analysisId, 'hijack', response.revision);
    expect(written.status).toBe(404);
  });
});
