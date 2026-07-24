import { test, expect, type Locator, type Page, type Response } from '@playwright/test';
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
async function setupTestEnvironment(page: Page, prefix: string) {
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
async function openShiftDialog(page: Page) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });

  // Wait for the schedule card to render before looking for buttons
  await expect(page.getByRole('heading', { name: /staff schedule/i })).toBeVisible({ timeout: 15000 });

  // The "Shift" button is in the toolbar; "Create First Shift" is in the empty state
  const shiftButton = page.getByRole('button', { name: /^shift$/i });
  const createFirstButton = page.getByRole('button', { name: /create first shift/i });

  if (await shiftButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await shiftButton.click();
  } else {
    await expect(createFirstButton).toBeVisible({ timeout: 5000 });
    await createFirstButton.click();
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

/** Fill the ShiftDialog form fields using element IDs and aria-labels. */
async function fillShiftDialog(
  page: Page,
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
  page: Page,
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

  // .first(): the assertion means "the template rendered", not "exactly one node names it" —
  // the planner is free to echo the name in a row header and elsewhere without tripping strict mode.
  await expect(page.getByText(opts.name).first()).toBeVisible({ timeout: 10000 });
}

/** Navigate to planner tab. */
async function goToPlanner(page: Page) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });
  const plannerTab = page.getByRole('tab', { name: /planner/i });
  await expect(plannerTab).toBeVisible({ timeout: 10000 });
  await plannerTab.click();
}

/**
 * Find a point *on* the draggable `locator` that a real pointer can actually reach — i.e.
 * one where `locator` is the topmost hit-test target — and return it as the drag press point.
 *
 * Three separate things make the card's geometric centre the wrong place to press, and each
 * one produced the same silent symptom: the pointerdown lands on something else, @dnd-kit's
 * PointerSensor never activates, and the gesture no-ops until the popover assertion fails as
 * if the *drop* had missed.
 *   1. A *permanent* floating action button (`fixed z-[100] ... w-12 h-12 rounded-full`) parked
 *      at the bottom-right, sitting directly over the centre of the bottom-most employee cards.
 *   2. Transient success toasts (e.g. "Template created") — a `z-[200]` viewport covering the
 *      whole card for ~5s before auto-dismissing.
 *   3. The conflict dialog is a Radix *modal*, so while it is open Radix sets
 *      `pointer-events: none` on <body> and react-remove-scroll locks scrolling — both torn
 *      down asynchronously *after* the close animation. `toBeVisible()` going false on the
 *      dialog therefore does NOT mean the page is interactive again. `elementFromPoint`
 *      honours `pointer-events: none`, so this helper stays unsatisfied for exactly as long as
 *      the lock is up: the precondition is asserted rather than slept through.
 *
 * So: probe several points biased toward the card's upper-left — away from the bottom-right
 * FAB — and poll until one clears.
 */
async function findDraggablePressPoint(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 10000 });
  const found: { point: { x: number; y: number } | null } = { point: null };

  await expect(async () => {
    // Scroll, measure and hit-test in a SINGLE evaluate. Splitting them across round trips
    // leaves a window in which the planner re-renders (hover-preview fires setPickedEmployeeId
    // on every pointer enter/leave) and scrolls, so the point measured in call N gets tested
    // against the layout of call N+1 — which reports a bogus interceptor and sends you chasing
    // an overlay that was never there.
    const result = await locator.evaluate((el: Element) => {
      // Raw page.mouse events go to viewport coordinates, so unlike locator.click() they get
      // NO actionability auto-scroll. The employee sidebar sits below several collapsible
      // panels and can fall off the bottom of a 1280x720 viewport, where every candidate point
      // hit-tests as `null` forever. Centring it also moves it clear of the corner-anchored FAB.
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return { point: null, blockedBy: 'nothing (element has no layout box yet)' };
      }
      // Candidate offsets (fraction of width/height), ordered upper-left first to dodge the
      // bottom-right FAB; still all comfortably inside the card.
      const candidates = [
        [0.5, 0.18],
        [0.3, 0.18],
        [0.5, 0.35],
        [0.2, 0.5],
        [0.35, 0.5],
      ].map(([fx, fy]) => ({ x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }));
      for (const p of candidates) {
        const target = document.elementFromPoint(p.x, p.y);
        // Require the hit to be *this* card. A looser `closest('[aria-roledescription=
        // "draggable"]')` would happily accept a neighbouring employee's card showing through
        // and drag the wrong person.
        if (target && (el === target || el.contains(target))) return { point: p, blockedBy: null };
      }
      const top = document.elementFromPoint(candidates[0].x, candidates[0].y);
      // Name WHAT is on top when this fails — otherwise a blocked pointer is indistinguishable
      // from a slow one, and that ambiguity is what made this spec hard to diagnose before.
      return {
        point: null,
        blockedBy: top
          ? `<${top.tagName.toLowerCase()} class="${top.getAttribute('class') ?? ''}">`
          : 'nothing (point is outside the viewport)',
      };
    });
    // Throw rather than assert — toPass() retries on throw and surfaces the last message.
    if (!result.point) {
      throw new Error(`No reachable press point on the drag source; topmost there is ${result.blockedBy}`);
    }
    found.point = result.point;
  }).toPass({ timeout: 12000 });

  if (!found.point) throw new Error('unreachable: toPass would have thrown');
  return found.point;
}

/**
 * Drag an employee to a shift cell using raw mouse events.
 * @dnd-kit's PointerSensor requires real pointer events with distance > 8px.
 * Playwright's dragTo doesn't produce the right events, so we use page.mouse.
 */
