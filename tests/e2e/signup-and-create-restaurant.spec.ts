import { test, expect } from '@playwright/test';

/**
 * E2E Test: User Signup and Restaurant Creation Flow
 * 
 * Tests the critical path for new users:
 * 1. Navigate to auth page
 * 2. Sign up with email/password
 * 3. Verify email (auto-confirmed in local Supabase)
 * 4. Create first restaurant
 * 5. Verify restaurant appears in dashboard
 * 
 * Works with:
 * - Local Supabase (email auto-confirmed)
 * - CI with Supabase branching (email auto-confirmed in test mode)
 */

// Generate unique test data to avoid conflicts
const generateTestUser = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return {
    email: `test-${timestamp}-${random}@example.com`,
    password: 'TestPassword123!',
    fullName: `Test User ${timestamp}`,
    restaurantName: `Test Restaurant ${timestamp}`,
  };
};

test.describe('Signup and Create Restaurant Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state
    await page.context().clearCookies();
    await page.goto('/');
  });

  test('new user can sign up and create their first restaurant', async ({ page }) => {
    const testUser = generateTestUser();

    // Step 1: Navigate to auth page
    // Should redirect to /auth if not logged in
    await page.waitForURL(/\/(auth)?$/);
    
    // If on home page, click sign in (if there's a button)
    if (page.url().endsWith('/')) {
      const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
      if (await signInLink.isVisible()) {
        await signInLink.click();
        await page.waitForURL('/auth');
      }
    }

    // Step 2: Go to signup tab
    await expect(page.getByRole('tab', { name: /sign up/i })).toBeVisible();
    await page.getByRole('tab', { name: /sign up/i }).click();

    // Step 3: Fill signup form
    await page.getByLabel(/email/i).first().fill(testUser.email);
    await page.getByLabel(/full name/i).fill(testUser.fullName);
    await page.getByLabel(/password/i).first().fill(testUser.password);

    // Step 4: Submit signup
    await page.getByRole('button', { name: /sign up|create account/i }).click();

    // Step 5: Wait for redirect (local Supabase auto-confirms email)
    // Should redirect to home/dashboard after successful signup
    await page.waitForURL('/', { timeout: 10000 });

    // Step 6: Verify we're on the main app (should show restaurant selector or empty state)
    // For a new user with no restaurants, should see the "Add Restaurant" button
    await expect(page.getByRole('button', { name: /add restaurant/i })).toBeVisible({ timeout: 10000 });

    // Step 7: Click to add restaurant
    await page.getByRole('button', { name: /add restaurant/i }).click();

    // Step 8: Fill restaurant creation form
    const dialog = page.getByRole('dialog', { name: /add new restaurant/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
    await dialog.getByLabel(/address/i).fill('123 Test Street');
    await dialog.getByLabel(/phone/i).fill('555-123-4567');

    // Select cuisine type (first combobox with "Select cuisine type" placeholder)
    const cuisineSelect = dialog.getByRole('combobox').filter({ hasText: /select cuisine type/i });
    if (await cuisineSelect.isVisible()) {
      await cuisineSelect.click();
      await page.getByRole('option', { name: /american/i }).click();
    }

    // Step 9: Submit restaurant creation
    await dialog.getByRole('button', { name: /create|add|save/i }).click();

    // Step 10: Verify restaurant was created
    // Dialog should close and restaurant should be selected
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

  // Restaurant name should appear in the main content area (dashboard)
    const mainContent = page.getByRole('main');
    await expect(mainContent.getByText(testUser.restaurantName).first()).toBeVisible({ timeout: 5000 });

    // Step 11: Verify we can access restaurant features
    // Should no longer see "Add Restaurant" as primary action (restaurant is selected)
    const dashboardContent = page.locator('main, [role="main"], .dashboard, .content');
    await expect(dashboardContent).toBeVisible();
  });

  test('user can sign in with existing account', async ({ page }) => {
    // This test uses credentials that should exist in seed data or be created by a setup
    // For now, skip if no seed user exists
    test.skip(true, 'Requires seed user - will be enabled when seed data is added');
  });
});

test.describe('Restaurant Selection', () => {
  test.skip('user with multiple restaurants can switch between them', async ({ page }) => {
    // This test requires a user with multiple restaurants
    // Will be implemented when fixture data is available
  });
});
