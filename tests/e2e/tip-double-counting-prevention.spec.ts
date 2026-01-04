import { test, expect } from '@playwright/test';
import { clearDatabase, setupTest, createEmployee } from './helpers';

test.describe('Tip Double-Counting Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await clearDatabase();
    await setupTest(page, { role: 'manager' });
  });

  test('should not double-count tips when employee declares and manager approves split', async ({ page }) => {
    // Step 1: Create two test employees
    const employee1 = await createEmployee(page, {
      name: 'Alice Johnson',
      position: 'Server',
      hourly_rate: 15,
    });

    const employee2 = await createEmployee(page, {
      name: 'Bob Smith',
      position: 'Bartender',
      hourly_rate: 15,
    });

    // Step 2: Navigate to Tips page
    await page.goto('/tips');
    await expect(page.locator('h1')).toContainText('Tip Management');

    // Step 3: Employee 1 declares $10 cash and $20 credit
    await page.click('[data-testid="employee-tip-submission"]');
    await page.selectOption('[data-testid="employee-select"]', employee1.id);
    await page.fill('[data-testid="cash-amount"]', '10');
    await page.fill('[data-testid="credit-amount"]', '20');
    await page.click('[data-testid="submit-tips"]');
    await expect(page.locator('.toast')).toContainText('Tips submitted');

    // Step 4: Employee 2 declares $10 cash and $20 credit
    await page.click('[data-testid="employee-tip-submission"]');
    await page.selectOption('[data-testid="employee-select"]', employee2.id);
    await page.fill('[data-testid="cash-amount"]', '10');
    await page.fill('[data-testid="credit-amount"]', '20');
    await page.click('[data-testid="submit-tips"]');
    await expect(page.locator('.toast')).toContainText('Tips submitted');

    // Step 5: Verify employee-declared tips show in manager view
    await page.click('[data-testid="view-declared-tips"]');
    await expect(page.locator('[data-testid="declared-tips"]')).toContainText('Alice Johnson');
    await expect(page.locator('[data-testid="declared-tips"]')).toContainText('Bob Smith');
    await expect(page.locator('[data-testid="alice-total"]')).toContainText('$30.00');
    await expect(page.locator('[data-testid="bob-total"]')).toContainText('$30.00');

    // Step 6: Manager creates approved split: $60 total → $30 each
    await page.click('[data-testid="create-tip-split"]');
    await page.fill('[data-testid="split-total-amount"]', '60');
    await page.selectOption('[data-testid="split-method"]', 'equal');
    
    // Add employees to split
    await page.click('[data-testid="add-employee-to-split"]');
    await page.selectOption('[data-testid="employee-1-select"]', employee1.id);
    await page.click('[data-testid="add-employee-to-split"]');
    await page.selectOption('[data-testid="employee-2-select"]', employee2.id);
    
    // Approve the split
    await page.click('[data-testid="approve-split"]');
    await expect(page.locator('.toast')).toContainText('Tip split approved');

    // Step 7: Navigate to Payroll page
    await page.goto('/payroll');
    await expect(page.locator('h1')).toContainText('Payroll');

    // Select current pay period
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
    await page.click('[data-testid="select-pay-period"]');
    await page.click(`[data-testid="period-${startOfWeek.toISOString().split('T')[0]}"]`);

    // Step 8: CRITICAL ASSERTION - Tips should be $30 each, NOT doubled
    // Wait for payroll to load
    await expect(page.locator('[data-testid="payroll-table"]')).toBeVisible();

    // Find Alice's row
    const aliceRow = page.locator('[data-testid="payroll-row-alice"]');
    await expect(aliceRow).toBeVisible();
    
    // Check tips column - should be $30.00 (from split), NOT $60.00 (double-counting)
    const aliceTips = aliceRow.locator('[data-testid="tips-amount"]');
    await expect(aliceTips).toContainText('$30.00');
    await expect(aliceTips).not.toContainText('$60.00');

    // Find Bob's row
    const bobRow = page.locator('[data-testid="payroll-row-bob"]');
    await expect(bobRow).toBeVisible();
    
    // Check tips column - should be $30.00 (from split), NOT $60.00 (double-counting)
    const bobTips = bobRow.locator('[data-testid="tips-amount"]');
    await expect(bobTips).toContainText('$30.00');
    await expect(bobTips).not.toContainText('$60.00');

    // Step 9: Verify tip breakdown shows correct source
    await page.click('[data-testid="alice-tip-details"]');
    await expect(page.locator('[data-testid="tip-breakdown"]')).toContainText('From Split: $30.00');
    await expect(page.locator('[data-testid="tip-breakdown"]')).toContainText('From Declaration: $0.00');
    await page.click('[data-testid="close-breakdown"]');

    // Step 10: Add a new tip declaration for a different date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    await page.goto('/tips');
    await page.click('[data-testid="employee-tip-submission"]');
    await page.selectOption('[data-testid="employee-select"]', employee1.id);
    await page.fill('[data-testid="cash-amount"]', '15');
    await page.fill('[data-testid="tip-date"]', tomorrow.toISOString().split('T')[0]);
    await page.click('[data-testid="submit-tips"]');
    await expect(page.locator('.toast')).toContainText('Tips submitted');

    // Step 11: Verify payroll now shows $30 (from split) + $15 (from new declaration) = $45
    await page.goto('/payroll');
    await page.click('[data-testid="select-pay-period"]');
    await page.click(`[data-testid="period-${startOfWeek.toISOString().split('T')[0]}"]`);
    
    const aliceRowUpdated = page.locator('[data-testid="payroll-row-alice"]');
    const aliceTipsUpdated = aliceRowUpdated.locator('[data-testid="tips-amount"]');
    await expect(aliceTipsUpdated).toContainText('$45.00');

    // Verify breakdown
    await page.click('[data-testid="alice-tip-details"]');
    await expect(page.locator('[data-testid="tip-breakdown"]')).toContainText('From Split: $30.00');
    await expect(page.locator('[data-testid="tip-breakdown"]')).toContainText('From Declaration: $15.00');
  });

  test('should handle multiple splits on different dates correctly', async ({ page }) => {
    const employee = await createEmployee(page, {
      name: 'Charlie Brown',
      position: 'Server',
      hourly_rate: 15,
    });

    // Day 1: Declare $20, manager approves split → gets $25
    await page.goto('/tips');
    await page.click('[data-testid="employee-tip-submission"]');
    await page.selectOption('[data-testid="employee-select"]', employee.id);
    await page.fill('[data-testid="cash-amount"]', '20');
    await page.click('[data-testid="submit-tips"]');

    await page.click('[data-testid="create-tip-split"]');
    await page.fill('[data-testid="split-total-amount"]', '50');
    await page.click('[data-testid="add-employee-to-split"]');
    await page.selectOption('[data-testid="employee-1-select"]', employee.id);
    await page.click('[data-testid="approve-split"]');

    // Day 2: Declare $30, no split
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    await page.click('[data-testid="employee-tip-submission"]');
    await page.selectOption('[data-testid="employee-select"]', employee.id);
    await page.fill('[data-testid="cash-amount"]', '30');
    await page.fill('[data-testid="tip-date"]', tomorrow.toISOString().split('T')[0]);
    await page.click('[data-testid="submit-tips"]');

    // Verify payroll: Day 1 split ($25) + Day 2 declaration ($30) = $55
    await page.goto('/payroll');
    const row = page.locator('[data-testid="payroll-row-charlie"]');
    const tips = row.locator('[data-testid="tips-amount"]');
    await expect(tips).toContainText('$55.00');
  });

  test('should use split amount over declaration when split exists (even if different)', async ({ page }) => {
    const employee = await createEmployee(page, {
      name: 'Diana Prince',
      position: 'Server',
      hourly_rate: 15,
    });

    // Employee declares $100
    await page.goto('/tips');
    await page.click('[data-testid="employee-tip-submission"]');
    await page.selectOption('[data-testid="employee-select"]', employee.id);
    await page.fill('[data-testid="cash-amount"]', '100');
    await page.click('[data-testid="submit-tips"]');

    // Manager corrects to $80 via split
    await page.click('[data-testid="create-tip-split"]');
    await page.fill('[data-testid="split-total-amount"]', '80');
    await page.click('[data-testid="add-employee-to-split"]');
    await page.selectOption('[data-testid="employee-1-select"]', employee.id);
    await page.click('[data-testid="approve-split"]');

    // Payroll should show $80 (from split), not $100 (declaration) or $180 (double)
    await page.goto('/payroll');
    const row = page.locator('[data-testid="payroll-row-diana"]');
    const tips = row.locator('[data-testid="tips-amount"]');
    await expect(tips).toContainText('$80.00');
    await expect(tips).not.toContainText('$100.00');
    await expect(tips).not.toContainText('$180.00');
  });
});
