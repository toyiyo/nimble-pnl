import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Pinning the timezone is what gives this spec its value. Playwright sets no
 * timezoneId and CI runs UTC — the one zone where this bug is invisible.
 * Unpinned, these assertions would pass before the fix, after the fix, and
 * straight through a future regression.
 */
test.use({ timezoneId: 'America/New_York' });

test.describe('Schedule publish week range', () => {
  test('publishing a week stores a Mon-Sun span, not Mon-Mon', async ({ page }) => {
    const testUser = generateTestUser('pubweek');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed one shift so there is something to publish.
    await page.evaluate(async ({ restId }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: 'Pat Publisher',
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select()
        .single();
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      // Wednesday of the current local week, safely inside Mon..Sun.
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const wednesday = new Date(monday);
      wednesday.setDate(monday.getDate() + 2);
      wednesday.setHours(10, 0, 0, 0);
      const end = new Date(wednesday);
      end.setHours(16, 0, 0, 0);

      const { error: shiftError } = await supabase.from('shifts').insert({
        restaurant_id: restId,
        employee_id: employee.id,
        start_time: wednesday.toISOString(),
        end_time: end.toISOString(),
        position: 'Server',
      });
      if (shiftError) throw new Error(`shifts insert failed: ${shiftError.message}`);
    }, { restId: restaurantId });

    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');

    // Wait for the seeded shift to render (confirms shifts have loaded and the
    // Publish button, which is disabled while shifts.length === 0, is enabled).
    await expect(page.getByRole('tabpanel', { name: 'Schedule' }).getByText('Pat Publisher').first())
      .toBeVisible({ timeout: 15000 });

    const publishBtn = page.getByRole('button', { name: 'Publish', exact: true });
    await expect(publishBtn).toBeEnabled({ timeout: 10000 });
    await publishBtn.click();

    const publishDialog = page.getByRole('dialog', { name: /publish schedule/i });
    await expect(publishDialog).toBeVisible({ timeout: 5000 });
    const confirmBtn = publishDialog.getByRole('button', { name: /publish schedule/i });
    await expect(confirmBtn).toBeVisible();

    // Intercept the publish_schedule RPC so we know the write has landed before we read it back.
    const publishResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('publish_schedule') && resp.status() === 200,
      { timeout: 20000 },
    );
    await confirmBtn.click();
    await publishResponsePromise;

    const publication = await page.evaluate(async ({ restId }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('schedule_publications')
        .select('week_start_date, week_end_date')
        .eq('restaurant_id', restId)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }, { restId: restaurantId });

    expect(publication).toBeTruthy();

    const start = new Date(`${publication.week_start_date}T00:00:00`);
    const finish = new Date(`${publication.week_end_date}T00:00:00`);
    const spanDays = Math.round((finish.getTime() - start.getTime()) / 86_400_000);

    // The bug produced 7 (Mon..Mon, 8 inclusive days).
    expect(spanDays).toBe(6);
    expect(start.getDay()).toBe(1); // Monday
    expect(finish.getDay()).toBe(0); // Sunday
  });
});
