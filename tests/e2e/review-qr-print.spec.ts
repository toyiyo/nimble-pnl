import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E: an owner prints the table tent from the QR dialog.
 *
 * The unit tests cover the props and the state. They cannot cover the print
 * CSS, because jsdom has no print media and no page box. This spec is the only
 * place `@media print` runs, so it asserts the two rules that a manager finds
 * out about at the printer:
 *
 *   1. The print copy hangs off document.body, outside DialogContent. A
 *      `fixed`, clipped, transformed ancestor prints the visible scroll
 *      window only.
 *   2. Print hides every other body child. Without that rule the sheet
 *      arrives behind the app chrome and the dialog overlay.
 *
 * `window.print` opens a native dialog that Playwright cannot close, so the
 * spec replaces it with a counter before the click.
 */

test('an owner previews and prints the table tent', async ({ page }) => {
  const user = generateTestUser('qrprint');
  await signUpAndCreateRestaurant(page, user);

  await page.goto('/reviews');
  await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /new page/i }).first().click();
  await page.getByLabel(/^name$/i).fill(`Tents ${Date.now()}`);
  await page.getByLabel(/google review link/i).fill('https://example.com/google-review');
  await page.getByRole('button', { name: /create page/i }).click();

  await page.getByRole('button', { name: /qr code/i }).click();

  const printRoot = page.locator('#review-print-root');
  await expect(printRoot).toHaveAttribute('data-size', 'tent', { timeout: 10000 });

  // The print copy is a sibling of the dialog on body, not a descendant of it.
  // `evaluate` reads the real parent, which no CSS selector can assert.
  const parentIsBody = await printRoot.evaluate((node) => node.parentElement === document.body);
  expect(parentIsBody).toBe(true);

  // The sheet carries the restaurant name and the seeded headline.
  const tile = printRoot.locator('.print-tile');
  await expect(tile).toHaveCount(1);
  await expect(tile).toContainText(user.restaurantName);
  await expect(tile).toContainText('How was everything?');

  // A one-off message reaches both mounts: the preview and the paper.
  await page.getByLabel(/^message$/i).fill('Tell us how we did');
  await expect(page.locator('.print-tile', { hasText: 'Tell us how we did' })).toHaveCount(2);

  // The sticker sheet is six tiles on one page, and repoints `@page`.
  await page.getByRole('radio', { name: /sticker/i }).click();
  await expect(printRoot).toHaveAttribute('data-size', 'stickers');
  await expect(printRoot.locator('.print-tile')).toHaveCount(6);

  await page.getByRole('radio', { name: /table tent/i }).click();
  await expect(printRoot).toHaveAttribute('data-size', 'tent');

  // Print media: the sheet is the only thing on the paper.
  //
  // Read the computed styles, not `toBeVisible`/`toBeHidden`. Radix marks the
  // background `aria-hidden` while a dialog is open, so a role query behind the
  // dialog matches nothing — and `toBeHidden()` passes for zero elements. That
  // assertion held even after the print rule was deleted. These do not.
  await page.emulateMedia({ media: 'print' });

  const printStyles = await page.evaluate(() => {
    const root = document.getElementById('review-print-root')!;
    const app = document.getElementById('root')!;
    return {
      appDisplay: getComputedStyle(app).display,
      sheetDisplay: getComputedStyle(root).display,
      // The screen rule parks the sheet at left: -100000px. Print must undo it,
      // or the paper comes out blank.
      sheetPosition: getComputedStyle(root).position,
      sheetLeft: getComputedStyle(root).left,
    };
  });

  expect(printStyles.appDisplay).toBe('none');
  expect(printStyles.sheetDisplay).not.toBe('none');
  expect(printStyles.sheetPosition).toBe('static');
  expect(printStyles.sheetLeft).toBe('auto');

  await page.emulateMedia({ media: 'screen' });

  await page.evaluate(() => {
    (window as unknown as { __printCalls: number }).__printCalls = 0;
    window.print = () => {
      (window as unknown as { __printCalls: number }).__printCalls += 1;
    };
  });

  await page.getByRole('button', { name: /^print$/i }).click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls), {
      timeout: 10000,
    })
    .toBe(1);

  // Close the dialog, then print again.
  //
  // The hide rule is global CSS. It loads with the Reviews route and stays for
  // the whole session. Scoped to `body >` alone it also hides the app on every
  // other page: a manager who opens this dialog once then prints a payroll
  // report gets a blank sheet. The rule must therefore need the print root to
  // be mounted.
  await page.keyboard.press('Escape');
  await expect(printRoot).toHaveCount(0);

  await page.emulateMedia({ media: 'print' });
  const afterClose = await page.evaluate(
    () => getComputedStyle(document.getElementById('root')!).display
  );
  expect(afterClose).not.toBe('none');
  await page.emulateMedia({ media: 'screen' });
});
