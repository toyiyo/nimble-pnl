import { test, expect, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Reproduction for the shift-creation timezone defect.
 *
 * Shift creation computes the stored instant with `new Date("YYYY-MM-DDTHH:mm")`,
 * which JS parses in the *host* timezone. The restaurant's timezone is never
 * consulted, so a manager whose laptop clock differs from the restaurant's zone
 * writes the wrong instant. Rush Bowls hit this: the manager's device was on
 * America/Los_Angeles, the restaurant is America/Chicago, and every shift landed
 * exactly 2 hours late.
 *
 * WHY THE TIMEZONE IS PINNED
 * --------------------------
 * `timezoneId` is the whole point of this spec. Playwright sets no timezone by
 * default and CI runs UTC — and UTC is the one zone where a restaurant in
 * Chicago still produces a *wrong* answer but a spec written against the host
 * clock could look self-consistent. Pinning makes the failure a fixed, known
 * quantity on every machine: an exact +120 minutes, matching the production
 * rows and the PostHog session ($timezone_offset 420 vs Chicago's 300).
 * Unpinned, these assertions would pass before the fix, after the fix, and
 * straight through a future regression. Precedent: schedule-publish-week-range.spec.ts.
 *
 * WHY THIS DATE
 * -------------
 * 2026-08-12 is a Wednesday on which BOTH zones are in daylight time
 * (Chicago CDT = UTC-5, Los Angeles PDT = UTC-7). The gap is therefore a clean
 * 120 minutes with no DST transition confounding it. DST-boundary behaviour is
 * a separate concern covered by the converter's own unit tests.
 */

const SHIFT_DATE = '2026-08-12';
const START_TIME = '06:30';
const END_TIME = '12:30';

/** 06:30 in Chicago (UTC-5 on this date) is 11:30 UTC. This is the correct answer. */
const EXPECTED_START_UTC = '2026-08-12T11:30:00+00:00';
/** 12:30 in Chicago is 17:30 UTC. */
const EXPECTED_END_UTC = '2026-08-12T17:30:00+00:00';

/**
 * Points the restaurant at an explicit timezone.
 *
 * `signUpAndCreateRestaurant` sets no timezone, and `restaurants.timezone` is
 * nullable with a DEFAULT of 'America/Chicago'. Leaning on that default would
 * leave the premise of this whole spec implicit and silently invisible if the
 * default ever changed — so state it.
 */
async function setRestaurantTimezone(page: Page, restaurantId: string, timezone: string) {
  const result = await page.evaluate(
    async ({ restId, tz }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { error } = await supabase.from('restaurants').update({ timezone: tz }).eq('id', restId);
      if (error) return { ok: false, message: error.message };
      const { data } = await supabase.from('restaurants').select('timezone').eq('id', restId).single();
      return { ok: true, stored: data?.timezone };
    },
    { restId: restaurantId, tz: timezone },
  );
  expect(result.ok, `failed to set restaurant timezone: ${result.message}`).toBe(true);
  // Guard the premise: if this write silently no-ops (RLS, column rename), every
  // assertion below would be measuring the wrong thing.
  expect(result.stored).toBe(timezone);
}

async function createEmployee(page: Page, restaurantId: string, name: string) {
  const employee = await page.evaluate(
    async ({ restId, empName }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data, error } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: empName,
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select()
        .single();
      if (error) throw new Error(`employees insert failed: ${error.message}`);
      return data;
    },
    { restId: restaurantId, empName: name },
  );
  expect(employee?.id).toBeTruthy();
  return employee;
}

/** Drives the real Add-Shift dialog — the same path a manager clicks through. */
async function createShiftViaDialog(page: Page, employeeName: string) {
  await page.goto('/scheduling');
  await page.waitForLoadState('networkidle');

  // Either the empty-state CTA or the toolbar button, depending on whether the
  // week already has shifts. Both call the same handler.
  const emptyStateBtn = page.getByRole('button', { name: /create first shift/i });
  const toolbarBtn = page.getByRole('button', { name: 'Shift', exact: true });
  const addBtn = (await emptyStateBtn.count()) > 0 ? emptyStateBtn : toolbarBtn;
  await expect(addBtn.first()).toBeVisible({ timeout: 15000 });
  await addBtn.first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10000 });

  await dialog.getByRole('combobox', { name: /select employee/i }).click();
  await page.getByRole('option', { name: new RegExp(employeeName, 'i') }).click();

  await dialog.getByRole('combobox', { name: /select position/i }).click();
  await page.getByRole('option', { name: 'Server', exact: true }).click();

  await dialog.getByLabel('Shift start date').fill(SHIFT_DATE);
  await dialog.getByLabel('Shift start time').fill(START_TIME);
  await dialog.getByLabel('Shift end date').fill(SHIFT_DATE);
  await dialog.getByLabel('Shift end time').fill(END_TIME);

  await dialog.getByRole('button', { name: /create shift/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15000 });
}

