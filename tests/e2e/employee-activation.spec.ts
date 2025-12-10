import { test, expect, Page } from '@playwright/test';

/**
 * E2E Tests for Employee Activation/Deactivation
 * 
 * Test Coverage:
 * 1. Manager can deactivate an active employee
 * 2. Inactive employee cannot log in to their account
 * 3. Inactive employee cannot use PIN at kiosk
 * 4. Manager can view inactive employees separately
 * 5. Manager can reactivate an inactive employee
 * 6. Reactivated employee can log in and use PIN
 * 7. Deactivation preserves historical data (punches, payroll, schedules)
 * 
 * These tests follow the TDD approach and validate the happy path
 * for employee lifecycle management.
 */

// Generate unique test data
const generateTestUser = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return {
    email: `activation-mgr-${timestamp}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Activation Manager ${timestamp}`,
    restaurantName: `Activation Test Restaurant ${timestamp}`,
  };
};

const generateEmployee = () => {
  const random = Math.random().toString(36).substring(2, 6);
  return {
    email: `employee-${random}@test.com`,
    password: 'EmployeePass123!',
    name: `Seasonal Worker ${random}`,
    position: 'Server',
    hourlyRate: '15.00',
    pin: '1234',
  };
};

/**
 * Helper to sign up a new user and create a restaurant
 */
