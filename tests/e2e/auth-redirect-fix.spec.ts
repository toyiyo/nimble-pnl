import { test, expect, Page } from '@playwright/test';
import { generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * E2E Test: Authentication Redirect Fix
 * 
 * Tests that user authentication doesn't create a redirect loop.
 * This was a bug where users with username/password auth were redirected
 * back to login after successful authentication.
 * 
 * Tests:
 * 1. New user signup redirects to dashboard (not back to auth)
 * 2. Existing user sign-in redirects to dashboard (not back to auth)
 * 3. Welcome modal appears for new users without existing subscription
 */

test.describe('Authentication Redirect Fix', () => {
  test('new user can sign up and reaches dashboard without redirect loop', async ({ page }) => {
    const testUser = generateTestUser('auth-redirect');

    // Start at auth page
    await page.goto('/auth');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForURL(/\/auth/);

    // Expose Supabase helpers
    await exposeSupabaseHelpers(page);

    // Switch to signup tab
    const signupTab = page.getByRole('tab', { name: /sign up/i });
    await expect(signupTab).toBeVisible({ timeout: 10000 });
    await signupTab.click();

    // Fill in signup form
    await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/email/i).first().fill(testUser.email);
    await page.getByLabel(/full name/i).fill(testUser.fullName);
    await page.getByLabel(/password/i).first().fill(testUser.password);
    
    // Submit signup
    await page.getByRole('button', { name: /sign up|create account/i }).click();
    
    // Should redirect to dashboard (/) and NOT back to /auth
    await page.waitForURL('/', { timeout: 15000 });
    
    // Verify we're on the dashboard by checking for welcome modal or restaurant selector
    const welcomeModal = page.getByRole('button', { name: /get started/i });
    const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
    
    // One of these should be visible (depending on welcome modal state)
    await expect(welcomeModal.or(addRestaurantButton)).toBeVisible({ timeout: 10000 });
    
    // Most importantly, verify we did NOT redirect back to auth
    expect(page.url()).not.toContain('/auth');
  });

  test('existing user can sign in and reaches dashboard', async ({ page }) => {
    // First, create a user and restaurant
    const testUser = generateTestUser('auth-existing');

    await page.goto('/auth');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForURL(/\/auth/);

    await exposeSupabaseHelpers(page);

    // Sign up
    const signupTab = page.getByRole('tab', { name: /sign up/i });
    await signupTab.click();
    await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/email/i).first().fill(testUser.email);
    await page.getByLabel(/full name/i).fill(testUser.fullName);
    await page.getByLabel(/password/i).first().fill(testUser.password);
    await page.getByRole('button', { name: /sign up|create account/i }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // Handle welcome modal if it appears
    try {
      await page.getByRole('button', { name: /get started/i }).click({ timeout: 3000 });
    } catch (e) {
      // Welcome modal might not show if user already has subscription
    }

    // Create a restaurant
    const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
    await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
    await addRestaurantButton.click();

    const dialog = page.getByRole('dialog').filter({ hasText: /add new restaurant/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
    await dialog.getByLabel(/address/i).fill('123 Main St');
    await dialog.getByLabel(/phone/i).fill('555-123-4567');
    await dialog.getByRole('button', { name: /create|add|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Now sign out
    const userMenuButton = page.getByRole('button', { name: /account/i }).or(
      page.locator('[aria-label*="user menu"]')
    ).or(
      page.locator('button').filter({ hasText: testUser.email })
    );
    
    // Wait a bit for the restaurant to be created
    await page.waitForTimeout(2000);
    
    // Try to find and click sign out - this is tricky, so we'll use navigation
    await page.goto('/auth');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();

    // Now sign in again
    await page.waitForURL(/\/auth/);
    const signinTab = page.getByRole('tab', { name: /sign in/i });
    if (await signinTab.isVisible()) {
      await signinTab.click();
    }
    
    await expect(page.getByLabel(/email/i).first()).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/email/i).first().fill(testUser.email);
    await page.getByLabel(/password/i).first().fill(testUser.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Should redirect to dashboard and NOT back to auth
    await page.waitForURL('/', { timeout: 15000 });
    
    // Verify we're on dashboard - should see restaurant name
    await expect(page.getByText(testUser.restaurantName).first()).toBeVisible({ timeout: 10000 });
    
    // Verify we did NOT redirect back to auth
    expect(page.url()).not.toContain('/auth');
  });

  test('welcome modal does not cause redirect loop', async ({ page }) => {
    const testUser = generateTestUser('auth-welcome');

    await page.goto('/auth');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForURL(/\/auth/);

    await exposeSupabaseHelpers(page);

    // Sign up
    const signupTab = page.getByRole('tab', { name: /sign up/i });
    await signupTab.click();
    await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/email/i).first().fill(testUser.email);
    await page.getByLabel(/full name/i).fill(testUser.fullName);
    await page.getByLabel(/password/i).first().fill(testUser.password);
    await page.getByRole('button', { name: /sign up|create account/i }).click();

    // Wait for redirect to complete
    await page.waitForURL('/', { timeout: 15000 });
    
    // Wait a bit to ensure no redirect loop happens
    await page.waitForTimeout(2000);
    
    // Verify we're still on the dashboard (not redirected to auth)
    expect(page.url()).toBe(`${page.url().split('?')[0]}`); // Clean URL without params
    expect(page.url()).not.toContain('/auth');
    
    // Welcome modal should be visible for new users
    const welcomeModal = page.getByRole('button', { name: /get started/i });
    await expect(welcomeModal).toBeVisible({ timeout: 5000 });
  });
});
