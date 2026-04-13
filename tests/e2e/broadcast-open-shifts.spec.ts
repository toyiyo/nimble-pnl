import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Broadcast Open Shifts', () => {
  test('manager sees broadcast button and dialog when open shifts exist', async ({ page }) => {
    // 1. Sign up, create restaurant
    const testUser = generateTestUser('broadcast');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // 2. Seed required data via page.evaluate
    await page.evaluate(async ({ restId }) => {
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      // Enable open shifts in staffing settings
      const { error: settingsError } = await supabase
        .from('staffing_settings')
        .upsert({
          restaurant_id: restId,
          open_shifts_enabled: true,
        }, { onConflict: 'restaurant_id' });
      if (settingsError) throw new Error(`staffing_settings upsert failed: ${settingsError.message}`);

      // Create an employee linked to the current user
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: 'Jane Server',
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select()
        .single();
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      // Create shift template with capacity=3 for all days
      // capacity=3 means 2 open spots after 1 assigned shift → openShiftCount > 0
      const { error: templateError } = await supabase
        .from('shift_templates')
        .insert({
          restaurant_id: restId,
          name: 'Evening Server',
          start_time: '16:00:00',
          end_time: '22:00:00',
          position: 'Server',
          capacity: 3,
          days: [0, 1, 2, 3, 4, 5, 6], // All days — works regardless of day-of-week
          is_active: true,
        });
      if (templateError) throw new Error(`shift_templates insert failed: ${templateError.message}`);

      // Compute this week's Monday date string in local time
      // (same logic as date-fns startOfWeek({ weekStartsOn: 1 }))
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);

      const pad = (n: number) => String(n).padStart(2, '0');
      const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const mondayStr = fmt(monday);

      // Insert a draft shift for Monday at noon local time (avoids timezone edge cases)
      // The publish_schedule RPC uses start_time::date which compares local date
      const shiftStart = new Date(monday);
      shiftStart.setHours(12, 0, 0, 0); // noon local

      const shiftEnd = new Date(monday);
      shiftEnd.setHours(18, 0, 0, 0); // 6pm local

      const { error: shiftError } = await supabase
        .from('shifts')
        .insert({
          restaurant_id: restId,
          employee_id: employee.id,
          start_time: shiftStart.toISOString(),
          end_time: shiftEnd.toISOString(),
          position: 'Server',
          source: 'manual',
        });
      if (shiftError) throw new Error(`shifts insert failed: ${shiftError.message}`);

      return { mondayStr };
    }, { restId: restaurantId as string });

    // 3. Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');

    // 4. Wait for the shift to appear in the schedule grid (confirms data is loaded)
    // Scope to the Schedule tabpanel to avoid the LaborCostBreakdown duplicate
    await expect(page.getByRole('tabpanel', { name: 'Schedule' }).getByText('Jane Server').first()).toBeVisible({ timeout: 15000 });

    // 5. Click the Publish button to enter published state
    // The Publish button is the primary action button (not "Publish Schedule" inside the dialog)
    const publishBtn = page.getByRole('button', { name: 'Publish', exact: true });
    await expect(publishBtn).toBeVisible({ timeout: 10000 });
    await publishBtn.click();

    // 6. Confirm publish in the dialog
    const publishDialog = page.getByRole('dialog', { name: /publish schedule/i });
    await expect(publishDialog).toBeVisible({ timeout: 5000 });
    const confirmBtn = publishDialog.getByRole('button', { name: /publish schedule/i });
    await expect(confirmBtn).toBeVisible();

    // Intercept the publish_schedule RPC call before clicking confirm
    const publishResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('publish_schedule') && resp.status() === 200,
      { timeout: 20000 }
    );
    await confirmBtn.click();
    await publishResponsePromise;

    // Dismiss any toast that appeared after publishing (may overlay buttons)
    const toast = page.locator('[data-sonner-toast]').first();
    if (await toast.isVisible({ timeout: 2000 }).catch(() => false)) {
      await toast.locator('button[aria-label="Close"]').click().catch(() => {});
    }

    // 7. Reload the page to force React Query to refetch week_publication_status
    // (the publish mutation invalidates shifts but not week_publication_status query key)
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for the page to reflect published state — "Unpublish" button signals success
    await expect(page.getByRole('button', { name: /unpublish/i })).toBeVisible({ timeout: 15000 });

    // 8. Verify Broadcast button appears
    // Conditions: open_shifts_enabled=true, openShiftCount>0 (capacity=3, 1 assigned → 2 open)
    const broadcastBtn = page.getByRole('button', { name: /broadcast open shifts/i });
    await expect(broadcastBtn).toBeVisible({ timeout: 10000 });

    // 9. Click broadcast button to open dialog
    await broadcastBtn.click();

    // 10. Verify dialog opens with correct title
    const dialog = page.getByRole('dialog', { name: /broadcast open shifts/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // 11. Verify dialog shows open shift count info and team member notification copy
    // Use first() to handle the title "Broadcast Open Shifts" also matching /open shift/i
    await expect(dialog.getByText(/open shifts? for/i).first()).toBeVisible();
    await expect(dialog.getByText(/team members/i)).toBeVisible();

    // 12. Cancel the dialog (don't actually broadcast — edge function may not be running)
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });
});
