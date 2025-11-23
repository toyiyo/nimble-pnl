import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getNextDayOfWeek, formatDateForInput, getDaysFromNow } from '../../helpers/dateUtils';

test.describe('Employee Availability', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-availability-${Date.now()}@example.com`;
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

  test('should set recurring weekly availability', async ({ page }) => {
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
    
    // Add an employee first if not exists
    const employeeExists = await page.locator('text=Test Employee').count() > 0;
    
    if (!employeeExists) {
      await page.click('button:has-text("Add Employee")');
      await page.fill('input[id="name"]', 'Test Employee');
      await page.fill('input[id="hourlyRate"]', '15.00');
      await page.click('[role="combobox"]');
      await page.click('[role="option"]:has-text("Server")');
      await page.click('button[type="submit"]:has-text("Add Employee")');
      await page.waitForTimeout(1000);
    }
    
    // Navigate to Availability tab
    await page.click('[role="tab"]:has-text("Availability")');
    await page.waitForTimeout(500);
    
    // Click Set Availability button
    await page.click('button:has-text("Set Availability")');
    
    // Select employee
    await page.getByRole('combobox', { name: /employee/i }).click();
    await page.getByRole('option', { name: /Test Employee/i }).click();
    
    // Select day of week (Monday)
    await page.getByRole('combobox', { name: /day of week/i }).click();
    await page.getByRole('option', { name: /Monday/i }).click();
    
    // Ensure is available toggle is on
    const availableToggle = page.locator('button[id="is-available"]');
    const isChecked = await availableToggle.getAttribute('data-state');
    if (isChecked !== 'checked') {
      await availableToggle.click();
    }
    
    // Set time range
    await page.fill('input[id="start-time"]', '09:00');
    await page.fill('input[id="end-time"]', '17:00');
    
    // Add notes
    await page.fill('textarea#notes', 'Regular weekday availability');
    
    // Submit
    await page.click('button[type="submit"]:has-text("Save")');
    
    // Wait for dialog to close
    await page.waitForTimeout(1000);
    
    // Verify success message (toast)
    await expect(page.locator('text=Availability saved')).toBeVisible();
  });

  test('should create an availability exception', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to availability tab
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    await page.click('[role="tab"]:has-text("Availability")');
    await page.waitForTimeout(500);
    
    // Click Add Exception button
    await page.click('button:has-text("Add Exception")');
    
    // Select employee
    await page.getByRole('combobox', { name: /employee/i }).click();
    await page.getByRole('option', { name: /Test Employee/i }).click();
    
    // Select date (3 days from now)
    const exceptionDate = new Date();
    exceptionDate.setDate(exceptionDate.getDate() + 3);
    
    await page.click('button[id="date"]');
    await page.waitForTimeout(300);
    const day = exceptionDate.getDate().toString();
    await page.click(`button:has-text("${day}"):visible`);
    
    // Leave available toggle off (marking as unavailable for that date)
    // Add reason
    await page.fill('textarea#reason', 'Doctor appointment');
    
    // Submit
    await page.click('button[type="submit"]:has-text("Save")');
    
    // Wait for dialog to close
    await page.waitForTimeout(1000);
    
    // Verify success message
    await expect(page.locator('text=Exception saved')).toBeVisible();
  });

  test('should detect availability conflict when scheduling', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    await page.click('[role="tab"]:has-text("Schedule")');
    
    // Try to create a shift outside availability window
    await page.click('button:has-text("Create Shift")');
    
    // Select employee
    await page.getByRole('combobox', { name: /employee/i }).click();
    await page.getByRole('option', { name: /Test Employee/i }).click();
    
    // Select Monday (when we set 9-5 availability)
    // But schedule for 6am-2pm (outside typical hours)
    const nextMonday = getNextDayOfWeek(1); // Monday = 1
    const dateStr = formatDateForInput(nextMonday);
    
    await page.fill('input[id="startDate"]', dateStr);
    await page.fill('input[id="startTime"]', '06:00');
    await page.fill('input[id="endDate"]', dateStr);
    await page.fill('input[id="endTime"]', '14:00');
    
    // Wait for conflict detection
    await page.waitForTimeout(1500);
    
    // Verify availability warning is displayed
    await expect(page.locator('text=Scheduling conflicts detected')).toBeVisible();
    await expect(page.locator('text=availability')).toBeVisible();
  });

  test('should warn when scheduling on exception date', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to scheduling
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    await page.click('[role="tab"]:has-text("Schedule")');
    
    // Try to create a shift on exception date (3 days from now)
    await page.click('button:has-text("Create Shift")');
    
    // Select employee
    await page.getByRole('combobox', { name: /employee/i }).click();
    await page.getByRole('option', { name: /Test Employee/i }).click();
    
    // Select exception date
    const exceptionDate = new Date();
    exceptionDate.setDate(exceptionDate.getDate() + 3);
    const dateStr = exceptionDate.toISOString().split('T')[0];
    
    await page.fill('input[id="startDate"]', dateStr);
    await page.fill('input[id="startTime"]', '09:00');
    await page.fill('input[id="endDate"]', dateStr);
    await page.fill('input[id="endTime"]', '17:00');
    
    // Wait for conflict detection
    await page.waitForTimeout(1500);
    
    // Verify exception warning is displayed
    await expect(page.locator('text=Scheduling conflicts detected')).toBeVisible();
    await expect(page.locator('text=unavailable')).toBeVisible();
  });
});
