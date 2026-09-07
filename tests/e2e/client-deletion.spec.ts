import { test, expect } from '@playwright/test';
import { signIn, signInAsAnalyst, seedAnalysis, api } from './helpers';

/**
 * Permanent client deletion through the interface.
 *
 * The API has always been able to do this; these tests exist because a
 * destructive capability an owner cannot reach is not a delivered capability.
 * The confirmation is deliberately ungenerous: a near miss deletes nothing.
 */

test('a near-miss on the typed name deletes nothing', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Near Miss Client');
  await page.goto(`/clients/${seed.clientId}`);

  await page.getByLabel('Type the client name to confirm').fill('near miss client');
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  await expect(page.getByText(/does not match this client exactly/)).toBeVisible();
  // The client, and everything under it, is still there.
  const still = await page.goto(`/clients/${seed.clientId}`);
  expect(still?.status()).toBe(200);
  const analysis = await page.goto(`/analyses/${seed.analysisId}`);
  expect(analysis?.status()).toBe(200);
});

test('an owner deletes a client and everything belonging to it', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Deletable Client');
  await page.goto(`/clients/${seed.clientId}`);

  await page.getByLabel('Type the client name to confirm').fill('Deletable Client');
  await page.getByRole('button', { name: 'Delete permanently' }).click();

  // The reader is returned to the list rather than left on a dead page.
  await page.waitForURL(/\/clients$/, { timeout: 20_000 });

  const gone = await page.goto(`/clients/${seed.clientId}`);
  expect(gone?.status()).toBe(404);
  const analysis = await page.goto(`/analyses/${seed.analysisId}`);
  expect(analysis?.status()).toBe(404);
  const report = await page.goto(`/reports/${seed.reportId}`);
  expect(report?.status()).toBe(404);
});

test('an analyst is told deletion is owner-only rather than shown a control', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsAnalyst(page);

  const clients = await api<{ items: Array<{ id: string }> }>(
    page,
    'GET',
    '/api/clients?limit=1&includeArchived=true',
  );
  expect(clients.items.length).toBeGreaterThan(0);
  await page.goto(`/clients/${clients.items[0].id}`);

  await expect(page.getByText(/deletion is limited to a workspace owner/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);

  await context.close();
});
