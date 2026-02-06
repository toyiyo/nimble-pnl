import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Basic Kiosk Functionality Test
 *
 * This test verifies the core kiosk UI renders and navigation works.
 * Full punch flow testing requires employee setup which is complex in E2E.
 *
 * Manual testing checklist documented in tests/e2e/KIOSK_TESTS_README.md
 */

test.describe('Kiosk - Basic UI', () => {
  test('should render kiosk mode with PIN pad', async ({ page }) => {
    const testUser = generateTestUser();

    await signUpAndCreateRestaurant(page, testUser);

    // Navigate to kiosk - launch from time punches page
    await page.goto('/time-punches');
    await page.waitForURL(/\/time-punches/, { timeout: 8000 });

    // Open Time Clock Settings
    const settingsButton = page.getByRole('button', { name: /time clock settings/i });
    await expect(settingsButton).toBeVisible({ timeout: 8000 });
    await settingsButton.click();

    // Click Launch button in the kiosk mode section
    const launchButton = page.getByRole('button', { name: /^launch$/i });
    await expect(launchButton).toBeVisible({ timeout: 5000 });
    await launchButton.click();

    // Wait for navigation to kiosk page
    await expect(page).toHaveURL(/\/kiosk/, { timeout: 10000 });

    // Verify kiosk UI renders
    await expect(page.getByRole('button', { name: /clock in/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /clock out/i })).toBeVisible({ timeout: 5000 });

    // Verify PIN pad digits exist - they're labeled as "Digit 0", "Digit 1", etc.
    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      await expect(page.getByRole('button', { name: `Digit ${digit}` })).toBeVisible({ timeout: 3000 });
    }
  });
});
