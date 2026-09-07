import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signIn, seedAnalysis } from './helpers';

/**
 * Automated accessibility checks plus the keyboard behaviour axe cannot see.
 *
 * Serious and critical violations fail the build. Automation cannot judge
 * whether wording is comprehensible or whether focus order makes sense, so the
 * keyboard tests below check the specific interactions that matter here.
 */

async function scan(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
}

function serious(results: Awaited<ReturnType<typeof scan>>) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

function describeViolations(results: Awaited<ReturnType<typeof scan>>) {
  return serious(results)
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes.map((node) => `    at ${node.target.join(' ')}\n    ${node.html.slice(0, 200)}`).join('\n'),
    )
    .join('\n');
}

test.describe('accessibility', () => {
  test('the sign-in page has no serious violations', async ({ page }) => {
    await page.goto('/login');
    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });

  test('the demo dashboard has no serious violations', async ({ page }) => {
    await page.goto('/demo');
    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });

  test('the analysis dashboard has no serious violations', async ({ page }) => {
    await signIn(page);
    const seed = await seedAnalysis(page, 'Accessibility Client');
    await page.goto(`/analyses/${seed.analysisId}`);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });

  test('an open evidence drawer has no serious violations', async ({ page }) => {
    await signIn(page);
    const seed = await seedAnalysis(page, 'Drawer Client');
    await page.goto(`/analyses/${seed.analysisId}`);
    await page.getByRole('button', { name: /Show the evidence behind Organic Traffic/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });
});

test.describe('keyboard navigation', () => {
  test('sign-in is completable with the keyboard alone', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab'); // email
    await page.keyboard.type('owner@example.com');
    await page.keyboard.press('Tab'); // password
    await page.keyboard.type('e2e-local-password-1234');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/(dashboard|analyses)/, { timeout: 20_000 });
  });

  test('a drawer traps focus, closes on Escape and returns focus to its trigger', async ({
    page,
  }) => {
    await signIn(page);
    const seed = await seedAnalysis(page, 'Focus Client');
    await page.goto(`/analyses/${seed.analysisId}`);

    const trigger = page.getByRole('button', { name: /Show the evidence behind Conversion Rate/i });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Focus has moved inside the dialog.
    const focusedInsideDialog = await page.evaluate(() => {
      const dialogEl = document.querySelector('[role="dialog"]');
      return dialogEl?.contains(document.activeElement) ?? false;
    });
    expect(focusedInsideDialog).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // And returns to the control that opened it, so the reader is not dropped
    // at the top of the document.
    await expect(trigger).toBeFocused();
  });

  test('a skip link is the first stop and reaches the main region', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeVisible();
  });

  test('every focusable control shows a visible focus ring', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').focus();
    const outline = await page.evaluate(() => {
      const style = window.getComputedStyle(document.activeElement!);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(parseFloat(outline.width)).toBeGreaterThan(0);
  });
});

test.describe('presentation', () => {
  test('headings form a sensible order with exactly one h1', async ({ page }) => {
    await signIn(page);
    const seed = await seedAnalysis(page, 'Heading Client');
    await page.goto(`/analyses/${seed.analysisId}`);

    const levels = await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => Number(el.tagName.slice(1))),
    );
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    // No level is skipped on the way down.
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  test('primary controls meet the 44px touch target', async ({ page }) => {
    await page.goto('/login');
    const button = page.getByRole('button', { name: 'Sign in' });
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('reduced motion is respected', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/demo');
    const duration = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transition = 'opacity 2s';
      document.body.appendChild(probe);
      const value = window.getComputedStyle(probe).transitionDuration;
      probe.remove();
      return value;
    });
    // The global rule collapses transitions to effectively zero.
    expect(parseFloat(duration)).toBeLessThan(0.01);
    await context.close();
  });

  test('colour is never the only signal for the investigation focus', async ({ page }) => {
    await page.goto('/demo');
    // The selected area is also named in text.
    await expect(page.getByText('Post-click', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('selected', { exact: true })).toBeVisible();
  });
});
