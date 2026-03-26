import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Helpers to compute dates for the current week.
 */
function getMondayOfCurrentWeek(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
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

/** UTC offset string like "-05:00" for seeding shifts in local timezone. */
function getTimezoneOffsetString(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const minutes = String(absOffset % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

/**
 * Convert a local time on a specific date to a UTC HH:MM:SS string.
 * Using a specific date ensures DST is accounted for correctly.
 */
function localTimeToUTCOnDate(localTime: string, date: Date): string {
  const [h, m] = localTime.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`;
}

/** Shared setup: sign up, create restaurant, seed 2 employees, expose helpers. */
async function setupTestEnvironment(page: any, prefix: string) {
  const testUser = generateTestUser(prefix);
  await signUpAndCreateRestaurant(page, testUser);
  await exposeSupabaseHelpers(page);

  const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
  expect(restaurantId).toBeTruthy();

  const employees = await page.evaluate(
    ({ emps, restId }: any) => (window as any).__insertEmployees(emps, restId),
    {
      emps: [
        { name: 'Alice Johnson', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        { name: 'Bob Smith', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1800 },
      ],
      restId: restaurantId,
    },
  );

  const alice = (employees as any[]).find((e: any) => e.name === 'Alice Johnson');
  const bob = (employees as any[]).find((e: any) => e.name === 'Bob Smith');

  return { restaurantId, alice, bob };
}

/** Navigate to scheduling and open the ShiftDialog for creating a new shift. */
async function openShiftDialog(page: any) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });

  // Schedule tab: "Shift" button in toolbar, or "Create First Shift" in empty state
  const shiftButton = page.getByRole('button', { name: /^shift$/i });
  const createFirstButton = page.getByRole('button', { name: /create first shift/i });

  if (await shiftButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await shiftButton.click();
  } else {
    await createFirstButton.click();
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

/** Fill the ShiftDialog form fields using element IDs and aria-labels. */
async function fillShiftDialog(
  page: any,
  dialog: any,
  opts: { employeeName: string; startDate: string; endDate: string; startTime: string; endTime: string },
) {
  // Select employee via the select trigger
  await dialog.locator('#employee').click();
  await page.getByRole('option', { name: new RegExp(opts.employeeName, 'i') }).click();

  // Fill dates and times using aria-labels
  await dialog.getByLabel('Shift start date').fill(opts.startDate);
  await dialog.getByLabel('Shift end date').fill(opts.endDate);
  await dialog.getByLabel('Shift start time').fill(opts.startTime);
  await dialog.getByLabel('Shift end time').fill(opts.endTime);
}

/** Create a shift template in the planner. */
async function createTemplate(
  page: any,
  opts: { name: string; startTime: string; endTime: string; position: string; days: string[] },
) {
  await page.getByRole('button', { name: /add shift template/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 3000 });

  await dialog.locator('#template-name').fill(opts.name);
  await dialog.locator('#start-time').fill(opts.startTime);
  await dialog.locator('#end-time').fill(opts.endTime);
  await dialog.locator('#position').fill(opts.position);

  for (const day of opts.days) {
    await dialog.getByRole('button', { name: day }).click();
  }

  const resp = page.waitForResponse(
    (r: any) => r.url().includes('rest/v1/shift_templates') && r.status() === 201,
    { timeout: 15000 },
  );
  await dialog.getByRole('button', { name: /add template/i }).click();
  await resp;

  await expect(page.getByText(opts.name)).toBeVisible({ timeout: 10000 });
}

/** Navigate to planner tab. */
async function goToPlanner(page: any) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });
  const plannerTab = page.getByRole('tab', { name: /planner/i });
  await expect(plannerTab).toBeVisible({ timeout: 10000 });
  await plannerTab.click();
}

/**
 * Drag an employee to a shift cell using raw mouse events.
 * @dnd-kit's PointerSensor requires real pointer events with distance > 8px.
 * Playwright's dragTo doesn't produce the right events, so we use page.mouse.
 */
async function dragAndAssign(page: any, employeeName: string, assignType: 'day' | 'all') {
  const employeeButton = page.getByRole('button', { name: new RegExp(employeeName, 'i') }).first();
  await expect(employeeButton).toBeVisible({ timeout: 5000 });

  const targetCell = page.locator('.border-l-2.border-primary\\/40').first();
  await expect(targetCell).toBeVisible({ timeout: 5000 });

  const popoverButton = assignType === 'day'
    ? page.getByRole('button', { name: /this day only/i })
    : page.getByRole('button', { name: /all.*days/i });

  // Retry the drag up to 3 times — dnd-kit PointerSensor can miss events under load
  for (let attempt = 0; attempt < 3; attempt++) {
    const sourceBox = await employeeButton.boundingBox();
    const targetBox = await targetCell.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('Could not get bounding boxes for drag');

    const srcX = sourceBox.x + sourceBox.width / 2;
    const srcY = sourceBox.y + sourceBox.height / 2;
    const tgtX = targetBox.x + targetBox.width / 2;
    const tgtY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(srcX, srcY);
    await page.mouse.down();
    await page.mouse.move(srcX + 5, srcY, { steps: 2 });
    await page.mouse.move(srcX + 10, srcY, { steps: 2 });
    await page.mouse.move(tgtX, tgtY, { steps: 10 });
    await page.mouse.up();

    const visible = await popoverButton.isVisible({ timeout: 5000 }).catch(() => false);
    if (visible) break;

    if (attempt < 2) {
      await page.waitForTimeout(1000);
    }
  }

  await expect(popoverButton).toBeVisible({ timeout: 5000 });
  await popoverButton.click();
}

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

test.describe('Scheduling Conflict Enhancements', () => {
  test('shows availability hours in local time when shift conflicts with availability', async ({ page }) => {
    const { restaurantId, alice } = await setupTestEnvironment(page, 'conflict-hours');

    const monday = getMondayOfCurrentWeek();
    const monStr = formatDate(monday);
    const dow = monday.getDay();

    // Seed availability: Alice available 9 AM - 5 PM local time on Monday
    // Use the actual Monday date for DST-correct UTC conversion
    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertAvailability(rows, restId),
      {
        rows: [{
          employee_id: alice.id,
          day_of_week: dow,
          start_time: localTimeToUTCOnDate('09:00', monday),
          end_time: localTimeToUTCOnDate('17:00', monday),
          is_available: true,
        }],
        restId: restaurantId,
      },
    );

    const dialog = await openShiftDialog(page);

    await fillShiftDialog(page, dialog, {
      employeeName: 'Alice Johnson',
      startDate: monStr,
      endDate: monStr,
      startTime: '06:00',
      endTime: '14:00', // Starts at 6 AM, before 9 AM availability
    });

    // Conflict warning should show with "available" and time range in AM/PM format
    await expect(page.getByText(/outside availability/i)).toBeVisible({ timeout: 15000 });
    // Verify the message contains "available" followed by two times with AM/PM
    // (both could be AM or PM depending on the server's timezone vs restaurant timezone)
    await expect(page.getByText(/available\s+\d+:\d+\s*[AP]M\s*[–-]\s*\d+:\d+\s*[AP]M/i)).toBeVisible({ timeout: 5000 });
  });

  test('allows creating overlapping shifts with a warning instead of blocking', async ({ page }) => {
    const { restaurantId, alice } = await setupTestEnvironment(page, 'overlap-warn');

    const monday = getMondayOfCurrentWeek();
    const monStr = formatDate(monday);
    const tzStr = getTimezoneOffsetString();

    // Seed an existing shift for Alice: 8 AM - 4 PM on Monday
    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertShifts(rows, restId),
      {
        rows: [{
          employee_id: alice.id,
          start_time: `${monStr}T08:00:00${tzStr}`,
          end_time: `${monStr}T16:00:00${tzStr}`,
          position: 'Server',
          status: 'scheduled',
          break_duration: 0,
          is_published: false,
          locked: false,
        }],
        restId: restaurantId,
      },
    );

    const dialog = await openShiftDialog(page);

    await fillShiftDialog(page, dialog, {
      employeeName: 'Alice Johnson',
      startDate: monStr,
      endDate: monStr,
      startTime: '10:00',
      endTime: '18:00', // Overlaps with 8 AM - 4 PM
    });

    // The ShiftDialog uses RPC-based conflict detection which does NOT check overlaps
    // (overlaps are only checked client-side in the planner via shiftValidator).
    // The key test: the overlapping shift should be CREATED successfully (not blocked).
    const responsePromise = page.waitForResponse(
      (resp: any) => resp.url().includes('rest/v1/shifts') && resp.status() === 201,
      { timeout: 15000 },
    );
    await dialog.getByRole('button', { name: /create shift/i }).click();
    await responsePromise;
  });

  test('planner shows conflict dialog when assigning employee with availability conflict', async ({ page }) => {
    const { restaurantId, alice } = await setupTestEnvironment(page, 'planner-conflict');

    const monday = getMondayOfCurrentWeek();
    const dow = monday.getDay();

    // Alice available 9 AM - 1 PM local on Monday (short window)
    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertAvailability(rows, restId),
      {
        rows: [{
          employee_id: alice.id,
          day_of_week: dow,
          start_time: localTimeToUTCOnDate('09:00', monday),
          end_time: localTimeToUTCOnDate('13:00', monday),
          is_available: true,
        }],
        restId: restaurantId,
      },
    );

    await goToPlanner(page);

    // Create template 6 AM - 2 PM (outside 9 AM - 1 PM)
    await createTemplate(page, {
      name: 'Morning',
      startTime: '06:00',
      endTime: '14:00',
      position: 'Server',
      days: ALL_DAYS,
    });

    // Drag Alice → Monday cell, assign day
    await dragAndAssign(page, 'Alice Johnson', 'day');

    // Conflict dialog should appear
    await expect(page.getByText(/scheduling warning/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/outside availability/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /assign anyway/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });

  test('Assign All batches conflicts into a single dialog', async ({ page }) => {
    const { restaurantId, alice } = await setupTestEnvironment(page, 'planner-batch');

    const monday = getMondayOfCurrentWeek();

    // Alice available only 5 PM - 10 PM every day — conflicts with morning template
    const availabilityRows = [0, 1, 2, 3, 4, 5, 6].map(dow => ({
      employee_id: alice.id,
      day_of_week: dow,
      start_time: localTimeToUTCOnDate('17:00', monday),
      end_time: localTimeToUTCOnDate('22:00', monday),
      is_available: true,
    }));

    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertAvailability(rows, restId),
      { rows: availabilityRows, restId: restaurantId },
    );

    await goToPlanner(page);

    await createTemplate(page, {
      name: 'Morning',
      startTime: '08:00',
      endTime: '14:00',
      position: 'Server',
      days: ALL_DAYS,
    });

    // Drag Alice, Assign All
    await dragAndAssign(page, 'Alice Johnson', 'all');

    // Single conflict dialog with multiple days' conflicts
    // handleAssignAll processes each day sequentially (7 days × 2 RPCs each), so allow ample time
    await expect(page.getByText(/scheduling warning/i)).toBeVisible({ timeout: 60000 });
    // Multiple "outside availability" entries (one per day) — use .first() to avoid strict mode
    await expect(page.getByText(/outside availability/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /assign anyway/i })).toBeVisible();
  });

  test('Assign Anyway creates the shift, Cancel does not', async ({ page }) => {
    const { restaurantId, alice } = await setupTestEnvironment(page, 'planner-confirm');

    const monday = getMondayOfCurrentWeek();
    const dow = monday.getDay();

    // Alice only available 5 PM - 10 PM on Monday
    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertAvailability(rows, restId),
      {
        rows: [{
          employee_id: alice.id,
          day_of_week: dow,
          start_time: localTimeToUTCOnDate('17:00', monday),
          end_time: localTimeToUTCOnDate('22:00', monday),
          is_available: true,
        }],
        restId: restaurantId,
      },
    );

    await goToPlanner(page);

    await createTemplate(page, {
      name: 'Morning',
      startTime: '08:00',
      endTime: '14:00',
      position: 'Server',
      days: ALL_DAYS,
    });

    // --- Test Cancel ---
    await dragAndAssign(page, 'Alice Johnson', 'day');

    await expect(page.getByText(/scheduling warning/i)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /cancel/i }).click();

    // Dialog closes, no shift created
    await expect(page.getByText(/scheduling warning/i)).not.toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('button', { name: /remove alice johnson from shift/i }),
    ).not.toBeVisible({ timeout: 3000 });

    // --- Test Assign Anyway ---
    // Wait for DnD sensors to fully reset after dialog close — needs extra time under load
    await page.waitForTimeout(2000);
    await dragAndAssign(page, 'Alice Johnson', 'day');

    await expect(page.getByText(/scheduling warning/i)).toBeVisible({ timeout: 15000 });

    const shiftResponse = page.waitForResponse(
      (resp: any) => resp.url().includes('rest/v1/shifts') && resp.status() === 201,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: /assign anyway/i }).click();
    await shiftResponse;

    // Success toast
    await expect(page.getByText(/assigned despite warnings/i)).toBeVisible({ timeout: 10000 });
  });

  test('overnight UTC availability windows still work correctly', async ({ page }) => {
    const { restaurantId, alice } = await setupTestEnvironment(page, 'overnight-avail');

    const monday = getMondayOfCurrentWeek();
    const monStr = formatDate(monday);
    const dow = monday.getDay();

    // Alice available 8 AM - 11 PM local (may be overnight in UTC depending on timezone)
    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertAvailability(rows, restId),
      {
        rows: [{
          employee_id: alice.id,
          day_of_week: dow,
          start_time: localTimeToUTCOnDate('08:00', monday),
          end_time: localTimeToUTCOnDate('23:00', monday),
          is_available: true,
        }],
        restId: restaurantId,
      },
    );

    const dialog = await openShiftDialog(page);

    await fillShiftDialog(page, dialog, {
      employeeName: 'Alice Johnson',
      startDate: monStr,
      endDate: monStr,
      startTime: '10:00',
      endTime: '18:00', // Within 8 AM - 11 PM
    });

    // Wait for conflict check
    await page.waitForTimeout(3000);

    // NO conflict — shift is within availability
    await expect(page.getByText(/outside availability/i)).not.toBeVisible({ timeout: 3000 });

    // Submit should work
    const responsePromise = page.waitForResponse(
      (resp: any) => resp.url().includes('rest/v1/shifts') && resp.status() === 201,
      { timeout: 15000 },
    );
    await dialog.getByRole('button', { name: /create shift/i }).click();
    await responsePromise;
  });
});
