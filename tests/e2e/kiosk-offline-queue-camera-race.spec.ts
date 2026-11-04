/* eslint-disable @typescript-eslint/no-explicit-any -- window.__supabase and its test-only
   helpers (exposeSupabaseHelpers) carry no type declarations, same as every other E2E spec. */
import { createHash } from 'node:crypto';
import { test, expect, type Route } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E test for the kiosk offline queue race.
 *
 * The kiosk shows a punch result at once and releases the lock before the
 * background INSERT finishes. Employee A punches, and the test holds A's
 * INSERT. Employee B opens the camera dialog. Then the device goes offline
 * and A's INSERT fails, so A's punch goes to the offline queue. B's camera
 * dialog must stay open.
 */

const PIN_A = '1357';
const PIN_B = '2468';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

test.describe('Kiosk offline queue', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Open the app before the storage clear (about:blank has no localStorage).
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test.afterEach(async ({ page }) => {
    await page.context().setOffline(false);
  });

  test("a late offline queue does not close the next employee's camera dialog", async ({ page }) => {
    await signUpAndCreateRestaurant(page, generateTestUser('kiosk-race'));

    const restaurantId: string = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const suffix = crypto.randomUUID().slice(0, 8);
    const nameA = `Race Employee A ${suffix}`;
    const nameB = `Race Employee B ${suffix}`;

    const employees = await page.evaluate(
      ({ restId, names }: { restId: string; names: string[] }) =>
        (window as any).__insertEmployees(
          names.map((name) => ({
            name,
            position: 'Server',
            status: 'active',
            is_active: true,
            compensation_type: 'hourly',
            hourly_rate: 1800,
          })),
          restId,
        ),
      { restId: restaurantId, names: [nameA, nameB] },
    );
    const idA = employees.find((e: any) => e.name === nameA)?.id;
    const idB = employees.find((e: any) => e.name === nameB)?.id;
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();

    await page.evaluate(
      async ({ restId, pins }: { restId: string; pins: Array<{ employeeId: string; hash: string }> }) => {
        const supabase = (window as any).__supabase;
        const { error } = await supabase.from('employee_pins').insert(
          pins.map((p) => ({
            restaurant_id: restId,
            employee_id: p.employeeId,
            pin_hash: p.hash,
            min_length: 4,
            force_reset: false,
          })),
        );
        if (error) throw new Error(error.message);
      },
      {
        restId: restaurantId,
        pins: [
          { employeeId: idA, hash: sha256(PIN_A) },
          { employeeId: idB, hash: sha256(PIN_B) },
        ],
      },
    );

    // Hold the first punch INSERT. Let every other request through.
    let heldInsert: Route | null = null;
    let markHeld: () => void = () => {};
    const insertHeld = new Promise<void>((resolve) => {
      markHeld = resolve;
    });
    await page.route('**/rest/v1/time_punches*', async (route) => {
      if (route.request().method() === 'POST' && !heldInsert) {
        heldInsert = route;
        markHeld();
        return;
      }
      await route.continue();
    });

    // Launch the kiosk from the Time Punches page.
    await page.goto('/time-punches');
    await page.getByRole('button', { name: /time clock settings/i }).click();
    await page.getByRole('button', { name: /^launch$/i }).click();
    await expect(page).toHaveURL(/\/kiosk/, { timeout: 10000 });

    const enterPin = async (pin: string) => {
      for (const digit of pin) {
        await page.getByRole('button', { name: `Digit ${digit}` }).click();
      }
    };
    const cameraDialog = page.getByRole('dialog', { name: /verify your identity/i });

    // Employee A punches. The optimistic result shows before the INSERT settles.
    await enterPin(PIN_A);
    await page.getByRole('button', { name: /clock in/i }).click();
    await expect(cameraDialog).toBeVisible();
    await page.getByRole('button', { name: /skip photo/i }).click();
    await expect(cameraDialog).toBeHidden();
    await expect(page.getByText(nameA)).toBeVisible({ timeout: 10000 });
    await insertHeld;

    // Employee B opens the camera dialog while A's INSERT is still pending.
    await enterPin(PIN_B);
    await page.getByRole('button', { name: /clock in/i }).click();
    await expect(cameraDialog).toBeVisible();

    // The device goes offline, and A's INSERT fails.
    await page.context().setOffline(true);
    await heldInsert!.abort('internetdisconnected');

    // A's punch goes to the offline queue.
    await expect(page.getByText('Saved offline — will sync when online.')).toBeVisible({ timeout: 10000 });

    // B's camera dialog stays open.
    await expect(cameraDialog).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm punch/i })).toBeVisible();
  });
});
