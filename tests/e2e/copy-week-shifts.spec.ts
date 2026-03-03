import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Copy Week Shifts', () => {
  test('copies shifts from current week to next week via dialog', async ({ page }) => {
    // 1. Setup: create user, restaurant, employees, and shifts
    const testUser = generateTestUser('copy-week');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed employees
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
    const bobId = (employees as any).find((e: any) => e.name === 'Bob Smith')?.id;
    if (!aliceId || !bobId) {
      throw new Error('Could not find seeded employee IDs');
    }

    // Seed 2 shifts for the current week (one per employee)
    // IMPORTANT: Use .toISOString() for shift timestamps so that local hours
    // round-trip correctly through Supabase timestamptz columns.
    const seedResult = await page.evaluate(
      ({ restId, aId, bId }) => {
        const supabase = (window as any).__supabase;

        // Compute Monday of the current week
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);

        // Tuesday of the current week
        const tue = new Date(mon);
        tue.setDate(mon.getDate() + 1);

        // Create timestamps at 08:00 and 14:00 LOCAL time using Date constructor
        const monStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 8, 0, 0).toISOString();
        const monEnd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 14, 0, 0).toISOString();
        const tueStart = new Date(tue.getFullYear(), tue.getMonth(), tue.getDate(), 8, 0, 0).toISOString();
        const tueEnd = new Date(tue.getFullYear(), tue.getMonth(), tue.getDate(), 14, 0, 0).toISOString();

        return (async () => {
          // Insert 2 shifts: Alice on Monday, Bob on Tuesday
          const { error: shiftErr } = await supabase.from('shifts').insert([
            {
              restaurant_id: restId,
              employee_id: aId,
              start_time: monStart,
              end_time: monEnd,
              position: 'Server',
              status: 'scheduled',
              break_duration: 30,
              is_published: false,
              locked: false,
            },
            {
              restaurant_id: restId,
              employee_id: bId,
              start_time: tueStart,
              end_time: tueEnd,
              position: 'Cook',
              status: 'scheduled',
              break_duration: 30,
              is_published: false,
              locked: false,
            },
          ]);

          if (shiftErr) return { error: `shift: ${shiftErr.message}` };
          return { success: true };
        })();
      },
      { restId: restaurantId, aId: aliceId, bId: bobId },
    );

    if ((seedResult as any).error) {
      throw new Error(`Seed failed: ${(seedResult as any).error}`);
    }

    // 2. Navigate to Scheduling (Schedule tab is the default)
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Wait for the schedule grid to load and show employee names
    await expect(page.getByText('Alice Johnson').first()).toBeVisible({ timeout: 10000 });

    // Capture current week header text for later comparison
    const weekHeader = page.locator('h2.text-lg.font-semibold');
    await expect(weekHeader).toBeVisible();
    const sourceWeekText = await weekHeader.textContent();

    // 3. Click "Copy Week" button in the Schedule tab toolbar
    const copyWeekButton = page.getByRole('button', { name: /copy week/i });
    await expect(copyWeekButton).toBeVisible({ timeout: 5000 });
    await copyWeekButton.click();

    // 4. Dialog should open with "Copy Week" title
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByText('Copy Week')).toBeVisible();

    // Shift count should be reflected in the confirm button text
    await expect(dialog.getByText(/copy 2 shifts/i)).toBeVisible();

    // 5. Select a date in the next week
    const nextWeekMonday = new Date();
    const dayOfWeek = nextWeekMonday.getDay();
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    nextWeekMonday.setDate(nextWeekMonday.getDate() + daysUntilNextMonday);
    const targetDay = nextWeekMonday.getDate();

    // If next week is in a different month, navigate calendar forward
    const currentMonth = new Date().getMonth();
    if (nextWeekMonday.getMonth() !== currentMonth) {
      const nextMonthButton = dialog.getByRole('button', { name: /next month|chevron/i }).last();
      await nextMonthButton.click();
      await page.waitForTimeout(300);
    }

    // Click the target day in the calendar
    const dayButton = dialog.getByRole('gridcell', { name: String(targetDay) }).first();
    await dayButton.click();

    // Overwrite warning should appear
    await expect(dialog.getByText(/existing unlocked shifts.*will be replaced/i)).toBeVisible({ timeout: 3000 });

    // 6. Set up response listener for shift creation (POST always occurs)
    const postResponse = page.waitForResponse(
      resp => resp.url().includes('rest/v1/shifts') && resp.request().method() === 'POST',
      { timeout: 15000 },
    );

    // Click confirm
    const confirmButton = dialog.getByRole('button', { name: /confirm copy week/i });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // Wait for insert to complete
    await postResponse;

    // 7. Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Toast should appear
    await expect(page.getByText('Schedule copied', { exact: true })).toBeVisible({ timeout: 10000 });

    // 8. Schedule should navigate to the target week (header should change)
    await expect(weekHeader).not.toHaveText(sourceWeekText!, { timeout: 10000 });

    // The copied shifts should be visible in the target week (employee names in grid)
    await expect(page.getByText('Alice Johnson').first()).toBeVisible({ timeout: 10000 });
  });

  test('dialog prevents copying to same week', async ({ page }) => {
    const testUser = generateTestUser('copy-week-same');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());

    // Seed one employee and one shift
    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    // Use .toISOString() for timezone-correct shift timestamps
    const shiftResult = await page.evaluate(
      ({ restId, empId }) => {
        const supabase = (window as any).__supabase;
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);

        const monStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 8, 0, 0).toISOString();
        const monEnd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 14, 0, 0).toISOString();

        return (async () => {
          const { error } = await supabase.from('shifts').insert({
            restaurant_id: restId,
            employee_id: empId,
            start_time: monStart,
            end_time: monEnd,
            position: 'Server',
            status: 'scheduled',
            break_duration: 0,
            is_published: false,
            locked: false,
          });
          if (error) return { error: error.message };
          return { success: true };
        })();
      },
      {
        restId: restaurantId,
        empId: (employees as any).find((e: any) => e.name === 'Alice Johnson')?.id,
      },
    );
    if ((shiftResult as any).error) {
      throw new Error(`Shift seed failed: ${(shiftResult as any).error}`);
    }

    // Navigate to Scheduling (Schedule tab is the default)
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Wait for the schedule grid to show the shift
    await expect(page.getByText('Alice Johnson').first()).toBeVisible({ timeout: 10000 });

    // Open Copy Week dialog
    await page.getByRole('button', { name: /copy week/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Select a day in the CURRENT week (same week as source)
    const today = new Date();
    const todayDay = today.getDate();
    const dayCell = dialog.getByRole('gridcell', { name: String(todayDay) }).first();
    await dayCell.click();

    // Should show "Cannot copy to the same week" warning
    await expect(dialog.getByText(/cannot copy to the same week/i)).toBeVisible({ timeout: 3000 });

    // Confirm button should be disabled
    const confirmButton = dialog.getByRole('button', { name: /confirm copy week/i });
    await expect(confirmButton).toBeDisabled();
  });
});
