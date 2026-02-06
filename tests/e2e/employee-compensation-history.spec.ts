import { test, expect, Page } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

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

    // Use UTC date to match backend's default effective_date calculation
    const today = new Date().toISOString().split('T')[0];
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
    // Input should default to today (UTC)
    await expect(effectiveDateInput).toHaveValue(today);

    // Use UTC to avoid timezone conflicts with database constraint
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 3);
    const futureDate = future.toISOString().split('T')[0];
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

    // Use UTC date to match backend's default effective_date calculation
    const today = new Date().toISOString().split('T')[0];
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
    // Use UTC to avoid timezone conflicts with database constraint
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const futureDate = tomorrow.toISOString().split('T')[0];
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
