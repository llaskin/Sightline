import { test, expect } from '@playwright/test';
import { signIn, seedAnalysis, api, rawGet } from './helpers';

/**
 * The analysis journey against genuinely imported data.
 *
 * The figures asserted here are the corrected ones from the specification, not
 * the screenshot's: -43% rather than -42%, and an outcome that stays unverified
 * because no received-lead record was supplied.
 */

test('an imported report produces the documented diagnosis and figures', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Analysis Journey Client');
  await page.goto(`/analyses/${seed.analysisId}`);

  // The four metric cards.
  await expect(page.getByText('+74%', { exact: true })).toBeVisible();
  await expect(page.getByText('+31', { exact: true })).toBeVisible();
  await expect(page.getByText('-43%', { exact: true })).toBeVisible();
  await expect(page.getByText('3x', { exact: true })).toBeVisible();

  // Their raw comparisons, so a reader can check the arithmetic.
  await expect(page.getByText('12,540 vs 7,210')).toBeVisible();
  await expect(page.getByText('85 vs 54')).toBeVisible();
  await expect(page.getByText('1.2% vs 2.1%')).toBeVisible();
  await expect(page.getByText('15 vs 5')).toBeVisible();

  // The diagnosis, and the fact it is rule generated rather than a model's view.
  await expect(page.getByRole('heading', { name: 'Evidence diagnosis' })).toBeVisible();
  await expect(page.getByText('Rule generated')).toBeVisible();
  await expect(page.getByText('Evidence points to a post-click investigation').first()).toBeVisible();
  await expect(page.getByText('Moderate evidence')).toBeVisible();

  // The exact rate values appear in the evidence, unrounded to three places.
  await expect(page.getByText(/2\.094%/)).toBeVisible();
  await expect(page.getByText(/1\.196%/)).toBeVisible();
  await expect(page.getByText(/6\.818%/)).toBeVisible();

  // AC-10: the outcome cannot be checked, and the page says why.
  await expect(page.getByText('Cannot be checked from this evidence')).toBeVisible();
  await expect(page.getByText(/No complete record of received leads/)).toBeVisible();

  // Nothing anywhere claims a validity percentage.
  const body = await page.evaluate(() => document.body.innerText.toLowerCase());
  expect(body).not.toContain('not valid');
  expect(body).not.toContain('82%');
  expect(body).not.toContain('confidence');
  expect(body).not.toMatch(/\b\d{1,3}% (valid|certain)/);
});

test('the evidence drawer shows the formula, sources and freshness', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Drawer Evidence Client');
  await page.goto(`/analyses/${seed.analysisId}`);

  await page.getByRole('button', { name: /Show the evidence behind Conversion Rate/i }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  await expect(drawer.getByText('lead sessions / sessions, compared as unrounded rates')).toBeVisible();
  await expect(drawer.getByText('151 lead sessions of 7,210 sessions')).toBeVisible();
  await expect(drawer.getByText('150 lead sessions of 12,540 sessions')).toBeVisible();
  await expect(drawer.getByText(/Fictional analytics export/)).toBeVisible();
  // The honest limit of this metric is stated in the drawer itself.
  await expect(
    drawer
      .getByText(/not a count of leads that reached the client|cannot confirm or deny received leads/i)
      .first(),
  ).toBeVisible();
});

test('a saved draft persists and the Markdown export carries it', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Export Client');
  await page.goto(`/analyses/${seed.analysisId}`);

  // No Markdown control characters: the export escapes untrusted text, so a
  // trailing full stop would come back as "exported\." and the assertion would
  // be testing the escaper rather than the round trip.
  const wording = 'Our own wording for Northstar, saved and exported';
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Response draft').fill(wording);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Agency-edited draft')).toBeVisible();
  await expect(page.getByText(wording)).toBeVisible();

  const exported = await rawGet(page, `/api/analyses/${seed.analysisId}/export?format=md`);
  expect(exported.status).toBe(200);
  expect(exported.contentType).toContain('text/markdown');
  expect(exported.contentDisposition).toContain(`analysis-${seed.analysisId}.md`);
  expect(exported.cacheControl).toContain('no-store');
  expect(exported.body).toContain(wording);
  // And it labels the text as edited rather than engine-verified.
  expect(exported.body).toContain('agency-edited draft');
});

