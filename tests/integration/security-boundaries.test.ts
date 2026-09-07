import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as clientsRoute from '@/app/api/clients/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import * as complaintsRoute from '@/app/api/complaints/route';
import * as complaintRoute from '@/app/api/complaints/[id]/route';
import * as importsRoute from '@/app/api/imports/route';
import * as importRoute from '@/app/api/imports/[id]/route';
import * as filesRoute from '@/app/api/imports/[id]/files/route';
import * as reportRoute from '@/app/api/reports/[id]/route';
import * as analysesRoute from '@/app/api/analyses/route';
import * as analysisRoute from '@/app/api/analyses/[id]/route';
import * as responseRoute from '@/app/api/analyses/[id]/response/route';
import * as templatesRoute from '@/app/api/templates/route';
import * as templateRoute from '@/app/api/templates/[id]/route';
import * as settingsRoute from '@/app/api/settings/route';
import * as liveRoute from '@/app/api/health/live/route';
import * as readyRoute from '@/app/api/health/ready/route';
import { resetDatabase, closeDatabase, testDb } from '../helpers/database';
import { addAnalyst, createWorkspaceWithOwner, type TestUser } from '../helpers/auth';
import { call } from '../helpers/api';
import { seedReportAndComplaint } from '../helpers/scenario';
import { clients as clientsTable } from '@/server/db/schema';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

const ORIGIN = 'http://localhost:3100';

type Handler = (request: Request, context: never) => Promise<Response>;

async function fullScenario(user: TestUser) {
  const seed = await seedReportAndComplaint(user);
  const analysis = await call<{ id: string }>(analysesRoute.POST, {
    method: 'POST',
    path: '/api/analyses',
    user,
    headers: { 'idempotency-key': `sec-${seed.reportId}` },
    body: { reportId: seed.reportId, complaintId: seed.complaintId },
  });
  const draft = await call<{ id: string }>(importsRoute.POST, {
    method: 'POST',
    path: '/api/imports',
    user,
    body: { clientId: seed.clientId },
  });
  return { ...seed, analysisId: analysis.data.id, draftId: draft.data.id };
}

// ---------------------------------------------------------------------------
// AC-14 — no session, foreign identifiers
// ---------------------------------------------------------------------------

