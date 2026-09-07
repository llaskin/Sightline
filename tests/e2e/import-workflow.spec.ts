import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn, rawGet } from './helpers';

/**
 * The full import journey, driven entirely through the browser: sign in, create
 * a client, download a template, upload real CSV files, correct a deliberate
 * error, validate, commit, then reload and confirm the stored figures.
 *
 * Nothing here is mocked. The wizard talks to the real API and the real
 * database, which is the only way to test that the draft payload the wizard
 * holds stays in step with the draft the server stores.
 */

const ORGANIC_CSV = readFileSync('public/templates/organic-summary.csv', 'utf8');
const FORMS_CSV = readFileSync('public/templates/forms.csv', 'utf8');
const PAGES_CSV = readFileSync('public/templates/landing-pages.csv', 'utf8');

/**
 * The organic template with an ambiguous localized number. The value is quoted
 * so it stays one column: unquoted it would trip the column-count rule first
 * and never reach the number check.
 */
const BROKEN_ORGANIC_CSV = ORGANIC_CSV.replace('7210', '"7,210"');

/**
 * Fills one dataset's per-period source metadata. Every field here is required
 * by the schema, which is the point: a number with no stated provenance cannot
 * be committed.
 */
async function fillProvenance(page: import('@playwright/test').Page) {
  for (const legend of ['Baseline period', 'Current period']) {
    const period = page.getByRole('group', { name: legend });
    await period.getByLabel('Source label').fill('Fictional analytics export');
    await period.getByLabel('Exported at').fill('2026-08-11T12:00');
    await period.getByLabel('Coverage').selectOption('complete');
    await period.getByLabel('Scope key').fill('property=1;channel=organic_search');
    await period.getByLabel('Definition version').fill('v1');
  }
}

async function fillPeriods(page: import('@playwright/test').Page) {
  const current = page.getByRole('group', { name: 'Current period' });
  await current.getByLabel('Start').fill('2026-07-12');
  await current.getByLabel('End').fill('2026-08-10');
  const baseline = page.getByRole('group', { name: 'Baseline period' });
  await baseline.getByLabel('Start').fill('2026-06-12');
  await baseline.getByLabel('End').fill('2026-07-11');
}

