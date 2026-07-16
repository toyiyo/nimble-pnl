import { test, expect, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Since #598 ("default staffing suggestions panel to collapsed"), the Staffing
 * Suggestions panel starts collapsed and its content (empty-state CTA, suggested
 * shifts, apply dialog) is unmounted until opened. Expand it before asserting.
 */
async function expandStaffingPanel(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /expand staffing suggestions/i })
    .click({ timeout: 10000 });
}

/**
 * E2E: Staffing suggestions — empty state + seeded-sales → apply flow.
 *
 * Coverage:
 *  - Empty state (no sales): "Connect your POS" CTA visible
 *  - With seeded sales: "Suggested shifts" list and "Apply suggested shifts" button appear
 *  - Dialog opens with at least one checkbox (aria-label "Include …")
 *  - Confirm → POST to shift_templates → success toast "open shift(s) created"
 */

test.describe('Staffing suggestions', () => {
  test('empty state shows Connect your POS CTA', async ({ page }) => {
    const user = generateTestUser('staff-empty');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed an employee so the Planner tab renders (not blocked by the empty-employees gate)
    await page.evaluate(
      ({ restId }) =>
        (window as any).__insertEmployees(
          [
            {
              name: 'Ana Costa',
              position: 'Server',
              status: 'active',
              is_active: true,
              compensation_type: 'hourly',
              hourly_rate: 1500,
            },
          ],
          restId,
        ),
      { restId: restaurantId },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await page.getByRole('tab', { name: /planner/i }).click();
    await expect(page.getByText('Ana Costa')).toBeVisible({ timeout: 10000 });

    // The Staffing Overlay defaults to collapsed since #598 — expand it first.
    // With no sales data, the empty-state CTA should then be visible.
    await expandStaffingPanel(page);
    await expect(
      page.getByRole('link', { name: /connect your pos/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('seeded sales produce shift blocks and the apply dialog creates templates', async ({ page }) => {
    const user = generateTestUser('staff-apply');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed an employee so the Planner tab renders
    await page.evaluate(
      ({ restId }) =>
        (window as any).__insertEmployees(
          [
            {
              name: 'Marco Rivera',
              position: 'Server',
              status: 'active',
              is_active: true,
              compensation_type: 'hourly',
              hourly_rate: 1500,
            },
          ],
          restId,
        ),
      { restId: restaurantId },
    );

    // Seed unified_sales for the last 7 days with enough revenue to trigger shift blocks.
    // The default target_splh is $60; seeding ~$1200/day → ~$92/hr → 2 staff/hr.
    // We seed multiple days to ensure at least one DOW matches the current week shown.
    // Omitting sale_time triggers the daily-spread fallback (9am–10pm), which is
    // sufficient to produce consolidated shift blocks.
    await page.evaluate(async ({ restId }: { restId: string }) => {
      const supabase = (window as any).__supabase;

      const today = new Date();
      const rows: Record<string, unknown>[] = [];

      for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
        const d = new Date(today);
        d.setDate(d.getDate() - daysAgo);
        const saleDate = d.toISOString().slice(0, 10);

        rows.push({
          restaurant_id: restId,
          pos_system: 'manual',
          external_order_id: `staff-e2e-${daysAgo}-${Date.now()}`,
          item_name: 'Food Sale',
          item_type: 'sale',
          quantity: 1,
          unit_price: 1200,
          total_price: 1200,
          sale_date: saleDate,
          // sale_time is omitted → daily-spread fallback activates
        });
      }

      const { error } = await supabase.from('unified_sales').insert(rows);
      if (error) throw new Error(`Seed failed: ${error.message}`);
    }, { restId: restaurantId });

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await page.getByRole('tab', { name: /planner/i }).click();
    await expect(page.getByText('Marco Rivera')).toBeVisible({ timeout: 10000 });
    await expandStaffingPanel(page);

    // Wait for the staffing overlay to compute shift blocks and show the Suggested shifts section.
    // This proves the sales data was picked up and consolidated into at least one block.
    // Use exact match to avoid matching the "Apply suggested shifts" button label.
    await expect(
      page.getByText('Suggested shifts', { exact: true }),
    ).toBeVisible({ timeout: 15000 });

    // The "Apply suggested shifts" button must be present
    const applyBtn = page.getByRole('button', { name: /apply suggested shifts/i });
    await expect(applyBtn).toBeVisible({ timeout: 5000 });

    // Click opens the dialog
    await applyBtn.click();

    const dialog = page.getByRole('dialog', { name: /apply suggested shifts/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // At least one checkbox should be visible (one per shift block).
    // The aria-label is "Include {day} {time}, {n} staff"
    const firstCheckbox = dialog.getByRole('checkbox').first();
    await expect(firstCheckbox).toBeVisible({ timeout: 5000 });
    await expect(firstCheckbox).toBeChecked();

    // Confirm button shows "Create N shifts"
    const confirmBtn = dialog.getByRole('button', { name: /create \d+ shifts?/i });
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeEnabled();

    await confirmBtn.click();

    // Dialog should close after the upsert completes (success: hook calls onOpenChange(false))
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // A success toast naming "N open shift(s) created" should appear.
    // Use first() to handle the aria-live duplicate (screen-reader status mirror)
    await expect(
      page.getByText(/open shifts? created/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('apply dialog aria contract: checkboxes have Include labels, cancel closes', async ({ page }) => {
    const user = generateTestUser('staff-a11y');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await page.evaluate(
      ({ restId }) =>
        (window as any).__insertEmployees(
          [
            {
              name: 'Kim Park',
              position: 'Cook',
              status: 'active',
              is_active: true,
              compensation_type: 'hourly',
              hourly_rate: 1600,
            },
          ],
          restId,
        ),
      { restId: restaurantId },
    );

    // Seed sales
    await page.evaluate(async ({ restId }: { restId: string }) => {
      const supabase = (window as any).__supabase;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const saleDate = yesterday.toISOString().slice(0, 10);

      const { error } = await supabase.from('unified_sales').insert([
        {
          restaurant_id: restId,
          pos_system: 'manual',
          external_order_id: `staff-a11y-${Date.now()}`,
          item_name: 'Food Sale',
          item_type: 'sale',
          quantity: 1,
          unit_price: 1200,
          total_price: 1200,
          sale_date: saleDate,
        },
      ]);
      if (error) throw new Error(`Seed failed: ${error.message}`);
    }, { restId: restaurantId });

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 10000 });

    await page.getByRole('tab', { name: /planner/i }).click();
    await expect(page.getByText('Kim Park')).toBeVisible({ timeout: 10000 });
    await expandStaffingPanel(page);

    await expect(page.getByText('Suggested shifts', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /apply suggested shifts/i }).click();

    const dialog = page.getByRole('dialog', { name: /apply suggested shifts/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Every checkbox must have an aria-label starting with "Include"
    const checkboxes = dialog.getByRole('checkbox');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const label = await checkboxes.nth(i).getAttribute('aria-label');
      expect(label).toMatch(/^Include /);
    }

    // Cancel closes the dialog
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });
});
