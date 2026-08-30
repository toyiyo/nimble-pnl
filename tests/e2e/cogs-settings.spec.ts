import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * COGS Settings — combined method removal
 *
 * The COGS card on restaurant settings must show exactly two options:
 * Inventory and Financials. The Combined option is gone. A selected
 * method must persist across a reload.
 */

test.describe('COGS settings', () => {
  test('shows two COGS options and persists the selected one', async ({ page }) => {
    const testUser = generateTestUser();

    await signUpAndCreateRestaurant(page, testUser);

    await page.goto('/settings?tab=financial');
    await page.waitForURL(/\/settings/, { timeout: 8000 });

    await expect(
      page.getByRole('heading', { name: /cogs settings/i }),
    ).toBeVisible({ timeout: 8000 });

    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(2);

    await expect(page.getByText(/combined/i)).toHaveCount(0);

    const financialsOption = page.getByRole('radio', {
      name: /financials \(purchases\)/i,
    });
    await expect(financialsOption).toBeVisible();
    await financialsOption.click();
    await expect(financialsOption).toBeChecked();

    await page.reload();
    await page.waitForURL(/\/settings/, { timeout: 8000 });
    await expect(
      page.getByRole('heading', { name: /cogs settings/i }),
    ).toBeVisible({ timeout: 8000 });

    await expect(
      page.getByRole('radio', { name: /financials \(purchases\)/i }),
    ).toBeChecked({ timeout: 8000 });
  });
});
