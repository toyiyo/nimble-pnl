import { test, expect, Page } from '@playwright/test';
import { addDays, format } from 'date-fns';

const generateTestUser = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return {
    email: `comp-history-${timestamp}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Comp History User ${timestamp}`,
    restaurantName: `Comp History Restaurant ${timestamp}`,
  };
};

/**
 * Helper to sign up and create a restaurant.
 * Mirrors the happy-path flows used in other payroll tests.
 */
async function signUpAndCreateRestaurant(page: Page, testUser: ReturnType<typeof generateTestUser>) {
  await page.goto('/auth');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForURL(/\/auth/);

  // If still authenticated, sign out and return to auth
  const signOutButton = page.getByRole('button', { name: /sign out/i });
  if (await signOutButton.isVisible().catch(() => false)) {
    await signOutButton.click();
    await page.waitForURL(/\/auth/);
  }

  // Enter signup mode
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

  await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });

  // Fill signup form
  await page.getByLabel(/email/i).first().fill(testUser.email);
  await page.getByLabel(/full name/i).fill(testUser.fullName);
  await page.getByLabel(/password/i).first().fill(testUser.password);

  // Submit signup
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  // Create restaurant
  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 10000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Compensation Lane');
  await dialog.getByLabel(/phone/i).fill('555-123-4567');

  const cuisineSelect = dialog.getByRole('combobox').filter({ hasText: /select cuisine type/i });
  if (await cuisineSelect.isVisible().catch(() => false)) {
    await cuisineSelect.click();
    await page.getByRole('option', { name: /american/i }).click();
  }

  await dialog.getByRole('button', { name: /create|add|save/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

async function goToEmployeesPage(page: Page) {
  // Open home to ensure restaurant context is hydrated, then navigate to Employees
  await page.goto('/');
  const employeesNav = page.getByRole('link', { name: /^employees$/i }).first();
  if (await employeesNav.isVisible({ timeout: 5000 }).catch(() => false)) {
    await employeesNav.click();
  } else {
    await page.goto('/employees');
  }

  await expect(page.getByRole('button', { name: /add employee/i }).first()).toBeVisible({ timeout: 15000 });
}

async function fetchEmployeeId(page: Page, name: string) {
  return page.evaluate(async ({ employeeName }) => {
    const { supabase } = await import('/src/integrations/supabase/client');
    const { data, error } = await supabase
      .from('employees')
      .select('id')
      .eq('name', employeeName)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.id as string | undefined;
  }, { employeeName: name });
}

async function fetchCompHistory(page: Page, employeeId: string) {
  return page.evaluate(async ({ employeeId }) => {
    const { supabase } = await import('/src/integrations/supabase/client');
    const { data, error } = await supabase
      .from('employee_compensation_history')
      .select('amount_cents, compensation_type, pay_period_type, effective_date')
      .eq('employee_id', employeeId)
      .order('effective_date', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }, { employeeId });
}

test.describe('Employee compensation history', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('changing hourly rate prompts effective date and appends history', async ({ page }) => {
    const testUser = generateTestUser();
    const employee = {
      name: `Hourly Tester ${Date.now()}`,
      position: 'Server',
      initialRate: '10.00',
      newRate: '12.00',
    };

    await signUpAndCreateRestaurant(page, testUser);

    // Create an hourly employee
    await goToEmployeesPage(page);
    await page.getByRole('button', { name: /add employee/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(employee.name);

    const positionCombobox = dialog.getByRole('combobox').filter({ hasText: /position|select/i });
    if (await positionCombobox.isVisible().catch(() => false)) {
      await positionCombobox.click();
      const option = page.getByRole('option', { name: new RegExp(employee.position, 'i') });
      if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
        await option.click();
      } else {
        await page.keyboard.type(employee.position);
        await page.keyboard.press('Enter');
      }
    }

    await dialog.getByLabel(/hourly rate/i).fill(employee.initialRate);
    await dialog.getByRole('button', { name: /add employee|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    const employeeId = await fetchEmployeeId(page, employee.name);
    expect(employeeId).toBeTruthy();

    const today = format(new Date(), 'yyyy-MM-dd');
    const initialHistory = await fetchCompHistory(page, employeeId!);
    expect(initialHistory).toHaveLength(1);
    expect(initialHistory[0]).toMatchObject({
      compensation_type: 'hourly',
      amount_cents: 1000,
      effective_date: today,
    });

    // Update hourly rate and confirm modal flow
    await page.getByRole('button', { name: `Edit ${employee.name}` }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();

    await editDialog.getByLabel(/hourly rate/i).fill(employee.newRate);
    await editDialog.getByRole('button', { name: /update employee/i }).click();

    const modal = page.getByRole('dialog', { name: /apply new compensation rate/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    const effectiveDateInput = modal.getByLabel(/effective date/i);
    await expect(effectiveDateInput).toHaveValue(today);

    const futureDate = format(addDays(new Date(), 3), 'yyyy-MM-dd');
    await effectiveDateInput.fill(futureDate);
    await modal.getByRole('button', { name: /save new rate|apply new rate/i }).click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect(editDialog).not.toBeVisible({ timeout: 5000 });

    const historyAfter = await fetchCompHistory(page, employeeId!);
    expect(historyAfter).toHaveLength(2);
    expect(historyAfter[0].amount_cents).toBe(1000);
    expect(historyAfter[1]).toMatchObject({
      compensation_type: 'hourly',
      amount_cents: 1200,
      effective_date: futureDate,
    });

    await expect(page.getByText('$12.00/hr')).toBeVisible();
  });

  test('changing salary captures pay period and protects history', async ({ page }) => {
    const testUser = generateTestUser();
    const employee = {
      name: `Salary Tester ${Date.now()}`,
      position: 'Manager',
      initialSalary: '52000',
      initialPeriod: 'bi-weekly',
      newSalary: '54000',
      newPeriodLabel: 'Monthly',
      newPeriodValue: 'monthly',
    };

    await signUpAndCreateRestaurant(page, testUser);

    await goToEmployeesPage(page);
    await page.getByRole('button', { name: /add employee/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill(employee.name);

    const positionCombobox = dialog.getByRole('combobox').filter({ hasText: /position|select/i });
    if (await positionCombobox.isVisible().catch(() => false)) {
      await positionCombobox.click();
      const option = page.getByRole('option', { name: new RegExp(employee.position, 'i') });
      if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
        await option.click();
      } else {
        await page.keyboard.type(employee.position);
        await page.keyboard.press('Enter');
      }
    }

    const compensationTypeSelect = dialog.getByLabel(/compensation type/i);
    await compensationTypeSelect.click();
    await page.getByRole('option', { name: /^salary$/i }).click();

    await dialog.getByLabel(/salary amount/i).fill(employee.initialSalary);
    await dialog.getByLabel(/pay period/i).click();
    await page.getByRole('option', { name: /bi-weekly/i }).click();

    await dialog.getByRole('button', { name: /add employee|save/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    const employeeId = await fetchEmployeeId(page, employee.name);
    expect(employeeId).toBeTruthy();

    const today = format(new Date(), 'yyyy-MM-dd');
    const initialHistory = await fetchCompHistory(page, employeeId!);
    expect(initialHistory).toHaveLength(1);
    expect(initialHistory[0]).toMatchObject({
      compensation_type: 'salary',
      pay_period_type: employee.initialPeriod,
      amount_cents: 52000 * 100, // $52,000 → cents
      effective_date: today,
    });

    // Update salary + pay period
    await page.getByRole('button', { name: `Edit ${employee.name}` }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog).toBeVisible();

    await editDialog.getByLabel(/salary amount/i).fill(employee.newSalary);
    await editDialog.getByLabel(/pay period/i).click();
    await page.getByRole('option', { name: employee.newPeriodLabel, exact: true }).click();
    await editDialog.getByRole('button', { name: /update employee/i }).click();

    const modal = page.getByRole('dialog', { name: /apply new compensation rate/i });
    await expect(modal).toBeVisible({ timeout: 5000 });

    const effectiveDateInput = modal.getByLabel(/effective date/i);
    const futureDate = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    await effectiveDateInput.fill(futureDate);
    await modal.getByRole('button', { name: /save new rate|apply new rate/i }).click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect(editDialog).not.toBeVisible({ timeout: 5000 });

    const historyAfter = await fetchCompHistory(page, employeeId!);
    expect(historyAfter).toHaveLength(2);
    expect(historyAfter[0].pay_period_type).toBe(employee.initialPeriod);
    expect(historyAfter[1]).toMatchObject({
      compensation_type: 'salary',
      pay_period_type: employee.newPeriodValue,
      amount_cents: 54000 * 100,
      effective_date: futureDate,
    });

    await expect(page.getByText('$54000.00/month')).toBeVisible();
  });
});
