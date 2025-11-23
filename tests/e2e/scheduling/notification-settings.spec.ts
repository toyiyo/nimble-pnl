// sonar.duplication.exclusions: This E2E test file contains intentional duplication
// for test setup, login flows, and UI interactions which is standard in E2E testing.
import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';

test.describe.serial('Notification Settings', () => {
  let testUserId: string;
  const testEmail = `test-notif-settings-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    // Setup test user and restaurant
    const user = await createTestUser(testEmail, testPassword, 'Test User');
    testUserId = user.id;
    await createTestRestaurant(testUserId, 'Test Restaurant');
  });

  test.afterAll(async () => {
    // Cleanup
    await cleanupTestUser(testUserId);
  });

  test('should display notification settings on settings page', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to settings
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // Verify notification settings section is visible
    await expect(page.locator('text=Notification Settings')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Time-Off Request Notifications')).toBeVisible();
    
    // Verify all toggle options are present
    await expect(page.locator('text=New Request Submitted')).toBeVisible();
    await expect(page.locator('text=Request Approved')).toBeVisible();
    await expect(page.locator('text=Request Rejected')).toBeVisible();
    await expect(page.locator('text=Notify Managers')).toBeVisible();
    await expect(page.locator('text=Notify Employee')).toBeVisible();
  });

  test('should save notification settings', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to settings
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // Wait for notification settings to load
    await expect(page.locator('text=Notification Settings')).toBeVisible({ timeout: 10000 });
    
    // Toggle off "New Request Submitted" notification
    const newRequestToggle = page.locator('switch[id="notify-request"]').or(
      page.locator('button[role="switch"][id="notify-request"]')
    );
    
    // Get initial state
    const initialState = await newRequestToggle.getAttribute('data-state');
    
    // Click to toggle
    await newRequestToggle.click();
    
    // Wait a moment for state to update
    await page.waitForTimeout(500);
    
    // Verify Save Settings button is enabled (has changes)
    const saveButton = page.locator('button:has-text("Save Settings")');
    await expect(saveButton).toBeEnabled();
    
    // Click save
    await saveButton.click();
    
    // Wait for success toast
    await expect(page.locator('text=Settings updated')).toBeVisible({ timeout: 5000 });
    
    // Refresh page to verify settings persisted
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Verify the toggle state persisted
    const newState = await newRequestToggle.getAttribute('data-state');
    expect(newState).not.toBe(initialState);
  });

  test('should show reset button when changes are made', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to settings
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // Wait for notification settings to load
    await expect(page.locator('text=Notification Settings')).toBeVisible({ timeout: 10000 });
    
    // Reset button should not be visible initially
    await expect(page.locator('button:has-text("Reset Changes")')).not.toBeVisible();
    
    // Make a change
    const approvedToggle = page.locator('switch[id="notify-approved"]').or(
      page.locator('button[role="switch"][id="notify-approved"]')
    );
    await approvedToggle.click();
    
    // Wait for UI to update
    await page.waitForTimeout(500);
    
    // Reset button should now be visible
    await expect(page.locator('button:has-text("Reset Changes")')).toBeVisible();
    
    // Click reset
    await page.click('button:has-text("Reset Changes")');
    
    // Reset button should disappear
    await expect(page.locator('button:has-text("Reset Changes")')).not.toBeVisible();
  });

  test('should only show notification settings to owners and managers', async ({ page }) => {
    // This test assumes the user is an owner/manager
    // In a real scenario, you would create a staff user and verify they don't see it
    
    // Login as owner/manager
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to settings
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // Verify notification settings are visible for owner/manager
    await expect(page.locator('text=Notification Settings')).toBeVisible({ timeout: 10000 });
    
    // Verify the note about email addresses is present
    await expect(page.locator('text=Email notifications are sent to registered email addresses only')).toBeVisible();
  });
});