test('reanalysing creates a new analysis and leaves the original untouched', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Reanalyse Client');

  const second = await api<{ id: string }>(
    page,
    'POST',
    '/api/analyses',
    { reportId: seed.reportId, complaintId: seed.complaintId, parentAnalysisId: seed.analysisId },
    { 'idempotency-key': `reanalyse-${seed.analysisId}` },
  );
  expect(second.id).not.toBe(seed.analysisId);

  // The original is still readable and unchanged.
  await page.goto(`/analyses/${seed.analysisId}`);
  await expect(page.getByText('Evidence points to a post-click investigation').first()).toBeVisible();

  // History lists both.
  // The history table, not the client filter's hidden <option>.
  await page.goto('/history');
  await expect(page.getByRole('table').getByText('Reanalyse Client').first()).toBeVisible();
});

test('the report selector switches every panel together', async ({ page }) => {
  await signIn(page);
  const first = await seedAnalysis(page, 'Selector Client A');
  const second = await seedAnalysis(page, 'Selector Client B');

  await page.goto(`/analyses/${first.analysisId}`);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.goto(`/analyses/${second.analysisId}`);
  // The complaint, evidence and response all belong to the newly chosen
  // analysis; none is left describing the previous one.
  await expect(page.getByRole('heading', { name: 'Client Complaint' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggested Response' })).toBeVisible();
  const url = page.url();
  expect(url).toContain(second.analysisId);
  expect(url).not.toContain(first.analysisId);
});

test('an insufficient-evidence analysis is saved and names what is missing', async ({ page }) => {
  await signIn(page);
  const { makeDemoReport } = await import('../../src/domain/fixtures/demo-report');
  const { makeDemoComplaint } = await import('../../src/domain/fixtures/demo-complaint');

  // Below the minimum-sessions floor, so no direction can be read.
  const report = makeDemoReport();
  report.datasets.organic[0] = { period: 'baseline', sessions: 40, activeUsers: 30, leadSessions: 2 };
  report.datasets.organic[1] = { period: 'current', sessions: 50, activeUsers: 40, leadSessions: 1 };
  report.datasets.trafficTrend![4] = { ...report.datasets.trafficTrend![4], sessions: 40, activeUsers: 30 };
  report.datasets.trafficTrend![5] = { ...report.datasets.trafficTrend![5], sessions: 50, activeUsers: 40 };

  const client = await api<{ id: string }>(page, 'POST', '/api/clients', {
    name: 'Thin Evidence Client',
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
    { 'idempotency-key': `thin-${draft.id}` },
  );
  const complaint = await api<{ id: string }>(page, 'POST', '/api/complaints', {
    clientId: client.id,
    ...makeDemoComplaint(),
  });
  const analysis = await api<{ id: string; result: { diagnosis: string } }>(
    page,
    'POST',
    '/api/analyses',
    { reportId: committed.id, complaintId: complaint.id },
    { 'idempotency-key': `thin-analysis-${draft.id}` },
  );

  // It is a real saved analysis, not an error.
  expect(analysis.result.diagnosis).toBe('insufficient_evidence');

  await page.goto(`/analyses/${analysis.id}`);
  await expect(page.getByText('More comparable evidence is needed').first()).toBeVisible();
  // The raw figures stay visible, and the gap is named rather than implied.
  await expect(page.getByText(/fewer than 100 sessions/i).first()).toBeVisible();
  await expect(page.getByText('Shown for reference; not comparable enough to carry a direction.').first()).toBeVisible();
  // And it is never presented as a clean bill of health.
  const body = await page.evaluate(() => document.body.innerText.toLowerCase());
  expect(body).not.toContain('no clear issue');
});

test('the client selector moves between clients without losing the page', async ({ page }) => {
  await signIn(page);
  const first = await seedAnalysis(page, 'Switch Client A');
  const second = await seedAnalysis(page, 'Switch Client B');

  await page.goto(`/analyses/${first.analysisId}`);
  // The header names the client, so the page is never ambiguous about whose
  // figures these are.
  await expect(page.getByText(/Switch Client A . SEO performance/)).toBeVisible();
  await expect(page.getByLabel('Choose a client')).toHaveValue(first.clientId);

  // Choosing another client lands on that client's most recent saved analysis,
  // not on a blank dashboard.
  await page.getByLabel('Choose a client').selectOption(second.clientId);
  await page.waitForURL(new RegExp(second.analysisId), { timeout: 20_000 });
  await expect(page.getByLabel('Choose a client')).toHaveValue(second.clientId);
  await expect(page.getByText(/Switch Client B . SEO performance/)).toBeVisible();
});
