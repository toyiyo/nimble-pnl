/* eslint-disable @typescript-eslint/no-explicit-any -- window.__supabase and its test-only
   helpers (exposeSupabaseHelpers) carry no type declarations, same as every other E2E spec. */
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E test for a Kiosk punch with a failed GPS read.
 *
 * The browser GPS read fails (an init script makes getCurrentPosition call
 * its error callback). An employee clocks in on the Kiosk with a PIN. The
 * stored punch must carry `{ location_unavailable: true }`, so the manager
 * sees it in the "no location" count, filter, and chip.
 */

const PIN = '4829';

test.describe('Kiosk punch with a failed GPS read', () => {
  let testUser: ReturnType<typeof generateTestUser>;

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Open the app before the storage clear (about:blank has no localStorage).
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    testUser = generateTestUser('kiosk-noloc');
    await signUpAndCreateRestaurant(page, testUser);
  });

  test('stores location_unavailable on the punch', async ({ page }) => {
    // Every GPS read on every later page fails with PERMISSION_DENIED.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
            setTimeout(() => error?.({ code: 1, message: 'denied' } as GeolocationPositionError), 0);
          },
          watchPosition: () => 0,
          clearWatch: () => {},
        },
      });
    });

    const restaurantId: string = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const employeeName = `No Location Employee ${crypto.randomUUID().slice(0, 8)}`;
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

    // Launch the kiosk from the Time Punches page.
    await page.goto('/time-punches');
    const settingsButton = page.getByRole('button', { name: /time clock settings/i });
    await expect(settingsButton).toBeVisible({ timeout: 15000 });
    await settingsButton.click();
    const launchButton = page.getByRole('button', { name: /^launch$/i });
    await expect(launchButton).toBeVisible({ timeout: 5000 });
    await launchButton.click();
    await expect(page).toHaveURL(/\/kiosk/, { timeout: 10000 });

    for (const digit of PIN) {
      await page.getByRole('button', { name: `Digit ${digit}` }).click();
    }
    await page.getByRole('button', { name: /clock in/i }).click();
    await page.getByRole('button', { name: /skip photo/i }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Clocked in' })).toBeVisible({ timeout: 15000 });

    // The INSERT runs in the background after the optimistic status. Poll the row.
    await page.waitForFunction(() => (window as any).__supabaseHelpersReady === true, undefined, { timeout: 10000 });
    await expect
      .poll(
        async () =>
          page.evaluate(async (employeeId: string) => {
            const { data, error } = await (window as any).__supabase
              .from('time_punches')
              .select('punch_type, location')
              .eq('employee_id', employeeId);
            if (error) throw new Error(error.message);
            return data;
          }, employee.id),
        { timeout: 15000 },
      )
      .toEqual([{ punch_type: 'clock_in', location: { location_unavailable: true } }]);
  });
});
