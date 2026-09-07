import { test, expect } from '@playwright/test';
import { signIn, signInAsAnalyst, seedAnalysis, api } from './helpers';

/**
 * Every navigation destination and every non-happy path.
 *
 * A dead navigation item is a promise the release does not keep, so each one is
 * followed and checked for a real page rather than a placeholder.
 */

const NAV = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Upload Report', path: '/reports/new' },
  { label: 'Complaints', path: '/complaints' },
  { label: 'Analysis History', path: '/history' },
  { label: 'Clients', path: '/clients' },
  { label: 'Templates', path: '/templates' },
  { label: 'Settings', path: '/settings' },
];

test('every sidebar destination leads to a working page', async ({ page }) => {
  await signIn(page);
  await seedAnalysis(page, 'Navigation Client');

  for (const item of NAV) {
    await page.goto('/dashboard');
    const link = page.getByRole('link', { name: item.label }).first();
    await expect(link, `${item.label} is missing from the sidebar`).toBeAttached();
    await link.click();
    await page.waitForURL((url) => url.pathname.startsWith(item.path.split('?')[0]), {
      timeout: 20_000,
    });

    // A real heading, not an error boundary or a placeholder.
    const heading = page.locator('h1').first();
    await expect(heading, `${item.label} rendered no heading`).toBeVisible();
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, `${item.label} rendered an error`).not.toContain("This page couldn't load");
    expect(text.toLowerCase(), `${item.label} looks unimplemented`).not.toContain('coming soon');
  }
});

test('a workspace with no clients explains what to do first', async ({ browser }) => {
  // A separate workspace so the empty state is genuine rather than simulated.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);

  // Archive every client so the dashboard has none to show.
  const clients = await api<{ items: Array<{ id: string; revision: number }> }>(
    page,
    'GET',
    '/api/clients?limit=100',
  );
  for (const client of clients.items) {
    await api(page, 'PATCH', `/api/clients/${client.id}`, {
      archived: true,
      expectedRevision: client.revision,
    });
  }

  await page.goto('/dashboard');
  await expect(page.getByText('Add a client to begin')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a client' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore demo' })).toBeVisible();

  // Restore them so later tests are unaffected.
  const archived = await api<{ items: Array<{ id: string; revision: number }> }>(
    page,
    'GET',
    '/api/clients?includeArchived=true&limit=100',
  );
  for (const client of archived.items) {
    await api(page, 'PATCH', `/api/clients/${client.id}`, {
      archived: false,
      expectedRevision: client.revision,
    });
  }
  await context.close();
});

test('a report with no trend or form data says so instead of inventing them', async ({ page }) => {
  await signIn(page);
  const { makeDemoReport } = await import('../../src/domain/fixtures/demo-report');
  const { makeDemoComplaint } = await import('../../src/domain/fixtures/demo-complaint');

  const report = makeDemoReport();
  // Only the required dataset survives.
  report.datasets.trafficTrend = null;
  report.sources.trafficTrend = null;
  report.datasets.forms = null;
  report.sources.forms = null;
  report.selectedForm = null;
  report.formDefinitionAcknowledged = false;
  report.datasets.keywords = null;
  report.sources.keywords = null;
  report.datasets.landingPages = null;
  report.sources.landingPages = null;
  report.trendGranularity = null;

  const client = await api<{ id: string }>(page, 'POST', '/api/clients', {
    name: 'Sparse Evidence Client',
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
    selectedForm: null,
    formDefinitionAcknowledged: false,
    trendGranularity: null,
  });
  const validated = await api<{ revision: number; contentHash: string }>(
    page,
    'POST',
    `/api/imports/${draft.id}/validate`,
    { expectedRevision: saved.revision },
  );
  const committed = await api<{ id: string }>(
    page,
    'POST',
    `/api/imports/${draft.id}/commit`,
    { expectedRevision: validated.revision, contentHash: validated.contentHash },
    { 'idempotency-key': `sparse-${draft.id}` },
  );
  const complaint = await api<{ id: string }>(page, 'POST', '/api/complaints', {
    clientId: client.id,
    ...makeDemoComplaint(),
  });
  const analysis = await api<{ id: string }>(
    page,
    'POST',
    '/api/analyses',
    { reportId: committed.id, complaintId: complaint.id },
    { 'idempotency-key': `sparse-analysis-${draft.id}` },
  );

  await page.goto(`/analyses/${analysis.id}`);

  // AC-17 and AC-19: no line is drawn, and the reason is stated.
  await expect(page.getByText('Trend data not provided').first()).toBeVisible();
  await expect(page.locator('svg.recharts-surface')).toHaveCount(0);

  // Missing metrics read as not provided, never as zero.
  const cards = page.getByText('Not provided');
  expect(await cards.count()).toBeGreaterThan(0);

  // The range options that cannot be filled are disabled, with the reason.
  await expect(page.getByRole('option', { name: /Last 6 supplied periods.*not supplied/ })).toBeDisabled();

  // The tables say what is absent rather than showing an empty grid.
  await expect(page.getByText('No keyword data').first()).toBeVisible();
  await expect(page.getByText('No landing-page data').first()).toBeVisible();
});