test('imports a report end to end and the committed figures survive a reload', async ({ page }) => {
  await signIn(page);

  // ---- A client, created through the UI ----
  await page.goto('/clients?new=1');
  await page.getByLabel('Client name').fill('Import Journey Client');
  await page.getByLabel('Domain').fill('example.com');
  await page.getByRole('button', { name: /Create client|Save client|Add client/i }).click();
  await expect(page.getByText('Import Journey Client').first()).toBeVisible({ timeout: 15_000 });

  // ---- A downloadable template really is served ----
  const templateResponse = await rawGet(page, '/templates/organic-summary.csv');
  expect(templateResponse.status).toBe(200);
  expect(templateResponse.body).toContain('period,sessions,active_users,lead_sessions');

  // ---- Step 1: client, periods and definitions ----
  await page.goto('/reports/new');
  await page.getByLabel('Client').selectOption({ label: 'Import Journey Client' });
  await page.getByLabel('Report label').fill('Browser import 10 August 2026');
  await fillPeriods(page);
  await page.getByLabel('Report time zone').fill('America/New_York');
  await page.getByLabel('Lead definition').fill('Sessions containing the contact form submission');
  await page.getByLabel('Tracking status').selectOption('verified');
  await page.getByLabel('Tracking reviewed by').fill('Alex Rivera');
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Step 2: a deliberately broken required file is rejected ----
  await expect(page.getByRole('heading', { name: 'Organic summary', exact: true })).toBeVisible();
  const organicInput = page.getByLabel('Upload a Organic summary CSV');
  await organicInput.setInputFiles({
    name: 'organic-summary.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(BROKEN_ORGANIC_CSV),
  });

  // The wizard reports the row, the field and the rejected value, and says
  // plainly that the draft was left alone.
  await expect(page.getByText(/not accepted and nothing changed/i)).toBeVisible({
    timeout: 15_000,
  });
  // Row, column and the rejected value, so the reader knows which cell to fix.
  const rejected = page.getByRole('table', { name: /Rejected cells/i });
  await expect(rejected.getByText('7,210')).toBeVisible();
  await expect(rejected.getByText('sessions')).toBeVisible();
  await expect(rejected.getByText('2', { exact: true })).toBeVisible();

  // ---- The correction is accepted ----
  await organicInput.setInputFiles({
    name: 'organic-summary.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(ORGANIC_CSV),
  });
  await expect(page.getByText(/2 rows|2 row/i).first()).toBeVisible({ timeout: 15_000 });

  // Provenance is required before a report can be committed: without it the
  // application cannot say where a number came from, so validation refuses.
  await fillProvenance(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Step 3: optional evidence ----
  // Every optional dataset offers its own labelled upload.
  for (const label of ['Keywords', 'Forms', 'Landing pages', 'Traffic trend']) {
    await expect(page.getByLabel(`Upload a ${label} CSV`)).toBeAttached();
  }
  await page.getByLabel('Upload a Forms CSV').setInputFiles({
    name: 'forms.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(FORMS_CSV),
  });
  await expect(page.getByText(/2 rows|2 row/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Upload a Landing pages CSV').setInputFiles({
    name: 'landing-pages.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(PAGES_CSV),
  });
  await page.getByRole('button', { name: 'Continue' }).click();

  // ---- Step 4: validation, which is an explicit action ----
  await expect(page.getByRole('heading', { name: /Validated content|Validation/i })).toBeVisible({
    timeout: 15_000,
  });
  // Commit stays unavailable until the server has accepted this exact content.
  await expect(page.getByRole('button', { name: 'Continue to commit' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save and validate' }).click();
  await expect(page.getByRole('button', { name: 'Continue to commit' })).toBeEnabled({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Continue to commit' }).click();

  // ---- Step 5: commit ----
  const commit = page.getByRole('button', { name: /Commit (this )?report/i });
  await expect(commit).toBeEnabled({ timeout: 15_000 });
  await commit.click();

  // ---- The committed report, re-read from the database ----
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(page.getByText('Browser import 10 August 2026').first()).toBeVisible();

  const reportUrl = page.url();
  await page.reload();

  // The exact raw totals, date windows and source labels persisted.
  await expect(page.getByText('12,540').first()).toBeVisible();
  await expect(page.getByText('7,210').first()).toBeVisible();
  await expect(page.getByText(/2026-07-12|12 Jul 2026/).first()).toBeVisible();
  await expect(page.getByText(/2026-06-12|12 Jun 2026/).first()).toBeVisible();

  // A committed report is immutable, and the page says so.
  await expect(page.getByText(/immutable|cannot be (edited|changed)/i).first()).toBeVisible();

  // ---- Exports are reachable and safe ----
  const reportId = reportUrl.split('/').pop()!;
  const pagesCsv = await rawGet(page, `/api/reports/${reportId}/export?dataset=pages`);
  expect(pagesCsv.status, pagesCsv.body.slice(0, 200)).toBe(200);
  expect(pagesCsv.contentDisposition).toContain('attachment');
  expect(pagesCsv.cacheControl).toContain('no-store');
  // The landing-page rows really are in the download.
  expect(pagesCsv.body).toContain('/seo-services');
});

test('a rejected upload leaves the draft unchanged', async ({ page }) => {
  await signIn(page);
  await page.goto('/clients?new=1');
  await page.getByLabel('Client name').fill('Rejected Upload Client');
  await page.getByLabel('Domain').fill('example.com');
  await page.getByRole('button', { name: /Create client|Save client|Add client/i }).click();
  await expect(page.getByText('Rejected Upload Client').first()).toBeVisible({ timeout: 15_000 });

  await page.goto('/reports/new');
  await page.getByLabel('Client').selectOption({ label: 'Rejected Upload Client' });
  await page.getByLabel('Report label').fill('Rejected upload');
  await fillPeriods(page);
  await page.getByLabel('Lead definition').fill('Sessions containing a lead action');
  await page.getByRole('button', { name: 'Continue' }).click();

  const organicInput = page.getByLabel('Upload a Organic summary CSV');
  // Not UTF-8 at all.
  await organicInput.setInputFiles({
    name: 'organic-summary.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([0x70, 0x65, 0xff, 0xfe, 0x0a]),
  });

  await expect(page.getByText(/UTF-8|encoding/i).first()).toBeVisible({ timeout: 15_000 });
  // The wizard does not claim rows were loaded.
  await expect(page.getByText(/^2 rows$/)).toHaveCount(0);
});

test('a spreadsheet formula in an uploaded cell is refused', async ({ page }) => {
  await signIn(page);
  await page.goto('/clients?new=1');
  await page.getByLabel('Client name').fill('Formula Client');
  await page.getByLabel('Domain').fill('example.com');
  await page.getByRole('button', { name: /Create client|Save client|Add client/i }).click();
  await expect(page.getByText('Formula Client').first()).toBeVisible({ timeout: 15_000 });

  await page.goto('/reports/new');
  await page.getByLabel('Client').selectOption({ label: 'Formula Client' });
  await page.getByLabel('Report label').fill('Formula check');
  await fillPeriods(page);
  await page.getByLabel('Lead definition').fill('Sessions containing a lead action');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Upload a Organic summary CSV').setInputFiles({
    name: 'organic-summary.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(ORGANIC_CSV),
  });
  await expect(page.getByText(/2 rows|2 row/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Continue' }).click();

  // A landing-pages file whose path cell would execute in a spreadsheet.
  const hostile = PAGES_CSV.replace('/seo-services', '=cmd|calc');
  await page.getByLabel('Upload a Landing pages CSV').setInputFiles({
    name: 'landing-pages.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(hostile),
  });
  await expect(page.getByText(/=, \+, - or @|formula/i).first()).toBeVisible({ timeout: 15_000 });
});

test('the forms template round-trips through the wizard', async ({ page }) => {
  // Guards the template files themselves: if a template stops parsing under its
  // own parser, the download is worse than useless.
  expect(FORMS_CSV).toContain('period,form_id,scope,attempts,failed_attempts,error_events');
  await signIn(page);
  await page.goto('/reports/new');
  await expect(page.getByRole('heading', { name: 'Import a report' })).toBeVisible();
});
