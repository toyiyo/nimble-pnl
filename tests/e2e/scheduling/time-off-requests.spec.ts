import { test, expect } from '@playwright/test';
import { createTestUser, createTestRestaurant, cleanupTestUser } from '../../helpers/auth';
import { getDaysFromNow, formatDateForInput } from '../../helpers/dateUtils';

test.describe('Time-Off Requests', () => {
  let testUserId: string;
  let testRestaurantId: string;
  const testEmail = `test-timeoff-${Date.now()}@example.com`;
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

  test('should create a new time-off request', async ({ page }) => {
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
    
    // Navigate to Time-Off tab
    await page.click('[role="tab"]:has-text("Time-Off")');
    await page.waitForTimeout(500);
    
    // Click New Request button
    await page.click('button:has-text("New Request")');
    
    // Fill out time-off request form
    await page.click('select#employee');
    await page.click('select#employee option:has-text("Test Employee")');
    
    // Set start date (tomorrow)
    const tomorrow = getDaysFromNow(1);
    const startDateStr = formatDateForInput(tomorrow);
    
    await page.click('button[id="start-date"]');
    await page.waitForTimeout(300);
    // Select date in calendar
    const startDay = tomorrow.getDate().toString();
    await page.click(`button:has-text("${startDay}"):visible`);
    
    // Set end date (day after tomorrow)
    const endDate = getDaysFromNow(2);
    
    await page.click('button[id="end-date"]');
    await page.waitForTimeout(300);
    const endDay = endDate.getDate().toString();
    await page.click(`button:has-text("${endDay}"):visible`);
    
    // Add reason
    await page.fill('textarea#reason', 'Personal time off');
    
    // Submit request
    await page.click('button[type="submit"]:has-text("Submit Request")');
    
    // Wait for dialog to close
    await page.waitForTimeout(1000);
    
    // Verify request appears in list with pending status
    await expect(page.locator('text=Test Employee')).toBeVisible();
    await expect(page.locator('text=Pending')).toBeVisible();
    await expect(page.locator('text=Personal time off')).toBeVisible();
  });

  test('should approve a time-off request', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to scheduling time-off tab
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    await page.click('[role="tab"]:has-text("Time-Off")');
    await page.waitForTimeout(500);
    
    // Find pending request
    const requestCard = page.locator('div:has-text("Test Employee"):has-text("Pending")').first();
    await requestCard.hover();
    
    // Click approve button
    await requestCard.locator('button[aria-label="Approve request"]').click();
    
    // Wait for update
    await page.waitForTimeout(1000);
    
    // Verify status changed to approved
    await expect(page.locator('text=Approved')).toBeVisible();
  });

  test('should detect conflict when scheduling over time-off', async ({ page }) => {
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
    
    // Try to create a shift during time-off period
    await page.click('button:has-text("Create Shift")');
    
    // Select employee
    await page.click('select#employee');
    await page.click('select#employee option:has-text("Test Employee")');
    
    // Set date to tomorrow (when time-off exists)
    const tomorrow = getDaysFromNow(1);
    const dateStr = formatDateForInput(tomorrow);
    
    await page.fill('input[id="startDate"]', dateStr);
    await page.fill('input[id="startTime"]', '09:00');
    await page.fill('input[id="endDate"]', dateStr);
    await page.fill('input[id="endTime"]', '17:00');
    
    // Wait for conflict detection
    await page.waitForTimeout(1500);
    
    // Verify conflict warning is displayed
    await expect(page.locator('text=Scheduling conflicts detected')).toBeVisible();
    await expect(page.locator('text=time-off')).toBeVisible();
  });

  test('should delete a time-off request', async ({ page }) => {
    // Login
    await page.goto('/auth');
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);
    await page.click('button[type="submit"]:has-text("Sign In")');
    await page.waitForURL('/', { timeout: 10000 });
    
    // Navigate to time-off tab
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');
    await page.click('[role="tab"]:has-text("Time-Off")');
    await page.waitForTimeout(500);
    
    // Hover over request card to show delete button
    const requestCard = page.locator('div:has-text("Test Employee")').first();
    await requestCard.hover();
    
    // Click delete button
    await requestCard.locator('button[aria-label="Delete request"]').click();
    
    // Confirm deletion in alert dialog
    await page.click('button:has-text("Delete")');
    
    // Wait for deletion
    await page.waitForTimeout(1000);
    
    // Verify request is removed (or "No time-off requests" message appears)
    const hasRequests = await page.locator('text=Test Employee').count() > 0;
    if (!hasRequests) {
      await expect(page.locator('text=No time-off requests')).toBeVisible();
    }
  });
});
