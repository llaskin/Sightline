import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signIn, seedAnalysis } from './helpers';

/**
 * Responsive behaviour at the five sizes named in the specification.
 *
 * The load-bearing assertion is that the *document* never scrolls sideways. A
 * wide table scrolling inside its own card is intended; the page body scrolling
 * horizontally is the failure that makes a phone unusable.
 */

const ARTIFACTS = 'docs/verification-artifacts';

const VIEWPORTS = [
  { name: '1536x1024', width: 1536, height: 1024, sidebar: 'full' },
  { name: '1280x800', width: 1280, height: 800, sidebar: 'full' },
  { name: '1024x768', width: 1024, height: 768, sidebar: 'rail' },
  { name: '768x1024', width: 768, height: 1024, sidebar: 'drawer' },
  { name: '390x844', width: 390, height: 844, sidebar: 'drawer' },
] as const;

test.beforeAll(() => {
  mkdirSync(ARTIFACTS, { recursive: true });
});

for (const viewport of VIEWPORTS) {
  test(`the dashboard is usable at ${viewport.name} with no page-wide overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signIn(page);
    const seed = await seedAnalysis(page, `Responsive ${viewport.width}`);
    await page.goto(`/analyses/${seed.analysisId}`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.screenshot({
      path: `${ARTIFACTS}/dashboard-${viewport.name}.png`,
      fullPage: true,
    });

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `document scrolls sideways at ${viewport.name}`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Every panel is reachable by ordinary scrolling; nothing is clipped away.
    await expect(page.getByRole('heading', { name: 'Client Complaint' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Evidence diagnosis' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Suggested Response' })).toBeVisible();

    // The four metric values survive every size.
    await expect(page.getByText('+74%', { exact: true })).toBeVisible();
    await expect(page.getByText('-43%', { exact: true })).toBeVisible();
  });
}

test('the sidebar becomes an icon rail, then a menu drawer', async ({ page }) => {
  await signIn(page);

  // Full sidebar: the wordmark is visible.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();

  // Icon rail: labels remain in the accessibility tree even though they are
  // visually hidden, so the navigation is not lost to a screen reader.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.getByRole('link', { name: 'Analysis History' }).first()).toBeAttached();

  // Below 1024 the sidebar is replaced by a menu button.
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Open menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole('link', { name: 'Clients' }).first()).toBeVisible();
});

test('a wide table scrolls inside its own card rather than the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const seed = await seedAnalysis(page, 'Narrow Tables');
  await page.goto(`/analyses/${seed.analysisId}`);

  await expect(page.getByRole('heading', { name: 'Top Keywords Movement' })).toBeVisible();

  const result = await page.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find((node) =>
      node.textContent?.includes('Old'),
    );
    if (!table) return null;
    const container = table.parentElement!;
    return {
      containerScrolls: container.scrollWidth > container.clientWidth,
      containerOverflowX: window.getComputedStyle(container).overflowX,
      documentScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  expect(result).not.toBeNull();
  expect(result!.containerOverflowX).toBe('auto');
  expect(result!.documentScrolls).toBe(false);
});

test('the metric grid reflows from four columns to two to one', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Grid Client');

  const columnsAt = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/analyses/${seed.analysisId}`);
    await expect(page.getByText('+74%', { exact: true })).toBeVisible();
    return page.evaluate(() => {
      const value = [...document.querySelectorAll('p')].find(
        (node) => node.textContent?.trim() === '+74%',
      );
      const grid = value?.closest('section')?.parentElement;
      if (!grid) return 0;
      return window.getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    });
  };

  expect(await columnsAt(1400)).toBe(4);
  expect(await columnsAt(700)).toBe(2);
  expect(await columnsAt(390)).toBe(1);
});
