import { test, expect } from '@playwright/test';
import fs from 'fs';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

test.describe('Time Punch Upload', () => {
  test('imports punches after resolving unmatched employees', async ({ page }, testInfo) => {
    const testUser = generateTestUser();

    await signUpAndCreateRestaurant(page, testUser);

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
