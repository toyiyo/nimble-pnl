import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant } from '../helpers/e2e-supabase';

test.describe('dashboard basis labels', () => {
  test('shows the basis labels and the reconciliation line', async ({ page }) => {
    const user = generateTestUser();
    await signUpAndCreateRestaurant(page, user);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Performance Overview' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Before other expenses', { exact: true })).toBeVisible();

    const cashflowHeading = page.getByRole('heading', { name: 'Cashflow', exact: true });
    await cashflowHeading.scrollIntoViewIfNeeded();
    await expect(page.getByText('Cash basis', { exact: true })).toBeVisible();
    await expect(page.getByText(/= Net \$/)).toBeVisible({ timeout: 20000 });

    const monthlyHeading = page.getByRole('heading', { name: 'Monthly Performance' });
    await monthlyHeading.scrollIntoViewIfNeeded();
    await expect(page.getByText('Accrual basis', { exact: true })).toBeVisible();
  });
});
