/* eslint-disable @typescript-eslint/no-explicit-any -- window.__supabase and its test-only
   helpers (exposeSupabaseHelpers) carry no type declarations, same as every other E2E spec. */
import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';
import { wallClockToInstant, formatLocalDateInTz } from '../../src/lib/shiftInterval';

/**
 * E2E test for the in-row schedule-vs-clock audit on `/payroll`.
 *
 * Walks the full manager journey: an hourly employee has a published shift
 * for yesterday with no punches. The audit bar shows `1 to fix` and the
 * employee's row carries the same chip. The manager filters the table down
 * to that one chip, then clears the filter, expands the row, and fills the
 * clock data from the scheduled shift. The chip clears and the hours flow
 * into the payroll table.
 *
 * Restaurants default to `America/Chicago` (see the `restaurants` table
 * migrations), so the seeded shift is anchored to that zone with
 * `wallClockToInstant` — the same conversion the app and the SQL RPCs use.
 * The custom pay-period window in the UI is set from the test runner's own
 * local "today", widened by several days on each side, so the window
 * covers "yesterday in Chicago" even when the runner's own timezone
 * differs from Chicago by a few hours.
 */

const RESTAURANT_TZ = 'America/Chicago';

/** `dateStr` (YYYY-MM-DD) minus `days` calendar days, in the same calendar. */
function subtractDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Format a Date as YYYY-MM-DD using the runner's own local calendar day. */
function formatLocalYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Create one hourly employee through the /scheduling UI. Returns the employee's name. */
async function createHourlyEmployee(page: Page): Promise<string> {
  await page.goto('/scheduling');
  await expect(page.getByRole('heading', { name: /staff schedule/i })).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /employee/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /add new employee|edit employee/i });

  // crypto.randomUUID (not Math.random) so this unique name doesn't trip
  // CodeQL's js/insecure-randomness rule.
  const employeeName = `Audit Employee ${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await dialog.getByLabel(/name/i).first().fill(employeeName);

  const positionCombobox = dialog.getByRole('combobox').filter({ hasText: /position|select/i });
  if (await positionCombobox.isVisible().catch(() => false)) {
    await positionCombobox.click();
    const serverOption = page.getByRole('option', { name: /server/i });
    if (await serverOption.isVisible({ timeout: 1000 }).catch(() => false)) {
      await serverOption.click();
    } else {
      await page.keyboard.type('Server');
      await page.keyboard.press('Enter');
    }
  }

  await dialog.getByLabel(/hourly rate/i).fill('18.00');
  await dialog.getByRole('button', { name: /add employee|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  return employeeName;
}

/** Set the payroll page's period to a custom range that safely contains "yesterday". */
async function setWidePayrollPeriod(page: Page): Promise<void> {
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - 3);
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() + 2);

  await page.getByRole('combobox').filter({ hasText: 'Current Week' }).click();
  await page.getByRole('option', { name: 'Custom Range' }).click();

  const dateInputs = page.locator('input[type="date"]');
  await dateInputs.first().fill(formatLocalYMD(rangeStart));
  await dateInputs.last().fill(formatLocalYMD(rangeEnd));
}

test.describe('Schedule vs. clock audit', () => {
  let testUser: ReturnType<typeof generateTestUser>;

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    // Navigate to the app first before clearing storage (can't access
    // localStorage on about:blank).
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    testUser = generateTestUser('audit');
    await signUpAndCreateRestaurant(page, testUser);
  });

  test('flags a shift with no clock data, filters by it, then matches it once the manager enters the punches', async ({ page }) => {
    const employeeName = await createHourlyEmployee(page);
    const escapedName = employeeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Step 3: seed one published shift for yesterday (restaurant timezone), no punches.
    const restaurantId: string = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const employeeId: string = await page.evaluate(
      async ({ restId, name }: { restId: string; name: string }) => {
        const supabase = (window as any).__supabase;
        const { data, error } = await supabase
          .from('employees')
          .select('id')
          .eq('restaurant_id', restId)
          .eq('name', name)
          .single();
        if (error) throw new Error(error.message);
        return data.id;
      },
      { restId: restaurantId, name: employeeName },
    );

    const todayStr = formatLocalDateInTz(new Date(), RESTAURANT_TZ);
    const yesterdayStr = subtractDays(todayStr, 1);
    const shiftStartTime = '09:00';
    const shiftEndTime = '17:00';
    const shiftStartIso = wallClockToInstant(yesterdayStr, shiftStartTime, RESTAURANT_TZ).toISOString();
    const shiftEndIso = wallClockToInstant(yesterdayStr, shiftEndTime, RESTAURANT_TZ).toISOString();

    await page.evaluate(
      ({ shift, restId }: { shift: Record<string, unknown>; restId: string }) =>
        (window as any).__insertShifts([shift], restId),
      {
        shift: {
          employee_id: employeeId,
          start_time: shiftStartIso,
          end_time: shiftEndIso,
          position: 'Server',
          status: 'scheduled',
          is_published: true,
          break_duration: 0,
          locked: false,
        },
        restId: restaurantId,
      },
    );

    // Step 4: open /payroll with a period that contains yesterday.
    await page.goto('/payroll', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });
    await setWidePayrollPeriod(page);

    // Step 5: the bar shows `1 to fix`, and the row carries the same chip.
    const toFixChip = page.getByRole('button', { name: '1 to fix' });
    await expect(toFixChip).toBeVisible({ timeout: 10000 });

    const employeeRow = page.getByRole('row', { name: new RegExp(escapedName) });
    await expect(employeeRow).toBeVisible();
    await expect(employeeRow.getByText('1 to fix')).toBeVisible();

    // Step 6: activate the amber chip — the table shows only the flagged
    // employee, and the totals row hides (a total over a filtered subset
    // reads as a wrong pay total).
    const totalRow = page.getByRole('rowheader', { name: 'TOTAL' });
    await expect(totalRow).toBeVisible();
    await toFixChip.click();
    await expect(page.getByText('Clock filter active: 1 of 1 employees')).toBeVisible();
    await expect(employeeRow).toBeVisible();
    await expect(totalRow).toHaveCount(0);

    // Clear the filter before repairing the punches.
    await toFixChip.click();
    await expect(totalRow).toBeVisible();

    // Step 7: expand the row, open the dialog from the row chip's action.
    const expandButton = page.getByRole('button', { name: `Show clock detail for ${employeeName}` });
    await expandButton.click();

    const enterClockButton = page.getByRole('button', {
      name: new RegExp(`Enter clock data for ${escapedName}`),
    });
    await expect(enterClockButton).toBeVisible();
    await enterClockButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const expectedClockInValue = `${yesterdayStr}T${shiftStartTime}`;
    await expect(dialog.getByLabel(/clock in/i)).toHaveValue(expectedClockInValue);

    await dialog.getByRole('button', { name: /save clock data/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Step 8: the chip clears and the hours appear.
    await expect(employeeRow.getByText('1 to fix')).toHaveCount(0);
    const hoursCellText = await employeeRow.getByRole('cell').nth(4).innerText();
    expect(parseFloat(hoursCellText)).toBeGreaterThan(0);
  });
});
