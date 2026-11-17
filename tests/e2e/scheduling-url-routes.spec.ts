import { test, expect, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

// The Scheduling page keeps its tab, filters, and view in the URL.
// Each test signs up a fresh user, then opens /scheduling with query params.

async function openScheduling(page: Page, query: string, prefix: string) {
  await signUpAndCreateRestaurant(page, generateTestUser(prefix));
  await exposeSupabaseHelpers(page);
  const restaurantId = await page.evaluate(() => (window as unknown as { __getRestaurantId: () => string }).__getRestaurantId());
  await page.evaluate(
    ({ emps, restId }) => (window as unknown as { __insertEmployees: (e: unknown[], r: string) => unknown }).__insertEmployees(emps, restId),
    {
      emps: [
        { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
      ],
      restId: restaurantId,
    },
  );
  await page.goto(`/scheduling${query}`);
  await expect(page.getByRole('tab', { name: 'Planner', exact: true })).toBeVisible({
    timeout: 15000,
  });
}

test.describe('Scheduling URL routes', () => {
  test('planner timeline deep link opens the timeline view', async ({ page }) => {
    await openScheduling(page, '?tab=planner&view=timeline', 'url-timeline');
    await expect(page.getByRole('tab', { name: 'Planner', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('radio', { name: 'Timeline', exact: true })).toBeChecked();
  });

  test('the selected tab trigger matches ?tab=', async ({ page }) => {
    await openScheduling(page, '?tab=availability', 'url-tab');
    await expect(page.getByRole('tab', { name: 'Availability', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Schedule', exact: true })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  test('a tab change adds a history entry and Back returns to the old tab', async ({ page }) => {
    await openScheduling(page, '?tab=schedule', 'url-back');
    await page.getByRole('tab', { name: 'Planner', exact: true }).click();
    await expect(page).toHaveURL(/tab=planner/);
    await page.goBack();
    await expect(page).not.toHaveURL(/tab=planner/);
    await expect(page.getByRole('tab', { name: 'Schedule', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('reload keeps area and group', async ({ page }) => {
    await openScheduling(page, '?tab=schedule&area=Kitchen&group=position', 'url-reload');
    await page.reload();
    await expect(page).toHaveURL(/area=Kitchen/);
    await expect(page).toHaveURL(/group=position/);
  });

  test('a 375 px viewport keeps ?day=', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openScheduling(page, '?tab=schedule&day=2026-03-04', 'url-day');
    await expect(page).toHaveURL(/day=2026-03-04/);
    await page.reload();
    await expect(page).toHaveURL(/day=2026-03-04/);
  });

  test('a dirty template draft stays when Back opens the discard dialog', async ({ page }) => {
    await openScheduling(page, '?tab=schedule', 'url-draft');
    await page.getByRole('tab', { name: 'Week Templates', exact: true }).click();
    await page.getByRole('button', { name: 'New template', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Template name', exact: true });
    await name.fill('Draft kept');
    await page.getByRole('button', { name: 'Add employee', exact: true }).click();
    await page.getByRole('button', { name: 'Add Alice Johnson to template', exact: true }).click();
    await page.getByRole('button', { name: 'Add shift for Alice Johnson on Monday', exact: true }).click();
    await page.getByLabel('Position').fill('Server');
    await page.getByRole('button', { name: 'Add shift', exact: true }).click();
    await page.goBack();
    await expect(
      page.getByRole('alertdialog', { name: 'Discard unsaved template changes?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(name).toHaveValue('Draft kept');
  });

  test('an arrow key moves focus and Enter changes ?tab=', async ({ page }) => {
    await openScheduling(page, '?tab=schedule', 'url-keys');
    const schedule = page.getByRole('tab', { name: 'Schedule', exact: true });
    await schedule.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Time-Off', exact: true })).toBeFocused();
    await expect(page).not.toHaveURL(/tab=timeoff/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=timeoff/);
  });
});
