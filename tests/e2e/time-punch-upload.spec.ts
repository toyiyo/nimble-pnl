import { test, expect } from '@playwright/test';
import fs from 'fs';

const generateTestUser = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return {
    email: `time-punch-${timestamp}-${random}@test.com`,
    password: 'TestPassword123!',
    fullName: `Time Punch Test User ${timestamp}`,
    restaurantName: `Time Punch Restaurant ${timestamp}`,
  };
};

test.describe('Time Punch Upload', () => {
  test('imports punches after resolving unmatched employees', async ({ page }, testInfo) => {
    const testUser = generateTestUser();

    await page.goto('/');
    await page.waitForURL(/\/(auth)?$/, { timeout: 8000 });

    if (page.url().endsWith('/')) {
      const signInLink = page.getByRole('link', { name: /sign in|log in|get started/i });
      if (await signInLink.isVisible().catch(() => false)) {
        await signInLink.click();
        await page.waitForURL('/auth', { timeout: 8000 });
      }
    }

    await expect(page.getByRole('tab', { name: /sign up/i })).toBeVisible({ timeout: 8000 });
    await page.getByRole('tab', { name: /sign up/i }).click();
    await page.getByLabel(/email/i).first().fill(testUser.email);
    await page.getByLabel(/full name/i).fill(testUser.fullName);
    await page.getByLabel(/password/i).first().fill(testUser.password);
    await page.getByRole('button', { name: /sign up|create account/i }).click();
    await page.waitForURL('/', { timeout: 10000 });

    const addRestaurantButton = page.getByRole('button', { name: /add restaurant/i });
    await expect(addRestaurantButton).toBeVisible({ timeout: 8000 });
    await addRestaurantButton.click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Add New Restaurant' });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByLabel(/restaurant name/i).fill(testUser.restaurantName);
    await dialog.getByLabel(/address/i).fill('123 Test St');
    await dialog.getByLabel(/phone/i).fill('555-TEST-123');
    await dialog.getByRole('button', { name: /create|add/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    await page.goto('/time-punches');
    await page.waitForURL(/\/time-punches/, { timeout: 8000 });

    await page.getByRole('button', { name: /upload punches/i }).click();
    await expect(page.getByRole('heading', { name: /upload time punches/i })).toBeVisible({ timeout: 5000 });

    const csv = [
      'Employee,Anomalies,Location,Job,Date,Time In,Time Out,Auto Clock-out,Total Hours,Unpaid Break Time,Paid Break Time,Cash Tips Declared,Payable Hours',
      'Lopez, Bianca,,2026 Babcock Road,Owner,Jan 12, 2026,08:50 AM,04:12 PM,false,7.38,0.00,0.00,12.00,7.38',
    ].join('\n');

    const filePath = testInfo.outputPath('time-punches.csv');
    fs.writeFileSync(filePath, csv);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    await expect(page.getByText(/preview summary/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/unmatched employees/i)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /^create$/i }).first().click();
    await expect(page.getByText(/2 punches detected/i)).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /import & review/i }).click();


    const employeeButton = page.getByRole('button', { name: /Lopez/i }).first();
    const importedBadge = page.locator('div[data-component-name="Badge"]', { hasText: 'Imported' }).first();
    await employeeButton.click();
    await importedBadge.scrollIntoViewIfNeeded();
    await expect(importedBadge).toBeVisible({ timeout: 10000 });
  });
});
