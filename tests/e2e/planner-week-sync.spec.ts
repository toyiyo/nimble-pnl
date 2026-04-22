import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Planner shared week state', () => {
  test('selected week persists across Schedule and Planner tabs', async ({ page }) => {
    const user = generateTestUser('week-sync');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/scheduling');

    // Read current week label on Schedule tab
    await expect(page.getByRole('tab', { name: /schedule/i })).toBeVisible();
    const nextWeekBtn = page.getByRole('button', { name: /next week/i });
    await nextWeekBtn.click();

    // URL should have ?week=YYYY-MM-DD
    await page.waitForURL(/\?week=\d{4}-\d{2}-\d{2}/);
    const schedUrl = page.url();
    const weekParam = new URL(schedUrl).searchParams.get('week');
    expect(weekParam).toMatch(/\d{4}-\d{2}-\d{2}/);

    // Switch to Planner tab
    await page.getByRole('tab', { name: /planner/i }).click();

    // URL should still carry the same week param
    const plannerUrl = page.url();
    expect(new URL(plannerUrl).searchParams.get('week')).toBe(weekParam);
  });

  test('reloading the Scheduling page preserves the week param', async ({ page }) => {
    const user = generateTestUser('week-reload');
    await signUpAndCreateRestaurant(page, user);
    await page.goto('/scheduling?week=2026-05-04');
    await page.reload();
    expect(new URL(page.url()).searchParams.get('week')).toBe('2026-05-04');
  });
});
