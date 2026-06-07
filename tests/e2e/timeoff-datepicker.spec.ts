import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * BUG-001 regression: the New Time-Off Request calendar must register the
 * FIRST click. Before the fix, react-day-picker's `initialFocus` inside a
 * Popover portaled out of the modal Dialog's focus trap caused the first
 * day-click to be swallowed (PostHog rage-click). The fix removes
 * `initialFocus` and uses a controlled Popover that closes on a real pick.
 *
 * This exercises the real browser (Chromium) — the environment where the
 * focus race actually lives — and asserts both date pickers register a
 * first-interaction click AND close the popover (the observable fix).
 */
test.describe('Time-Off date picker (BUG-001)', () => {
  test('first click on the calendar selects the date and closes the popover', async ({ page }) => {
    const testUser = generateTestUser('timeoff-cal');
    await signUpAndCreateRestaurant(page, testUser);

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await page.getByRole('tab', { name: /time-off/i }).click();
    await page.getByRole('button', { name: /new request/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // ---- Start date: the first click must register ----
    const startTrigger = dialog.getByRole('button', { name: /select start date/i });
    await expect(startTrigger).toHaveText(/pick date/i); // empty initial state
    await startTrigger.click();

    const startGrid = page.getByRole('grid');
    await expect(startGrid).toBeVisible();
    // First (and only) interaction with a mid-month, always-enabled day.
    await startGrid.getByRole('gridcell', { name: '15', exact: true }).first().click();

    // The fix: the popover closes and the trigger now shows the chosen date.
    await expect(page.getByRole('grid')).toBeHidden();
    await expect(startTrigger).not.toHaveText(/pick date/i);
    await expect(startTrigger).toContainText('15');

    // ---- End date: same first-click guarantee (end-date calendar gates on start) ----
    const endTrigger = dialog.getByRole('button', { name: /select end date/i });
    await endTrigger.click();

    const endGrid = page.getByRole('grid');
    await expect(endGrid).toBeVisible();
    // Day 20 is on/after the chosen start (15) so it is enabled.
    await endGrid.getByRole('gridcell', { name: '20', exact: true }).first().click();

    await expect(page.getByRole('grid')).toBeHidden();
    await expect(endTrigger).toContainText('20');
  });
});
