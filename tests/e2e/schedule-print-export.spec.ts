import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

function getMondayOfCurrentWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTimezoneOffsetString(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const minutes = String(absOffset % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

async function setupWithShifts(page: any) {
  const testUser = generateTestUser('schprint');
  await signUpAndCreateRestaurant(page, testUser);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  const employees = await page.evaluate(
    ({ emps, restId }: any) => (window as any).__insertEmployees(emps, restId),
    {
      emps: [
        { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        { name: 'Bob Smith', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        { name: 'Carlos Rivera', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
        { name: 'Diana Lee', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
      ],
      restId: restaurantId,
    },
  );

  const alice = (employees as any[]).find((e: any) => e.name === 'Alice Johnson');
  const bob = (employees as any[]).find((e: any) => e.name === 'Bob Smith');
  const carlos = (employees as any[]).find((e: any) => e.name === 'Carlos Rivera');
  const diana = (employees as any[]).find((e: any) => e.name === 'Diana Lee');

  const monday = getMondayOfCurrentWeek();
  const tuesday = new Date(monday);
  tuesday.setDate(monday.getDate() + 1);
  const tzStr = getTimezoneOffsetString();
  const mondayStr = formatDate(monday);
  const tuesdayStr = formatDate(tuesday);

  await page.evaluate(
    ({ rows, restId }: any) => (window as any).__insertShifts(rows, restId),
    {
      rows: [
        { employee_id: alice.id, start_time: `${mondayStr}T08:00:00${tzStr}`, end_time: `${mondayStr}T16:00:00${tzStr}`, position: 'Server', status: 'scheduled', break_duration: 0, is_published: false, locked: false },
        { employee_id: bob.id, start_time: `${mondayStr}T10:00:00${tzStr}`, end_time: `${mondayStr}T18:00:00${tzStr}`, position: 'Server', status: 'scheduled', break_duration: 0, is_published: false, locked: false },
        { employee_id: carlos.id, start_time: `${mondayStr}T06:00:00${tzStr}`, end_time: `${mondayStr}T14:00:00${tzStr}`, position: 'Cook', status: 'scheduled', break_duration: 0, is_published: false, locked: false },
        { employee_id: diana.id, start_time: `${tuesdayStr}T16:00:00${tzStr}`, end_time: `${tuesdayStr}T23:00:00${tzStr}`, position: 'Cook', status: 'scheduled', break_duration: 0, is_published: false, locked: false },
      ],
      restId: restaurantId,
    },
  );

  return { restaurantId, alice, bob, carlos, diana };
}

/** Helper to find an employee checkbox by aria-label within the dialog. */
function empCheckbox(dialog: any, name: string) {
  return dialog.locator(`[aria-label="Include ${name}"]`);
}

async function openPrintDialog(page: any) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });
  await page.waitForTimeout(2000);

  const printButton = page.getByRole('button', { name: 'Print', exact: true });
  await expect(printButton).toBeEnabled({ timeout: 8000 });
  await printButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  // Wait for employee list to render
  await expect(dialog.getByText(/of \d+/)).toBeVisible({ timeout: 5000 });
  return dialog;
}

test.describe('Schedule Print/Export — Employee Selection', () => {
  test('all employees are checked by default and preview shows them', async ({ page }) => {
    await setupWithShifts(page);
    const dialog = await openPrintDialog(page);

    // All 4 employees should have checkboxes and be checked
    for (const name of ['Alice Johnson', 'Bob Smith', 'Carlos Rivera', 'Diana Lee']) {
      const cb = empCheckbox(dialog, name);
      await expect(cb).toBeVisible();
      await expect(cb).toBeChecked();
    }

    // Count badge should show "4 of 4"
    await expect(dialog.getByText('4 of 4')).toBeVisible();

    // Staff count in preview footer
    await expect(dialog.getByText('4 staff scheduled')).toBeVisible();

    // Download button should be enabled
    await expect(dialog.getByRole('button', { name: /download pdf/i })).toBeEnabled();
  });

  test('unchecking employees updates preview and count', async ({ page }) => {
    await setupWithShifts(page);
    const dialog = await openPrintDialog(page);

    // Uncheck Alice and Bob
    await empCheckbox(dialog, 'Alice Johnson').click();
    await empCheckbox(dialog, 'Bob Smith').click();

    // Count badge should show "2 of 4"
    await expect(dialog.getByText('2 of 4')).toBeVisible();

    // Staff count should update
    await expect(dialog.getByText('2 staff scheduled')).toBeVisible();

    // Preview should not show Alice or Bob
    await expect(dialog.locator('table').getByText('Alice')).not.toBeVisible();
    await expect(dialog.locator('table').getByText('Bob')).not.toBeVisible();

    // Preview should still show Carlos and Diana
    await expect(dialog.locator('table').getByText('Carlos')).toBeVisible();
    await expect(dialog.locator('table').getByText('Diana')).toBeVisible();
  });

  test('Select All and Deselect All buttons work', async ({ page }) => {
    await setupWithShifts(page);
    const dialog = await openPrintDialog(page);

    // Click Deselect All
    await dialog.getByRole('button', { name: 'Deselect all employees' }).click();

    // All should be unchecked
    await expect(dialog.getByText('0 of 4')).toBeVisible();
    await expect(dialog.getByText('0 staff scheduled')).toBeVisible();

    for (const name of ['Alice Johnson', 'Bob Smith', 'Carlos Rivera', 'Diana Lee']) {
      await expect(empCheckbox(dialog, name)).not.toBeChecked();
    }

    // Click Select All
    await dialog.getByRole('button', { name: 'Select all employees', exact: true }).click();

    // All should be checked again
    await expect(dialog.getByText('4 of 4')).toBeVisible();
    await expect(dialog.getByText('4 staff scheduled')).toBeVisible();
  });

  test('Download button is disabled when no employees selected', async ({ page }) => {
    await setupWithShifts(page);
    const dialog = await openPrintDialog(page);

    // Deselect all
    await dialog.getByRole('button', { name: 'Deselect all employees' }).click();

    // Download button should be disabled
    await expect(dialog.getByRole('button', { name: /download pdf/i })).toBeDisabled();

    // "No employees selected" message in preview
    await expect(dialog.getByText(/no employees selected/i)).toBeVisible();
  });

  test('position filter narrows the employee list in print dialog', async ({ page }) => {
    await setupWithShifts(page);

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.waitForTimeout(2000);

    // Set position filter to "Cook"
    const positionSelect = page.locator('#position-filter');
    await positionSelect.click();
    await page.getByRole('option', { name: 'Cook' }).click();
    await page.waitForTimeout(500);

    // Open print dialog
    const printButton = page.getByRole('button', { name: 'Print', exact: true });
    await expect(printButton).toBeEnabled({ timeout: 8000 });
    await printButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/of \d+/)).toBeVisible({ timeout: 5000 });

    // Only Cook employees should appear
    await expect(empCheckbox(dialog, 'Carlos Rivera')).toBeVisible();
    await expect(empCheckbox(dialog, 'Diana Lee')).toBeVisible();

    // Server employees should NOT appear
    await expect(empCheckbox(dialog, 'Alice Johnson')).not.toBeVisible();
    await expect(empCheckbox(dialog, 'Bob Smith')).not.toBeVisible();

    // Count should show "2 of 2"
    await expect(dialog.getByText('2 of 2')).toBeVisible();
  });

  test('PDF download triggers with selected employees only', async ({ page }) => {
    await setupWithShifts(page);
    const dialog = await openPrintDialog(page);

    // Uncheck Carlos and Diana (keep only Servers)
    await empCheckbox(dialog, 'Carlos Rivera').click();
    await empCheckbox(dialog, 'Diana Lee').click();

    // Verify 2 of 4 selected
    await expect(dialog.getByText('2 of 4')).toBeVisible();

    // Click Download and verify a download event fires
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /download pdf/i }).click();
    const download = await downloadPromise;

    // Verify filename pattern
    expect(download.suggestedFilename()).toMatch(/^schedule_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
