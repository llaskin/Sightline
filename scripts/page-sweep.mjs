/**
 * Walks every authenticated route in a real browser and reports what actually
 * happened: HTTP status, console errors, page errors, whether a Next error
 * boundary rendered, and whether the document overflows horizontally.
 *
 * Reading a route handler tells you it compiles. This tells you it renders.
 *
 *   node scripts/page-sweep.mjs <baseURL> <email> <password> [width] [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base, email, password, widthArg, outDir] = process.argv.slice(2);
const width = Number(widthArg ?? 1536);
const dir = outDir ?? 'docs/verification-artifacts';
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height: 1024 } });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password', { exact: true }).fill(password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/(dashboard|analyses)/, { timeout: 30_000 });

// Establish real data so pages are exercised with content, not just empty states.
const post = async (path, body, headers = {}) => {
  const response = await context.request.post(`${base}${path}`, {
    data: body,
    headers: { origin: base, ...headers },
  });
  const text = await response.text();
  if (!response.ok()) throw new Error(`${path} -> ${response.status()} ${text.slice(0, 200)}`);
  return JSON.parse(text).data;
};

const clients = await context.request.get(`${base}/api/clients`, { headers: { origin: base } });
const existing = (await clients.json()).data.items;
let clientId = existing[0]?.id;
if (!clientId) {
  const created = await post('/api/clients', {
    name: 'Sweep Client',
    domain: 'example.com',
    timeZone: 'America/New_York',
  });
  clientId = created.id;
}

const analysesResponse = await context.request.get(`${base}/api/analyses`, {
  headers: { origin: base },
});
const analysisId = (await analysesResponse.json()).data.items[0]?.id ?? null;

const reportsResponse = await context.request.get(`${base}/api/reports`, {
  headers: { origin: base },
});
const reportId = (await reportsResponse.json()).data.items[0]?.id ?? null;

const templatesResponse = await context.request.get(`${base}/api/templates`, {
  headers: { origin: base },
});
const templateId = (await templatesResponse.json()).data.items[0]?.id ?? null;

const ROUTES = [
  ['dashboard', '/dashboard'],
  ['clients', '/clients'],
  ['clients-new', '/clients?new=1'],
  ['clients-archived', '/clients?archived=1'],
  ['client-detail', clientId ? `/clients/${clientId}` : null],
  ['reports-new', `/reports/new?clientId=${clientId}`],
  ['report-detail', reportId ? `/reports/${reportId}` : null],
  ['complaints', '/complaints'],
  ['complaints-filtered', `/complaints?clientId=${clientId}&status=open`],
  ['analyses-new', `/analyses/new?clientId=${clientId}`],
  ['analysis', analysisId ? `/analyses/${analysisId}` : null],
  ['history', '/history'],
  ['history-filtered', '/history?diagnosis=post_click'],
  ['templates', '/templates'],
  ['template-detail', templateId ? `/templates?templateId=${templateId}` : null],
  ['settings', '/settings'],
  ['demo', '/demo'],
];

const results = [];
for (const [name, path] of ROUTES) {
  if (!path) {
    results.push({ name, skipped: 'no data available' });
    continue;
  }
  consoleErrors.length = 0;
  pageErrors.length = 0;

  const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  // Matches only the framework's own error surfaces. A bare '500' substring
  // was a false positive: the form finding legitimately renders '2.500%'.
  const boundary = await page.evaluate(() => {
    const text = document.body.innerText;
    return (
      text.includes("This page couldn't load") ||
      text.includes('Application error:') ||
      text.includes('Internal Server Error') ||
      document.querySelector('.next-error-h1') !== null
    );
  });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const heading = await page
    .locator('h1')
    .first()
    .textContent()
    .catch(() => null);

  await page.screenshot({ path: `${dir}/sweep-${name}.png`, fullPage: true });

  results.push({
    name,
    path,
    status: response?.status() ?? null,
    heading: heading?.trim().slice(0, 60) ?? null,
    errorBoundary: boundary,
    overflows: overflow.scrollWidth > overflow.clientWidth + 1,
    consoleErrors: [...consoleErrors],
    pageErrors: [...pageErrors],
  });
}

await browser.close();

let failures = 0;
console.log(`\n${'ROUTE'.padEnd(20)} ${'ST'.padEnd(4)} ${'OK'.padEnd(4)} HEADING`);
for (const result of results) {
  if (result.skipped) {
    console.log(`${result.name.padEnd(20)} --   skip ${result.skipped}`);
    continue;
  }
  const bad =
    result.status !== 200 ||
    result.errorBoundary ||
    result.overflows ||
    result.pageErrors.length > 0 ||
    result.consoleErrors.length > 0;
  if (bad) failures += 1;
  console.log(
    `${result.name.padEnd(20)} ${String(result.status).padEnd(4)} ${(bad ? 'FAIL' : 'ok').padEnd(4)} ${result.heading ?? ''}`,
  );
  if (result.errorBoundary) console.log('    error boundary rendered');
  if (result.overflows) console.log('    document overflows horizontally');
  for (const error of result.pageErrors) console.log(`    page error: ${error.slice(0, 200)}`);
  for (const error of result.consoleErrors) console.log(`    console: ${error.slice(0, 200)}`);
}

console.log(`\n${results.length - failures} of ${results.length} routes clean.`);
process.exit(failures > 0 ? 1 : 0);
