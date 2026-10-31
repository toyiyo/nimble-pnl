/* eslint-disable @typescript-eslint/no-explicit-any -- window.__supabase and its test-only
   helpers (exposeSupabaseHelpers) carry no type declarations, same as every other E2E spec. */
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E test for a punch by a kiosk service account (role 'kiosk').
 *
 * The kiosk punch sends INSERT ... RETURNING. The kiosk role has no
 * view:scheduling / view:payroll capability and no employees row, so before
 * 20261031120000_time_punches_creator_select.sql no SELECT policy admitted the
 * new row, and every punch failed with "new row violates row-level security
 * policy for table "time_punches"".
 *
 * The other kiosk specs launch the kiosk as the owner, who holds
 * view:scheduling, so they never hit this path.
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

  test('records a clock-in and stores the punch row', async ({ page }) => {
    const restaurantId: string = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed the employee and the PIN as the owner, before the role change.
    const employeeName = `Kiosk Account Employee ${crypto.randomUUID().slice(0, 8)}`;
    const [employee] = await page.evaluate(
      ({ restId, name }: { restId: string; name: string }) =>
        (window as any).__insertEmployees(
          [{ name, position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 }],
          restId,
        ),
      { restId: restaurantId, name: employeeName },
    );
    expect(employee?.id).toBeTruthy();

    // Same hash as src/utils/kiosk.ts hashString (SHA-256, lowercase hex).
    await page.evaluate(
      async ({ restId, employeeId, pin }: { restId: string; employeeId: string; pin: string }) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
        const pinHash = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const { error } = await (window as any).__supabase
          .from('employee_pins')
          .insert({ restaurant_id: restId, employee_id: employeeId, pin_hash: pinHash, min_length: 4, force_reset: false });
        if (error) throw new Error(error.message);
      },
      { restId: restaurantId, employeeId: employee.id, pin: PIN },
    );

    // Turn this user into a kiosk service account. Same step as
    // setUserRole(page, 'kiosk') in permissions-roles.spec.ts.
    await exposeSupabaseHelpers(page);
    await page.evaluate(async (restId: string) => {
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');
      const { error } = await (window as any).__supabase
        .from('user_restaurants')
        .update({ role: 'kiosk' })
        .eq('user_id', user.id)
        .eq('restaurant_id', restId);
      if (error) throw new Error(`Failed to update role: ${error.message}`);
    }, restaurantId);
    await page.reload();
    await expect(page).toHaveURL(/\/kiosk/, { timeout: 15000 });

    for (const digit of PIN) {
      await page.getByRole('button', { name: `Digit ${digit}` }).click();
    }
    await page.getByRole('button', { name: /clock in/i }).click();
    await page.getByRole('button', { name: /skip photo/i }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Clocked in' })).toBeVisible({ timeout: 15000 });

    // The status above is optimistic. The INSERT runs after it, so poll the
    // row. The kiosk reads it through the new creator policy.
    await page.waitForFunction(() => (window as any).__supabaseHelpersReady === true, undefined, { timeout: 10000 });
    await expect
      .poll(
        async () =>
          page.evaluate(async (employeeId: string) => {
            const { data, error } = await (window as any).__supabase
              .from('time_punches')
              .select('punch_type, notes')
              .eq('employee_id', employeeId);
            // Return the error as a value: a throw would stop the poll at once.
            return error ? { error: error.message } : data;
          }, employee.id),
        { timeout: 15000 },
      )
      .toEqual([{ punch_type: 'clock_in', notes: 'Kiosk PIN punch' }]);

    await expect(page.getByText('Error recording punch')).toHaveCount(0);
  });
});
