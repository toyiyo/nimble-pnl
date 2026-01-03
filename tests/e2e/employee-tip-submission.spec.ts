import { test, expect } from '@playwright/test';

/**
 * E2E Test: Employee Tip Submission via Clock-Out Flow
 * 
 * Tests the complete workflow of:
 * 1. Employee clocks out using kiosk mode
 * 2. Tip submission dialog appears
 * 3. Employee enters cash/credit tips
 * 4. Tips are submitted and stored in database
 * 5. Manager can view employee tips
 */

test.describe('Employee Tip Submission', () => {
  test.beforeEach(async ({ page }) => {
    // Login as manager to set up test data
    await page.goto('/login');
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'testpassword');
    await page.click('button[type="submit"]');
    
    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard');
    
    // Ensure we have a restaurant selected
    const hasRestaurant = await page.locator('[data-testid="restaurant-selector"]').count();
    if (hasRestaurant === 0) {
      // Create test restaurant if needed
      await page.goto('/restaurants');
      await page.click('button:has-text("Add Restaurant")');
      await page.fill('input[name="name"]', 'Test Restaurant');
      await page.click('button:has-text("Create")');
      await page.waitForURL('**/restaurants');
    }
  });

  test('should show tip dialog after clock-out', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // Wait for kiosk interface to load
    await expect(page.locator('h1:has-text("Time Clock")')).toBeVisible();
    
    // Enter employee PIN (assuming employee with PIN 1234 exists and is clocked in)
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    
    // Tip dialog should appear
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('text=/Enter.*Tips/i')).toBeVisible();
    
    // Dialog should have cash and credit inputs
    await expect(page.locator('label:has-text("Cash Tips")')).toBeVisible();
    await expect(page.locator('label:has-text("Credit Tips")')).toBeVisible();
  });

  test('should submit cash and credit tips successfully', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // Clock out
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    
    // Wait for tip dialog
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Enter cash tips ($45.50)
    const cashInput = page.locator('input[placeholder*="cash" i]').first();
    await cashInput.fill('45.50');
    
    // Enter credit tips ($62.75)
    const creditInput = page.locator('input[placeholder*="credit" i]').first();
    await creditInput.fill('62.75');
    
    // Verify total is calculated correctly ($108.25)
    await expect(page.locator('text=/Total.*\\$108\\.25/i')).toBeVisible();
    
    // Submit tips
    await page.click('button:has-text("Submit Tips")');
    
    // Dialog should close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    
    // Success toast should appear
    await expect(page.locator('text=/tips.*submitted/i')).toBeVisible();
  });

  test('should allow skipping tip submission', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // Clock out
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    
    // Wait for tip dialog
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Click skip button
    await page.click('button:has-text("Skip")');
    
    // Dialog should close without error
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    
    // No error toast should appear
    await expect(page.locator('[role="alert"]')).not.toBeVisible();
  });

  test('should validate non-negative tip amounts', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // Clock out
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    
    // Wait for tip dialog
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Try to enter negative cash tips
    const cashInput = page.locator('input[placeholder*="cash" i]').first();
    await cashInput.fill('-10');
    
    // Submit button should be disabled or show error
    const submitButton = page.locator('button:has-text("Submit Tips")');
    await expect(submitButton).toBeDisabled();
  });

  test('should accept zero tips', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // Clock out
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    
    // Wait for tip dialog
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Enter zero for both (or leave empty)
    const cashInput = page.locator('input[placeholder*="cash" i]').first();
    const creditInput = page.locator('input[placeholder*="credit" i]').first();
    await cashInput.fill('0');
    await creditInput.fill('0');
    
    // Total should show $0.00
    await expect(page.locator('text=/Total.*\\$0\\.00/i')).toBeVisible();
    
    // Submit button should be enabled
    const submitButton = page.locator('button:has-text("Submit Tips")');
    await expect(submitButton).not.toBeDisabled();
    
    // Submit zero tips
    await submitButton.click();
    
    // Dialog should close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('should handle multiple tip submissions same day', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // First submission
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    const cashInput1 = page.locator('input[placeholder*="cash" i]').first();
    await cashInput1.fill('25.00');
    await page.click('button:has-text("Submit Tips")');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    
    // Clock in again (for second shift)
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock In")');
    
    // Wait a moment
    await page.waitForTimeout(1000);
    
    // Clock out again
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Second submission
    const cashInput2 = page.locator('input[placeholder*="cash" i]').first();
    await cashInput2.fill('35.00');
    await page.click('button:has-text("Submit Tips")');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
    
    // Both should be recorded (verify in employee tips page)
    await page.goto('/employee-tips');
    
    // Should see both submissions
    await expect(page.locator('text=/\\$25\\.00/i')).toBeVisible();
    await expect(page.locator('text=/\\$35\\.00/i')).toBeVisible();
  });

  test('should show loading state during submission', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // Clock out
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    
    // Wait for tip dialog
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Enter tips
    const cashInput = page.locator('input[placeholder*="cash" i]').first();
    await cashInput.fill('50.00');
    
    // Click submit and immediately check for loading state
    const submitButton = page.locator('button:has-text("Submit Tips")');
    await submitButton.click();
    
    // Should see loading indicator (spinner or disabled button)
    // Note: This may be fast in tests, so we check for either loading or success
    const loadingOrSuccess = page.locator('button:has-text("Submitting..."), button:has-text("Submit Tips"):disabled, text=/tips.*submitted/i');
    await expect(loadingOrSuccess.first()).toBeVisible({ timeout: 2000 });
  });

  test('manager should see employee tips in manager view', async ({ page }) => {
    // First, employee submits tips
    await page.goto('/kiosk');
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    const cashInput = page.locator('input[placeholder*="cash" i]').first();
    const creditInput = page.locator('input[placeholder*="credit" i]').first();
    await cashInput.fill('40.00');
    await creditInput.fill('60.00');
    await page.click('button:has-text("Submit Tips")');
    
    // Now navigate to manager tips view
    await page.goto('/tips');
    
    // Should see employee tip data
    await expect(page.locator('text=/Employee/i')).toBeVisible();
    await expect(page.locator('text=/\\$100\\.00/i')).toBeVisible(); // Total
  });

  test('should handle submission errors gracefully', async ({ page }) => {
    // Navigate to kiosk mode
    await page.goto('/kiosk');
    
    // Clock out
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    
    // Wait for tip dialog
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Simulate network failure by going offline
    await page.context().setOffline(true);
    
    // Enter tips
    const cashInput = page.locator('input[placeholder*="cash" i]').first();
    await cashInput.fill('50.00');
    
    // Try to submit
    await page.click('button:has-text("Submit Tips")');
    
    // Should show error toast
    await expect(page.locator('text=/error/i, text=/failed/i')).toBeVisible({ timeout: 5000 });
    
    // Dialog should remain open
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    // Go back online
    await page.context().setOffline(false);
  });

  test('should calculate total correctly for various amounts', async ({ page }) => {
    await page.goto('/kiosk');
    await page.fill('input[type="password"]', '1234');
    await page.click('button:has-text("Clock Out")');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    
    const cashInput = page.locator('input[placeholder*="cash" i]').first();
    const creditInput = page.locator('input[placeholder*="credit" i]').first();
    
    // Test case 1: Cash only
    await cashInput.fill('123.45');
    await creditInput.fill('0');
    await expect(page.locator('text=/Total.*\\$123\\.45/i')).toBeVisible();
    
    // Test case 2: Credit only
    await cashInput.fill('0');
    await creditInput.fill('67.89');
    await expect(page.locator('text=/Total.*\\$67\\.89/i')).toBeVisible();
    
    // Test case 3: Both
    await cashInput.fill('100.50');
    await creditInput.fill('200.75');
    await expect(page.locator('text=/Total.*\\$301\\.25/i')).toBeVisible();
    
    // Test case 4: Decimal precision
    await cashInput.fill('12.99');
    await creditInput.fill('5.01');
    await expect(page.locator('text=/Total.*\\$18\\.00/i')).toBeVisible();
  });
});
