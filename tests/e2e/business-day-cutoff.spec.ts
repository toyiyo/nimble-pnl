import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * BUSINESS-DAY CUTOFF, END TO END.
 *
 * A restaurant's operating day does not start at midnight. Until this feature,
 * a shift that began at 1 AM was attributed to the calendar day it started in,
 * so the night's work landed on tomorrow's books. `business_day_start_hour`
 * moves that boundary, and the two money tests below prove it moves the PAY
 * with it -- through the real database, real RLS, and the real UI, not a
 * calculation harness.
 *
 * WHY THE BROWSER IS PINNED TO America/New_York.
 *
 * The restaurant is created in America/Chicago (the signup RPC's default), so
 * the browser zone deliberately DIFFERS from the restaurant zone -- a test run
 * with the two equal cannot tell a restaurant-framed read from a browser-framed
 * one, and CI's default UTC is the worst case of that.
 *
 * New York specifically, because it is exactly one hour ahead of Chicago:
 *
 *   - Far enough to discriminate. The seeded 1:00 AM Chicago clock-in is 2:00 AM
 *     in New York. At cutoff 2 the correct (Chicago-framed) answer is "previous
 *     business day"; a browser-framed implementation reads 2:00 AM >= 2 and says
 *     "same day". The two answers differ by a full day of pay, and the
 *     assertions below distinguish them.
 *   - Close enough to stay honest. The Payroll page's date-range controls build
 *     browser-local day tokens (pre-existing behaviour, unchanged by this
 *     feature), so a far-flung browser zone would test that skew instead of the
 *     cutoff. One hour keeps the range aligned with the restaurant day while
 *     still flipping the cutoff boundary.
 *
 * Process-zone independence of the bucketing itself is pinned separately, with
 * hard-coded expectations under four TZ values: `npm run test:tz:business-day`.
 */

test.use({ timezoneId: 'America/New_York' });

// Each money test signs up, seeds, and then loads Payroll several times over --
// once per range, before and after the cutoff change. That is the cost of
// proving the numbers through the real app rather than through a calculator,
// and it does not fit the project-wide 90s e2e budget.
test.describe.configure({ timeout: 240_000 });

const RESTAURANT_TZ = 'America/Chicago';
const HOURLY_RATE_CENTS = 2000; // $20/hr
const DAILY_RATE_CENTS = 15000; // $150/day

/** Today's calendar day IN THE RESTAURANT's zone, never the runner's. */
const todayInRestaurantTz = () => formatInTimeZone(new Date(), RESTAURANT_TZ, 'yyyy-MM-dd');

/**
 * Shift a `yyyy-MM-dd` token by whole days. Noon UTC as the carrier instant:
 * only the calendar fields are ever read back, and noon is far enough from
 * either boundary that no DST transition can round the answer to a neighbour.
 */
const dayToken = (base: string, deltaDays: number) => {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
};

/** A wall-clock time in the RESTAURANT's zone, as the UTC instant it really is. */
const restaurantInstant = (day: string, hhmm: string) =>
  fromZonedTime(`${day} ${hhmm}:00`, RESTAURANT_TZ).toISOString();

const parseCurrency = (value: string) => Number(value.replace(/[^0-9.-]/g, ''));

/**
 * The helpers `exposeSupabaseHelpers` hangs off `window`, named so the code
 * inside `page.evaluate` can be read without an `any` in the way. The client is
 * the app's own untyped-schema instance, so a structural declaration of the
 * calls this spec makes is as precise as it can honestly be.
 */
type SeedWindow = Window & {
  __getRestaurantId: () => Promise<string | null>;
  __insertEmployees: (rows: Record<string, unknown>[], restaurantId: string) => Promise<unknown>;
  __insertTimePunches: (rows: Record<string, unknown>[], restaurantId: string) => Promise<unknown>;
  __supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: unknown) => {
          single: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
        };
      };
      upsert: (
        values: Record<string, unknown>,
        options?: { onConflict: string }
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

async function seedRestaurant(page: Page, prefix: string) {
  const user = generateTestUser(prefix);
  await signUpAndCreateRestaurant(page, user);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(() => (window as unknown as SeedWindow).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  // The whole feature is framed in the restaurant's zone, so assert the zone
  // this run actually got rather than trusting the signup default. If it ever
  // changes, every expectation below is wrong and this is where it surfaces.
  const row = await page.evaluate(async (id) => {
    const { data, error } = await (window as unknown as SeedWindow).__supabase
      .from('restaurants')
      .select('timezone, business_day_start_hour')
      .eq('id', id)
      .single();
    return { data, error: error?.message ?? null };
  }, restaurantId);
  expect(row.error, 'reading the restaurant row').toBeNull();
  expect(row.data?.timezone).toBe(RESTAURANT_TZ);
  // Behaviour-preserving default: a restaurant that never touches the setting
  // keeps calendar-midnight bucketing.
  expect(row.data?.business_day_start_hour).toBe(0);

  return restaurantId as string;
}

/**
 * Open Settings on the Payroll tab and return the Business Day trigger.
 *
 * The tab is clicked rather than deep-linked: `/settings?tab=payroll` is
 * normalised back to `general` when the page loads before the restaurant
 * context resolves, because the allowed-tab list is derived from a role that is
 * not known yet. That is pre-existing routing behaviour, unrelated to the
 * cutoff, and not something this spec should be waiting on.
 */
async function openBusinessDaySetting(page: Page) {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Payroll' }).click();
  const trigger = page.getByLabel(/business day starts at/i);
  await expect(trigger).toBeVisible({ timeout: 20000 });
  return trigger;
}

/** Set the business day start hour through the real Settings UI. */
async function setBusinessDayStart(page: Page, optionLabel: string) {
  const trigger = await openBusinessDaySetting(page);

  await trigger.click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await expect(trigger).toHaveText(optionLabel);

  await page.getByRole('button', { name: /save business day/i }).click();
  await expect(page.getByText('Business day saved', { exact: true })).toBeVisible({ timeout: 10000 });
}

/**
 * Open Payroll on a custom [startDay, endDay] range and read the summary.
 *
 * Navigating fresh each time is deliberate: the cutoff reaches these numbers
 * through the restaurant context, so a full page load is what proves the saved
 * value is the one being used, rather than in-memory state left over from the
 * Settings page.
 */
async function readPayrollSummary(page: Page, startDay: string, endDay: string) {
  await page.goto('/payroll');
  await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Employee Payroll Details')).toBeVisible({ timeout: 15000 });

  const payPeriodSelect = page.locator('button[role="combobox"]').nth(1);
  await expect(payPeriodSelect).toBeEnabled();
  await payPeriodSelect.click();
  await page.locator('[role="option"]').filter({ hasText: 'Custom Range' }).click();

  const dateInputs = page.locator('input[type="date"]');
  await expect(dateInputs.first()).toBeVisible({ timeout: 5000 });
  await dateInputs.first().fill(startDay);
  await dateInputs.nth(1).fill(endDay);

  // Let the range change settle before reading. Without this, a $0 expectation
  // could be satisfied by the pre-refetch render and pass for the wrong reason.
  await page.waitForTimeout(2500);

  const cardValue = (label: string) =>
    page
      .getByText(label, { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
      .locator('.text-2xl')
      .first();

  const gross = parseCurrency(await cardValue('Gross Wages').innerText());
  const hours = Number(await cardValue('Total Hours').innerText());

  // A split punch pair would quietly change every number below, so fail on the
  // warning itself rather than on the arithmetic it corrupts.
  await expect(page.getByText('Incomplete Time Punches Detected')).toHaveCount(0);

  return { gross, hours };
}

test.describe('Business day cutoff', () => {
  test('the Settings control offers only legal hours and persists what it saves', async ({ page }) => {
    await seedRestaurant(page, 'bd-settings');

    const trigger = await openBusinessDaySetting(page);
    // Hydrated from the row, and rendered as wall-clock rather than a bare 0.
    await expect(trigger).toHaveText('12:00 AM (midnight)');

    await trigger.click();
    // The column's CHECK allows 0..11. The Select is closed over exactly those,
    // so the constraint is unreachable from the UI -- assert the domain rather
    // than a rejection toast. No PM entry means no "2" that means 2 PM.
    await expect(page.getByRole('option')).toHaveCount(12);
    await expect(page.getByRole('option', { name: /PM/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: '12:00 AM (midnight)', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: '11:00 AM', exact: true })).toBeVisible();

    await page.getByRole('option', { name: '2:00 AM', exact: true }).click();
    await page.getByRole('button', { name: /save business day/i }).click();
    await expect(page.getByText('Business day saved', { exact: true })).toBeVisible({ timeout: 10000 });

    // Round-trip through the database, not just through component state: a
    // fresh load re-reads the restaurant row from scratch.
    await expect(await openBusinessDaySetting(page)).toHaveText('2:00 AM');
  });

  test('a post-midnight shift moves a full day of daily-rate pay to the previous business day', async ({ page }) => {
    const restaurantId = await seedRestaurant(page, 'bd-daily');

    // A week back: safely closed out, and far from any month or week edge the
    // Payroll range controls might otherwise clamp.
    const shiftDay = dayToken(todayInRestaurantTz(), -7);
    const priorDay = dayToken(shiftDay, -1);

    // 1:00 AM -> 4:00 AM in the restaurant's zone. Under the default cutoff of 0
    // this is `shiftDay`; under a cutoff of 2 it belongs to the night before.
    const clockIn = restaurantInstant(shiftDay, '01:00');
    const clockOut = restaurantInstant(shiftDay, '04:00');

    const employeeId = randomUUID();
    await page.evaluate(
      async ({ restaurantId, employeeId, dailyRateCents, hireDate, clockIn, clockOut }) => {
        await (window as unknown as SeedWindow).__insertEmployees(
          [{
            id: employeeId,
            name: 'Dana Daily',
            position: 'Closer',
            compensation_type: 'daily_rate',
            daily_rate_amount: dailyRateCents,
            // Reference figures the daily rate was derived from. They do not
            // enter the pay calculation, but `daily_rate_fields_required`
            // insists a daily-rate employee carry them.
            daily_rate_reference_weekly: dailyRateCents * 5,
            daily_rate_reference_days: 5,
            hourly_rate: 0,
            status: 'active',
            is_active: true,
            requires_time_punch: true,
            hire_date: hireDate,
          }],
          restaurantId
        );
        await (window as unknown as SeedWindow).__insertTimePunches(
          [
            { employee_id: employeeId, punch_type: 'clock_in', punch_time: clockIn },
            { employee_id: employeeId, punch_type: 'clock_out', punch_time: clockOut },
          ],
          restaurantId
        );
      },
      {
        restaurantId,
        employeeId,
        dailyRateCents: DAILY_RATE_CENTS,
        hireDate: dayToken(shiftDay, -60),
        clockIn,
        clockOut,
      }
    );

    const dailyRateDollars = DAILY_RATE_CENTS / 100;

    // Default cutoff 0: the shift is its own calendar day's work.
    expect((await readPayrollSummary(page, shiftDay, shiftDay)).gross).toBeCloseTo(dailyRateDollars, 2);
    expect((await readPayrollSummary(page, priorDay, priorDay)).gross).toBeCloseTo(0, 2);

    await setBusinessDayStart(page, '2:00 AM');

    // Cutoff 2: the same shift is now the previous business day's work. The day
    // of pay MOVED -- it was not duplicated and it was not lost.
    expect((await readPayrollSummary(page, shiftDay, shiftDay)).gross).toBeCloseTo(0, 2);
    expect((await readPayrollSummary(page, priorDay, priorDay)).gross).toBeCloseTo(dailyRateDollars, 2);
    // Conservation, stated directly: across both days the employee is paid for
    // exactly one day, at either cutoff. Paying two would be the bug this
    // feature's clock-in attribution exists to prevent.
    expect((await readPayrollSummary(page, priorDay, shiftDay)).gross).toBeCloseTo(dailyRateDollars, 2);
  });

  test('the cutoff decides whether two shifts one night are one overtime day or two regular ones', async ({ page }) => {
    const restaurantId = await seedRestaurant(page, 'bd-ot');

    const firstDay = dayToken(todayInRestaurantTz(), -7);
    const secondDay = dayToken(firstDay, 1);

    // 6 PM -> 11 PM, then back on at 1 AM -> 5 AM: nine hours across one night.
    // Cutoff 0 splits them 5/4 across two business days; cutoff 2 keeps all nine
    // on the night they belong to, which crosses the 8-hour daily OT threshold.
    const punches = [
      { punch_type: 'clock_in', punch_time: restaurantInstant(firstDay, '18:00') },
      { punch_type: 'clock_out', punch_time: restaurantInstant(firstDay, '23:00') },
      { punch_type: 'clock_in', punch_time: restaurantInstant(secondDay, '01:00') },
      { punch_type: 'clock_out', punch_time: restaurantInstant(secondDay, '05:00') },
    ];

    const employeeId = randomUUID();
    await page.evaluate(
      async ({ restaurantId, employeeId, hourlyRateCents, hireDate, punches }) => {
        // Daily overtime seeded directly rather than through the Overtime Rules
        // card: this test's subject is the cutoff, and driving a second settings
        // form would only add ways for it to fail for unrelated reasons.
        const { error } = await (window as unknown as SeedWindow).__supabase
          .from('overtime_rules')
          .upsert({
            restaurant_id: restaurantId,
            weekly_threshold_hours: 40,
            weekly_ot_multiplier: 1.5,
            daily_threshold_hours: 8,
            daily_ot_multiplier: 1.5,
            exclude_tips_from_ot_rate: true,
          }, { onConflict: 'restaurant_id' });
        if (error) throw new Error(`overtime_rules seed failed: ${error.message}`);

        await (window as unknown as SeedWindow).__insertEmployees(
          [{
            id: employeeId,
            name: 'Hollis Hourly',
            position: 'Server',
            compensation_type: 'hourly',
            hourly_rate: hourlyRateCents,
            status: 'active',
            is_active: true,
            requires_time_punch: true,
            hire_date: hireDate,
          }],
          restaurantId
        );
        await (window as unknown as SeedWindow).__insertTimePunches(
          punches.map((p) => ({ ...p, employee_id: employeeId })),
          restaurantId
        );
      },
      {
        restaurantId,
        employeeId,
        hourlyRateCents: HOURLY_RATE_CENTS,
        hireDate: dayToken(firstDay, -60),
        punches,
      }
    );

    const rate = HOURLY_RATE_CENTS / 100;

    // Cutoff 0: 5h on one business day, 4h on the next. Neither reaches 8, so
    // all nine hours are straight time.
    const before = await readPayrollSummary(page, firstDay, secondDay);
    expect(before.hours).toBeCloseTo(9, 2);
    expect(before.gross).toBeCloseTo(9 * rate, 2);

    await setBusinessDayStart(page, '2:00 AM');

    // Cutoff 2: all nine hours are one business day, so the ninth hour is daily
    // overtime at 1.5x. The employee worked the same nine hours and is paid MORE
    // -- which is the point. Under-paying it is exactly the failure this feature
    // is meant to fix.
    const after = await readPayrollSummary(page, firstDay, secondDay);
    // Hours are conserved to the second decimal: the repricing must come from
    // how the hours are banded, never from hours appearing or vanishing.
    expect(after.hours).toBeCloseTo(9, 2);
    expect(after.gross).toBeCloseTo(8 * rate + 1 * rate * 1.5, 2);
  });
});
