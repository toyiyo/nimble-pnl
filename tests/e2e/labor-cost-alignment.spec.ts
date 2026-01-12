import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { exposeSupabaseHelpers } from '../helpers/e2e-supabase';

type TestUser = {
  email: string;
  password: string;
  fullName: string;
  restaurantName: string;
};

const generateUser = (): TestUser => {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return {
    email: `labor-e2e-${ts}-${rand}@test.com`,
    password: 'TestPassword123!',
    fullName: `Labor Tester ${rand}`,
    restaurantName: `Labor Resto ${rand}`,
  };
};

async function signUpAndCreateRestaurant(page: Page, user: TestUser) {
  await page.goto('/');
  await page.waitForURL(/\/(auth)?$/);

  if (page.url().endsWith('/')) {
    const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
    if (await signInLink.isVisible().catch(() => false)) {
      await signInLink.click();
      await page.waitForURL('/auth');
    }
  }

  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(user.email);
  await page.getByLabel(/full name/i).fill(user.fullName);
  await page.getByLabel(/password/i).first().fill(user.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();

  await page.waitForURL('/', { timeout: 20000 });

  const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
  await expect(addRestaurantButton).toBeVisible({ timeout: 15000 });
  await addRestaurantButton.click();

  const dialog = page.getByRole('dialog', { name: /add new restaurant/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/restaurant name/i).fill(user.restaurantName);
  await dialog.getByLabel(/address/i).fill('123 Test Street');
  await dialog.getByLabel(/phone/i).fill('555-000-0000');
  await dialog.getByRole('button', { name: /create restaurant|add restaurant/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const parseCurrency = (value: string) => Number(value.replace(/[^0-9.-]/g, ''));

test.describe('Labor cost alignment across Payroll and Dashboard', () => {
  test('Dashboard labor matches Payroll for month-to-date with mixed compensation types', async ({ page }) => {
    // Capture browser console logs  
    page.on('console', msg => {
      if (msg.text().includes('[usePayroll]')) {
        console.log('BROWSER:', msg.text());
      }
    });
    
    const user = generateUser();

    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(async () => {
      const fn = (window as any).__getRestaurantId;
      return fn ? await fn() : null;
    });
    expect(restaurantId).toBeTruthy();

    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const monthStart = new Date(todayMidnight.getFullYear(), todayMidnight.getMonth(), 1);

    const hourlyId = randomUUID();
    const salaryId = randomUUID();
    const contractorId = randomUUID();

    const salaryAmountCents = 70000; // $700/week → $100/day
    const contractorAmountCents = 35000; // $350/week → $50/day
    const hourlyRateCents = 1000; // $10/hr
    const hoursWorked = 8;

    const clockIn = new Date(todayMidnight);
    clockIn.setHours(10, 0, 0, 0);
    const clockOut = new Date(todayMidnight);
    clockOut.setHours(18, 0, 0, 0);

    const monthStartStr = formatDate(monthStart);
    const todayStr = formatDate(todayMidnight);

    await page.evaluate(
      async ({
        restaurantId,
        monthStartStr,
        todayStr,
        hourlyId,
        salaryId,
        contractorId,
        salaryAmountCents,
        contractorAmountCents,
        hourlyRateCents,
        clockIn,
        clockOut,
      }) => {
        const insertEmployees = (window as any).__insertEmployees;
        const insertTimePunches = (window as any).__insertTimePunches;
        if (!insertEmployees || !insertTimePunches) throw new Error('Supabase helpers not available');

        await insertEmployees(
          [
            {
              id: hourlyId,
              name: 'Hourly Worker',
              position: 'Server',
              compensation_type: 'hourly',
              hourly_rate: hourlyRateCents,
              status: 'inactive',
              is_active: false,
              tip_eligible: false,
              requires_time_punch: true,
              hire_date: monthStartStr,
              termination_date: todayStr,
            },
            {
              id: salaryId,
              name: 'Salary Manager',
              position: 'Manager',
              compensation_type: 'salary',
              hourly_rate: 0,
              salary_amount: salaryAmountCents,
              pay_period_type: 'weekly',
              status: 'inactive',
              is_active: false,
              hire_date: monthStartStr,
              termination_date: todayStr,
            },
            {
              id: contractorId,
              name: 'Weekly Contractor',
              position: 'Consultant',
              compensation_type: 'contractor',
              hourly_rate: 0,
              contractor_payment_amount: contractorAmountCents,
              contractor_payment_interval: 'weekly',
              status: 'inactive',
              is_active: false,
              hire_date: monthStartStr,
              termination_date: todayStr,
            },
          ],
          restaurantId
        );

        await insertTimePunches(
          [
            {
              employee_id: hourlyId,
              punch_type: 'clock_in',
              punch_time: clockIn,
            },
            {
              employee_id: hourlyId,
              punch_type: 'clock_out',
              punch_time: clockOut,
            },
          ],
          restaurantId
        );
      },
      {
        restaurantId,
        monthStartStr,
        todayStr,
        hourlyId,
        salaryId,
        contractorId,
        salaryAmountCents,
        contractorAmountCents,
        hourlyRateCents,
        clockIn: clockIn.toISOString(),
        clockOut: clockOut.toISOString(),
      }
    );

    const daysMonthToDate =
      Math.floor((todayMidnight.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const expectedSalary = (salaryAmountCents / 7 / 100) * daysMonthToDate;
    const expectedContractor = (contractorAmountCents / 7 / 100) * daysMonthToDate;
    const expectedHourly = (hourlyRateCents / 100) * hoursWorked;
    const expectedPayrollTotal = expectedSalary + expectedContractor + expectedHourly;

    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 20000 });

    // Set payroll to month-to-date to align with dashboard/monthly metrics
    // Wait for payroll data to load first
    await expect(page.getByText('Employee Payroll Details')).toBeVisible({ timeout: 15000 });
    
    // Find the Pay Period select (it's the second combobox, first is restaurant selector)
    const payPeriodSelect = page.locator('button[role="combobox"]').nth(1);
    await expect(payPeriodSelect).toBeEnabled();
    await payPeriodSelect.click();
    
    // Wait a moment for dropdown to render
    await page.waitForTimeout(300);
    
    // Click Custom Range option
    await page.locator('[role="option"]').filter({ hasText: 'Custom Range' }).click();

    // Wait for date inputs to appear and fill them
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs.first()).toBeVisible({ timeout: 5000 });
    await dateInputs.first().fill(formatDate(monthStart));
    await dateInputs.nth(1).fill(formatDate(todayMidnight));

    await expect(page.getByText('Employee Payroll Details')).toBeVisible({ timeout: 15000 });

    const grossWagesCard = page
      .getByText('Gross Wages')
      .locator('xpath=ancestor::div[contains(@class,\"rounded-lg\")][1]');
    const grossWagesText = await grossWagesCard.locator('.text-2xl').first().innerText();
    const payrollTotal = parseCurrency(grossWagesText);
    const payrollRounded = Math.round(payrollTotal);

    expect(payrollTotal).toBeCloseTo(expectedPayrollTotal, 1);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /performance period/i })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /this month/i }).click();

    const laborCard = page.getByRole('heading', { name: 'Labor Cost (Wages + Payroll)' }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
    const laborValueText = await laborCard.locator('.text-3xl, .text-2xl').first().innerText();
    const laborValue = parseCurrency(laborValueText);

    // The pending value is in the subtitle text like "30.0% of revenue | Pending $1,580 • Actual $0"
    const laborCardText = await laborCard.textContent();
    const pendingMatch = laborCardText?.match(/Pending\s*\$([0-9,]+)/);
    const pendingValue = pendingMatch ? parseCurrency(pendingMatch[1]) : 0;

    expect(laborValue).toBeCloseTo(payrollRounded, 0);
    expect(pendingValue).toBeCloseTo(payrollRounded, 0);

    const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(todayMidnight);
    await page.getByRole('heading', { name: 'Monthly Performance' }).first().scrollIntoViewIfNeeded();
    const monthRow = page.getByRole('row', { name: new RegExp(monthLabel, 'i') });
    await expect(monthRow).toBeVisible({ timeout: 20000 });

    // Extract pending value from the row - format is like "Pending: $1,580.00 (30.0%)"
    const pendingRowText = await monthRow.getByText(/Pending:/i).innerText();
    const monthlyPendingMatch = pendingRowText.match(/Pending:\s*\$([0-9,]+(?:\.[0-9]{2})?)/);
    const monthlyPending = monthlyPendingMatch ? parseCurrency(monthlyPendingMatch[1]) : 0;

    expect(monthlyPending).toBeCloseTo(payrollRounded, 0);
  });
});
