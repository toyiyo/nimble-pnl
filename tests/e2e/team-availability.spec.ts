import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Team Availability Grid', () => {
  test('manager sees availability grid with employees', async ({ page }) => {
    // 1. Setup
    const testUser = generateTestUser('team-avail');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed 2 employees: Alice with availability, Bob without
    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Bob Smith', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
        ],
        restId: restaurantId,
      },
    );

    if (!(employees as any)?.length) {
      throw new Error('Employee seeding returned empty results');
    }

    const aliceId = (employees as any).find((e: any) => e.name === 'Alice Johnson')?.id;
    if (!aliceId) {
      throw new Error('Could not find Alice employee ID');
    }

    // Seed recurring availability for Alice on Monday
    await page.evaluate(
      ({ rows, restId }) => (window as any).__insertAvailability(rows, restId),
      {
        rows: [
          { employee_id: aliceId, day_of_week: 1, start_time: '14:00:00', end_time: '22:00:00', is_available: true },
        ],
        restId: restaurantId,
      },
    );

    // 2. Navigate to Scheduling → Availability tab
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const availabilityTab = page.getByRole('tab', { name: /availability/i });
    await expect(availabilityTab).toBeVisible({ timeout: 10000 });
    await availabilityTab.click();

    // 3. Assert both employees are visible
    await expect(page.getByText('Alice Johnson').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Bob Smith').first()).toBeVisible({ timeout: 10000 });

    // 4. Bob has no availability — should show "No availability set" or "Set now"
    // The desktop grid shows "No availability set — Set now" as one button text
    // The mobile view shows "No availability set" and "Set availability" separately
    // We check for the text that appears in the grid (desktop or mobile)
    const noAvailText = page.getByText(/no availability set/i).first();
    await expect(noAvailText).toBeVisible({ timeout: 5000 });

    // 5. Week navigation buttons should be visible
    await expect(page.getByRole('button', { name: /previous week/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /next week/i })).toBeVisible();
  });

  test('clicking "Set now" link opens availability dialog', async ({ page }) => {
    // 1. Setup
    const testUser = generateTestUser('avail-dialog');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed one employee without availability
    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Carol Davis', position: 'Bartender', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1600 },
        ],
        restId: restaurantId,
      },
    );

    if (!(employees as any)?.length) {
      throw new Error('Employee seeding returned empty results');
    }

    // 2. Navigate to Availability tab
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    await page.getByRole('tab', { name: /availability/i }).click();

    // 3. Wait for Carol to appear
    await expect(page.getByText('Carol Davis').first()).toBeVisible({ timeout: 10000 });

    // 4. Click "Set now" (desktop) or "Set availability" (mobile) link
    // Dismiss any toast notifications that might be blocking
    const toasts = page.locator('[data-sonner-toast]');
    if (await toasts.count() > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Try clicking the "Set now" button (part of "No availability set — Set now" text on desktop)
    // Or "Set availability" on mobile
    const setNowButton = page.getByRole('button', { name: /set now|set availability/i }).first();
    await expect(setNowButton).toBeVisible({ timeout: 5000 });
    await setNowButton.click();

    // 5. A dialog should open
    // Use a name filter to avoid matching Combobox/Popover dialogs
    const dialog = page.getByRole('dialog').filter({ hasText: /availability/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });
  });

  test('grid shows time range for employee with seeded availability', async ({ page }) => {
    // 1. Setup
    const testUser = generateTestUser('avail-times');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed one employee
    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'David Lee', position: 'Chef', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 2000 },
        ],
        restId: restaurantId,
      },
    );

    if (!(employees as any)?.length) {
      throw new Error('Employee seeding returned empty results');
    }

    const davidId = (employees as any).find((e: any) => e.name === 'David Lee')?.id;
    if (!davidId) {
      throw new Error('Could not find David employee ID');
    }

    // Seed recurring availability for Monday (dow=1)
    await page.evaluate(
      ({ rows, restId }) => (window as any).__insertAvailability(rows, restId),
      {
        rows: [
          { employee_id: davidId, day_of_week: 1, start_time: '14:00:00', end_time: '22:00:00', is_available: true },
        ],
        restId: restaurantId,
      },
    );

    // 2. Navigate to Availability tab
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    await page.getByRole('tab', { name: /availability/i }).click();

    // 3. Assert employee name is visible
    await expect(page.getByText('David Lee').first()).toBeVisible({ timeout: 10000 });

    // 4. "No availability set" should NOT appear for David (he has availability)
    // Get all instances to check none belong to David's row
    const allNoAvailText = page.getByText(/no availability set/i);
    // If the count is 0 that's perfect, but we just need to confirm David's row
    // is not showing the "no availability" state by checking a time value is visible
    // The grid shows time ranges like "2p" or "10p" for available slots
    const availCells = page.getByRole('button', { name: /available 2p–10p/i });
    await expect(availCells.first()).toBeVisible({ timeout: 5000 });
  });

  test('week navigation changes the week header', async ({ page }) => {
    // 1. Setup
    const testUser = generateTestUser('avail-nav');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed one employee so the grid renders
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Eve Wilson', position: 'Host', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1400 },
        ],
        restId: restaurantId,
      },
    );

    // 2. Navigate to Availability tab
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    await page.getByRole('tab', { name: /availability/i }).click();

    // Wait for grid to load
    await expect(page.getByText('Eve Wilson').first()).toBeVisible({ timeout: 10000 });

    // 3. Capture current week text (the span next to the nav buttons)
    // It's rendered as a <span> with text like "Apr 7 – 13, 2026"
    const weekSpan = page.locator('span').filter({ hasText: /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i }).first();
    await expect(weekSpan).toBeVisible({ timeout: 5000 });
    const originalWeekText = await weekSpan.textContent();
    expect(originalWeekText).toBeTruthy();

    // 4. Click "Next week"
    await page.getByRole('button', { name: /next week/i }).click();

    // 5. Week text should change
    await expect(weekSpan).not.toHaveText(originalWeekText!, { timeout: 5000 });
    const nextWeekText = await weekSpan.textContent();
    expect(nextWeekText).not.toBe(originalWeekText);

    // 6. Click "Today" to go back
    const todayButton = page.getByRole('button', { name: /today/i });
    await expect(todayButton).toBeVisible({ timeout: 3000 });
    await todayButton.click();

    // 7. Week text should return to original
    await expect(weekSpan).toHaveText(originalWeekText!, { timeout: 5000 });
  });
});
