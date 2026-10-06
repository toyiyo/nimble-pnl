import { test, expect, type Locator, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Click one in-month day cell in a react-day-picker calendar (see copy-week-shifts.spec.ts). */
async function clickCalendarDay(scope: Locator, day: number) {
  const cells = scope.getByRole('gridcell', { name: String(day), exact: true });
  await cells.first().waitFor({ state: 'visible' });
  const inMonth = cells.and(scope.locator(':not(.day-outside)'));
  if (await inMonth.count()) await inMonth.first().click();
  else await cells.first().click();
}

function nextMonday(): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? 1 : 8 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

async function openWeekTemplates(page: Page) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });
  const tab = page.getByRole('tab', { name: 'Week Templates' });
  await expect(tab).toBeVisible({ timeout: 10000 });
  await tab.click();
}

test.describe('Week Templates', () => {
  test('create, edit and apply a week template without a live week', async ({ page }) => {
    const user = generateTestUser('week-tmpl');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

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
    expect((employees as any[]).length).toBe(2);

    // 1. Open the tab: empty state.
    await openWeekTemplates(page);
    await expect(page.getByText('Create your first week template')).toBeVisible();

    // 2. New template, name it, add Alice, add a 9-5 shift on Mon, Tue, Wed.
    await page.getByRole('button', { name: 'New template' }).click();
    const name = page.getByLabel('Template name');
    await name.fill('Weekday Lunch');

    await page.getByRole('button', { name: 'Add employee' }).click();
    await page.getByRole('button', { name: 'Add Alice Johnson to template' }).click();
    await page.getByRole('button', { name: 'Add shift for Alice Johnson on Monday' }).click();

    const shiftDialog = page.getByRole('dialog', { name: 'Add shift' });
    await expect(shiftDialog).toBeVisible();
    await shiftDialog.getByLabel('Start').fill('09:00');
    await shiftDialog.getByLabel('End').fill('17:00');
    await shiftDialog.getByRole('button', { name: 'Tuesday' }).click();
    await shiftDialog.getByRole('button', { name: 'Wednesday' }).click();
    await shiftDialog.getByRole('button', { name: 'Add shift' }).click();
    await expect(shiftDialog).not.toBeVisible();

    await expect(page.getByRole('button', { name: /^Edit shift: Alice Johnson/ })).toHaveCount(3);
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    // 3. Save. The template shows in the list and the draft is clean.
    const saveResp = page.waitForResponse((r) => r.url().includes('rpc/save_schedule_plan_template'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saveResp).ok()).toBe(true);
    await expect(page.getByText('Unsaved changes')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /Weekday Lunch.*3 shifts/ })).toBeVisible();

    // 4. Reload and edit: Monday ends at 6p. The update RPC succeeds.
    await openWeekTemplates(page);
    await expect(page.getByLabel('Template name')).toHaveValue('Weekday Lunch');
    await page.getByRole('button', { name: 'Edit shift: Alice Johnson, Monday, 9a to 5p' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit shift' });
    await editDialog.getByLabel('End').fill('18:00');
    await editDialog.getByRole('button', { name: 'Save shift' }).click();
    await expect(page.getByRole('button', { name: 'Edit shift: Alice Johnson, Monday, 9a to 6p' })).toBeVisible();

    // Apply is blocked while there are unsaved changes.
    await expect(page.getByRole('button', { name: 'Apply to week' })).toBeDisabled();

    const updateResp = page.waitForResponse((r) => r.url().includes('rpc/update_schedule_plan_template'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await updateResp).ok()).toBe(true);
    await expect(page.getByText('Unsaved changes')).not.toBeVisible();

    // 5. Apply to next week.
    await page.getByRole('button', { name: 'Apply to week' }).click();
    const applyDialog = page.getByRole('dialog', { name: 'Apply template' });
    await expect(applyDialog).toBeVisible();

    const target = nextMonday();
    if (target.getMonth() !== new Date().getMonth()) {
      await applyDialog.getByRole('button', { name: /next month|chevron/i }).last().click();
    }
    await clickCalendarDay(applyDialog, target.getDate());

    const applyResp = page.waitForResponse((r) => r.url().includes('rpc/apply_schedule_plan_template'));
    await applyDialog.getByRole('button', { name: 'Apply', exact: true }).click();
    expect((await applyResp).ok()).toBe(true);
    await expect(applyDialog.getByText('3 shifts created.')).toBeVisible();

    // 6. The shifts exist in the database at the template times.
    const rows = await page.evaluate(
      async ({ restId, from }) => {
        const supabase = (window as any).__supabase;
        const start = new Date(from);
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        const { data, error } = await supabase
          .from('shifts')
          .select('start_time, end_time, position')
          .eq('restaurant_id', restId)
          .gte('start_time', start.toISOString())
          .lt('start_time', end.toISOString())
          .order('start_time');
        if (error) throw new Error(error.message);
        return (data as any[]).map((s) => ({
          day: new Date(s.start_time).getDay(),
          start: new Date(s.start_time).getHours(),
          end: new Date(s.end_time).getHours(),
          position: s.position,
        }));
      },
      { restId: restaurantId, from: target.toISOString() },
    );
    expect(rows).toEqual([
      { day: 1, start: 9, end: 18, position: 'Server' },
      { day: 2, start: 9, end: 17, position: 'Server' },
      { day: 3, start: 9, end: 17, position: 'Server' },
    ]);

    // 7. View week opens the Schedule tab on that week.
    await applyDialog.getByRole('button', { name: 'View week' }).click();
    await expect(page.getByRole('tab', { name: /Schedule/ }).first()).toHaveAttribute('data-state', 'active');
    await expect(page.getByText('Alice Johnson').first()).toBeVisible({ timeout: 10000 });
  });

  test('asks before it leaves the tab with unsaved changes', async ({ page }) => {
    const user = generateTestUser('week-tmpl-guard');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [{ name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 }],
        restId: restaurantId,
      },
    );

    await openWeekTemplates(page);
    await page.getByRole('button', { name: 'New template' }).click();
    await page.getByRole('button', { name: 'Add employee' }).click();
    await page.getByRole('button', { name: 'Add Alice Johnson to template' }).click();
    await page.getByRole('button', { name: 'Add shift for Alice Johnson on Friday' }).click();
    await page.getByRole('dialog', { name: 'Add shift' }).getByRole('button', { name: 'Add shift' }).click();

    await page.getByRole('tab', { name: 'Planner' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Discard unsaved template changes?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('tab', { name: 'Week Templates' })).toHaveAttribute('data-state', 'active');

    await page.getByRole('tab', { name: 'Planner' }).click();
    await confirm.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('tab', { name: 'Planner' })).toHaveAttribute('data-state', 'active');
  });
});
