import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Open Shift Claiming', () => {
  test('employee can claim an open shift', async ({ page }) => {
    // 1. Sign up manager, create restaurant
    const testUser = generateTestUser('open-shift');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // 2. Seed all required data
    await page.evaluate(async (restId: string) => {
      const supabase = (window as any).__supabase;

      // Enable open shifts in staffing settings
      const { error: settingsError } = await supabase
        .from('staffing_settings')
        .upsert(
          {
            restaurant_id: restId,
            open_shifts_enabled: true,
            require_shift_claim_approval: false,
          },
          { onConflict: 'restaurant_id' }
        );
      if (settingsError) throw new Error(`staffing_settings upsert failed: ${settingsError.message}`);

      // Create a shift template with capacity=3
      const { data: template, error: templateError } = await supabase
        .from('shift_templates')
        .insert({
          restaurant_id: restId,
          name: 'Closing Server',
          start_time: '16:00:00',
          end_time: '22:00:00',
          position: 'Server',
          capacity: 3,
          days: [0, 1, 2, 3, 4, 5, 6], // All days — ensures test works regardless of day-of-week
          is_active: true,
        })
        .select()
        .single();
      if (templateError) throw new Error(`shift_templates insert failed: ${templateError.message}`);

      // Compute current week dates (Mon-Sun)
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const pad = (n: number) => String(n).padStart(2, '0');
      const toDateStr = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      const mondayStr = toDateStr(monday);
      const sundayStr = toDateStr(sunday);

      // Get auth user to use as published_by
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) throw new Error('No authenticated user found');

      // Publish current + next week (ensures future dates exist regardless of day-of-week)
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);
      const nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextMonday.getDate() + 6);

      const { error: pubError } = await supabase
        .from('schedule_publications')
        .insert([
          {
            restaurant_id: restId,
            week_start_date: mondayStr,
            week_end_date: sundayStr,
            published_by: userId,
            shift_count: 0,
          },
          {
            restaurant_id: restId,
            week_start_date: toDateStr(nextMonday),
            week_end_date: toDateStr(nextSunday),
            published_by: userId,
            shift_count: 0,
          },
        ]);
      if (pubError) throw new Error(`schedule_publications insert failed: ${pubError.message}`);

      // Create employee linked to the current user so useCurrentEmployee can find them
      const { error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: userId,
          name: 'Test Employee',
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        });
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      return { templateId: template.id, mondayStr, sundayStr };
    }, restaurantId as string);

    // Change role to staff so employee routes are accessible
    await page.evaluate(async () => {
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No user session');
      const restaurantId = await (window as any).__getRestaurantId(user.id);
      const { error } = await supabase
        .from('user_restaurants')
        .update({ role: 'staff' })
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);
      if (error) throw new Error(`Failed to set role to staff: ${error.message}`);
    });

    // 3. Navigate to /employee/shifts
    await page.goto('/employee/shifts');
    await page.waitForURL(/\/employee\/shifts/, { timeout: 10000 });

    // 4. Wait for the "Available Shifts" header to confirm page loaded
    await expect(page.getByText('Available Shifts')).toBeVisible({ timeout: 15000 });

    // 5. Wait for feed to populate — look for OPEN SHIFT badge or template name
    // The page shows a loading skeleton first, then populates from the RPC
    await expect(page.getByText('OPEN SHIFT').first()).toBeVisible({ timeout: 15000 });

    // 6. Verify the template name is visible on the open shift card
    await expect(page.getByText('Closing Server').first()).toBeVisible({ timeout: 5000 });

    // 7. Click "Claim" on the first open shift card that has a Claim button
    // (Some cards may show "Schedule conflict" instead of Claim button)
    const claimButton = page.getByRole('button', { name: /claim shift closing server/i }).first();
    await expect(claimButton).toBeVisible({ timeout: 10000 });
    await claimButton.click();

    // 8. Wait for the confirmation dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Claim Shift')).toBeVisible();

    // 9. Click "Confirm" in the dialog
    const confirmButton = dialog.getByRole('button', { name: /confirm/i });
    await expect(confirmButton).toBeVisible();

    // Wait for the RPC response after clicking confirm
    const claimResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('claim_open_shift') && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null); // Non-fatal: RPC may come via different URL pattern

    await confirmButton.click();

    // 10. Verify the claim was submitted — dialog closes and "My Claims" section appears
    // The dialog should close after successful claim
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // "My Claims" section appears after a successful claim (collapsible header with count > 0)
    const myClaimsHeading = page.getByRole('heading', { name: /my claims/i });
    await expect(myClaimsHeading).toBeVisible({ timeout: 10000 });

    // Wait for the RPC response if it hasn't arrived yet
    await claimResponsePromise;

    // Also try to catch the toast if it's still visible (Sonner toasts auto-dismiss)
    const successToast = page.locator('[data-sonner-toast]').first();
    const toastVisible = await successToast.isVisible().catch(() => false);
    if (toastVisible) {
      await expect(successToast).toContainText(/shift claimed|claim submitted/i);
    }
  });

  test('claimed shift has correct timezone-adjusted timestamps', async ({ page }) => {
    // 1. Sign up manager, create restaurant
    const testUser = generateTestUser('tz-claim');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // 2. Seed data with explicit timezone
    const seedResult = await page.evaluate(async (restId: string) => {
      const supabase = (window as any).__supabase;

      // Set restaurant timezone to America/Chicago (CDT = UTC-5 in April)
      await supabase
        .from('restaurants')
        .update({ timezone: 'America/Chicago' })
        .eq('id', restId);

      // Enable open shifts (instant approval)
      await supabase
        .from('staffing_settings')
        .upsert(
          {
            restaurant_id: restId,
            open_shifts_enabled: true,
            require_shift_claim_approval: false,
          },
          { onConflict: 'restaurant_id' }
        );

      // Template: 3:30 PM - 10:00 PM (the exact scenario from the bug report)
      const { data: template } = await supabase
        .from('shift_templates')
        .insert({
          restaurant_id: restId,
          name: 'Closing TZ Test',
          start_time: '15:30:00',
          end_time: '22:00:00',
          position: 'Server',
          capacity: 3,
          days: [0, 1, 2, 3, 4, 5, 6],
          is_active: true,
        })
        .select()
        .single();

      // Compute next Sunday (DOW=0) that is today or in the future
      const now = new Date();
      const daysUntilSunday = (7 - now.getDay()) % 7 || 7; // next Sunday, not today
      const nextSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSunday);
      const pad = (n: number) => String(n).padStart(2, '0');
      const sundayStr = `${nextSunday.getFullYear()}-${pad(nextSunday.getMonth() + 1)}-${pad(nextSunday.getDate())}`;

      // Compute week containing that Sunday (Mon-Sun)
      const monday = new Date(nextSunday);
      monday.setDate(nextSunday.getDate() - 6);
      const mondayStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;

      // Get auth user
      const { data: { user } } = await supabase.auth.getUser();

      // Publish the week
      await supabase
        .from('schedule_publications')
        .insert({
          restaurant_id: restId,
          week_start_date: mondayStr,
          week_end_date: sundayStr,
          published_by: user?.id,
          shift_count: 0,
        });

      // Create employee linked to current user
      await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user?.id,
          name: 'TZ Test Employee',
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        });

      return { templateId: template!.id, sundayStr, mondayStr };
    }, restaurantId as string);

    // 3. Switch to staff role
    await page.evaluate(async () => {
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      const restaurantId = await (window as any).__getRestaurantId(user?.id);
      await supabase
        .from('user_restaurants')
        .update({ role: 'staff' })
        .eq('user_id', user?.id)
        .eq('restaurant_id', restaurantId);
    });

    // 4. Navigate and claim the shift
    await page.goto('/employee/shifts');
    await expect(page.getByText('Available Shifts')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('OPEN SHIFT').first()).toBeVisible({ timeout: 15000 });

    const claimButton = page.getByRole('button', { name: /claim shift closing tz test/i }).first();
    await expect(claimButton).toBeVisible({ timeout: 10000 });
    await claimButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: /confirm/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // 5. Verify the resulting shift has correct UTC timestamps
    const shiftCheck = await page.evaluate(async (args: { restId: string; sundayStr: string }) => {
      const supabase = (window as any).__supabase;

      // Read the shift created by the claim
      const { data: shifts } = await supabase
        .from('shifts')
        .select('start_time, end_time')
        .eq('restaurant_id', args.restId)
        .eq('source', 'template')
        .eq('status', 'scheduled')
        .order('created_at', { ascending: false })
        .limit(1);

      if (!shifts || shifts.length === 0) return { error: 'No shift found' };

      const shift = shifts[0];
      const startHourUTC = new Date(shift.start_time).getUTCHours();
      const endHourUTC = new Date(shift.end_time).getUTCHours();

      // In CDT (UTC-5): 15:30 local = 20:30 UTC, 22:00 local = 03:00 UTC next day
      // BUG would produce: 15:30 UTC (startHourUTC=15), 22:00 UTC (endHourUTC=22)
      return {
        startHourUTC,
        endHourUTC,
        startTime: shift.start_time,
        endTime: shift.end_time,
      };
    }, { restId: restaurantId as string, sundayStr: seedResult.sundayStr });

    // The shift should be stored as 20:30 UTC (15:30 CDT), not 15:30 UTC
    expect(shiftCheck).not.toHaveProperty('error');
    expect(shiftCheck.startHourUTC).toBe(20); // 15:30 CDT = 20:30 UTC
    expect(shiftCheck.endHourUTC).toBe(3);    // 22:00 CDT = 03:00 UTC next day

    // 6. Verify open_spots via RPC
    const spotsCheck = await page.evaluate(async (args: { restId: string; mondayStr: string; sundayStr: string }) => {
      const supabase = (window as any).__supabase;
      const { data } = await supabase.rpc('get_open_shifts', {
        p_restaurant_id: args.restId,
        p_week_start: args.mondayStr,
        p_week_end: args.sundayStr,
      });
      // Find the Sunday entry for our template
      const entry = data?.find((d: any) => d.shift_date === args.sundayStr);
      return { openSpots: entry?.open_spots ?? null, assignedCount: entry?.assigned_count ?? null };
    }, { restId: restaurantId as string, mondayStr: seedResult.mondayStr, sundayStr: seedResult.sundayStr });

    // After 1 claim, should show 2 open spots (capacity 3 - 1 assigned)
    expect(spotsCheck.assignedCount).toBe(1);
    expect(spotsCheck.openSpots).toBe(2);
  });
});
