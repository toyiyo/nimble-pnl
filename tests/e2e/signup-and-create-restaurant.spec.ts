import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant } from '../helpers/e2e-supabase';

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

test.describe('Signup and Create Restaurant Flow', () => {
  test('new user can sign up and create their first restaurant', async ({ page }) => {
    const testUser = generateTestUser('signup');

    // Use shared helper that handles welcome modal, onboarding drawer, and sets Pro plan
    await signUpAndCreateRestaurant(page, testUser);

    // Verify restaurant is visible in the main content area (dashboard)
    const mainContent = page.getByRole('main');
    await expect(mainContent.getByText(testUser.restaurantName).first()).toBeVisible({ timeout: 10000 });

    // Confirm dashboard is usable (main container present)
    const dashboardContent = page.locator('main, [role=\"main\"], .dashboard, .content');
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