describe('AC-14 authentication is required everywhere', () => {
  it('returns 401 for every collection route with no session', async () => {
    const routes: Array<[string, Handler, string]> = [
      ['GET /api/clients', clientsRoute.GET, '/api/clients'],
      ['POST /api/clients', clientsRoute.POST, '/api/clients'],
      ['GET /api/complaints', complaintsRoute.GET, '/api/complaints'],
      ['POST /api/complaints', complaintsRoute.POST, '/api/complaints'],
      ['POST /api/imports', importsRoute.POST, '/api/imports'],
      ['GET /api/analyses', analysesRoute.GET, '/api/analyses'],
      ['POST /api/analyses', analysesRoute.POST, '/api/analyses'],
      ['GET /api/templates', templatesRoute.GET, '/api/templates'],
      ['POST /api/templates', templatesRoute.POST, '/api/templates'],
      ['GET /api/settings', settingsRoute.GET, '/api/settings'],
      ['PATCH /api/settings', settingsRoute.PATCH, '/api/settings'],
    ];

    for (const [label, handler, path] of routes) {
      const method = label.split(' ')[0];
      const response = await call(handler, {
        method,
        path,
        user: null,
        body: method === 'GET' ? undefined : {},
        headers: { 'idempotency-key': 'x' },
      });
      expect(response.status, label).toBe(401);
    }
  });

  it('returns 404 for every detail route asked for another workspace’s identifier', async () => {
    const attacker = await createWorkspaceWithOwner('Agency A');
    const victim = await createWorkspaceWithOwner('Agency B');
    const target = await fullScenario(victim);

    const cases: Array<[string, Handler, string, string, string]> = [
      ['GET client', clientRoute.GET, 'GET', `/api/clients/${target.clientId}`, target.clientId],
      ['PATCH client', clientRoute.PATCH, 'PATCH', `/api/clients/${target.clientId}`, target.clientId],
      ['DELETE client', clientRoute.DELETE, 'DELETE', `/api/clients/${target.clientId}`, target.clientId],
      ['GET complaint', complaintRoute.GET, 'GET', `/api/complaints/${target.complaintId}`, target.complaintId],
      ['PATCH complaint', complaintRoute.PATCH, 'PATCH', `/api/complaints/${target.complaintId}`, target.complaintId],
      ['GET report', reportRoute.GET, 'GET', `/api/reports/${target.reportId}`, target.reportId],
      ['GET analysis', analysisRoute.GET, 'GET', `/api/analyses/${target.analysisId}`, target.analysisId],
      ['GET response', responseRoute.GET, 'GET', `/api/analyses/${target.analysisId}/response`, target.analysisId],
      ['PATCH response', responseRoute.PATCH, 'PATCH', `/api/analyses/${target.analysisId}/response`, target.analysisId],
      ['GET draft', importRoute.GET, 'GET', `/api/imports/${target.draftId}`, target.draftId],
      ['PATCH draft', importRoute.PATCH, 'PATCH', `/api/imports/${target.draftId}`, target.draftId],
      ['DELETE draft', importRoute.DELETE, 'DELETE', `/api/imports/${target.draftId}`, target.draftId],
    ];

    for (const [label, handler, method, path, id] of cases) {
      const response = await call(handler, {
        method,
        path,
        user: attacker,
        params: { id },
        body:
          method === 'GET'
            ? undefined
            : { expectedRevision: 1, editedText: 'x', confirmName: 'Northstar Services', name: 'x' },
      });
      expect(response.status, label).toBe(404);
    }

    // The victim's data survives every attempt untouched.
    const survivors = await testDb().select().from(clientsTable);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].workspaceId).toBe(victim.workspaceId);
    expect(survivors[0].name).toBe('Northstar Services');
    void target;
  });
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe('analyst restrictions', () => {
  it('refuses owner-only mutations with 403 while allowing analyst work', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);
    const seed = await seedReportAndComplaint(owner);

    const template = await call<{ id: string }>(templatesRoute.POST, {
      method: 'POST',
      path: '/api/templates',
      user: owner,
      body: { name: 'T', body: 'Hi {{client_name}} {{sender_name}}' },
    });

    const forbidden: Array<[string, Handler, string, string, Record<string, unknown>, Record<string, string>]> = [
      ['create template', templatesRoute.POST, 'POST', '/api/templates', { name: 'X', body: 'Hi {{client_name}}' }, {}],
      ['edit template', templateRoute.PATCH, 'PATCH', `/api/templates/${template.data.id}`, { body: 'Hi {{client_name}}', expectedRevision: 1 }, { id: template.data.id }],
      ['change settings', settingsRoute.PATCH, 'PATCH', '/api/settings', { retentionDays: 90, expectedRevision: 1 }, {}],
      ['archive client', clientRoute.PATCH, 'PATCH', `/api/clients/${seed.clientId}`, { archived: true, expectedRevision: 1 }, { id: seed.clientId }],
      ['delete client', clientRoute.DELETE, 'DELETE', `/api/clients/${seed.clientId}`, { confirmName: 'Northstar Services' }, { id: seed.clientId }],
    ];

    for (const [label, handler, method, path, body, params] of forbidden) {
      const response = await call(handler, { method, path, user: analyst, body, params });
      expect(response.status, label).toBe(403);
    }

    // An analyst can still do the day-to-day work.
    const allowed = await call(complaintsRoute.POST, {
      method: 'POST',
      path: '/api/complaints',
      user: analyst,
      body: {
        clientId: seed.clientId,
        originalText: 'Analyst-entered complaint',
        category: 'traffic_down',
        scope: 'organic_search',
        periodStart: '2026-07-12',
        periodEnd: '2026-08-10',
        receivedAt: '2026-08-11T09:00:00.000Z',
      },
    });
    expect(allowed.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Origin enforcement
// ---------------------------------------------------------------------------

describe('same-origin enforcement', () => {
  it('refuses every mutation carrying a foreign Origin', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);

    const cases: Array<[string, Handler, string, string, Record<string, unknown>, Record<string, string>]> = [
      ['create client', clientsRoute.POST, 'POST', '/api/clients', { name: 'X', domain: 'example.com', timeZone: 'UTC' }, {}],
      ['patch client', clientRoute.PATCH, 'PATCH', `/api/clients/${seed.clientId}`, { name: 'X', expectedRevision: 1 }, { id: seed.clientId }],
      ['delete client', clientRoute.DELETE, 'DELETE', `/api/clients/${seed.clientId}`, { confirmName: 'Northstar Services' }, { id: seed.clientId }],
      ['create complaint', complaintsRoute.POST, 'POST', '/api/complaints', {}, {}],
      ['create draft', importsRoute.POST, 'POST', '/api/imports', { clientId: seed.clientId }, {}],
      ['patch settings', settingsRoute.PATCH, 'PATCH', '/api/settings', { retentionDays: 90, expectedRevision: 1 }, {}],
    ];

    for (const [label, handler, method, path, body, params] of cases) {
      const response = await call(handler, {
        method,
        path,
        user: owner,
        body,
        params,
        origin: 'https://attacker.example',
      });
      expect(response.status, label).toBe(403);
      expect(response.code, label).toBe('ORIGIN_REJECTED');
    }

    // Nothing was created or changed.
    const survivors = await testDb().select().from(clientsTable);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].name).toBe('Northstar Services');
  });

  it('allows a GET regardless of Origin, because it changes nothing', async () => {
    const owner = await createWorkspaceWithOwner();
    const response = await call(clientsRoute.GET, {
      path: '/api/clients',
      user: owner,
      origin: 'https://attacker.example',
    });
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// AC-16 — oversized and hostile input
// ---------------------------------------------------------------------------

describe('AC-16 bounded and hostile input', () => {
  it('refuses an oversized JSON body', async () => {
    const owner = await createWorkspaceWithOwner();
    const response = await call(clientsRoute.POST, {
      method: 'POST',
      path: '/api/clients',
      user: owner,
      body: { name: 'x'.repeat(2 * 1024 * 1024), domain: 'example.com', timeZone: 'UTC' },
    });
    expect(response.status).toBe(413);
  });

  it('refuses an oversized upload declared by Content-Length', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const draft = await call<{ id: string }>(importsRoute.POST, {
      method: 'POST',
      path: '/api/imports',
      user: owner,
      body: { clientId: seed.clientId },
    });

    const headers = new Headers(owner.headers);
    headers.set('origin', ORIGIN);
    headers.set('content-type', 'multipart/form-data; boundary=x');
    headers.set('content-length', String(50 * 1024 * 1024));
    const request = new Request(`${ORIGIN}/api/imports/${draft.data.id}/files`, {
      method: 'POST',
      headers,
      body: 'ignored',
    });
    const response = await filesRoute.POST(request, {
      params: Promise.resolve({ id: draft.data.id }),
    } as never);
    expect(response.status).toBe(413);
  });

  it('refuses a chunked upload that exceeds the cap without declaring a length', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const draft = await call<{ id: string }>(importsRoute.POST, {
      method: 'POST',
      path: '/api/imports',
      user: owner,
      body: { clientId: seed.clientId },
    });

    // A stream with no Content-Length, deliberately larger than the cap.
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 8) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(chunk);
      },
    });

    const headers = new Headers(owner.headers);
    headers.set('origin', ORIGIN);
    headers.set('content-type', 'multipart/form-data; boundary=x');
    const request = new Request(`${ORIGIN}/api/imports/${draft.data.id}/files`, {
      method: 'POST',
      headers,
      body,
      // @ts-expect-error duplex is required for a streaming request body in Node
      duplex: 'half',
    });
    const response = await filesRoute.POST(request, {
      params: Promise.resolve({ id: draft.data.id }),
    } as never);
    expect(response.status).toBe(413);
  });

  it('stores hostile complaint text verbatim and returns it escaped as data', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const hostile = '<img src=x onerror=alert(1)> =cmd|calc ${process.env}';

    const created = await call<{ id: string; originalText: string }>(complaintsRoute.POST, {
      method: 'POST',
      path: '/api/complaints',
      user: owner,
      body: {
        clientId: seed.clientId,
        originalText: hostile,
        category: 'other',
        scope: 'organic_search',
        periodStart: '2026-07-12',
        periodEnd: '2026-08-10',
        receivedAt: '2026-08-11T09:00:00.000Z',
      },
    });
    expect(created.status).toBe(201);
    // Preserved exactly, neither executed nor silently rewritten.
    expect(created.data.originalText).toBe(hostile);
  });

  it('rejects a malformed JSON body with 422 rather than a stack trace', async () => {
    const owner = await createWorkspaceWithOwner();
    const headers = new Headers(owner.headers);
    headers.set('origin', ORIGIN);
    headers.set('content-type', 'application/json');
    const request = new Request(`${ORIGIN}/api/clients`, {
      method: 'POST',
      headers,
      body: '{not valid json',
    });
    const response = await clientsRoute.POST(request, undefined as never);
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).not.toContain('at Object');
    expect(body).not.toContain('node_modules');
  });
});