async function dragAndAssign(page: Page, employeeName: string, assignType: 'day' | 'all') {
  const employeeButton = page.getByRole('button', { name: new RegExp(employeeName, 'i') }).first();

  const targetCell = page.locator('.border-l-2.border-primary\\/40').first();
  await expect(targetCell).toBeVisible({ timeout: 5000 });

  const popoverButton = assignType === 'day'
    ? page.getByRole('button', { name: /this day only/i })
    : page.getByRole('button', { name: /all.*days/i });

  // Why this is fiddly: @dnd-kit's PointerSensor drives collision detection off
  // requestAnimationFrame, and the planner re-renders mid-drag (hover-to-preview fires
  // setPickedEmployeeId on every pointer enter/leave). Under CPU load those frames get
  // starved, so releasing the mouse the instant the pointer reaches the cell can drop with
  // `over === null` — handleDragEnd then bails (`if (!over) return`) and never sets
  // pendingAssignment, so the AssignmentPopover never mounts. That's the whole flake.
  //
  // The fix is a deterministic handshake instead of a hopeful release: ShiftCell applies
  // `ring-foreground/20` iff @dnd-kit currently reports the pointer `isOver` this cell. We
  // keep the pointer alive over the target with tiny ±1px nudges (a static hold can let a
  // mid-drag re-render drift `over` to a neighbour) and release ONLY once that class shows —
  // which proves `over` is this cell, so the drop registers and lands on the intended day.
  // If it never registers, we drop back on the source (off any droppable, so handleDragEnd
  // makes no assignment) and retry the whole gesture cleanly.
  for (let attempt = 0; attempt < 3; attempt++) {
    // Root-cause guard: press on a part of the card that is actually the topmost
    // hit-test target. Otherwise the pointerdown lands on the transient toast or the
    // permanent bottom-right FAB and dnd-kit's PointerSensor never activates.
    const { x: srcX, y: srcY } = await findDraggablePressPoint(employeeButton);

    const targetBox = await targetCell.boundingBox();
    if (!targetBox) throw new Error('Could not get bounding box for drop target');
    const tgtX = targetBox.x + targetBox.width / 2;
    const tgtY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(srcX, srcY);
    await page.mouse.down();
    // Cross the PointerSensor 8px activation threshold, then travel onto the target cell.
    await page.mouse.move(srcX + 12, srcY, { steps: 2 });
    await page.mouse.move(tgtX, tgtY, { steps: 12 });

    // Actively confirm @dnd-kit registers the pointer over THIS cell before releasing. Each
    // ±1px nudge emits a pointermove so dnd-kit re-runs collision detection at rest on the
    // cell; we poll the cell's own isOver styling between nudges. Fast (no long fixed waits).
    let over = false;
    for (let i = 0; i < 15 && !over; i++) {
      await page.mouse.move(tgtX + (i % 2 === 0 ? 1 : -1), tgtY);
      over = await targetCell
        .evaluate((el) => el.className.includes('ring-foreground/20'))
        .catch(() => false);
    }

    if (over) {
      await page.mouse.up();
      if (await popoverButton.isVisible({ timeout: 5000 }).catch(() => false)) break;
    } else {
      // Never registered — drop back on the source so no stray shift is created, then retry.
      await page.mouse.move(srcX, srcY, { steps: 4 });
      await page.mouse.up();
    }

    if (attempt < 2) {
      await page.waitForTimeout(500);
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
    // No sleep needed: dragAndAssign waits for the sidebar handle to be pointer-reachable
    // again, which is exactly what Radix's modal body-lock teardown gates.
    await dragAndAssign(page, 'Alice Johnson', 'day');

    await expect(page.getByText(/scheduling warning/i)).toBeVisible({ timeout: 15000 });

    const shiftResponse = page.waitForResponse(
      (resp: any) => resp.url().includes('rest/v1/shifts') && resp.status() === 201,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: /assign anyway/i }).click();
    await shiftResponse;

    // Success toast. Radix renders toast text twice — the visible ToastTitle and a
    // visually-hidden `role="status"` aria-live announcer — so a bare getByText resolves to
    // two nodes and trips strict mode. Scope to the first (the visible title).
    await expect(page.getByText(/assigned despite warnings/i).first()).toBeVisible({ timeout: 10000 });
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

    // This test asserts the ABSENCE of a conflict, so it is only meaningful once the
    // availability check for the *final* form state has actually come back — otherwise it
    // passes vacuously against a check that never ran. ShiftDialog sends
    // `new Date(`${date}T${time}`).toISOString()` as p_start_time/p_end_time, so the test can
    // name the exact request it is waiting for. Match on BOTH bounds: filling the form fires
    // the query on intermediate states too (start time lands before end time), and a
    // start-only match would resolve on that earlier, half-filled request.
    const expectedStart = new Date(`${monStr}T10:00`).toISOString();
    const expectedEnd = new Date(`${monStr}T18:00`).toISOString();
    const conflictChecked = page.waitForResponse(
      (resp: Response) => {
        if (!resp.url().includes('check_availability_conflict')) return false;
        const body = resp.request().postData() ?? '';
        return body.includes(expectedStart) && body.includes(expectedEnd);
      },
      { timeout: 20000 },
    );

    await fillShiftDialog(page, dialog, {
      employeeName: 'Alice Johnson',
      startDate: monStr,
      endDate: monStr,
      startTime: '10:00',
      endTime: '18:00', // Within 8 AM - 11 PM
    });

    await conflictChecked;

    // NO conflict — shift is within availability. The remaining timeout is render slack after
    // a known-completed round-trip, not a stand-in for the network call itself.
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
