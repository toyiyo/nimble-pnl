import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E validation for the overnight-shift punch-windowing fix.
 *
 * Seeds a single hourly employee with ONE overnight shift — clock in the
 * evening of day D, clock out early morning of D+1 (crosses midnight). Before
 * the fix, the per-period/per-day punch fetch split the pair, so Payroll and
 * the Tips "calculate from hours" flow reported ZERO hours and a false
 * "Incomplete Time Punches / no matching clock-in" warning. After the fix
 * (±18h buffered fetch + clock-in-day attribution) the whole shift is counted
 * once, on the night it began.
 */

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const parseCurrency = (value: string) => Number(value.replace(/[^0-9.-]/g, ''));

test.describe('Overnight shift hours (punch windowing fix)', () => {
  test('Payroll counts a cross-midnight shift on its clock-in day with no false warning', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(async () => {
      const fn = (window as any).__getRestaurantId;
      return fn ? await fn() : null;
    });
    expect(restaurantId).toBeTruthy();

    // Shift 3 days ago so it's safely in the past and away from "today near midnight".
    const shiftDay = new Date();
    shiftDay.setDate(shiftDay.getDate() - 3);
    const shiftDayMidnight = new Date(shiftDay.getFullYear(), shiftDay.getMonth(), shiftDay.getDate());

    // Clock in 8:00 PM, clock out 1:00 AM next day → 5.0 worked hours, crossing midnight.
    const clockIn = new Date(shiftDayMidnight);
    clockIn.setHours(20, 0, 0, 0);
    const clockOut = new Date(shiftDayMidnight);
    clockOut.setDate(clockOut.getDate() + 1);
    clockOut.setHours(1, 0, 0, 0);

    const hourlyId = randomUUID();
    const hourlyRateCents = 2000; // $20/hr
    const workedHours = 5;
    const expectedGross = (hourlyRateCents / 100) * workedHours; // $100
    const hireDateStr = formatDate(new Date(shiftDayMidnight.getFullYear(), shiftDayMidnight.getMonth(), 1));

    await page.evaluate(
      async ({ restaurantId, hourlyId, hourlyRateCents, hireDateStr, clockIn, clockOut }) => {
        const insertEmployees = (window as any).__insertEmployees;
        const insertTimePunches = (window as any).__insertTimePunches;
        if (!insertEmployees || !insertTimePunches) throw new Error('Supabase helpers not available');

        await insertEmployees(
          [
            {
              id: hourlyId,
              name: 'Overnight Closer',
              position: 'Server',
              compensation_type: 'hourly',
              hourly_rate: hourlyRateCents,
              status: 'active',
              is_active: true,
              tip_eligible: true,
              requires_time_punch: true,
              hire_date: hireDateStr,
            },
          ],
          restaurantId
        );

        await insertTimePunches(
          [
            { employee_id: hourlyId, punch_type: 'clock_in', punch_time: clockIn },
            { employee_id: hourlyId, punch_type: 'clock_out', punch_time: clockOut },
          ],
          restaurantId
        );
      },
      {
        restaurantId,
        hourlyId,
        hourlyRateCents,
        hireDateStr,
        clockIn: clockIn.toISOString(),
        clockOut: clockOut.toISOString(),
      }
    );

    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Employee Payroll Details')).toBeVisible({ timeout: 15000 });

    // Custom range = exactly the clock-in DAY. Before the fix this window excluded
    // the next-day clock-out, so the shift computed 0h; after the fix the buffered
    // fetch pairs it and attributes the full 5h to this day.
    const payPeriodSelect = page.locator('button[role="combobox"]').nth(1);
    await expect(payPeriodSelect).toBeEnabled();
    await payPeriodSelect.click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]').filter({ hasText: 'Custom Range' }).click();

    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs.first()).toBeVisible({ timeout: 5000 });
    await dateInputs.first().fill(formatDate(shiftDayMidnight));
    await dateInputs.nth(1).fill(formatDate(shiftDayMidnight));
    await page.waitForTimeout(2000);

    // The false "no matching clock-in" / incomplete banner must NOT appear.
    await expect(page.getByText('Incomplete Time Punches Detected')).toHaveCount(0);

    // Gross Wages must reflect the full 5h (≈ $100), not $0.
    const grossWagesCard = page
      .getByText('Gross Wages')
      .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    const grossWagesText = await grossWagesCard.locator('.text-2xl').first().innerText();
    const gross = parseCurrency(grossWagesText);
    expect(gross).toBeGreaterThan(0);
    expect(gross).toBeCloseTo(expectedGross, 0);
  });

  test('Tips "calculate from hours" counts a cross-midnight shift instead of zero', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(async () => {
      const fn = (window as any).__getRestaurantId;
      return fn ? await fn() : null;
    });
    expect(restaurantId).toBeTruthy();

    // Overnight shift on TODAY (the Tips daily-entry default date): clock in
    // 8:00 PM today, clock out 1:00 AM tomorrow → 5.0 worked hours across midnight.
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const clockIn = new Date(todayMidnight);
    clockIn.setHours(20, 0, 0, 0);
    const clockOut = new Date(todayMidnight);
    clockOut.setDate(clockOut.getDate() + 1);
    clockOut.setHours(1, 0, 0, 0);

    const empId = randomUUID();
    const hireDateStr = formatDate(new Date(todayMidnight.getFullYear(), todayMidnight.getMonth(), 1));

    await page.evaluate(
      async ({ restaurantId, empId, hireDateStr, clockIn, clockOut }) => {
        const insertEmployees = (window as any).__insertEmployees;
        const insertTimePunches = (window as any).__insertTimePunches;
        if (!insertEmployees || !insertTimePunches) throw new Error('Supabase helpers not available');
        await insertEmployees(
          [{
            id: empId, name: 'Nova Overnight', position: 'Server',
            compensation_type: 'hourly', hourly_rate: 1500,
            status: 'active', is_active: true, tip_eligible: true,
            requires_time_punch: true, hire_date: hireDateStr,
          }],
          restaurantId
        );
        await insertTimePunches(
          [
            { employee_id: empId, punch_type: 'clock_in', punch_time: clockIn },
            { employee_id: empId, punch_type: 'clock_out', punch_time: clockOut },
          ],
          restaurantId
        );
      },
      { restaurantId, empId, hireDateStr, clockIn: clockIn.toISOString(), clockOut: clockOut.toISOString() }
    );

    // Tips → Daily Entry → enter a tip pool → review (where hours-from-punches show).
    await page.goto('/tips');
    await page.getByRole('heading', { name: /^tips$/i }).first().waitFor({ state: 'visible', timeout: 25000 });
    await page.getByRole('button', { name: /daily entry/i }).click();
    await page.getByRole('button', { name: /enter.*tips/i }).first().click();
    await page.locator('#tip-amount').fill('100');
    await page.getByRole('button', { name: /continue/i }).click();

    // Force hours to (re)derive from punches, then assert the overnight shift is
    // counted (~5h), not zero as the old single-day fetch produced.
    await expect(page.getByRole('button', { name: /recalculate from punches/i })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /recalculate from punches/i }).click();

    const hoursInput = page.getByRole('spinbutton', { name: /Nova Overnight/i });
    await expect(hoursInput).toBeVisible({ timeout: 5000 });
    await expect(hoursInput).toHaveValue('5');
  });
});
