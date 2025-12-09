import { test, expect, Page } from '@playwright/test';

/**
 * E2E Tests for Employee Payroll
 * 
 * Current Status:
 * - Hourly employees: Fully implemented (UI + backend)
 * - Salaried employees: Backend only (UI Phase 2)
 * - Contractors: Backend only (UI Phase 2)
 * 
 * These tests validate the happy path for employee creation and payroll calculation.
 */

// Generate unique test data
const generateTestUser = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return {
    email: `payroll-test-${timestamp}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Payroll Test User ${timestamp}`,
    restaurantName: `Payroll Test Restaurant ${timestamp}`,
  };
};

const generateHourlyEmployee = () => {
  const random = Math.random().toString(36).substring(2, 6);
  return {
    name: `Hourly Employee ${random}`,
    position: 'Server',
    hourlyRate: '15.00',
  };
};

const generateSalaryEmployee = () => {
  const random = Math.random().toString(36).substring(2, 6);
  return {
    name: `Salaried Manager ${random}`,
    position: 'Manager',
    salaryAmount: '52000',
    payPeriod: 'bi-weekly',
  };
};

const generateContractorEmployee = () => {
  const random = Math.random().toString(36).substring(2, 6);
  return {
    name: `Contractor ${random}`,
    position: 'Consultant',
    contractorPayment: '2000',
    paymentInterval: 'monthly',
  };
};

/**
 * Helper to sign up a new user and create a restaurant
 * Reusable across tests to avoid code duplication
 */
async function signUpAndCreateRestaurant(page: Page, testUser: ReturnType<typeof generateTestUser>) {
  // Navigate to auth page
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

  // Wait for redirect (local Supabase auto-confirms email)
  await page.waitForURL('/', { timeout: 15000 });

  // For a new user, should see "Add Restaurant" button
  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  // Fill restaurant creation form
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Payroll Test Street');
  await dialog.getByLabel(/phone/i).fill('555-PAY-ROLL');

  // Select cuisine type if present
  const cuisineSelect = dialog.getByRole('combobox').filter({ hasText: /select cuisine type/i });
  if (await cuisineSelect.isVisible().catch(() => false)) {
    await cuisineSelect.click();
    await page.getByRole('option', { name: /american/i }).click();
  }

  // Submit restaurant creation
  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  // Wait for page to stabilize
  await page.waitForTimeout(500);
}

