import { test, expect } from '@playwright/test';
import fs from 'fs';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Generate a minimal Sling-format CSV string.
 * Sling CSVs have a first column for employee names and date columns (YYYY-MM-DD).
 * Each cell contains shift blocks like:
 *   "10:00 AM - 6:00 PM • 8h\nServer • San Antonio\n "
 */
function buildSlingCsv(
  employees: string[],
  dates: string[],
  shiftSpec: { start: string; end: string; hours: string; position: string; location: string } = {
    start: '10:00 AM',
    end: '6:00 PM',
    hours: '8h',
    position: 'Server',
    location: 'San Antonio',
  },
): string {
  const headers = ['', ...dates];

  const rows: string[][] = [];

  // Section header row (Sling exports include these)
  rows.push(['Scheduled shifts', ...dates.map(() => '')]);

  for (const emp of employees) {
    const cells = dates.map(
      () => `${shiftSpec.start} - ${shiftSpec.end} • ${shiftSpec.hours}\n${shiftSpec.position} • ${shiftSpec.location}\n `,
    );
    rows.push([emp, ...cells]);
  }

  // Build CSV text — cells with newlines need quoting
  const csvRows = [headers.join(',')];
  for (const row of rows) {
    csvRows.push(row.map((cell) => (cell.includes('\n') || cell.includes(',') ? `"${cell}"` : cell)).join(','));
  }

  return csvRows.join('\n');
}

