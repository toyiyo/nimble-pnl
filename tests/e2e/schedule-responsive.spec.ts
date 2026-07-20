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

async function setupWithEmployees(page: any) {
  const testUser = generateTestUser('resp');
  await signUpAndCreateRestaurant(page, testUser);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  const employees = await page.evaluate(
    ({ emps, restId }: any) => (window as any).__insertEmployees(emps, restId),
    {
      emps: [
        { name: 'Maria Rodriguez', position: 'Server', area: 'Front of House', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        { name: 'James Thompson', position: 'Cook', area: 'Back of House', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
        { name: 'Sarah Chen', position: 'Host', area: 'Front of House', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1400 },
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

async function gotoSchedule(page: any) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });
}

test.describe('Schedule responsive layout', () => {
  test('shows the day-focused mobile view with full names at mobile viewport width', async ({ page }) => {
    // Setup at desktop size (signup flow needs wider viewport)
    await setupWithEmployees(page);
    // Resize to mobile before navigating to schedule
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoSchedule(page);

    // The day-focused mobile view (md:hidden) replaces the wide table on phones.
    const mobileView = page.getByTestId('week-schedule-mobile');
    await expect(mobileView).toBeVisible({ timeout: 15000 });

    // Full employee names are visible on mobile (the core of the redesign —
    // previously only initials showed).
    await expect(mobileView.getByText('Maria Rodriguez')).toBeVisible();

    // One card per employee is rendered for the selected day.
    await expect(
      page.getByTestId('week-schedule-mobile-employee-card'),
    ).toHaveCount(3);

    // The day-picker marks today with aria-current="date".
    await expect(
      mobileView.locator('button[aria-current="date"]'),
    ).toHaveCount(1);

    // The desktop table (hidden md:block) is not shown on mobile.
    await expect(page.locator('table').first()).toBeHidden();
  });

  test('shows the wide table with full names at desktop viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupWithEmployees(page);
    await gotoSchedule(page);

    // The wide table is visible on desktop and shows full employee names.
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15000 });
    await expect(table.getByText('Maria Rodriguez')).toBeVisible();

    // All 7 day column headers (+ the team-member column) are present.
    await expect(page.locator('thead th')).toHaveCount(8);

    // The mobile day-focused view (md:hidden) is not shown on desktop.
    await expect(page.getByTestId('week-schedule-mobile')).toBeHidden();
  });
});
