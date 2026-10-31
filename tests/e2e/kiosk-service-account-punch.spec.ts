import { test, expect } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  seedEmployeeWithPin,
  setUserRole,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * E2E test for a punch by a kiosk service account (role 'kiosk').
 *
 * The kiosk punch sends INSERT ... RETURNING. The kiosk role has no
 * view:scheduling or view:payroll capability. It has no employees row.
 * Before 20261031120000_time_punches_creator_select.sql, no SELECT policy
 * admitted the new row. Every punch then failed with
 * "new row violates row-level security policy for table "time_punches"".
 *
 * The other kiosk specs start the kiosk as the owner. The owner holds
 * view:scheduling, so those specs do not use this path.
 */

const PIN = '5937';

test.describe('Kiosk service account punch', () => {
  let testUser: ReturnType<typeof generateTestUser>;

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Open the app before the storage clear (about:blank has no localStorage).
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    testUser = generateTestUser('kiosk-svc');
    await signUpAndCreateRestaurant(page, testUser);
  });

  test('records a clock-in, a clock-out, and a tip', async ({ page }) => {
    const restaurantId = await page.evaluate(() =>
      (window as unknown as E2EHelperWindow).__getRestaurantId(),
    );
    expect(restaurantId).toBeTruthy();

    // Seed the employee and the PIN as the owner, before the role change.
    const employee = await seedEmployeeWithPin(
      page,
      restaurantId!,
      `Kiosk Account Employee ${crypto.randomUUID().slice(0, 8)}`,
      PIN,
    );

    await setUserRole(page, 'kiosk');
    await expect(page).toHaveURL(/\/kiosk/, { timeout: 15000 });

    for (const digit of PIN) {
      await page.getByRole('button', { name: `Digit ${digit}` }).click();
    }
    await page.getByRole('button', { name: /clock in/i }).click();
    await page.getByRole('button', { name: /skip photo/i }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Clocked in' })).toBeVisible({ timeout: 15000 });

    // The status above is optimistic. The INSERT runs after it, so poll the
    // row. The kiosk reads it through the new creator policy.
    await page.waitForFunction(
      () => (window as unknown as E2EHelperWindow).__supabaseHelpersReady === true,
      undefined,
      { timeout: 10000 },
    );
    await expect
      .poll(
        async () =>
          page.evaluate(async (employeeId: string) => {
            const { data, error } = await (window as unknown as E2EHelperWindow).__supabase
              .from('time_punches')
              .select('punch_type')
              .eq('employee_id', employeeId);
            // Return the error as a value: a throw would stop the poll at once.
            return error ? { error: error.message } : data;
          }, employee.id),
        { timeout: 15000 },
      )
      .toEqual([{ punch_type: 'clock_in' }]);

    await expect(page.getByRole('status').filter({ hasText: 'Error recording punch' })).toHaveCount(0);

    // Clock out. The kiosk then opens the tip dialog, which inserts into
    // employee_tips with INSERT ... RETURNING.
    for (const digit of PIN) {
      await page.getByRole('button', { name: `Digit ${digit}` }).click();
    }
    await page.getByRole('button', { name: /clock out/i }).click();
    await page.getByRole('button', { name: /skip photo/i }).click();

    await page.getByLabel('Cash tips amount').fill('12.50');
    await page.getByRole('button', { name: 'Submit Tips' }).click();
    await expect(page.getByRole('dialog').filter({ hasText: 'Cash Tips' })).toHaveCount(0, { timeout: 15000 });

    await expect
      .poll(
        async () =>
          page.evaluate(async (employeeId: string) => {
            const { data, error } = await (window as unknown as E2EHelperWindow).__supabase
              .from('employee_tips')
              .select('tip_amount')
              .eq('employee_id', employeeId);
            return error ? { error: error.message } : data;
          }, employee.id),
        { timeout: 15000 },
      )
      .toEqual([{ tip_amount: 1250 }]);
  });
});
