import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Task 15 (design: docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md).
 * Covers the two flows the plan calls out:
 *   - a manager publishes with "Notify employees" unchecked and the week still publishes;
 *   - a manager edits a shift that is already published, sees one warning dialog, saves
 *     the change, and the week stays published (no forced unpublish).
 *
 * Timezone is pinned for the same reason as the sibling scheduling specs: CI runs UTC,
 * and week-bucketing bugs are invisible there.
 */
test.use({ timezoneId: 'America/New_York' });

/** Seed one active employee and a Wednesday shift, safely inside the current Mon..Sun week. */
async function seedEmployeeAndShift(
  page: Page,
  restaurantId: string,
  employeeName: string,
): Promise<{ employeeName: string }> {
  return page.evaluate(
    async ({ restId, name }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name,
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

      return { employeeName: employee.name as string };
    },
    { restId: restaurantId, name: employeeName },
  );
}

/** Opens the Publish dialog, sets the notify checkbox, confirms, and waits for the RPC. */
async function publishWeek(page: Page, options: { notify: boolean }): Promise<void> {
  await page.goto('/scheduling');
  await page.waitForLoadState('networkidle');

  const publishBtn = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publishBtn).toBeEnabled({ timeout: 10000 });
  await publishBtn.click();

  const dialog = page.getByRole('dialog', { name: /publish schedule/i });
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Checked by default on every open — see PublishScheduleDialog's own tests.
  const notifyCheckbox = dialog.getByRole('checkbox', { name: /notify employees about this schedule/i });
  await expect(notifyCheckbox).toBeChecked();
  if (!options.notify) {
    await notifyCheckbox.click();
    await expect(notifyCheckbox).not.toBeChecked();
  }

  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('publish_schedule') && resp.status() === 200,
    { timeout: 20000 },
  );
  await dialog.getByRole('button', { name: /publish schedule/i }).click();
  await responsePromise;
}

test.describe('Quiet publish and live edit of a published shift', () => {
  test('publishing with "Notify employees" unchecked still publishes the week', async ({ page }) => {
    const testUser = generateTestUser('quietpub');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await seedEmployeeAndShift(page, restaurantId, 'Quinn Quietly');

    await publishWeek(page, { notify: false });

    // Publish succeeded despite the unchecked box: a fresh load shows the week
    // as published, so the action button flips from Publish to Unpublish.
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /^unpublish$/i })).toBeVisible({ timeout: 15000 });
  });

  test('editing a published shift shows one warning dialog, saves, and keeps the week published', async ({ page }) => {
    const testUser = generateTestUser('liveedit');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const { employeeName } = await seedEmployeeAndShift(page, restaurantId, 'Casey Editor');

    await publishWeek(page, { notify: true });

    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /^unpublish$/i })).toBeVisible({ timeout: 15000 });

    // Open the shift for edit. The shift is locked (published), but opening
    // the editor is never blocked — only saving a change is guarded. The
    // dialog no longer shows a "Shift is Locked" banner (fd7d765b): a
    // published shift is now editable, so that copy would be false.
    const shiftCard = page.getByTestId('shift-card').first();
    await expect(shiftCard).toBeVisible({ timeout: 15000 });
    await shiftCard.click();

    const editDialog = page.getByRole('dialog', { name: /edit shift/i });
    await expect(editDialog).toBeVisible({ timeout: 5000 });

    const endTimeInput = editDialog.getByLabel('Shift end time');
    const currentEndTime = await endTimeInput.inputValue();
    const [hh, mm] = currentEndTime.split(':').map(Number);
    const newEndTime = `${((hh + 2) % 24).toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
    await endTimeInput.fill(newEndTime);

    await editDialog.getByRole('button', { name: /^update shift$/i }).click();

    // Saving a change to a published shift raises exactly one warning dialog.
    const warningDialog = page.getByRole('alertdialog', { name: /this shift is published/i });
    await expect(warningDialog).toBeVisible({ timeout: 5000 });
    await expect(warningDialog.getByText(new RegExp(`^${employeeName} can see this shift`, 'i'))).toBeVisible();

    const patchPromise = page.waitForResponse(
      (resp) => resp.url().includes('/rest/v1/shifts') && resp.request().method() === 'PATCH' && resp.ok(),
      { timeout: 15000 },
    );
    await warningDialog.getByRole('button', { name: /^save change$/i }).click();
    await patchPromise;

    await expect(warningDialog).not.toBeVisible({ timeout: 5000 });
    await expect(editDialog).not.toBeVisible({ timeout: 5000 });

    // This was a live edit, not an unpublish: the week stays published.
    await expect(page.getByRole('button', { name: /^unpublish$/i })).toBeVisible({ timeout: 10000 });

    // The shift actually changed: reopening the editor shows the new end time.
    await shiftCard.click();
    const reopenedDialog = page.getByRole('dialog', { name: /edit shift/i });
    await expect(reopenedDialog).toBeVisible({ timeout: 5000 });
    await expect(reopenedDialog.getByLabel('Shift end time')).toHaveValue(newEndTime);
  });
});
