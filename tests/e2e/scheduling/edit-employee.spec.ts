import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';

test.describe('Scheduling - Edit Employee', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-edit-employee-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    // Setup test user and restaurant
    const user = await createTestUser(testEmail, testPassword, 'Test User');
    testUserId = user.id;
    testRestaurantId = await createTestRestaurant(testUserId, 'Test Restaurant');
  });

  test.afterAll(async () => {
    // Cleanup
    await cleanupTestUser(testUserId);
  });

  test('should show edit button on employee row hover', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    
    // Wait for navigation to dashboard
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    
    // Add an employee first
    await page.click('button:has-text("Add Employee")');
    
    // Fill employee form
    await page.fill('input[id="name"]', 'Test Employee');
    await page.fill('input[id="hourlyRate"]', '15.00');
    
    // Select position (using the PositionCombobox)
    await page.click('[role="combobox"]');
    await page.click('[role="option"]:has-text("Server")');
    
    // Submit form
    await page.click('button[type="submit"]:has-text("Add Employee")');
    
    // Wait for dialog to close and employee to appear
    await page.waitForTimeout(1000);
    
    // Find the employee row
    const employeeRow = page.locator('tr:has-text("Test Employee")');
    await expect(employeeRow).toBeVisible();
    
    // Edit button should not be visible initially
    const editButton = employeeRow.locator('button[aria-label*="Edit"]');
    await expect(editButton).toHaveCSS('opacity', '0');
    
    // Hover over employee row
    await employeeRow.hover();
    
    // Edit button should become visible after hover
    await expect(editButton).toHaveCSS('opacity', '1');
  });

  test('should open employee dialog when edit button is clicked', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    
    // Check if employee already exists, if not add one
    const employeeExists = await page.locator('text=Test Employee').count() > 0;
    
    if (!employeeExists) {
      // Add an employee
      await page.click('button:has-text("Add Employee")');
      await page.fill('input[id="name"]', 'Test Employee');
      await page.fill('input[id="hourlyRate"]', '15.00');
      await page.click('[role="combobox"]');
      await page.click('[role="option"]:has-text("Server")');
      await page.click('button[type="submit"]:has-text("Add Employee")');
      await page.waitForTimeout(1000);
    }
    
    // Find and hover over employee row
    const employeeRow = page.locator('tr:has-text("Test Employee")');
    await employeeRow.hover();
    
    // Click edit button
    const editButton = employeeRow.locator('button[aria-label*="Edit"]');
    await editButton.click();
    
    // Verify dialog opened with "Edit Employee" title
    await expect(page.locator('text=Edit Employee')).toBeVisible();
    
    // Verify employee data is pre-filled
    await expect(page.locator('input[id="name"]')).toHaveValue('Test Employee');
    await expect(page.locator('input[id="hourlyRate"]')).toHaveValue('15.00');
  });

  test('should allow updating employee information', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    
    // Check if employee exists
    const employeeExists = await page.locator('text=Test Employee').count() > 0;
    
    if (!employeeExists) {
      // Add an employee
      await page.click('button:has-text("Add Employee")');
      await page.fill('input[id="name"]', 'Test Employee');
      await page.fill('input[id="hourlyRate"]', '15.00');
      await page.click('[role="combobox"]');
      await page.click('[role="option"]:has-text("Server")');
      await page.click('button[type="submit"]:has-text("Add Employee")');
      await page.waitForTimeout(1000);
    }
    
    // Find and click edit button
    const employeeRow = page.locator('tr:has-text("Test Employee")');
    await employeeRow.hover();
    await employeeRow.locator('button[aria-label*="Edit"]').click();
    
    // Update hourly rate
    await page.fill('input[id="hourlyRate"]', '16.50');
    
    // Update position
    await page.click('[role="combobox"]');
    await page.click('[role="option"]:has-text("Bartender")');
    
    // Submit update
    await page.click('button[type="submit"]:has-text("Update Employee")');
    
    // Wait for dialog to close
    await page.waitForTimeout(1000);
    
    // Verify the employee row shows updated position
    await expect(page.locator('tr:has-text("Test Employee"):has-text("Bartender")')).toBeVisible();
    
    // Verify update persisted by reopening dialog
    await employeeRow.hover();
    await employeeRow.locator('button[aria-label*="Edit"]').click();
    await expect(page.locator('input[id="hourlyRate"]')).toHaveValue('16.50');
  });
});
