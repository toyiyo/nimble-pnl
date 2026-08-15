import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * The whole point of the banner is that an employee can tell a draft week from
 * a published one, and a published week from one the manager has pulled back.
 * That distinction only exists across a publish/unpublish sequence, so this
 * spec walks the sequence rather than asserting any single state in isolation.
 *
 * Timezone is pinned for the same reason as schedule-publish-week-range.spec.ts:
 * CI runs UTC, and week bucketing bugs are invisible there.
 */
test.use({ timezoneId: 'America/New_York' });

/** The owner is also the employee, so one session can both publish and read the result. */
async function seedSelfAsEmployeeWithShift(page: Page, restaurantId: string): Promise<void> {
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
        name: 'Robin Retraction',
        position: 'Server',
        status: 'active',
        is_active: true,
        compensation_type: 'hourly',
        hourly_rate: 1500,
      })
      .select('id, name')
      .single();
    if (empError) throw new Error(`employees insert failed: ${empError.message}`);

    // Wednesday of the current local week — safely inside Mon..Sun no matter
    // which day the suite runs on.
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
}

/** Drives the manager-side Publish dialog and waits for the RPC to land. */
async function publishCurrentWeek(page: Page): Promise<void> {
  await page.goto('/scheduling');
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('tabpanel', { name: 'Schedule' }).getByText('Robin Retraction').first())
    .toBeVisible({ timeout: 15000 });

  const publishBtn = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publishBtn).toBeEnabled({ timeout: 10000 });
  await publishBtn.click();

  const dialog = page.getByRole('dialog', { name: /publish schedule/i });
  await expect(dialog).toBeVisible({ timeout: 5000 });

  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('publish_schedule') && resp.status() === 200,
    { timeout: 20000 },
  );
  await dialog.getByRole('button', { name: /publish schedule/i }).click();
  await responsePromise;
}

/** Drives the manager-side Unpublish confirmation and waits for the RPC to land. */
async function unpublishCurrentWeek(page: Page): Promise<void> {
  await page.goto('/scheduling');
  await page.waitForLoadState('networkidle');

  const unpublishBtn = page.getByRole('button', { name: /^unpublish$/i });
  await expect(unpublishBtn).toBeVisible({ timeout: 15000 });
  await unpublishBtn.click();

  const dialog = page.getByRole('alertdialog').filter({ hasText: /unpublish schedule/i });
  await expect(dialog).toBeVisible({ timeout: 5000 });

  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('unpublish_schedule') && resp.status() === 200,
    { timeout: 20000 },
  );
  await dialog.getByRole('button', { name: /unpublish schedule/i }).click();
  await responsePromise;
}

test.describe('Employee schedule publish states', () => {
  test('an employee sees draft, then published, then retracted as the manager acts', async ({ page }) => {
    const testUser = generateTestUser('retract');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await seedSelfAsEmployeeWithShift(page, restaurantId);

    // --- State A: nothing published yet. The shift is visible, with a quiet
    // draft hue and no warning copy — many restaurants never publish, and the
    // old "not published yet" alert caused a real no-show.
    await page.goto('/employee/schedule');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/upcoming/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/schedule not published yet/i)).not.toBeVisible();
    await expect(page.getByText(/draft — not confirmed/i)).not.toBeVisible();

    // --- State B: published. The draft badge is gone and the banner steps aside.
    await publishCurrentWeek(page);

    await page.goto('/employee/schedule');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/^Published /)).toBeVisible({ timeout: 15000 });

    // --- State D: pulled back. This is the state the old UI could not express
    // at all — the employee was left reading a week nobody had told them was
    // no longer final.
    await unpublishCurrentWeek(page);

    await page.goto('/employee/schedule');
    await page.waitForLoadState('networkidle');

    const retractedAlert = page.getByRole('alert').filter({ hasText: /pulled back for changes/i });
    await expect(retractedAlert).toBeVisible({ timeout: 15000 });
    await expect(retractedAlert).toContainText(/nothing below is final/i);
  });
});
