import { test, expect } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  exposeSupabaseHelpers,
  generateTestUser,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * Shift Protection E2E (warn mode, end to end):
 *   1. The owner turns on the time-off notice rule (warn, 60 days) — seeded
 *      through staffing_settings, the same row the settings dialog writes.
 *   2. The New Time-Off Request dialog shows the warning panel for a
 *      short-notice pick, and the request still submits (warn never stops
 *      a request).
 *   3. The approval queue answers with policy findings; "Approve anyway"
 *      retries with the override and the request lands approved.
 *
 * 60 days of notice makes EVERY date reachable in the calendar a
 * short-notice date, so the spec stays green on any day of the month
 * (hardcoded-date lesson). Block-mode negative paths are pgTAP-covered
 * (supabase/tests/shift_protection_triggers.test.sql).
 */
test.describe('Shift Protection (warn rules)', () => {
  test('the dialog warns, the request submits, the queue approves anyway', async ({ page }) => {
    const owner = generateTestUser('shift-prot');
    await signUpAndCreateRestaurant(page, owner);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as E2EHelperWindow).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed: one employee and the warn rule.
    await page.evaluate(async ({ restId }) => {
      const supabase = (window as E2EHelperWindow).__supabase;
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error('No session');

      const { error: empErr } = await supabase.from('employees').insert({
        restaurant_id: restId, user_id: userId, name: 'Riley Server', position: 'Server',
        status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
      });
      if (empErr) throw new Error(`employee insert: ${empErr.message}`);

      const { error: setErr } = await supabase.from('staffing_settings').upsert(
        { restaurant_id: restId, timeoff_notice_mode: 'warn', timeoff_notice_days: 60 },
        { onConflict: 'restaurant_id' },
      );
      if (setErr) throw new Error(`settings upsert: ${setErr.message}`);
    }, { restId: restaurantId as string });

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await page.getByRole('tab', { name: /time-off/i }).click();
    await page.getByRole('button', { name: /new request/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Pick the employee.
    await dialog.getByLabel(/employee/i).click();
    await page.getByRole('option', { name: /riley server/i }).click();

    // Pick dates (mid-month days are always clickable — see
    // timeoff-datepicker.spec.ts).
    await dialog.getByRole('button', { name: /select start date/i }).click();
    await page.getByRole('grid').getByRole('gridcell', { name: '15', exact: true }).first().click();
    await expect(page.getByRole('grid')).toBeHidden();

    await dialog.getByRole('button', { name: /select end date/i }).click();
    await page.getByRole('grid').getByRole('gridcell', { name: '20', exact: true }).first().click();
    await expect(page.getByRole('grid')).toBeHidden();

    // The warning panel appears and names the notice rule, and the submit
    // stays enabled (warn mode).
    const warningPanel = dialog.getByRole('status');
    await expect(warningPanel).toBeVisible({ timeout: 10000 });
    await expect(warningPanel).toContainText(/days of notice/i);

    const submit = dialog.getByRole('button', { name: /submit request/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Approve from the pending queue: the RPC answers policy_warning, the
    // findings dialog opens, and "Approve anyway" approves.
    const approveButton = page.getByRole('button', { name: /approve time-off for riley server/i });
    await expect(approveButton).toBeVisible({ timeout: 15000 });
    await approveButton.click();

    const findingsDialog = page.getByRole('alertdialog');
    await expect(findingsDialog).toBeVisible({ timeout: 15000 });
    await expect(findingsDialog).toContainText(/shift protection findings/i);
    await expect(findingsDialog).toContainText(/days of notice/i);

    await findingsDialog.getByRole('button', { name: /approve anyway/i }).click();
    await expect(findingsDialog).toBeHidden({ timeout: 15000 });

    // Authoritative: the request is approved in the database.
    await expect
      .poll(
        async () =>
          page.evaluate(async (restId: string) => {
            const supabase = (window as E2EHelperWindow).__supabase;
            const { data } = await supabase
              .from('time_off_requests')
              .select('status')
              .eq('restaurant_id', restId)
              .limit(1)
              .single();
            return data?.status ?? null;
          }, restaurantId as string),
        { timeout: 15000 },
      )
      .toBe('approved');
  });
});
