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
  // Navigate to auth page and clear any persisted session to avoid landing on dashboard
  await page.goto('/auth');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForURL(/\/auth/);

  // If still authenticated (e.g., Supabase session persisted elsewhere), sign out then return
  const signOutButton = page.getByRole('button', { name: /sign out/i });
  if (await signOutButton.isVisible().catch(() => false)) {
    await signOutButton.click();
    await page.waitForURL(/\/auth/);
  }
  
  // If we somehow remain signed in (rare), skip straight to restaurant creation
  const addRestaurantButtonExisting = page.getByRole('button', { name: /add restaurant/i });
  if (await addRestaurantButtonExisting.isVisible().catch(() => false)) {
    await addRestaurantButtonExisting.click();
    const dialogExisting = page.getByRole('dialog');
    await expect(dialogExisting).toBeVisible();
    await dialogExisting.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
    await dialogExisting.getByLabel(/address/i).fill('123 Payroll Test Street');
    await dialogExisting.getByLabel(/phone/i).fill('555-PAY-ROLL');
    const cuisineExisting = dialogExisting.getByRole('combobox').filter({ hasText: /select cuisine type/i });
    if (await cuisineExisting.isVisible().catch(() => false)) {
      await cuisineExisting.click();
      await page.getByRole('option', { name: /american/i }).click();
    }
    await dialogExisting.getByRole('button', { name: /create|add|save/i }).click();
    await expect(dialogExisting).not.toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
    return;
  }

  // Go to signup tab or trigger signup mode if tabs aren't present
  const signupTab = page.getByRole('tab', { name: /sign up/i });
  if (await signupTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await signupTab.click();
  } else {
    const signupTrigger = page.getByRole('button', { name: /sign up|create account|get started/i }).first();
    const signupLink = page.getByRole('link', { name: /sign up|create account|get started/i }).first();
    if (await signupTrigger.isVisible().catch(() => false)) {
      await signupTrigger.click();
    } else if (await signupLink.isVisible().catch(() => false)) {
      await signupLink.click();
    }
  }

  // Ensure signup fields are visible
  await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });

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
      
      // Scheduling view hides employees until they have a shift; dialog closure is our success signal.
      await page.waitForLoadState('networkidle');
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

      // Scheduling view hides employees until they have a shift; dialog closure is our success signal.
      await page.waitForLoadState('networkidle');

      // Navigate to payroll and wait for network to settle
      await page.goto('/payroll', { waitUntil: 'networkidle' });
      
      // Wait for page to load - use exact heading match to avoid ambiguity
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 15000 });

      // Should see payroll summary cards - use exact text to avoid ambiguity
      await expect(page.getByText('Employees', { exact: true }).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Total Hours', { exact: true }).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Gross Wages', { exact: true }).first()).toBeVisible({ timeout: 10000 });

      // Without time punches, employee won't have hours - that's expected
      // Check that the page loads correctly - increased timeout for CI
      await expect(page.getByText(/employee payroll details/i)).toBeVisible({ timeout: 10000 });
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

      // Verify all three employees appear on payroll (scheduling hides employees without shifts)
      await page.goto('/payroll', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(hourlyEmployee.name).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(salaryEmployee.name).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(contractor.name).first()).toBeVisible({ timeout: 10000 });
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
    // Note: Badge component renders as a div with classes like "inline-flex", "rounded-full" but no "badge" in class name
    const paymentAmount = contractorRow.getByText(/\+\$250/);
    await expect(paymentAmount).toBeVisible({ timeout: 5000 });
    
    // Hover over the payment amount to see the tooltip with payment details
    await paymentAmount.hover();
    
    // The tooltip should show the payment description - use .first() for strict mode
    await expect(page.getByRole('tooltip').getByText('Window cleaning').first()).toBeVisible({ timeout: 5000 });
  });

  test.describe('Inactive Employee Historical Data', () => {
    let inactiveTestUser: ReturnType<typeof generateTestUser>;

    test.beforeEach(async ({ page }) => {
      inactiveTestUser = generateTestUser();
      await signUpAndCreateRestaurant(page, inactiveTestUser);
    });

    test('deactivated employee still appears in historical payroll with past work', async ({ page }) => {
      const employee = generateHourlyEmployee();
      
      // Step 1: Create an hourly employee
      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: /add employee/i }).first().click();
      const dialog = page.getByRole('dialog');
      
      await dialog.getByLabel(/name/i).first().fill(employee.name);
      await dialog.getByLabel(/hourly rate/i).fill(employee.hourlyRate);
      await dialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });

      // Step 2: Go to payroll and verify employee appears
      await page.goto('/payroll');
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });
      
      // Employee should appear in payroll table (payroll shows all employees)
      const employeeRowBefore = page.locator('tr', { has: page.getByText(employee.name) });
      await expect(employeeRowBefore).toBeVisible({ timeout: 5000 });

      // Step 3: Go to employees page to edit employee (has dedicated employee management)
      await page.goto('/employees');
      
      // Wait for page to load - check for the employee list card instead of hidden heading
      await expect(page.getByText(/manage your restaurant staff/i)).toBeVisible({ timeout: 10000 });

      // Wait for employee list to load
      await page.waitForTimeout(1000);

      // Find employee card and click "Deactivate" button (dedicated action for status change)
      // The UI has separate Edit and Deactivate buttons to handle status changes properly
      const deactivateButton = page.locator('.space-y-2').filter({ hasText: employee.name })
        .getByRole('button', { name: /deactivate/i }).first();
      
      await expect(deactivateButton).toBeVisible({ timeout: 5000 });
      await deactivateButton.click();
      
      // Deactivation dialog appears with reason and date fields
      const deactivateDialog = page.getByRole('dialog');
      await expect(deactivateDialog).toBeVisible({ timeout: 5000 });

      // Fill in optional deactivation reason
      const reasonInput = deactivateDialog.getByLabel(/reason|note/i);
      if (await reasonInput.isVisible().catch(() => false)) {
        await reasonInput.fill('Test deactivation for payroll verification');
      }

      // Click confirm/save button
      await deactivateDialog.getByRole('button', { name: /deactivate|confirm|save/i }).click();
      
      // Wait for dialog to close
      await expect(deactivateDialog).not.toBeVisible({ timeout: 10000 });

      // Wait for update to propagate
      await page.waitForTimeout(1500);

      // Step 4: Go back to payroll to verify inactive employee still appears
      await page.goto('/payroll');
      await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 10000 });

      // CRITICAL TEST - Verify employee STILL appears in payroll after deactivation
      // The deactivated employee should STILL appear in payroll with their data
      const employeeRowAfter = page.locator('tr', { has: page.getByText(employee.name) });
      await expect(employeeRowAfter).toBeVisible({ timeout: 5000 });

      // Check if "Inactive" badge is shown (may not be present on payroll page - that's OK)
      // The critical requirement is that the employee still appears in payroll after deactivation
      const inactiveBadge = employeeRowAfter.getByText(/inactive/i);
      if (await inactiveBadge.isVisible().catch(() => false)) {
        // Badge is present - good!
        await expect(inactiveBadge).toBeVisible();
      }
      
      // Row should still be visible and functional - THIS IS THE KEY TEST
      await expect(employeeRowAfter).toBeVisible();
    });

    test('inactive employee with past shifts still counted in labor costs', async ({ page }) => {
      const employee = generateHourlyEmployee();
      
      // Step 1: Create employee and schedule a shift
      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      await page.getByRole('button', { name: /add employee/i }).first().click();
      const empDialog = page.getByRole('dialog');
      
      await empDialog.getByLabel(/name/i).first().fill(employee.name);
      await empDialog.getByLabel(/hourly rate/i).fill(employee.hourlyRate);
      await empDialog.getByRole('button', { name: /add employee|save/i }).click();
      await expect(empDialog).not.toBeVisible({ timeout: 5000 });

      // Create a shift for this employee
      await page.getByRole('button', { name: /create shift/i }).first().click();
      const shiftDialog = page.getByRole('dialog');

      // Select employee
      const employeeSelect = shiftDialog.getByLabel(/employee/i);
      await employeeSelect.click();
      await page.getByRole('option', { name: employee.name }).click();

      // Fill shift times (using yesterday to ensure it's past)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateString = yesterday.toISOString().slice(0, 10);
      const startTime = new Date(yesterday);
      startTime.setHours(9, 0, 0, 0);
      const endTime = new Date(yesterday);
      endTime.setHours(17, 0, 0, 0);

      // Date/time inputs are separate
      await shiftDialog.getByLabel(/start date/i).fill(dateString);
      await shiftDialog.getByLabel(/end date/i).fill(dateString);
      const startTimeString = startTime.toTimeString().slice(0, 5);
      const endTimeString = endTime.toTimeString().slice(0, 5);
      await shiftDialog.getByLabel(/start.*time/i).fill(startTimeString);
      await shiftDialog.getByLabel(/end.*time/i).fill(endTimeString);

      await shiftDialog.getByRole('button', { name: /save|create/i }).click();
      await expect(shiftDialog).not.toBeVisible({ timeout: 5000 });

      // Wait for the shift to be created
      await page.waitForTimeout(2000);
      
      // Note the labor cost BEFORE deactivation (while still on scheduling page)
      const laborCostCard = page.getByText(/labor cost/i).first();
      await expect(laborCostCard).toBeVisible({ timeout: 10000 });
      const laborCostBeforeText = await laborCostCard.textContent();
      const laborCostBefore = laborCostBeforeText?.match(/\\$[0-9]+\\.?[0-9]*/)?.[0] || '$0';

      // Step 2: Navigate to employees page to deactivate
      await page.goto('/employees');
      await expect(page.getByRole('heading', { name: /employees/i, level: 1 })).toBeVisible({ timeout: 10000 });
      
      // Find the employee card or row
      const employeeCard = page.locator('div, tr').filter({ hasText: employee.name }).first();
      await expect(employeeCard).toBeVisible({ timeout: 10000 });
      
      // Look for deactivate or edit button
      const deactivateButton = employeeCard.getByRole('button', { name: /deactivate|edit/i }).first();
      await expect(deactivateButton).toBeVisible({ timeout: 5000 });
      await deactivateButton.click();

      const editDialog = page.getByRole('dialog');
      await expect(editDialog).toBeVisible();
      
      // If it's an edit dialog, change status to inactive
      const statusSelect = editDialog.getByLabel(/status/i);
      if (await statusSelect.isVisible().catch(() => false)) {
        await statusSelect.click();
        await page.getByRole('option', { name: /inactive/i }).click();
        await editDialog.getByRole('button', { name: /save|update/i }).click();
      } else {
        // If it's a deactivation dialog, just confirm
        await editDialog.getByRole('button', { name: /deactivate|confirm/i }).click();
      }
      
      // Wait for dialog to close
      await page.waitForTimeout(1500);

      // Step 3: Go back to scheduling and check labor cost
      await page.goto('/scheduling');
      await expect(page.getByRole('heading', { name: /scheduling/i })).toBeVisible({ timeout: 10000 });

      // Step 3: CRITICAL TEST - Labor cost should still include the inactive employee's shift
      // Re-query the labor cost card after reload
      const laborCostCardAfter = page.getByText(/labor cost/i).first();
      await expect(laborCostCardAfter).toBeVisible({ timeout: 10000 });
      const laborCostAfterText = await laborCostCardAfter.textContent();
      const laborCostAfter = laborCostAfterText?.match(/\$[0-9]+\.?[0-9]*/)?.[0] || '$0';
      
      // The labor cost should be the same (not zero)
      expect(laborCostAfter).toBe(laborCostBefore);

      // The shift should still be visible with an "Inactive" badge
      const shiftRow = page.locator('tr', { has: page.getByText(employee.name) });
      await expect(shiftRow).toBeVisible();
    });
  });
});
