import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as analysesRoute from '@/app/api/analyses/route';
import * as analysisExportRoute from '@/app/api/analyses/[id]/export/route';
import * as reportExportRoute from '@/app/api/reports/[id]/export/route';
import * as complaintsRoute from '@/app/api/complaints/route';
import { resetDatabase, closeDatabase } from '../helpers/database';
import { createWorkspaceWithOwner, type TestUser } from '../helpers/auth';
import { call } from '../helpers/api';
import { seedReportAndComplaint } from '../helpers/scenario';
import { TEST_ORIGIN } from '../helpers/origin';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

/** Raw text plus headers, since exports are attachments rather than envelopes. */
async function raw(
  handler: (request: Request, context: never) => Promise<Response>,
  options: { path: string; user: TestUser | null; params: Record<string, string> },
) {
  const headers = new Headers(options.user ? options.user.headers : undefined);
  const request = new Request(`${TEST_ORIGIN}${options.path}`, { headers });
  const response = await handler(request, {
    params: Promise.resolve(options.params),
  } as never);
  return { status: response.status, headers: response.headers, body: await response.text() };
}

async function scenario(user: TestUser, complaintText?: string) {
  const seed = await seedReportAndComplaint(user);
  if (complaintText) {
    await call(complaintsRoute.POST, {
      method: 'POST',
      path: '/api/complaints',
      user,
      body: {
        clientId: seed.clientId,
        originalText: complaintText,
        category: 'no_leads',
        scope: 'organic_search',
        periodStart: '2026-07-12',
        periodEnd: '2026-08-10',
        receivedAt: '2026-08-11T09:00:00.000Z',
      },
    });
  }
  const created = await call<{ id: string }>(analysesRoute.POST, {
    method: 'POST',
    path: '/api/analyses',
    user,
    headers: { 'idempotency-key': `x-${seed.reportId}` },
    body: { reportId: seed.reportId, complaintId: seed.complaintId },
  });
  return { ...seed, analysisId: created.data.id };
}

describe('analysis markdown export', () => {
  it('returns an attachment with private cache headers and a safe filename', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await scenario(owner);

    const response = await raw(analysisExportRoute.GET, {
      path: `/api/analyses/${seed.analysisId}/export?format=md`,
      user: owner,
      params: { id: seed.analysisId },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="analysis-${seed.analysisId}.md"`,
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.body).toContain('# Analysis for Northstar Services');
    expect(response.body).toContain('Rule version: 1.0.0');
  });

  it('refuses an export with no session', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await scenario(owner);
    const response = await raw(analysisExportRoute.GET, {
      path: `/api/analyses/${seed.analysisId}/export?format=md`,
      user: null,
      params: { id: seed.analysisId },
    });
    expect(response.status).toBe(401);
  });

  it('AC-14: refuses an export of another workspace’s analysis', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const seed = await scenario(b);

    const response = await raw(analysisExportRoute.GET, {
      path: `/api/analyses/${seed.analysisId}/export?format=md`,
      user: a,
      params: { id: seed.analysisId },
    });
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('Northstar');
  });

  it('rejects an unsupported format', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await scenario(owner);
    const response = await raw(analysisExportRoute.GET, {
      path: `/api/analyses/${seed.analysisId}/export?format=pdf`,
      user: owner,
      params: { id: seed.analysisId },
    });
    expect(response.status).toBe(422);
  });
});

describe('report csv export', () => {
  it('exports the keyword cohort and the landing pages', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await scenario(owner);

    const keywords = await raw(reportExportRoute.GET, {
      path: `/api/reports/${seed.reportId}/export?dataset=keywords`,
      user: owner,
      params: { id: seed.reportId },
    });
    expect(keywords.status).toBe(200);
    expect(keywords.headers.get('content-type')).toContain('text/csv');
    expect(keywords.body).toContain('"keyword","device"');

    const pages = await raw(reportExportRoute.GET, {
      path: `/api/reports/${seed.reportId}/export?dataset=pages`,
      user: owner,
      params: { id: seed.reportId },
    });
    expect(pages.status).toBe(200);
    expect(pages.body).toContain('"/seo-services",1250,2340,1090');
  });

  it('AC-14: refuses another workspace’s report', async () => {
    const a = await createWorkspaceWithOwner('Agency A');
    const b = await createWorkspaceWithOwner('Agency B');
    const seed = await scenario(b);

    const response = await raw(reportExportRoute.GET, {
      path: `/api/reports/${seed.reportId}/export?dataset=keywords`,
      user: a,
      params: { id: seed.reportId },
    });
    expect(response.status).toBe(404);
  });

  it('rejects an unknown dataset', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await scenario(owner);
    const response = await raw(reportExportRoute.GET, {
      path: `/api/reports/${seed.reportId}/export?dataset=../../etc/passwd`,
      user: owner,
      params: { id: seed.reportId },
    });
    expect(response.status).toBe(422);
  });
});

describe('AC-16 hostile text survives export safely', () => {
  it('escapes a complaint containing HTML, backticks and a formula string', async () => {
    const owner = await createWorkspaceWithOwner();
    const seed = await seedReportAndComplaint(owner);
    const hostile = await call<{ id: string }>(complaintsRoute.POST, {
      method: 'POST',
      path: '/api/complaints',
      user: owner,
      body: {
        clientId: seed.clientId,
        originalText: '<script>alert(1)</script> =cmd|calc `backticks` **bold**',
        category: 'no_leads',
        scope: 'organic_search',
        periodStart: '2026-07-12',
        periodEnd: '2026-08-10',
        receivedAt: '2026-08-11T09:00:00.000Z',
      },
    });
    const created = await call<{ id: string }>(analysesRoute.POST, {
      method: 'POST',
      path: '/api/analyses',
      user: owner,
      headers: { 'idempotency-key': 'hostile' },
      body: { reportId: seed.reportId, complaintId: hostile.data.id },
    });

    const response = await raw(analysisExportRoute.GET, {
      path: `/api/analyses/${created.data.id}/export?format=md`,
      user: owner,
      params: { id: created.data.id },
    });
    expect(response.status).toBe(200);
    expect(response.body).not.toContain('<script>');
    expect(response.body).toContain('&lt;script&gt;');
    expect(response.body).toContain('\\`backticks\\`');
    // And it changed nothing about the analysis.
    expect(response.body).toContain('Result: **unverified**');
  });
});