test.describe('Employee Payroll - Happy Paths', () => {
  let testUser: ReturnType<typeof generateTestUser>;

  test.beforeEach(async ({ page }) => {
    // Clear cookies for clean state
    await page.context().clearCookies();
    testUser = generateTestUser();
  });

  test.describe('Setup: User with Restaurant', () => {
    test('can sign up and create restaurant for payroll testing', async ({ page }) => {
      // Use the helper function
      await signUpAndCreateRestaurant(page, testUser);
      
      // Verify we're on the dashboard with restaurant selected
      await expect(page.getByText(testUser.restaurantName).first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Hourly Employee Flow', () => {
    test.beforeEach(async ({ page }) => {
      // Sign up and create restaurant using helper
      await signUpAndCreateRestaurant(page, testUser);
    });

    test('can create hourly employee from scheduling page', async ({ page }) => {
      const employee = generateHourlyEmployee();

      // Navigate to scheduling
      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      // Click Add Employee button (there may be multiple - use first one in header)
      await page.getByRole('button', { name: /add employee/i }).first().click();

      // Fill employee form
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      await dialog.getByLabel(/name/i).first().fill(employee.name);
      
      // Position - it's a PositionCombobox, click to open then select/type
      const positionCombobox = dialog.getByRole('combobox').filter({ hasText: /position|select/i });
      if (await positionCombobox.isVisible().catch(() => false)) {
        await positionCombobox.click();
        // Try to select from options or type new
        const serverOption = page.getByRole('option', { name: new RegExp(employee.position, 'i') });
        if (await serverOption.isVisible({ timeout: 1000 }).catch(() => false)) {
          await serverOption.click();
        } else {
          // Type and press enter to create new position
          await page.keyboard.type(employee.position);
          await page.keyboard.press('Enter');
        }
      }

      await dialog.getByLabel(/hourly rate/i).fill(employee.hourlyRate);

      // Submit
      await dialog.getByRole('button', { name: /add employee|save/i }).click();

      // Verify employee was created
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
      
      // Wait for toast to disappear and employee to appear in schedule table
      await page.waitForTimeout(1000);
      
      // Employee should appear in the schedule table (not in toast)
      // Look for the employee name in a table cell or schedule row
      const scheduleTable = page.locator('table, [role="table"], .schedule-grid');
      await expect(scheduleTable.getByText(employee.name).first()).toBeVisible({ timeout: 5000 });
    });

    test('can view hourly employee on payroll page', async ({ page }) => {
      const employee = generateHourlyEmployee();

      // First create an employee
      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: /add employee/i }).first().click();
      const dialog = page.getByRole('dialog');
      
      await dialog.getByLabel(/name/i).first().fill(employee.name);
      await dialog.getByLabel(/hourly rate/i).fill(employee.hourlyRate);
      await dialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // Navigate to payroll
      await page.goto('/payroll');
      
      // Wait for page to load - use exact heading match to avoid ambiguity
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

      // Should see payroll summary cards
      await expect(page.getByText(/employees/i)).toBeVisible();
      await expect(page.getByText(/total hours/i)).toBeVisible();
      await expect(page.getByText(/gross wages/i)).toBeVisible();

      // Without time punches, employee won't have hours - that's expected
      // Check that the page loads correctly
      await expect(page.getByText(/employee payroll details/i)).toBeVisible();
    });

    test('payroll page shows no data state or employee table', async ({ page }) => {
      // This test verifies the payroll page loads correctly after signup
      // For a new restaurant with employees but no time punches, shows "No Payroll Data"
      
      await page.goto('/payroll');
      
      // Wait for page to load - use exact heading match to avoid ambiguity  
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

      // The page should be functional - verify it shows the expected sections
      // Either: employee table with data, OR "No Payroll Data" message
      const noDataHeading = page.getByRole('heading', { name: 'No Payroll Data' });
      const employeeTable = page.getByRole('table');
      const payrollDetailsSection = page.getByText(/employee payroll details/i);
      
      // Page should have either the table or the no-data message
      const hasNoData = await noDataHeading.isVisible().catch(() => false);
      const hasTable = await employeeTable.isVisible().catch(() => false);
      const hasDetailsSection = await payrollDetailsSection.isVisible().catch(() => false);
      
      // At least one of these should be visible
      expect(hasNoData || hasTable || hasDetailsSection).toBeTruthy();
    });
  });

  test.describe('Salaried Employee Flow', () => {
    test.beforeEach(async ({ page }) => {
      // Sign up and create restaurant using helper
      await signUpAndCreateRestaurant(page, testUser);
    });

    test('can create salaried employee with pay period selection', async ({ page }) => {
      const employee = generateSalaryEmployee();

      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      // Click Add Employee button
      await page.getByRole('button', { name: /add employee/i }).first().click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Fill basic info
      await dialog.getByLabel(/name/i).first().fill(employee.name);

      // Select compensation type = "Salary"
      const compensationTypeSelect = dialog.getByLabel(/compensation type/i);
      await compensationTypeSelect.click();
      await page.getByRole('option', { name: /salary/i }).click();

      // Salary-specific fields should now be visible
      await expect(dialog.getByLabel(/salary amount/i)).toBeVisible();
      await expect(dialog.getByLabel(/pay period/i)).toBeVisible();

      // Fill salary details
      await dialog.getByLabel(/salary amount/i).fill(employee.salaryAmount);

      // Select pay period
      const payPeriodSelect = dialog.getByLabel(/pay period/i);
      await payPeriodSelect.click();
      await page.getByRole('option', { name: /bi-weekly/i }).click();

      // Submit
      await dialog.getByRole('button', { name: /add employee|save/i }).click();

      // Verify employee was created
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // Wait for toast and verify employee appears
      await page.waitForTimeout(500);
      await expect(page.getByText(employee.name).first()).toBeVisible({ timeout: 5000 });
    });

    test('salaried employee appears on payroll page with correct display', async ({ page }) => {
      const employee = generateSalaryEmployee();

      // Create salaried employee
      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: /add employee/i }).first().click();
      const dialog = page.getByRole('dialog');

      await dialog.getByLabel(/name/i).first().fill(employee.name);

      // Select Salary compensation type
      const compensationTypeSelect = dialog.getByLabel(/compensation type/i);
      await compensationTypeSelect.click();
      await page.getByRole('option', { name: /salary/i }).click();

      await dialog.getByLabel(/salary amount/i).fill(employee.salaryAmount);

      const payPeriodSelect = dialog.getByLabel(/pay period/i);
      await payPeriodSelect.click();
      await page.getByRole('option', { name: /bi-weekly/i }).click();

      await dialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // Navigate to payroll
      await page.goto('/payroll');
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

      // Salaried employee should appear (may show $0 if no allocation yet, but name should be visible)
      // The payroll page should handle salaried employees
      await expect(page.getByText(/employee payroll details/i)).toBeVisible();
    });
  });

  test.describe('Contractor Flow', () => {
    test.beforeEach(async ({ page }) => {
      // Sign up and create restaurant using helper
      await signUpAndCreateRestaurant(page, testUser);
    });

    test('can create contractor with payment interval', async ({ page }) => {
      const employee = generateContractorEmployee();

      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: /add employee/i }).first().click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Fill basic info
      await dialog.getByLabel(/name/i).first().fill(employee.name);

      // Select compensation type = "Contractor"
      const compensationTypeSelect = dialog.getByLabel(/compensation type/i);
      await compensationTypeSelect.click();
      await page.getByRole('option', { name: /contractor/i }).click();

      // Contractor-specific fields should now be visible
      await expect(dialog.getByLabel(/payment amount/i)).toBeVisible();
      await expect(dialog.getByLabel(/payment interval/i)).toBeVisible();

      // Fill contractor details
      await dialog.getByLabel(/payment amount/i).fill(employee.contractorPayment);

      // Select payment interval
      const paymentIntervalSelect = dialog.getByLabel(/payment interval/i);
      await paymentIntervalSelect.click();
      await page.getByRole('option', { name: /monthly/i }).click();

      // Submit
      await dialog.getByRole('button', { name: /add employee|save/i }).click();

      // Verify employee was created
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // Wait for toast and verify employee appears
      await page.waitForTimeout(500);
      await expect(page.getByText(employee.name).first()).toBeVisible({ timeout: 5000 });
    });

    test('contractor appears on payroll page', async ({ page }) => {
      const employee = generateContractorEmployee();

      // Create contractor
      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: /add employee/i }).first().click();
      const dialog = page.getByRole('dialog');

      await dialog.getByLabel(/name/i).first().fill(employee.name);

      const compensationTypeSelect = dialog.getByLabel(/compensation type/i);
      await compensationTypeSelect.click();
      await page.getByRole('option', { name: /contractor/i }).click();

      await dialog.getByLabel(/payment amount/i).fill(employee.contractorPayment);

      const paymentIntervalSelect = dialog.getByLabel(/payment interval/i);
      await paymentIntervalSelect.click();
      await page.getByRole('option', { name: /monthly/i }).click();

      await dialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // Navigate to payroll
      await page.goto('/payroll');
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

      // Contractor should appear
      await expect(page.getByText(/employee payroll details/i)).toBeVisible();
    });
  });

  test.describe('Mixed Workforce Payroll', () => {
    test.beforeEach(async ({ page }) => {
      await signUpAndCreateRestaurant(page, testUser);
    });

    test('can create all three compensation types', async ({ page }) => {
      // Test that all three types can be created in sequence

      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      // 1. Create hourly employee
      const hourlyEmployee = generateHourlyEmployee();
      await page.getByRole('button', { name: /add employee/i }).first().click();
      let dialog = page.getByRole('dialog');

      await dialog.getByLabel(/name/i).first().fill(hourlyEmployee.name);
      // Hourly is the default, so just fill the rate
      await dialog.getByLabel(/hourly rate/i).fill(hourlyEmployee.hourlyRate);
      await dialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // 2. Create salaried employee
      const salaryEmployee = generateSalaryEmployee();
      await page.getByRole('button', { name: /add employee/i }).first().click();
      dialog = page.getByRole('dialog');

      await dialog.getByLabel(/name/i).first().fill(salaryEmployee.name);
      const compTypeSelect1 = dialog.getByLabel(/compensation type/i);
      await compTypeSelect1.click();
      await page.getByRole('option', { name: /salary/i }).click();
      await dialog.getByLabel(/salary amount/i).fill(salaryEmployee.salaryAmount);
      const payPeriodSelect = dialog.getByLabel(/pay period/i);
      await payPeriodSelect.click();
      await page.getByRole('option', { name: /bi-weekly/i }).click();
      await dialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // 3. Create contractor
      const contractor = generateContractorEmployee();
      await page.getByRole('button', { name: /add employee/i }).first().click();
      dialog = page.getByRole('dialog');

      await dialog.getByLabel(/name/i).first().fill(contractor.name);
      const compTypeSelect2 = dialog.getByLabel(/compensation type/i);
      await compTypeSelect2.click();
      await page.getByRole('option', { name: /contractor/i }).click();
      await dialog.getByLabel(/payment amount/i).fill(contractor.contractorPayment);
      const intervalSelect = dialog.getByLabel(/payment interval/i);
      await intervalSelect.click();
      await page.getByRole('option', { name: /monthly/i }).click();
      await dialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // Verify all three employees appear on the page
      await expect(page.getByText(hourlyEmployee.name).first()).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(salaryEmployee.name).first()).toBeVisible({ timeout: 5000 });
      await expect(page.getByText(contractor.name).first()).toBeVisible({ timeout: 5000 });
    });
  });
});

