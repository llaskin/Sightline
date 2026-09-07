import { expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { E2E_OWNER, E2E_ANALYST, E2E_PASSWORD } from './global-setup';

/** Shared browser helpers. Everything goes through the real UI and real API. */

const STATE_DIR = 'tests/e2e/.auth';

/** One cookie file per account, named from the address rather than the role. */
function stateFile(email: string) {
  return `${STATE_DIR}/${email.replace(/[^a-z0-9]/gi, '-')}.json`;
}

/**
 * Signs in, reusing a cached session where possible.
 *
 * The auth library rate-limits sign-in, which is the behaviour we want in
 * production. Signing in afresh in every test trips that limit and produces
 * failures that look like application bugs, so each account's cookies are
 * captured once and replayed. A cached session that is no longer valid -- a
 * reset database, an expired cookie -- lands on the login page, and the real
 * sign-in below runs instead.
 */
export async function signIn(page: Page, email = E2E_OWNER, password = E2E_PASSWORD) {
  const cached = stateFile(email);
  if (existsSync(cached)) {
    await page.context().addCookies(JSON.parse(readFileSync(cached, 'utf8')));
    await page.goto('/dashboard');
    if (!page.url().includes('/login')) return;
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|analyses)/, { timeout: 30_000 });

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(cached, JSON.stringify(await page.context().cookies()), 'utf8');
}

export async function signInAsAnalyst(page: Page) {
  await signIn(page, E2E_ANALYST, E2E_PASSWORD);
}

/**
 * Calls the API *from inside the browser*.
 *
 * The server under test runs with NODE_ENV=production, so its session cookie is
 * marked `Secure`. Chromium applies the localhost exception and sends it over
 * plain HTTP; Playwright's Node-side request context does not, and every
 * authenticated call from it comes back 401. Issuing the request in the page
 * both avoids that and matches how the application actually calls its own API.
 */
export async function api<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const result = await page.evaluate(
    async ({ method, path, body, headers }) => {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, text };
    },
    { method, path, body, headers },
  );

  expect(
    result.status < 400,
    `${method} ${path} -> ${result.status} ${result.text.slice(0, 300)}`,
  ).toBe(true);
  return (result.text ? JSON.parse(result.text).data : null) as T;
}

/** Same as `api`, but returns the raw status and headers for an attachment. */
export async function rawGet(page: Page, path: string) {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    return {
      status: response.status,
      contentDisposition: response.headers.get('content-disposition'),
      cacheControl: response.headers.get('cache-control'),
      contentType: response.headers.get('content-type'),
      body: (await response.text()).slice(0, 40_000),
    };
  }, path);
}

/**
 * Builds a client, a committed report, a complaint and an analysis through the
 * API using the signed-in browser session, so a spec that needs data present
 * does not re-drive the whole wizard by hand.
 */
export async function seedAnalysis(
  page: Page,
  clientName = 'Northstar Services',
): Promise<{ clientId: string; reportId: string; complaintId: string; analysisId: string }> {
  const { makeDemoReport } = await import('../../src/domain/fixtures/demo-report');
  const { makeDemoComplaint } = await import('../../src/domain/fixtures/demo-complaint');
  const report = makeDemoReport();
  const complaint = makeDemoComplaint();

  const client = await api<{ id: string }>(page, 'POST', '/api/clients', {
    name: clientName,
    domain: 'example.com',
    timeZone: 'America/New_York',
  });
  const draft = await api<{ id: string; revision: number }>(page, 'POST', '/api/imports', {
    clientId: client.id,
  });
  const saved = await api<{ revision: number }>(page, 'PATCH', `/api/imports/${draft.id}`, {
    expectedRevision: draft.revision,
    metadata: report.metadata,
    datasets: report.datasets,
    sources: report.sources,
    selectedForm: report.selectedForm,
    formDefinitionAcknowledged: report.formDefinitionAcknowledged,
    trendGranularity: report.trendGranularity,
  });
  const validated = await api<{ revision: number; contentHash: string; ok: boolean }>(
    page,
    'POST',
    `/api/imports/${draft.id}/validate`,
    { expectedRevision: saved.revision },
  );
  expect(validated.ok).toBe(true);

  const reportRow = await api<{ id: string }>(
    page,
    'POST',
    `/api/imports/${draft.id}/commit`,
    { expectedRevision: validated.revision, contentHash: validated.contentHash },
    { 'idempotency-key': `e2e-${draft.id}` },
  );
  const complaintRow = await api<{ id: string }>(page, 'POST', '/api/complaints', {
    clientId: client.id,
    ...complaint,
  });
  const analysis = await api<{ id: string }>(
    page,
    'POST',
    '/api/analyses',
    { reportId: reportRow.id, complaintId: complaintRow.id },
    { 'idempotency-key': `e2e-analysis-${draft.id}` },
  );

  return {
    clientId: client.id,
    reportId: reportRow.id,
    complaintId: complaintRow.id,
    analysisId: analysis.id,
  };
}