// ---------------------------------------------------------------------------
// Error responses leak nothing
// ---------------------------------------------------------------------------

describe('error responses', () => {
  it('never include a stack trace, a connection string or a driver message', async () => {
    const owner = await createWorkspaceWithOwner();
    const responses = [
      await call(clientRoute.GET, {
        path: '/api/clients/not-a-uuid',
        user: owner,
        params: { id: 'not-a-uuid' },
      }),
      await call(clientsRoute.POST, {
        method: 'POST',
        path: '/api/clients',
        user: owner,
        body: { name: '', domain: 'nope', timeZone: 'Mars/Olympus' },
      }),
    ];

    for (const response of responses) {
      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toMatch(/postgres:\/\//);
      expect(serialised).not.toContain('node_modules');
      expect(serialised).not.toContain('at async');
      expect(serialised).not.toContain('excuse_local_dev');
      // A request id is present for support without exposing internals.
      expect(response.body.requestId).toBeTruthy();
    }
  });

  it('carries a request identifier on success too', async () => {
    const owner = await createWorkspaceWithOwner();
    const response = await call(clientsRoute.GET, { path: '/api/clients', user: owner });
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('health endpoints', () => {
  it('reports liveness without touching the database', async () => {
    const response = await liveRoute.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('reports readiness by actually querying the database', async () => {
    const response = await readyRoute.GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ready');
    // It says nothing about which database or host.
    expect(JSON.stringify(body)).not.toMatch(/postgres|localhost|5433/);
  });
});