test.describe('Shift CSV Import', () => {
  test('full Sling CSV import flow with matched and unmatched employees', async ({ page }, testInfo) => {
    const testUser = generateTestUser('shift-import');

    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // Seed 2 known employees
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await page.evaluate(
      ({ emps, restId }) =>
        (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Abraham Dominguez', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
          { name: 'Alfonso Moya', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    // Navigate to scheduling and wait for employee data to load
    const empResponse1 = page.waitForResponse(
      resp => resp.url().includes('rest/v1/employees') && resp.ok(),
    );
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await empResponse1;

    // Click Import button
    const importButton = page.getByRole('button', { name: 'Import', exact: true });
    await expect(importButton).toBeVisible({ timeout: 5000 });
    await importButton.click();

    // Verify sheet opens
    await expect(page.getByRole('heading', { name: /import shifts/i })).toBeVisible({ timeout: 5000 });

    // Generate Sling CSV with 2 known + 1 unknown employee
    const dates = ['2026-03-02', '2026-03-03', '2026-03-04'];
    const csv = buildSlingCsv(['Abraham Dominguez', 'Alfonso Moya', 'Unknown Employee'], dates);
    const filePath = testInfo.outputPath('shifts.csv');
    fs.writeFileSync(filePath, csv);

    // Upload the CSV
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    // Should auto-detect Sling format and skip to Employees step
    await expect(page.getByText(/employees matched/i)).toBeVisible({ timeout: 10000 });

    // Verify matched employees show green "Matched" badge
    const matchedBadges = page.getByText('Matched', { exact: true });
    await expect(matchedBadges.first()).toBeVisible({ timeout: 5000 });

    // Verify unmatched employee shows "Unmatched" badge
    await expect(page.getByText('Unmatched', { exact: true })).toBeVisible({ timeout: 5000 });

    // Click "Create All Unmatched"
    await page.getByRole('button', { name: /create all unmatched/i }).click();

    // Wait for the badge to change from "Unmatched" to "Matched"
    await expect(page.getByText('Unmatched', { exact: true })).not.toBeVisible({ timeout: 10000 });

    // Click Next to go to Preview
    await page.getByRole('button', { name: /next/i }).click();

    // Verify Preview step loaded (use total shifts count — unique to preview)
    await expect(page.getByText(/\d+ total shifts/)).toBeVisible({ timeout: 10000 });

    // Import the shifts
    const importShiftsButton = page.getByRole('button', { name: /import \d+ shifts/i });
    await expect(importShiftsButton).toBeVisible({ timeout: 5000 });
    await importShiftsButton.click();

    // Verify success toast
    await expect(page.getByText('Import complete', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('individual Create button creates employee and matches shifts', async ({ page }, testInfo) => {
    const testUser = generateTestUser('shift-create');

    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed 1 known employee
    await page.evaluate(
      ({ emps, restId }) =>
        (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Abraham Dominguez', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    // Navigate to scheduling and wait for employee data to load
    const empResponse2 = page.waitForResponse(
      resp => resp.url().includes('rest/v1/employees') && resp.ok(),
    );
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await empResponse2;

    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('heading', { name: /import shifts/i })).toBeVisible({ timeout: 5000 });

    // CSV with 1 known + 1 unknown
    const dates = ['2026-03-02', '2026-03-03', '2026-03-04'];
    const csv = buildSlingCsv(['Abraham Dominguez', 'New Employee'], dates);
    const filePath = testInfo.outputPath('shifts-create.csv');
    fs.writeFileSync(filePath, csv);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    await expect(page.getByText(/employees matched/i)).toBeVisible({ timeout: 10000 });

    // Click the individual "Create" button for the unmatched employee
    const createButton = page.getByRole('button', { name: /create employee new employee/i });
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await createButton.click();

    // Wait for the employee's badge to change from "Unmatched" to "Matched"
    await expect(page.getByText('Unmatched', { exact: true })).not.toBeVisible({ timeout: 10000 });

    // All employees should now be matched
    const matchedBadges = page.getByText('Matched', { exact: true });
    await expect(matchedBadges).toHaveCount(2, { timeout: 5000 });

    // Click Next → Preview step
    await page.getByRole('button', { name: /next/i }).click();

    // All shifts should be "Ready" (none skipped) — use total shifts count to avoid strict mode
    await expect(page.getByText(/\d+ total shifts/)).toBeVisible({ timeout: 10000 });

    // If a Skipped card exists its count should be 0
    const skippedCard = page.getByText('Skipped').locator('xpath=..').locator('p');
    const isPresent = await skippedCard.isVisible().catch(() => false);
    if (isPresent) {
      await expect(skippedCard).not.toHaveText(/^[1-9]/);
    }
  });

  test('duplicate detection on second import', async ({ page }, testInfo) => {
    const testUser = generateTestUser('shift-dup');

    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed 1 employee
    await page.evaluate(
      ({ emps, restId }) =>
        (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Abraham Dominguez', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );

    // Navigate to scheduling and wait for employee data to load
    const empResponse3 = page.waitForResponse(
      resp => resp.url().includes('rest/v1/employees') && resp.ok(),
    );
    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await empResponse3;

    // --- First import ---
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('heading', { name: /import shifts/i })).toBeVisible({ timeout: 5000 });

    const dates = ['2026-03-02', '2026-03-03', '2026-03-04'];
    const csv = buildSlingCsv(['Abraham Dominguez'], dates);
    const filePath = testInfo.outputPath('shifts-dup.csv');
    fs.writeFileSync(filePath, csv);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    await expect(page.getByText(/employees matched/i)).toBeVisible({ timeout: 10000 });

    // Click Next → Preview
    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.getByText(/\d+ total shifts/)).toBeVisible({ timeout: 10000 });

    // Import
    const importBtn = page.getByRole('button', { name: /import \d+ shifts/i });
    await expect(importBtn).toBeVisible({ timeout: 5000 });
    await importBtn.click();
    await expect(page.getByText('Import complete', { exact: true })).toBeVisible({ timeout: 10000 });

    // --- Second import with same CSV ---
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('heading', { name: /import shifts/i })).toBeVisible({ timeout: 5000 });

    const fileInput2 = page.locator('input[type="file"]');
    await fileInput2.setInputFiles(filePath);

    await expect(page.getByText(/employees matched/i)).toBeVisible({ timeout: 10000 });

    // Click Next → Preview
    await page.getByRole('button', { name: /next/i }).click();

    // On preview, the Duplicates summary card should show the count matching the previously imported shifts
    // We imported 3 shifts (1 employee x 3 dates), so duplicates should be 3
    const duplicatesCard = page.getByText('Duplicates').locator('..');
    await expect(duplicatesCard).toBeVisible({ timeout: 10000 });

    // Verify the count "3" is shown within the Duplicates card
    await expect(duplicatesCard.getByText('3')).toBeVisible({ timeout: 5000 });
  });
});