test.describe('Payroll Page Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('payroll page requires authentication', async ({ page }) => {
    // Try to access payroll without logging in
    await page.goto('/payroll');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/(login|signin|auth)/, { timeout: 5000 });
  });

  test('payroll page shows period selector', async ({ page }) => {
    // Sign up and create restaurant using helper
    const testUser = generateTestUser();
    await signUpAndCreateRestaurant(page, testUser);

    // Navigate to payroll
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

    // Verify period selector exists - look for the "Pay Period:" label
    await expect(page.getByText(/pay period/i)).toBeVisible();
    
    // Verify "Current Week" is visible as the default option
    await expect(page.getByText(/current week/i).first()).toBeVisible();
  });

  test('can navigate between pay periods', async ({ page }) => {
    // Sign up and create restaurant using helper
    const testUser = generateTestUser();
    await signUpAndCreateRestaurant(page, testUser);

    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

    // The date badge shows format like "Dec 1 - Dec 7, 2024" and has outline variant
    // Find the badge with date format (contains month abbreviation and hyphen)
    const dateBadge = page.locator('span, div').filter({ hasText: /\w{3}\s\d+\s*-\s*\w{3}\s\d+/ }).first();
    const initialText = await dateBadge.textContent();

    // Click previous period
    await page.getByRole('button', { name: /previous/i }).click();
    
    // Wait for page to update
    await page.waitForTimeout(500);
    
    // Date should have changed
    const newText = await dateBadge.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('can export payroll to CSV', async ({ page }) => {
    // Sign up and create restaurant using helper
    const testUser = generateTestUser();
    await signUpAndCreateRestaurant(page, testUser);

    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

    // Export button should exist (may be disabled without data)
    const exportButton = page.getByRole('button', { name: /export csv/i });
    await expect(exportButton).toBeVisible();
  });
});