test('an analyst can do their work but is told what only an owner can change', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsAnalyst(page);

  // Reading is unrestricted.
  await page.goto('/templates');
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.getByText(/only .*owner/i).first()).toBeVisible();

  await page.goto('/settings');
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.getByText(/only .*owner/i).first()).toBeVisible();
  // The analyst's own role is shown honestly.
  await expect(page.getByText(/analyst/i).first()).toBeVisible();

  // And the server refuses regardless of what the interface offers.
  const refused = await page.evaluate(async () => {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retentionDays: 90, expectedRevision: 1 }),
    });
    return response.status;
  });
  expect(refused).toBe(403);

  await context.close();
});

test('an unknown identifier is reported as not found, not as an error', async ({ page }) => {
  await signIn(page);
  const missing = '00000000-0000-4000-8000-000000000000';

  for (const path of [`/analyses/${missing}`, `/reports/${missing}`, `/clients/${missing}`]) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} should be 404`).toBe(404);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toContain('Internal Server Error');
  }
});

test('an expired session sends the reader to sign in rather than failing silently', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);
  await page.goto('/clients');
  await expect(page.locator('h1').first()).toBeVisible();

  // Losing the session is what happens when a cookie expires or an operator
  // deactivates the membership.
  await context.clearCookies();
  await page.goto('/clients');
  await page.waitForURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await context.close();
});

test('a failed write keeps the typed text on screen', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Failed Write Client');
  await page.goto(`/analyses/${seed.analysisId}`);

  await page.getByRole('button', { name: 'Edit' }).click();
  const wording = 'Text that must survive a failed save.';
  await page.getByLabel('Response draft').fill(wording);

  // Make the next save fail the way a dropped connection would.
  await page.route('**/api/analyses/*/response', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Save draft' }).click();

  await expect(page.getByText('Not saved')).toBeVisible();
  // The user's words are still there, which is the whole point.
  await expect(page.getByLabel('Response draft')).toHaveValue(wording);

  // And the save succeeds once the connection returns.
  await page.unroute('**/api/analyses/*/response');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
});

test('the demo is clearly labelled and never writes anything', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // No session at all.
  await page.goto('/demo');

  await expect(page.getByText('Demonstration with fictional data')).toBeVisible();
  await expect(page.getByText(/invented company on the reserved example.com domain/)).toBeVisible();
  await expect(page.getByText('This is a demo. Edits here are not saved anywhere.')).toBeVisible();

  // It offers sign-in rather than pretending to be a workspace.
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try an analysis' })).toBeVisible();

  // There is no edit control that would imply a save.
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Regenerate' })).toHaveCount(0);

  await context.close();
});
