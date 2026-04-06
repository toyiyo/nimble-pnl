import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

function getMondayOfCurrentWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function getTimezoneOffsetString(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const minutes = String(absOffset % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Setup: sign up, create restaurant, seed employees with areas + shifts. */
async function setupWithAreaEmployees(page: any) {
  const testUser = generateTestUser('grp');
  await signUpAndCreateRestaurant(page, testUser);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  const employees = await page.evaluate(
    ({ emps, restId }: any) => (window as any).__insertEmployees(emps, restId),
    {
      emps: [
        { name: 'Alice Cook', position: 'Line Cook', area: 'Back of House', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
        { name: 'Bob Dishwasher', position: 'Dishwasher', area: 'Back of House', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        { name: 'Carol Server', position: 'Server', area: 'Front of House', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        { name: 'Dave Bartender', position: 'Bartender', area: 'Bar', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1700 },
        { name: 'Eve Host', position: 'Host', area: 'Front of House', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1400 },
      ],
      restId: restaurantId,
    },
  );

  const monday = getMondayOfCurrentWeek();
  const monStr = formatDate(monday);
  const tz = getTimezoneOffsetString();

  await page.evaluate(
    ({ shifts, restId }: any) => (window as any).__insertShifts(shifts, restId),
    {
      shifts: (employees as any[]).map((emp: any) => ({
        employee_id: emp.id,
        start_time: `${monStr}T08:00:00${tz}`,
        end_time: `${monStr}T16:00:00${tz}`,
        position: emp.position,
        status: 'scheduled',
        break_duration: 30,
        is_published: false,
        locked: false,
      })),
      restId: restaurantId,
    },
  );

  return { restaurantId, employees };
}

/** Navigate to scheduling and wait for the schedule table to render. */
async function gotoSchedule(page: any) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });
  const table = page.locator('table').first();
  await expect(table.getByText('Alice Cook')).toBeVisible({ timeout: 15000 });
  return table;
}

/** Select group-by mode from the dropdown. */
async function selectGroupBy(page: any, optionName: string) {
  const groupByTrigger = page.getByLabel('Group by');
  await expect(groupByTrigger).toBeVisible({ timeout: 5000 });
  await groupByTrigger.click();
  await page.getByRole('option', { name: optionName }).click();
}

test.describe('Schedule group by area', () => {
  test('groups employees by area and shows collapsible section headers', async ({ page }) => {
    await setupWithAreaEmployees(page);
    const table = await gotoSchedule(page);

    await selectGroupBy(page, 'Group by Area');

    // Verify group headers
    await expect(table.getByText('Back of House').first()).toBeVisible({ timeout: 5000 });
    await expect(table.getByText('Front of House').first()).toBeVisible({ timeout: 5000 });
    await expect(table.getByText('Bar').first()).toBeVisible({ timeout: 5000 });

    // Verify employee count badges
    const bohHeader = table.locator('tr', { hasText: 'Back of House' }).first();
    await expect(bohHeader.getByText('2')).toBeVisible();

    const fohHeader = table.locator('tr', { hasText: 'Front of House' }).first();
    await expect(fohHeader.getByText('2')).toBeVisible();

    const barHeader = table.locator('tr', { hasText: 'Bar' }).first();
    await expect(barHeader.getByText('1')).toBeVisible();

    // Verify all employees are visible
    await expect(table.getByText('Alice Cook')).toBeVisible();
    await expect(table.getByText('Bob Dishwasher')).toBeVisible();
    await expect(table.getByText('Carol Server')).toBeVisible();
    await expect(table.getByText('Dave Bartender')).toBeVisible();
    await expect(table.getByText('Eve Host')).toBeVisible();
  });

  test('collapse and expand groups', async ({ page }) => {
    await setupWithAreaEmployees(page);
    const table = await gotoSchedule(page);

    await selectGroupBy(page, 'Group by Area');
    await expect(table.getByText('Back of House').first()).toBeVisible({ timeout: 5000 });

    // Verify BOH employees visible
    await expect(table.getByText('Alice Cook')).toBeVisible();
    await expect(table.getByText('Bob Dishwasher')).toBeVisible();

    // Collapse Back of House
    const bohHeader = table.locator('tr', { hasText: 'Back of House' }).first();
    await bohHeader.click();

    // BOH employees hidden
    await expect(table.getByText('Alice Cook')).not.toBeVisible({ timeout: 3000 });
    await expect(table.getByText('Bob Dishwasher')).not.toBeVisible();

    // Other groups still visible
    await expect(table.getByText('Carol Server')).toBeVisible();
    await expect(table.getByText('Dave Bartender')).toBeVisible();

    // Expand again
    await bohHeader.click();
    await expect(table.getByText('Alice Cook')).toBeVisible({ timeout: 3000 });
    await expect(table.getByText('Bob Dishwasher')).toBeVisible();
  });

  test('group by position mode works', async ({ page }) => {
    await setupWithAreaEmployees(page);
    const table = await gotoSchedule(page);

    await selectGroupBy(page, 'Group by Position');

    // Verify position group headers
    await expect(table.locator('tr', { hasText: /Line Cook/ }).first()).toBeVisible({ timeout: 5000 });
    await expect(table.locator('tr', { hasText: /Dishwasher/ }).first()).toBeVisible();
    await expect(table.locator('tr', { hasText: /Server/ }).first()).toBeVisible();
    await expect(table.locator('tr', { hasText: /Bartender/ }).first()).toBeVisible();
    await expect(table.locator('tr', { hasText: /Host/ }).first()).toBeVisible();
  });

  test('export dialog shows grouping indicator', async ({ page }) => {
    await setupWithAreaEmployees(page);
    await gotoSchedule(page);

    await selectGroupBy(page, 'Group by Area');
    await expect(page.locator('table').first().getByText('Back of House').first()).toBeVisible({ timeout: 5000 });

    // Open print dialog
    await page.getByRole('button', { name: /print/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify grouping indicator and PDF button
    await expect(dialog.getByText('Grouped by: Area')).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByRole('button', { name: /download pdf/i })).toBeVisible();
  });

  test('grouping persists after page reload', async ({ page }) => {
    await setupWithAreaEmployees(page);
    await gotoSchedule(page);

    await selectGroupBy(page, 'Group by Area');
    const table = page.locator('table').first();
    await expect(table.getByText('Back of House').first()).toBeVisible({ timeout: 5000 });

    // Reload
    await page.reload();
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Wait for table and verify grouping persisted via localStorage
    const tableAfterReload = page.locator('table').first();
    await expect(tableAfterReload.getByText('Alice Cook')).toBeVisible({ timeout: 15000 });
    await expect(tableAfterReload.getByText('Back of House').first()).toBeVisible({ timeout: 5000 });
    await expect(tableAfterReload.getByText('Front of House').first()).toBeVisible({ timeout: 5000 });
    await expect(tableAfterReload.getByText('Bar').first()).toBeVisible({ timeout: 5000 });
  });
});
