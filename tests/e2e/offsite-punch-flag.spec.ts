/* eslint-disable @typescript-eslint/no-explicit-any -- window.__supabase and its test-only
   helpers (exposeSupabaseHelpers) carry no type declarations, same as every other E2E spec. */
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E test for off-site punch flags on `/time-punches`.
 *
 * The restaurant gets a geofence center. An employee punch arrives 0.0135
 * degrees of latitude north of it (about 1501 m). The client claims
 * `within_geofence: true`, but the `set_punch_geofence` trigger calculates
 * the flag again on the server. The manager sees the off-site button in the
 * status bar. A click opens the Punch List with the off-site filter on, and
 * the row shows the "1.5 km away" chip.
 */

const CENTER = { latitude: 30.2672, longitude: -97.7431 };

test.describe('Off-site punch flags', () => {
  let testUser: ReturnType<typeof generateTestUser>;

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Open the app before the storage clear (about:blank has no localStorage).
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    testUser = generateTestUser('offsite');
    await signUpAndCreateRestaurant(page, testUser);
  });

  test('the server flags a punch outside the radius and the manager sees it', async ({ page }) => {
    const restaurantId: string = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Give the restaurant a geofence center. Enforcement stays `off`: the
    // server flags the punch also in that mode.
    await page.evaluate(
      async ({ restId, center }: { restId: string; center: typeof CENTER }) => {
        const supabase = (window as any).__supabase;
        const { error } = await supabase
          .from('restaurants')
          .update({ latitude: center.latitude, longitude: center.longitude, geofence_radius_meters: 200 })
          .eq('id', restId);
        if (error) throw new Error(error.message);
      },
      { restId: restaurantId, center: CENTER },
    );

    const employeeName = `Offsite Employee ${crypto.randomUUID().slice(0, 8)}`;
    const [employee] = await page.evaluate(
      ({ restId, name }: { restId: string; name: string }) =>
        (window as any).__insertEmployees(
          [{ name, position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 }],
          restId,
        ),
      { restId: restaurantId, name: employeeName },
    );
    expect(employee?.id).toBeTruthy();

    // `/time-punches` opens on today, from `startOfDay` in the browser time zone.
    // Before 00:30, `now - 30 min` is yesterday and the page does not count it.
    // Use the later of the two times. Compute it in the browser for the same zone.
    const punchTime: string = await page.evaluate(() => {
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      return new Date(Math.max(now.getTime() - 30 * 60 * 1000, startOfToday.getTime())).toISOString();
    });
    const [punch] = await page.evaluate(
      ({ restId, employeeId, time, center }: { restId: string; employeeId: string; time: string; center: typeof CENTER }) =>
        (window as any).__insertTimePunches(
          [
            {
              employee_id: employeeId,
              punch_type: 'clock_in',
              punch_time: time,
              location: {
                latitude: center.latitude + 0.0135,
                longitude: center.longitude,
                within_geofence: true,
                distance_meters: 0,
              },
            },
          ],
          restId,
        ),
      { restId: restaurantId, employeeId: employee.id, time: punchTime, center: CENTER },
    );

    // The trigger overrides the false client flag.
    expect(punch.location.within_geofence).toBe(false);
    expect(punch.location.distance_meters).toBeGreaterThan(1400);
    expect(punch.location.geofence_radius_meters).toBe(200);

    await page.goto('/time-punches');

    const offsiteButton = page.getByRole('button', {
      name: '1 off-site punch. Show them in the punch list.',
    });
    await expect(offsiteButton).toBeVisible({ timeout: 15000 });
    await offsiteButton.click();

    await expect(page.getByRole('radio', { name: 'Off-site (1)' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('1.5 km away').first()).toBeVisible();
  });
});