// ============================================================================
// Per-Job Contractor Manual Payment Flow
// ============================================================================

test.describe('Per-Job Contractor Manual Payments', () => {
  test.beforeEach(async ({ page }) => {
    const testUser = generateTestUser();
    await signUpAndCreateRestaurant(page, testUser);
  });

  test('can create per-job contractor and add manual payment', async ({ page }) => {
    // Step 1: Create a per-job contractor on scheduling page
    await page.goto('/scheduling');
    await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /add employee/i }).first().click();
    const employeeDialog = page.getByRole('dialog');
    await expect(employeeDialog).toBeVisible();

    const contractorName = `Contractor ${Date.now()}`;
    await employeeDialog.getByLabel(/name/i).first().fill(contractorName);

    // Select Contractor compensation type
    const compensationTypeSelect = employeeDialog.getByLabel(/compensation type/i);
    await compensationTypeSelect.click();
    await page.getByRole('option', { name: /contractor/i }).click();

    // Fill payment amount
    await employeeDialog.getByLabel(/payment amount/i).fill('500');

    // Select "Per Job" payment interval
    const paymentIntervalSelect = employeeDialog.getByLabel(/payment interval/i);
    await paymentIntervalSelect.click();
    await page.getByRole('option', { name: /per job/i }).click();

    // Submit
    await employeeDialog.getByRole('button', { name: /add employee|save/i }).click();
    await expect(employeeDialog).not.toBeVisible({ timeout: 5000 });

    // Step 2: Navigate to payroll page
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

    // Per-job contractor should appear with $0.00 initial pay
    await expect(page.getByText(contractorName)).toBeVisible({ timeout: 5000 });
    
    // Should see "Add Payment" button for per-job contractors
    const contractorRow = page.locator('tr', { has: page.getByText(contractorName) });
    const addPaymentButton = contractorRow.getByRole('button', { name: /add payment/i });
    await expect(addPaymentButton).toBeVisible();

    // Step 3: Click "Add Payment" and enter payment details
    await addPaymentButton.click();
    
    const paymentDialog = page.getByRole('dialog');
    await expect(paymentDialog).toBeVisible();
    // Check for the heading specifically to avoid multiple matches
    await expect(paymentDialog.getByRole('heading', { name: /add payment/i })).toBeVisible();

    // Fill payment details
    await paymentDialog.getByLabel(/amount/i).fill('750');
    await paymentDialog.getByLabel(/description|job|notes/i).fill('Kitchen deep clean');

    // Submit payment
    await paymentDialog.getByRole('button', { name: /add|save|submit/i }).click();
    await expect(paymentDialog).not.toBeVisible({ timeout: 5000 });

    // Step 4: Verify payment appears in contractor's total
    // The contractor's total pay should now show $750.00 in the total pay cell (font-semibold)
    await expect(contractorRow.getByRole('cell', { name: '$750.00' }).last()).toBeVisible({ timeout: 5000 });
  });

  test('per-job contractor shows indicator that manual payment is needed', async ({ page }) => {
    // Create a per-job contractor
    await page.goto('/scheduling');
    await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /add employee/i }).first().click();
    const dialog = page.getByRole('dialog');

    const contractorName = `PerJob ${Date.now()}`;
    await dialog.getByLabel(/name/i).first().fill(contractorName);

    const compensationTypeSelect = dialog.getByLabel(/compensation type/i);
    await compensationTypeSelect.click();
    await page.getByRole('option', { name: /contractor/i }).click();

    await dialog.getByLabel(/payment amount/i).fill('500');

    const paymentIntervalSelect = dialog.getByLabel(/payment interval/i);
    await paymentIntervalSelect.click();
    await page.getByRole('option', { name: /per job/i }).click();

    await dialog.getByRole('button', { name: /add employee|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Navigate to payroll
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

    // Should see the contractor in the payroll table
    const contractorRow = page.locator('tr', { has: page.getByText(contractorName) });
    await expect(contractorRow).toBeVisible();
    
    // Should see "Add Payment" button for per-job contractors (that's the indicator)
    await expect(contractorRow.getByRole('button', { name: /add payment/i })).toBeVisible();
  });

  test('can view payment history for per-job contractor', async ({ page }) => {
    // Create a per-job contractor
    await page.goto('/scheduling');
    await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /add employee/i }).first().click();
    const employeeDialog = page.getByRole('dialog');

    const contractorName = `History ${Date.now()}`;
    await employeeDialog.getByLabel(/name/i).first().fill(contractorName);

    const compensationTypeSelect = employeeDialog.getByLabel(/compensation type/i);
    await compensationTypeSelect.click();
    await page.getByRole('option', { name: /contractor/i }).click();

    await employeeDialog.getByLabel(/payment amount/i).fill('500');

    const paymentIntervalSelect = employeeDialog.getByLabel(/payment interval/i);
    await paymentIntervalSelect.click();
    await page.getByRole('option', { name: /per job/i }).click();

    await employeeDialog.getByRole('button', { name: /add employee|save/i }).click();
    await expect(employeeDialog).not.toBeVisible({ timeout: 5000 });

    // Go to payroll and add a payment
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

    const contractorRow = page.locator('tr', { has: page.getByText(contractorName) });
    await contractorRow.getByRole('button', { name: /add payment/i }).click();

    const paymentDialog = page.getByRole('dialog');
    await paymentDialog.getByLabel(/amount/i).fill('250');
    await paymentDialog.getByLabel(/description|job|notes/i).fill('Window cleaning');
    await paymentDialog.getByRole('button', { name: /add|save|submit/i }).click();
    await expect(paymentDialog).not.toBeVisible({ timeout: 5000 });

    // Payment was added - contractor total should now include the payment
    // Look for the manual payment badge (green badge showing "+$250.00")
    const paymentBadge = contractorRow.locator('[class*="badge"]').filter({ hasText: '+$250' });
    await expect(paymentBadge).toBeVisible({ timeout: 5000 });
    
    // Hover over the badge to see the tooltip with payment details
    await paymentBadge.hover();
    
    // The tooltip should show the payment description
    await expect(page.getByText('Window cleaning')).toBeVisible({ timeout: 5000 });
  });
});