async function readBackShift(page: Page, restaurantId: string) {
  const shift = await page.evaluate(
    async ({ restId }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('shifts')
        .select('start_time, end_time')
        .eq('restaurant_id', restId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    { restId: restaurantId },
  );
  expect(shift, 'no shift row was written').toBeTruthy();
  return shift as { start_time: string; end_time: string };
}

/** Minutes the stored instant is off by, signed. Reported so a failure names the defect. */
function driftMinutes(actualIso: string, expectedIso: string) {
  return Math.round((new Date(actualIso).getTime() - new Date(expectedIso).getTime()) / 60_000);
}

// ---------------------------------------------------------------------------
// THE BUG: manager's device in Los Angeles, restaurant in Chicago.
// ---------------------------------------------------------------------------
test.describe('Shift creation anchors to the restaurant timezone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('a 06:30 Chicago shift created from a Los Angeles device stores 11:30Z, not 13:30Z', async ({ page }) => {
    const testUser = generateTestUser('tzshift');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await setRestaurantTimezone(page, restaurantId, 'America/Chicago');
    const employee = await createEmployee(page, restaurantId, 'Tina Timezone');

    await createShiftViaDialog(page, employee.name);
    const shift = await readBackShift(page, restaurantId);

    const drift = driftMinutes(shift.start_time, EXPECTED_START_UTC);
    expect(
      drift,
      `start_time drifted ${drift} min. Expected ${EXPECTED_START_UTC} (06:30 Chicago), got ${shift.start_time}. ` +
        'A +120 drift is the known defect: the instant was computed in the browser timezone (America/Los_Angeles) ' +
        'instead of the restaurant timezone (America/Chicago).',
    ).toBe(0);

    expect(new Date(shift.start_time).toISOString()).toBe(new Date(EXPECTED_START_UTC).toISOString());
    expect(new Date(shift.end_time).toISOString()).toBe(new Date(EXPECTED_END_UTC).toISOString());
  });
});

// ---------------------------------------------------------------------------
// THE CONTROL: same restaurant, same wall clock, device already in Chicago.
//
// This must be GREEN both before and after the fix. It is what proves the fix
// re-anchors the conversion to the restaurant rather than shifting every shift
// by a constant two hours — a change that would make the test above pass while
// breaking every manager who is already in the restaurant's own timezone.
// ---------------------------------------------------------------------------
test.describe('Shift creation is unaffected when the device is already in the restaurant timezone', () => {
  test.use({ timezoneId: 'America/Chicago' });

  test('a 06:30 Chicago shift created from a Chicago device stores 11:30Z (green before and after the fix)', async ({ page }) => {
    const testUser = generateTestUser('tzctrl');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await setRestaurantTimezone(page, restaurantId, 'America/Chicago');
    const employee = await createEmployee(page, restaurantId, 'Carl Control');

    await createShiftViaDialog(page, employee.name);
    const shift = await readBackShift(page, restaurantId);

    const drift = driftMinutes(shift.start_time, EXPECTED_START_UTC);
    expect(
      drift,
      `Control case drifted ${drift} min — it must be 0 both before and after the fix. ` +
        `Expected ${EXPECTED_START_UTC}, got ${shift.start_time}.`,
    ).toBe(0);

    expect(new Date(shift.end_time).toISOString()).toBe(new Date(EXPECTED_END_UTC).toISOString());
  });
});
