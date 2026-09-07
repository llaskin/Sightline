import { test, expect } from '@playwright/test';
import { signIn, seedAnalysis } from './helpers';

/**
 * The attribution required by the licence.
 *
 * LICENSE, "ADDITIONAL TERMS UNDER SECTION 7", requires that the sponsorship
 * credit be preserved in the Appropriate Legal Notices displayed by every
 * interface of this program and of any work based on it. These tests are what
 * makes that requirement observable rather than merely written down: a fork
 * that strips the footer fails its own build.
 *
 * The three legal-notice elements are checked alongside it on purpose. AGPL
 * section 5(d) only obliges a derivative's interfaces to display notices if the
 * original's interfaces do; if this footer ever lost the copyright notice, the
 * warranty statement or the licence link, that obligation would fall away and
 * the attribution term would lose most of its force.
 */

/** Signed-out interfaces, plus one representative authenticated page. */
const PUBLIC_PAGES = ['/login', '/demo'];

async function expectNotices(page: import('@playwright/test').Page, where: string) {
  const footer = page.getByRole('contentinfo').filter({ hasText: 'Sponsored by' });

  await expect(footer, `${where} has no sponsorship footer`).toBeVisible();

  // The attribution the licence names, and the link it names.
  const sponsor = footer.getByRole('link', { name: 'AI Find My Business' });
  await expect(sponsor, `${where} is missing the attribution link`).toBeVisible();
  await expect(sponsor).toHaveAttribute('href', 'https://www.aifindmybusiness.com');

  // The three things AGPL section 0 requires of Appropriate Legal Notices.
  await expect(footer, `${where} has no copyright notice`).toContainText(
    /©\s*\d{4}\s*AI Find My Business/,
  );
  await expect(footer, `${where} does not state that there is no warranty`).toContainText(
    'No warranty',
  );
  const licence = footer.getByRole('link', { name: 'AGPL-3.0' });
  await expect(licence, `${where} does not say how to view the licence`).toBeVisible();
  await expect(licence).toHaveAttribute('href', /gnu\.org\/licenses\/agpl-3\.0/);
}

test('every signed-out interface carries the attribution and legal notices', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    await expectNotices(page, path);
  }
  await context.close();
});

test('every authenticated interface carries the attribution and legal notices', async ({
  page,
}) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Sponsorship Client');

  // One page per shape of the shell: a dashboard, a list, a form and a detail.
  for (const path of ['/dashboard', '/clients', '/reports/new', `/analyses/${seed.analysisId}`]) {
    await page.goto(path);
    await expectNotices(page, path);
  }
});

test('the footer is readable rather than tucked out of the way', async ({ page }) => {
  await signIn(page);
  await page.goto('/clients');
  const footer = page.getByRole('contentinfo').filter({ hasText: 'Sponsored by' });

  // Not collapsed, not zero-height, not hidden behind the sidebar.
  const box = await footer.boundingBox();
  expect(box, 'the footer has no box').not.toBeNull();
  expect(box!.height, 'the footer is collapsed').toBeGreaterThan(20);
  expect(box!.width, 'the footer is too narrow to read').toBeGreaterThan(200);

  const style = await footer.evaluate((el) => {
    const s = getComputedStyle(el);
    return { opacity: Number(s.opacity), visibility: s.visibility, display: s.display };
  });
  expect(style.opacity).toBeGreaterThan(0.5);
  expect(style.visibility).toBe('visible');
  expect(style.display).not.toBe('none');
});

test('the attribution survives a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expectNotices(page, '/demo at 390px');

  // And it does not push the page into horizontal scrolling.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the footer causes horizontal overflow').toBeLessThanOrEqual(1);
});
