import { test, expect } from '@playwright/test';

/**
 * Basic Kiosk Functionality Test
 * 
 * This test verifies the core kiosk UI renders and navigation works.
 * Full punch flow testing requires employee setup which is complex in E2E.
 * 
 * Manual testing checklist documented in tests/e2e/KIOSK_TESTS_README.md
 */

const generateTestUser = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return {
    email: `kiosk-${timestamp}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Kiosk Test User ${timestamp}`,
    restaurantName: `Kiosk Test Restaurant ${timestamp}`,
  };
};

test.describe('Kiosk - Basic UI', () => {
  test('should render kiosk mode with PIN pad', async ({ page }) => {
    const testUser = generateTestUser();
    
    // Sign up and create restaurant
    await page.goto('/');
    await page.waitForURL(/\/(auth)?$/, { timeout: 5000 });
    
    if (page.url().endsWith('/')) {
      const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
      if (await signInLink.isVisible().catch(() => false)) {
        await signInLink.click();
        await page.waitForURL('/auth', { timeout: 5000 });
      }
    }

    await expect(page.getByRole('tab', { name: /sign up/i })).toBeVisible({ timeout: 5000 });
    await page.getByRole('tab', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).first().fill(testUser.email);
    await page.getByLabel(/full name/i).fill(testUser.fullName);
    await page.getByLabel(/password/i).first().fill(testUser.password);
    await page.getByRole('button', { name: /sign up|create account/i }).click();
    await page.waitForURL('/', { timeout: 10000 });

    const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
    await expect(addRestaurantButton).toBeVisible({ timeout: 5000 });
    await addRestaurantButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 2000 });
    await dialog.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
    await dialog.getByLabel(/address/i).fill('123 Test St');
    await dialog.getByLabel(/phone/i).fill('555-TEST-123');
    await dialog.getByRole('button', { name: /create|add/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Navigate to kiosk - launch from time punches page
    await page.goto('/time-punches');
    await page.waitForURL(/\/time-punches/, { timeout: 5000 });
    
    // Look for launch kiosk button
    const kioskButton = page.getByRole('button', { name: /launch kiosk|kiosk mode/i }).first();
    await expect(kioskButton).toBeVisible({ timeout: 5000 });
    await kioskButton.click();
    
    // Wait for success toast and navigation to kiosk page
    await page.waitForTimeout(2000); // Give time for toast and navigation
    await expect(page).toHaveURL(/\/kiosk/, { timeout: 5000 });

    // Verify kiosk UI renders
    await expect(page.getByRole('button', { name: /clock in/i })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /clock out/i })).toBeVisible({ timeout: 3000 });
    
    // Verify PIN pad digits exist - they're labeled as "Digit 0", "Digit 1", etc.
    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      await expect(page.getByRole('button', { name: `Digit ${digit}` })).toBeVisible();
    }
  });
});
