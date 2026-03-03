import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Copy Week Shifts', () => {
  test('copies shifts from current week to next week via dialog', async ({ page }) => {
    // 1. Setup: create user, restaurant, employees, template, and shifts
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

    // Seed template + 2 shifts for the current week (one per employee)
    // IMPORTANT: Use .toISOString() for shift timestamps so that local hours
    // match the template's HH:MM:SS. The planner matches shifts to templates
    // by comparing local-time hours extracted from ISO timestamps.
    const seedResult = await page.evaluate(
      ({ restId, aliceId, bobId }) => {
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
        // .toISOString() converts to UTC, preserving the intended local time
        const monStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 8, 0, 0).toISOString();
        const monEnd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate(), 14, 0, 0).toISOString();
        const tueStart = new Date(tue.getFullYear(), tue.getMonth(), tue.getDate(), 8, 0, 0).toISOString();
        const tueEnd = new Date(tue.getFullYear(), tue.getMonth(), tue.getDate(), 14, 0, 0).toISOString();

        return (async () => {
          // Insert template (all 7 days active)
          const { data: tmpl, error: tmplErr } = await supabase
            .from('shift_templates')
            .insert({
              restaurant_id: restId,
              name: 'Morning',
              start_time: '08:00:00',
              end_time: '14:00:00',
              position: 'Server',
              days: [0, 1, 2, 3, 4, 5, 6],
              break_duration: 30,
              is_active: true,
            })
            .select()
            .single();

          if (tmplErr) return { error: `template: ${tmplErr.message}` };

          // Insert 2 shifts: Alice on Monday, Bob on Tuesday
          const { error: shiftErr } = await supabase.from('shifts').insert([
            {
              restaurant_id: restId,
              employee_id: aliceId,
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
              employee_id: bobId,
              start_time: tueStart,
              end_time: tueEnd,
              position: 'Server',
              status: 'scheduled',
              break_duration: 30,
              is_published: false,
              locked: false,
            },
          ]);

          if (shiftErr) return { error: `shift: ${shiftErr.message}` };
          return { templateId: tmpl.id };
        })();
      },
      {
        restId: restaurantId,
        aliceId: (employees as any).find((e: any) => e.name === 'Alice Johnson')?.id,
        bobId: (employees as any).find((e: any) => e.name === 'Bob Smith')?.id,
      },
    );

    if (!(employees as any)?.length) {
      throw new Error('Employee seeding returned empty results');
    }

    if ((seedResult as any).error) {
      throw new Error(`Seed failed: ${(seedResult as any).error}`);
    }

    // 2. Navigate to Scheduling → Planner tab
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for template to render
    await expect(page.getByText('Morning')).toBeVisible({ timeout: 10000 });

    // Verify shifts are present (employee chips in grid)
    await expect(
      page.getByRole('button', { name: /remove alice johnson from shift/i }),
    ).toBeVisible({ timeout: 10000 });

    // Capture current date range for later comparison
    const dateRange = page.locator('.text-\\[15px\\].font-semibold');
    await expect(dateRange).toBeVisible();
    const sourceWeekText = await dateRange.textContent();

    // 3. Click "Copy Week" button
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

    // 8. Planner should navigate to the target week (date range should change)
    await expect(dateRange).not.toHaveText(sourceWeekText!, { timeout: 10000 });

    // The copied shifts should be visible in the target week
    await expect(
      page.getByRole('button', { name: /remove alice johnson from shift/i }),
    ).toBeVisible({ timeout: 10000 });
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

    // Seed a template so the planner grid shows shifts
    const templateResult = await page.evaluate(
      ({ restId }) => {
        const supabase = (window as any).__supabase;
        return (async () => {
          const { error } = await supabase.from('shift_templates').insert({
            restaurant_id: restId,
            name: 'Morning',
            start_time: '08:00:00',
            end_time: '14:00:00',
            position: 'Server',
            days: [0, 1, 2, 3, 4, 5, 6],
            break_duration: 30,
            is_active: true,
          });
          if (error) return { error: error.message };
          return { success: true };
        })();
      },
      { restId: restaurantId },
    );
    if ((templateResult as any).error) {
      throw new Error(`Template seed failed: ${(templateResult as any).error}`);
    }

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
        empId: (employees as any)[0].id,
      },
    );
    if ((shiftResult as any).error) {
      throw new Error(`Shift seed failed: ${(shiftResult as any).error}`);
    }

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Wait for shift chip to render in planner grid
    await expect(
      page.getByRole('button', { name: /remove alice johnson from shift/i }),
    ).toBeVisible({ timeout: 10000 });

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
