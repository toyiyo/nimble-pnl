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
          days: [1, 2, 3, 4, 5], // Mon-Fri
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

      // Publish the current week schedule
      const { error: pubError } = await supabase
        .from('schedule_publications')
        .insert({
          restaurant_id: restId,
          week_start_date: mondayStr,
          week_end_date: sundayStr,
          published_by: userId,
          shift_count: 0,
        });
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
});
