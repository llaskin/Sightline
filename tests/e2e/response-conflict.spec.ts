import { test, expect } from '@playwright/test';
import { signIn, seedAnalysis } from './helpers';

/**
 * AC-15: two people editing one draft.
 *
 * The point is not that a conflict is detected. It is that the person who loses
 * the race still has their own wording on screen afterwards.
 */

test('a conflicting save keeps both versions and loses neither', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const pageOne = await first.newPage();
  const pageTwo = await second.newPage();

  await signIn(pageOne);
  const seed = await seedAnalysis(pageOne, 'Conflict Client');
  await signIn(pageTwo);

  await pageOne.goto(`/analyses/${seed.analysisId}`);
  await pageTwo.goto(`/analyses/${seed.analysisId}`);

  // Both editors open the draft at the same revision.
  await pageOne.getByRole('button', { name: 'Edit' }).click();
  await pageTwo.getByRole('button', { name: 'Edit' }).click();

  const editorOne = pageOne.getByLabel('Response draft');
  const editorTwo = pageTwo.getByLabel('Response draft');
  await editorOne.fill('Wording written by the first editor.');
  await editorTwo.fill('Wording written by the second editor.');

  // The first save wins.
  await pageOne.getByRole('button', { name: 'Save draft' }).click();
  await expect(pageOne.getByText('Saved.')).toBeVisible();

  // The second is told, and keeps its own text.
  await pageTwo.getByRole('button', { name: 'Save draft' }).click();
  await expect(
    pageTwo.getByText('Someone else saved this draft while you were editing'),
  ).toBeVisible();

  // Both versions are shown side by side rather than one being chosen.
  await expect(pageTwo.getByText('Wording written by the second editor.').first()).toBeVisible();
  await expect(pageTwo.getByText('Wording written by the first editor.').first()).toBeVisible();

  // The second editor's own text is still in the editor, not discarded.
  await expect(editorTwo).toHaveValue('Wording written by the second editor.');

  // Choosing to keep their own version lets the next save succeed.
  await pageTwo.getByRole('button', { name: 'Keep editing mine' }).click();
  await pageTwo.getByLabel('Response draft').fill('Reconciled wording from the second editor.');
  await pageTwo.getByRole('button', { name: 'Save draft' }).click();
  await expect(pageTwo.getByText('Saved.')).toBeVisible();

  // And the saved result is what they reconciled to.
  await pageOne.reload();
  await expect(
    pageOne.getByText('Reconciled wording from the second editor.'),
  ).toBeVisible();

  await first.close();
  await second.close();
});

test('a saved draft survives a reload exactly', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Reload Client');
  await page.goto(`/analyses/${seed.analysisId}`);

  const text = 'Exact wording that must come back unchanged, including  double  spaces.';
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Response draft').fill(text);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Agency-edited draft')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Response draft')).toHaveValue(text);
});

test('regenerating warns before discarding unsaved changes', async ({ page }) => {
  await signIn(page);
  const seed = await seedAnalysis(page, 'Regenerate Client');
  await page.goto(`/analyses/${seed.analysisId}`);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Response draft').fill('Unsaved wording that must not vanish silently.');

  // Decline the confirmation: nothing changes.
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByLabel('Response draft')).toHaveValue(
    'Unsaved wording that must not vanish silently.',
  );

  // Accept it: a new generated revision replaces the text, with the warning
  // having been shown first.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByText('Generated draft').first()).toBeVisible();
});

test('a denied clipboard falls back to selecting the text', async ({ browser }) => {
  // A context with no clipboard permission, which is the common real case.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);
  const seed = await seedAnalysis(page, 'Clipboard Client');
  await page.goto(`/analyses/${seed.analysisId}`);

  // Force the failure path deterministically rather than relying on the
  // browser's default permission state.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
  await page.reload();

  await page.getByRole('button', { name: 'Copy' }).click();

  // The user is told what happened and given the text ready to copy by hand,
  // rather than being left with a silent failure.
  await expect(page.getByText(/Copying was blocked by the browser/)).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const editor = document.getElementById('response-draft') as HTMLTextAreaElement | null;
        return editor ? editor.selectionEnd - editor.selectionStart : 0;
      }),
    )
    .toBeGreaterThan(0);

  await context.close();
});
