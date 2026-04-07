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
  const table = page.locator('table').first();
  await expect(table).toBeVisible({ timeout: 15000 });
  return table;
}

test.describe('Schedule responsive layout', () => {
  test('shows compact avatars at mobile viewport width', async ({ page }) => {
    // Setup at desktop size (signup flow needs wider viewport)
    await setupWithEmployees(page);
    // Resize to mobile before navigating to schedule
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoSchedule(page);

    // The compact avatar container (flex md:hidden) should be visible on mobile
    // The full name container (hidden md:flex) should be hidden
    // We check by looking for the employee name text — on mobile it should NOT
    // be visible as text (it's inside a hidden div), but the initials should be
    const compactAvatars = page.locator('td .flex.md\\:hidden');
    await expect(compactAvatars.first()).toBeVisible({ timeout: 5000 });

    // Full name div should be hidden
    const fullNames = page.locator('td .hidden.md\\:flex');
    await expect(fullNames.first()).toBeHidden();

    // All 7 day column headers should be present
    const headerCells = page.locator('thead th');
    await expect(headerCells).toHaveCount(8); // 1 name + 7 days
  });

  test('shows full names at desktop viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupWithEmployees(page);
    await gotoSchedule(page);

    // Full name should be visible on desktop
    const fullNames = page.locator('td .hidden.md\\:flex');
    await expect(fullNames.first()).toBeVisible({ timeout: 5000 });

    // Compact avatar should be hidden
    const compactAvatars = page.locator('td .flex.md\\:hidden');
    await expect(compactAvatars.first()).toBeHidden();

    // Employee name text should be visible in the schedule table
    const table = page.locator('table').first();
    await expect(table.getByText('Maria Rodriguez')).toBeVisible();
  });
});
