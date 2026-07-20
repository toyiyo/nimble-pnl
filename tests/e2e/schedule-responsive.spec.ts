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

// The mobile day-picker renders one button per day, labelled e.g. "Mon 14".
// display:none subtrees are dropped from the accessibility tree, so this role
// query resolves only to the currently-visible layout (mobile vs desktop).
const DAY_PICKER_BUTTON = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}$/;

test.describe('Schedule responsive layout', () => {
  test('shows the day-focused mobile view with full names at mobile viewport width', async ({ page }) => {
    // Setup at desktop size (signup flow needs wider viewport)
    await setupWithEmployees(page);
    // Resize to mobile before navigating to schedule
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoSchedule(page);

    // The day-focused mobile view replaces the wide table on phones: its
    // day-picker strip is the mobile-only affordance.
    await expect(
      page.getByRole('button', { name: DAY_PICKER_BUTTON }).first(),
    ).toBeVisible({ timeout: 10000 });

    // One full-name card per employee is rendered on mobile (the core of the
    // redesign — previously only initials showed). Anchor on each card's
    // "Edit <name>" button: it carries the full name as its accessible name and,
    // being a role query, excludes the display:none desktop tree (whose rows
    // carry the same label) — avoiding the ancestor/hidden matches that a fuzzy
    // getByText would hit.
    await expect(page.getByRole('button', { name: 'Edit Maria Rodriguez' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit James Thompson' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Sarah Chen' })).toBeVisible();

    // The desktop table (hidden md:block) is not shown on mobile.
    await expect(page.getByRole('table')).toBeHidden();
  });

  test('shows the wide table with full names at desktop viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupWithEmployees(page);
    await gotoSchedule(page);

    // The wide table is visible on desktop and shows full employee names.
    // Exact text targets the name cell only (a substring match would also hit
    // the enclosing <td>/<tr>, whose text includes the position and hours).
    const table = page.getByRole('table');
    await expect(table).toBeVisible({ timeout: 10000 });
    await expect(table.getByText('Maria Rodriguez', { exact: true })).toBeVisible();

    // The mobile day-picker (md:hidden) is not present on desktop.
    await expect(
      page.getByRole('button', { name: DAY_PICKER_BUTTON }),
    ).toHaveCount(0);
  });
});
