import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as clientsRoute from '@/app/api/clients/route';
import * as clientRoute from '@/app/api/clients/[id]/route';
import * as complaintsRoute from '@/app/api/complaints/route';
import * as complaintRoute from '@/app/api/complaints/[id]/route';
import * as templatesRoute from '@/app/api/templates/route';
import * as templateRoute from '@/app/api/templates/[id]/route';
import * as settingsRoute from '@/app/api/settings/route';
import { resetDatabase, closeDatabase } from '../helpers/database';
import { addAnalyst, createWorkspaceWithOwner, type TestUser } from '../helpers/auth';
import { call } from '../helpers/api';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

const NEW_CLIENT = {
  name: 'Northstar Services',
  domain: 'example.com',
  timeZone: 'America/New_York',
};

type Client = { id: string; revision: number; name: string; domain: string; archivedAt: string | null };
type Complaint = { id: string; revision: number; status: string };

async function createClient(user: TestUser, overrides: Record<string, unknown> = {}) {
  const response = await call<Client>(clientsRoute.POST, {
    method: 'POST',
    path: '/api/clients',
    user,
    body: { ...NEW_CLIENT, ...overrides },
  });
  expect(response.status).toBe(201);
  return response.data;
}

async function createComplaint(user: TestUser, clientId: string, overrides: Record<string, unknown> = {}) {
  return call<Complaint>(complaintsRoute.POST, {
    method: 'POST',
    path: '/api/complaints',
    user,
    body: {
      clientId,
      originalText: 'SEO isn’t working. We haven’t gotten any leads.',
      category: 'no_leads',
      scope: 'organic_search',
      periodStart: '2026-07-12',
      periodEnd: '2026-08-10',
      receivedAt: '2026-08-11T09:00:00.000Z',
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

describe('clients', () => {
  it('creates, reads and updates a client under optimistic revisions', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await createClient(owner);
    expect(client.revision).toBe(1);

    const read = await call<Client>(clientRoute.GET, {
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
    });
    expect(read.status).toBe(200);
    expect(read.data.name).toBe('Northstar Services');

    const updated = await call<Client>(clientRoute.PATCH, {
      method: 'PATCH',
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
      body: { name: 'Northstar Services Ltd', expectedRevision: 1 },
    });
    expect(updated.status).toBe(200);
    expect(updated.data.revision).toBe(2);
    expect(updated.data.name).toBe('Northstar Services Ltd');
  });

  it('returns 409 for a stale revision and leaves the row unchanged', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await createClient(owner);
    await call(clientRoute.PATCH, {
      method: 'PATCH',
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
      body: { name: 'First edit', expectedRevision: 1 },
    });

    const stale = await call(clientRoute.PATCH, {
      method: 'PATCH',
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
      body: { name: 'Second edit', expectedRevision: 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.code).toBe('REVISION_CONFLICT');
    expect(stale.body.error.latestRevision).toBe(2);

    const current = await call<Client>(clientRoute.GET, {
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
    });
    expect(current.data.name).toBe('First edit');
  });

  it('distinguishes an unknown id (404) from a stale revision (409)', async () => {
    const owner = await createWorkspaceWithOwner();
    const missing = await call(clientRoute.PATCH, {
      method: 'PATCH',
      path: '/api/clients/00000000-0000-4000-8000-000000000000',
      user: owner,
      params: { id: '00000000-0000-4000-8000-000000000000' },
      body: { name: 'x', expectedRevision: 1 },
    });
    expect(missing.status).toBe(404);
  });

  it('validates the domain and stores it without fetching it', async () => {
    const owner = await createWorkspaceWithOwner();
    const bad = await call(clientsRoute.POST, {
      method: 'POST',
      path: '/api/clients',
      user: owner,
      body: { ...NEW_CLIENT, domain: 'not a domain' },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields).toHaveProperty('domain');

    const normalised = await createClient(owner, { domain: 'HTTPS://Example.COM/path' });
    expect(normalised.domain).toBe('example.com');
  });

  it('rejects an invalid time zone', async () => {
    const owner = await createWorkspaceWithOwner();
    const bad = await call(clientsRoute.POST, {
      method: 'POST',
      path: '/api/clients',
      user: owner,
      body: { ...NEW_CLIENT, timeZone: 'Mars/Olympus' },
    });
    expect(bad.status).toBe(422);
  });

  it('paginates rather than returning every client at once', async () => {
    const owner = await createWorkspaceWithOwner();
    for (let i = 0; i < 5; i += 1) await createClient(owner, { name: `Client ${i}` });

    const page = await call<{ items: Client[]; nextCursor: string | null }>(clientsRoute.GET, {
      path: '/api/clients?limit=2',
      user: owner,
    });
    expect(page.data.items).toHaveLength(2);
    expect(page.data.nextCursor).not.toBeNull();

    const next = await call<{ items: Client[]; nextCursor: string | null }>(clientsRoute.GET, {
      path: `/api/clients?limit=2&cursor=${encodeURIComponent(page.data.nextCursor!)}`,
      user: owner,
    });
    expect(next.data.items).toHaveLength(2);
    const ids = new Set([...page.data.items, ...next.data.items].map((c) => c.id));
    expect(ids.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

describe('archiving', () => {
  it('archives and restores, and refuses new complaints while archived', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await createClient(owner);

    const archived = await call<Client>(clientRoute.PATCH, {
      method: 'PATCH',
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
      body: { archived: true, expectedRevision: 1 },
    });
    expect(archived.data.archivedAt).not.toBeNull();

    const blocked = await createComplaint(owner, client.id);
    expect(blocked.status).toBe(409);
    expect(blocked.code).toBe('CLIENT_ARCHIVED');

    const restored = await call<Client>(clientRoute.PATCH, {
      method: 'PATCH',
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
      body: { archived: false, expectedRevision: archived.data.revision },
    });
    expect(restored.data.archivedAt).toBeNull();

    const allowed = await createComplaint(owner, client.id);
    expect(allowed.status).toBe(201);
  });

  it('keeps an archived client readable', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await createClient(owner);
    await call(clientRoute.PATCH, {
      method: 'PATCH',
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
      body: { archived: true, expectedRevision: 1 },
    });
    const read = await call<Client>(clientRoute.GET, {
      path: `/api/clients/${client.id}`,
      user: owner,
      params: { id: client.id },
    });
    expect(read.status).toBe(200);
  });

  it('refuses archiving by an analyst', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);
    const client = await createClient(owner);

    const denied = await call(clientRoute.PATCH, {
      method: 'PATCH',
      path: `/api/clients/${client.id}`,
      user: analyst,
      params: { id: client.id },
      body: { archived: true, expectedRevision: 1 },
    });
    expect(denied.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------

describe('complaints', () => {
  it('saves a complaint before any report exists, with status open', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await createClient(owner);
    const created = await createComplaint(owner, client.id);
    expect(created.status).toBe(201);
    expect(created.data.status).toBe('open');
  });

  it('rejects an unknown category and a reversed period', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await createClient(owner);

    expect((await createComplaint(owner, client.id, { category: 'seo_is_bad' })).status).toBe(422);
    expect(
      (await createComplaint(owner, client.id, { periodStart: '2026-08-10', periodEnd: '2026-07-12' }))
        .status,
    ).toBe(422);
  });

  it('moves through open, resolved and reopened', async () => {
    const owner = await createWorkspaceWithOwner();
    const client = await createClient(owner);
    const complaint = (await createComplaint(owner, client.id)).data;

    const resolved = await call<Complaint>(complaintRoute.PATCH, {
      method: 'PATCH',
      path: `/api/complaints/${complaint.id}`,
      user: owner,
      params: { id: complaint.id },
      body: { status: 'resolved', expectedRevision: complaint.revision },
    });
    expect(resolved.data.status).toBe('resolved');

    const reopened = await call<Complaint>(complaintRoute.PATCH, {
      method: 'PATCH',
      path: `/api/complaints/${complaint.id}`,
      user: owner,
      params: { id: complaint.id },
      body: { status: 'open', expectedRevision: resolved.data.revision },
    });
    expect(reopened.data.status).toBe('open');
  });

  it('filters by client, status and category', async () => {
    const owner = await createWorkspaceWithOwner();
    const a = await createClient(owner, { name: 'A' });
    const b = await createClient(owner, { name: 'B' });
    await createComplaint(owner, a.id, { category: 'no_leads' });
    await createComplaint(owner, b.id, { category: 'traffic_down' });

    const filtered = await call<{ items: Complaint[] }>(complaintsRoute.GET, {
      path: `/api/complaints?clientId=${a.id}`,
      user: owner,
    });
    expect(filtered.data.items).toHaveLength(1);

    const byCategory = await call<{ items: Complaint[] }>(complaintsRoute.GET, {
      path: '/api/complaints?category=traffic_down',
      user: owner,
    });
    expect(byCategory.data.items).toHaveLength(1);
  });

  it('refuses a complaint against a client in another workspace', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const clientOfB = await createClient(b);

    const denied = await createComplaint(a, clientOfB.id);
    expect(denied.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation across every detail route
// ---------------------------------------------------------------------------

describe('AC-14 cross-workspace identifiers', () => {
  it('reports 404 and mutates nothing on every detail and PATCH route', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const clientOfB = await createClient(b);
    const complaintOfB = (await createComplaint(b, clientOfB.id)).data;

    const cases = [
      { handler: clientRoute.GET, method: 'GET', id: clientOfB.id, path: '/api/clients' },
      { handler: clientRoute.PATCH, method: 'PATCH', id: clientOfB.id, path: '/api/clients' },
      { handler: complaintRoute.GET, method: 'GET', id: complaintOfB.id, path: '/api/complaints' },
      { handler: complaintRoute.PATCH, method: 'PATCH', id: complaintOfB.id, path: '/api/complaints' },
    ];

    for (const testCase of cases) {
      const response = await call(testCase.handler, {
        method: testCase.method,
        path: `${testCase.path}/${testCase.id}`,
        user: a,
        params: { id: testCase.id },
        body: testCase.method === 'PATCH' ? { name: 'hijacked', status: 'resolved', expectedRevision: 1 } : undefined,
      });
      expect(response.status, `${testCase.method} ${testCase.path}`).toBe(404);
    }

    // Workspace B's data is untouched.
    const stillThere = await call<Client>(clientRoute.GET, {
      path: `/api/clients/${clientOfB.id}`,
      user: b,
      params: { id: clientOfB.id },
    });
    expect(stillThere.data.name).toBe('Northstar Services');
  });

  it('does not list another workspace’s clients', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    await createClient(b);

    const list = await call<{ items: Client[] }>(clientsRoute.GET, { path: '/api/clients', user: a });
    expect(list.data.items).toHaveLength(0);
  });

  it('refuses a mutation from another origin', async () => {
    const owner = await createWorkspaceWithOwner();
    const denied = await call(clientsRoute.POST, {
      method: 'POST',
      path: '/api/clients',
      user: owner,
      body: NEW_CLIENT,
      origin: 'https://attacker.example',
    });
    expect(denied.status).toBe(403);
    expect(denied.code).toBe('ORIGIN_REJECTED');
  });

  it('refuses any request with no session', async () => {
    const denied = await call(clientsRoute.GET, { path: '/api/clients', user: null });
    expect(denied.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Templates and settings
// ---------------------------------------------------------------------------

type Template = { id: string; name: string; body: string; revision: number; isDefault: boolean };

describe('templates', () => {
  it('provisions a usable default template with each workspace', async () => {
    const owner = await createWorkspaceWithOwner();
    const list = await call<{ items: Template[] }>(templatesRoute.GET, {
      path: '/api/templates',
      user: owner,
    });
    expect(list.data.items.length).toBeGreaterThanOrEqual(1);
    expect(list.data.items.some((t) => t.isDefault)).toBe(true);
  });

  it('rejects an unsupported token by name', async () => {
    const owner = await createWorkspaceWithOwner();
    const bad = await call(templatesRoute.POST, {
      method: 'POST',
      path: '/api/templates',
      user: owner,
      body: { name: 'Bad', body: 'Hi {{client_name}} {{secret_key}}' },
    });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('secret_key');
  });

  it('lets an owner edit and refuses an analyst', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);
    const created = await call<Template>(templatesRoute.POST, {
      method: 'POST',
      path: '/api/templates',
      user: owner,
      body: { name: 'Custom', body: 'Hi {{client_name}}, {{evidence_summary}} {{sender_name}}' },
    });
    expect(created.status).toBe(201);

    const denied = await call(templateRoute.PATCH, {
      method: 'PATCH',
      path: `/api/templates/${created.data.id}`,
      user: analyst,
      params: { id: created.data.id },
      body: { body: 'Hi {{client_name}}', expectedRevision: 1 },
    });
    expect(denied.status).toBe(403);

    // An analyst can still read templates.
    const readable = await call(templatesRoute.GET, { path: '/api/templates', user: analyst });
    expect(readable.status).toBe(200);
  });
});

describe('settings', () => {
  it('reports the real membership, role and workspace', async () => {
    const owner = await createWorkspaceWithOwner('Northstar Agency');
    const settings = await call<{
      workspaceName: string;
      role: string;
      email: string;
      retentionDays: number | null;
      revision: number;
    }>(settingsRoute.GET, { path: '/api/settings', user: owner });
    expect(settings.data.workspaceName).toBe('Northstar Agency');
    expect(settings.data.role).toBe('owner');
    expect(settings.data.email).toBe(owner.email);
    expect(settings.data.retentionDays).toBeNull();
  });

  it('lets an owner set retention and refuses an analyst', async () => {
    const owner = await createWorkspaceWithOwner();
    const analyst = await addAnalyst(owner.workspaceId);

    const updated = await call<{ retentionDays: number | null }>(settingsRoute.PATCH, {
      method: 'PATCH',
      path: '/api/settings',
      user: owner,
      body: { retentionDays: 180, expectedRevision: 1 },
    });
    expect(updated.data.retentionDays).toBe(180);

    const denied = await call(settingsRoute.PATCH, {
      method: 'PATCH',
      path: '/api/settings',
      user: analyst,
      body: { retentionDays: 90, expectedRevision: 2 },
    });
    expect(denied.status).toBe(403);
  });

  it('rejects a retention value outside the documented choices', async () => {
    const owner = await createWorkspaceWithOwner();
    const bad = await call(settingsRoute.PATCH, {
      method: 'PATCH',
      path: '/api/settings',
      user: owner,
      body: { retentionDays: 45, expectedRevision: 1 },
    });
    expect(bad.status).toBe(422);
  });
});