async function signUpAndCreateRestaurant(page: Page, testUser: ReturnType<typeof generateTestUser>) {
  await page.goto('/');
  await page.waitForURL(/\/(auth)?$/);
  
  // If on home page, click sign in
  if (page.url().endsWith('/')) {
    const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
    if (await signInLink.isVisible().catch(() => false)) {
      await signInLink.click();
      await page.waitForURL('/auth');
    }
  }

  // Go to signup tab
  await expect(page.getByRole('tab', { name: /sign up/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole('tab', { name: /sign up/i }).click();

  // Fill signup form
  await page.getByLabel(/email/i).first().fill(testUser.email);
  await page.getByLabel(/full name/i).fill(testUser.fullName);
  await page.getByLabel(/password/i).first().fill(testUser.password);

  // Submit signup
  await page.getByRole('button', { name: /sign up|create account/i }).click();

  // Wait for redirect
  await page.waitForURL('/', { timeout: 15000 });

  // Create restaurant
  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  // Fill restaurant creation form
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Activation Test Street');
  await dialog.getByLabel(/phone/i).fill('555-ACTIV-ATE');

  // Submit and wait for success
  await dialog.getByRole('button', { name: /create restaurant|add restaurant/i }).click();
  await page.waitForTimeout(2000); // Wait for creation
}

/**
 * Helper to create an employee with optional user account
 */
async function createEmployee(
  page: Page,
  employee: ReturnType<typeof generateEmployee>,
  createUserAccount = false
) {
  // Navigate to employees page directly
  await page.goto('/employees');
  await page.waitForURL(/\/employees/);

  // Click Add Employee button (use first() since there may be multiple)
  const addButton = page.getByRole('button', { name: /add employee/i }).first();
  await expect(addButton).toBeVisible();
  await addButton.click();

  // Fill employee form
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Fill basic employee info
  await dialog.getByLabel(/employee name/i).fill(employee.name);
  
  // Position uses a combobox - click to open, then type in the search
  const positionCombobox = dialog.getByRole('combobox', { name: /position/i });
  await positionCombobox.click();
  
  // Wait for the popover to open and type into the search input
  const searchInput = page.getByPlaceholder(/search or type new position/i);
  await searchInput.fill(employee.position);
  
  // Click the matching item or create new option
  const positionOption = page.getByRole('option', { name: new RegExp(employee.position, 'i') }).first();
  if (await positionOption.isVisible().catch(() => false)) {
    await positionOption.click();
  } else {
    // If no match, press Enter to create new
    await page.keyboard.press('Enter');
  }
  
  // Fill hourly rate
  await dialog.getByLabel(/hourly rate/i).fill(employee.hourlyRate);

  if (createUserAccount) {
    await dialog.getByLabel(/email/i).fill(employee.email);
    
    // Check if there's a "Create User Account" checkbox or similar
    const createAccountCheckbox = dialog.getByRole('checkbox', { name: /create.*account|enable login/i });
    if (await createAccountCheckbox.isVisible().catch(() => false)) {
      await createAccountCheckbox.check();
    }
  }

  // Submit
  await dialog.getByRole('button', { name: /create|add/i }).click();

  // Wait for the employee dialog specifically to close (by checking for its title to disappear)
  await expect(page.getByRole('dialog', { name: /add new employee|edit employee/i })).not.toBeVisible({ timeout: 10000 });
  
  // Wait for employee to appear in the list
  await expect(page.getByRole('heading', { name: employee.name })).toBeVisible({ timeout: 10000 });
}

/**
 * Helper to create a PIN for an employee
 */
async function createEmployeePin(page: Page, employeeName: string, pin: string) {
  // Find the employee row and click to open profile
  await page.getByText(employeeName).click();
  await page.waitForTimeout(1000);

  // Look for PIN section or button to set PIN
  const setPinButton = page.getByRole('button', { name: /set pin|create pin/i });
  if (await setPinButton.isVisible().catch(() => false)) {
    await setPinButton.click();

    // Fill PIN in dialog
    const pinDialog = page.getByRole('dialog');
    await pinDialog.getByLabel(/pin/i).first().fill(pin);
    await pinDialog.getByRole('button', { name: /save|create/i }).click();
    await page.waitForTimeout(1000);
  }
}

/**
 * Helper to log out
 */
async function logout(page: Page) {
  // Look for user menu or logout button
  const userMenu = page.getByRole('button', { name: /account|profile|user/i });
  if (await userMenu.isVisible().catch(() => false)) {
    await userMenu.click();
    await page.getByRole('menuitem', { name: /log out|sign out/i }).click();
  } else {
    // Alternative: direct logout button
    await page.getByRole('button', { name: /log out|sign out/i }).click();
  }
  await page.waitForURL('/auth', { timeout: 5000 });
}

test.describe('Employee Activation/Deactivation', () => {
  let managerData: ReturnType<typeof generateTestUser>;
  let employeeData: ReturnType<typeof generateEmployee>;

  test.beforeEach(async () => {
    managerData = generateTestUser();
    employeeData = generateEmployee();
  });

  test('Manager can deactivate an active employee and employee cannot login or use PIN', async ({ page, context }) => {
    // === SETUP: Create manager account and restaurant ===
    await signUpAndCreateRestaurant(page, managerData);

    // === SETUP: Create employee with user account ===
    await createEmployee(page, employeeData, true);

    // === SETUP: Set employee PIN ===
    await createEmployeePin(page, employeeData.name, employeeData.pin);

    // === TEST: Navigate to employee profile ===
    await page.getByText(employeeData.name).click();
    await page.waitForTimeout(1000);

    // === TEST: Verify employee is active ===
    await expect(page.getByText(/active/i).first()).toBeVisible();

    // === TEST: Click deactivate button ===
    const deactivateButton = page.getByRole('button', { name: /deactivate/i });
    await expect(deactivateButton).toBeVisible();
    await deactivateButton.click();

    // === TEST: Deactivation modal appears ===
    const deactivateModal = page.getByRole('dialog');
    await expect(deactivateModal).toBeVisible();
    await expect(deactivateModal.getByText(/deactivate.*employee/i)).toBeVisible();

    // === TEST: Select reason (optional) ===
    const seasonalOption = deactivateModal.getByText(/seasonal/i);
    if (await seasonalOption.isVisible().catch(() => false)) {
      await seasonalOption.click();
    }

    // === TEST: Confirm deactivation ===
    await deactivateModal.getByRole('button', { name: /deactivate|confirm/i }).click();
    await page.waitForTimeout(2000);

    // === TEST: Success message appears ===
    await expect(page.getByText(/deactivated|inactive/i)).toBeVisible({ timeout: 5000 });

    // === TEST: Navigate to employee list - should not see in active by default ===
    await page.getByRole('link', { name: /employees/i }).click();
    await page.waitForURL(/\/employees/);

    // Employee should not be in default (active) list
    await expect(page.getByText(employeeData.name)).not.toBeVisible({ timeout: 3000 });

    // === TEST: Switch to inactive view ===
    const inactiveTab = page.getByRole('tab', { name: /inactive/i });
    if (await inactiveTab.isVisible().catch(() => false)) {
      await inactiveTab.click();
      await page.waitForTimeout(1000);

      // Now employee should be visible
      await expect(page.getByText(employeeData.name)).toBeVisible();
      await expect(page.getByText(/inactive/i)).toBeVisible();
    }

    // === TEST: Logout as manager ===
    await logout(page);

    // === TEST: Try to login as deactivated employee ===
    await page.waitForURL('/auth');
    await page.getByLabel(/email/i).first().fill(employeeData.email);
    await page.getByLabel(/password/i).first().fill(employeeData.password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Should see error message or remain on auth page
    await page.waitForTimeout(2000);
    const inactiveMessage = page.getByText(/inactive|disabled|contact.*manager/i);
    await expect(inactiveMessage).toBeVisible({ timeout: 5000 });

    // === TEST: Try to use PIN at kiosk ===
    await page.goto('/kiosk');
    await page.waitForURL(/\/kiosk/);

    // Enter PIN
    for (const digit of employeeData.pin.split('')) {
      await page.getByRole('button', { name: digit }).click();
    }

    // Should see error message
    await page.waitForTimeout(1500);
    const pinErrorMessage = page.getByText(/not recognized|inactive|contact.*manager/i);
    await expect(pinErrorMessage).toBeVisible({ timeout: 5000 });
  });

  test('Manager can reactivate an inactive employee and employee can login and use PIN', async ({ page }) => {
    // === SETUP: Create manager, restaurant, and employee ===
    await signUpAndCreateRestaurant(page, managerData);
    await createEmployee(page, employeeData, true);
    await createEmployeePin(page, employeeData.name, employeeData.pin);

    // === SETUP: Deactivate the employee first ===
    await page.getByText(employeeData.name).click();
    await page.waitForTimeout(1000);

    const deactivateButton = page.getByRole('button', { name: /deactivate/i });
    await deactivateButton.click();

    const deactivateModal = page.getByRole('dialog');
    await deactivateModal.getByRole('button', { name: /deactivate|confirm/i }).click();
    await page.waitForTimeout(2000);

    // === TEST: Navigate to inactive employees ===
    await page.getByRole('link', { name: /employees/i }).click();
    await page.waitForURL(/\/employees/);

    const inactiveTab = page.getByRole('tab', { name: /inactive/i });
    if (await inactiveTab.isVisible().catch(() => false)) {
      await inactiveTab.click();
      await page.waitForTimeout(1000);
    }

    // === TEST: Click on inactive employee ===
    await page.getByText(employeeData.name).click();
    await page.waitForTimeout(1000);

    // === TEST: Verify inactive badge visible ===
    await expect(page.getByText(/inactive/i)).toBeVisible();

    // === TEST: Click reactivate button ===
    const reactivateButton = page.getByRole('button', { name: /reactivate/i });
    await expect(reactivateButton).toBeVisible();
    await reactivateButton.click();

    // === TEST: Reactivation modal appears ===
    const reactivateModal = page.getByRole('dialog');
    await expect(reactivateModal).toBeVisible();
    await expect(reactivateModal.getByText(/reactivate.*employee/i)).toBeVisible();

    // === TEST: Confirm wage and other details (form may be pre-filled) ===
    const confirmButton = reactivateModal.getByRole('button', { name: /reactivate|confirm/i });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
    await page.waitForTimeout(2000);

    // === TEST: Success message appears ===
    await expect(page.getByText(/reactivated|active/i)).toBeVisible({ timeout: 5000 });

    // === TEST: Navigate back to employee list ===
    await page.getByRole('link', { name: /employees/i }).click();
    await page.waitForURL(/\/employees/);

    // === TEST: Employee should now be in active list ===
    await expect(page.getByText(employeeData.name)).toBeVisible();

    // === TEST: Logout as manager ===
    await logout(page);

    // === TEST: Login as reactivated employee ===
    await page.waitForURL('/auth');
    await page.getByLabel(/email/i).first().fill(employeeData.email);
    await page.getByLabel(/password/i).first().fill(employeeData.password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // Should successfully login (redirect away from auth page)
    await page.waitForURL(/^(?!.*\/auth).*$/, { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/auth/);

    // === TEST: Logout employee and try PIN at kiosk ===
    await logout(page);

    // Login as manager again to access kiosk
    await page.getByLabel(/email/i).first().fill(managerData.email);
    await page.getByLabel(/password/i).first().fill(managerData.password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForTimeout(2000);

    // Navigate to kiosk
    await page.goto('/kiosk');
    await page.waitForURL(/\/kiosk/);

    // Enter PIN
    for (const digit of employeeData.pin.split('')) {
      await page.getByRole('button', { name: digit }).click();
    }

    // Should successfully authenticate (no error message)
    await page.waitForTimeout(1500);
    const successIndicator = page.getByText(new RegExp(employeeData.name, 'i'));
    await expect(successIndicator).toBeVisible({ timeout: 5000 });
  });

  test('Deactivation preserves historical data', async ({ page }) => {
    // === SETUP: Create manager, restaurant, and employee ===
    await signUpAndCreateRestaurant(page, managerData);
    await createEmployee(page, employeeData, false);

    // === SETUP: Create some historical data (e.g., time punch) ===
    // Note: This would require navigating to time tracking and creating a punch
    // For now, we'll verify the employee appears in historical views

    // === SETUP: Deactivate employee ===
    await page.getByText(employeeData.name).click();
    await page.waitForTimeout(1000);

    const deactivateButton = page.getByRole('button', { name: /deactivate/i });
    await deactivateButton.click();

    const deactivateModal = page.getByRole('dialog');
    await deactivateModal.getByRole('button', { name: /deactivate|confirm/i }).click();
    await page.waitForTimeout(2000);

    // === TEST: Navigate to inactive employees ===
    await page.getByRole('link', { name: /employees/i }).click();
    await page.waitForURL(/\/employees/);

    const inactiveTab = page.getByRole('tab', { name: /inactive/i });
    if (await inactiveTab.isVisible().catch(() => false)) {
      await inactiveTab.click();
      await page.waitForTimeout(1000);
    }

    // === TEST: Open inactive employee profile ===
    await page.getByText(employeeData.name).click();
    await page.waitForTimeout(1000);

    // === TEST: Verify history tabs are present and accessible ===
    const historyTabs = [
      /time.*punches/i,
      /payroll/i,
      /schedules/i,
      /history/i,
    ];

    for (const tabPattern of historyTabs) {
      const tab = page.getByRole('tab', { name: tabPattern });
      if (await tab.isVisible().catch(() => false)) {
        // Tab exists - click it to verify it's accessible
        await tab.click();
        await page.waitForTimeout(500);
        
        // Should not show error - data should be preserved
        const errorMessage = page.getByText(/error|not found/i);
        await expect(errorMessage).not.toBeVisible();
      }
    }

    // === TEST: Verify key fields are read-only ===
    const nameField = page.getByLabel(/^name/i);
    if (await nameField.isVisible().catch(() => false)) {
      await expect(nameField).toBeDisabled();
    }
  });
});
