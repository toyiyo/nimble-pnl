import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Smoke test for the Timeline view's popover-based create + edit path.
 *
 * Scope (per docs/superpowers/specs/2026-07-05-timeline-edit-create-design.md
 * "Test plan"): only the popover-driven quick-add and edit flows are covered
 * here. Pointer drag/resize choreography is explicitly excluded from E2E
 * coverage (Playwright drag flake risk) — that's pinned by unit tests on the
 * pure drag-math helpers instead.
 */

/** UTC offset string like "-05:00" for seeding shifts in local timezone. */
function getTimezoneOffsetString(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const absOffset = Math.abs(offset);
  const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const minutes = String(absOffset % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

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

test.describe('Timeline view — shift create/edit via popover', () => {
  test('creates a shift via quick-add popover and edits it via the shift popover', async ({ page }) => {
    const testUser = generateTestUser('timeline-edit-create');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed two active employees — the Timeline groups lanes by area by
    // default; with no area set, both fall into a single "Unassigned" lane
    // (see TimelineLane's `displayLabel = label || 'Unassigned'`).
    //
    // A lane (and its sr-only "Add shift" entry point) only renders once at
    // least one shift already exists that day — an empty day shows a
    // "No shifts scheduled" message instead (ShiftTimelineTab.tsx, the
    // `model.lanes.length === 0` branch backed by `buildLanes` in
    // src/lib/timelineModel.ts, which returns zero lanes for zero shifts).
    // So we seed an anchor shift for a second employee first, giving the
    // Unassigned lane a shift to render, then use its "Add shift" button to
    // create Dana Ortiz's shift via the quick-add popover.
    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Dana Ortiz', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1600 },
          { name: 'Anchor Alvarez', position: 'Host', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500 },
        ],
        restId: restaurantId,
      },
    );
    const dana = (employees as any[]).find((e: any) => e.name === 'Dana Ortiz');
    const anchor = (employees as any[]).find((e: any) => e.name === 'Anchor Alvarez');
    expect(dana).toBeTruthy();
    expect(anchor).toBeTruthy();

    const monday = getMondayOfCurrentWeek();
    const monStr = formatDate(monday);
    const tzStr = getTimezoneOffsetString();

    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertShifts(rows, restId),
      {
        rows: [{
          employee_id: anchor.id,
          start_time: `${monStr}T08:00:00${tzStr}`,
          end_time: `${monStr}T12:00:00${tzStr}`,
          position: 'Host',
          status: 'scheduled',
          break_duration: 0,
          is_published: false,
          locked: false,
        }],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    // Click Planner tab
    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    // Switch to Timeline view — ToggleGroupItem renders as a radio button
    const timelineToggle = page.getByRole('radio', { name: /^timeline$/i });
    await expect(timelineToggle).toBeVisible({ timeout: 10000 });
    await timelineToggle.click();

    // Navigate the day selector to Monday of this week, where the anchor
    // shift was seeded (the Timeline defaults to today).
    const mondayLabel = monday.toLocaleDateString('en-US', { weekday: 'short' });
    await page.getByRole('button', { name: new RegExp(`^${mondayLabel}`, 'i') }).click();

    // Sanity check: the anchor shift's bar is visible before we attempt to add a second.
    await expect(
      page.getByRole('button', { name: /anchor alvarez, host, 8a to 12p, 4\.0 hours/i }),
    ).toBeVisible({ timeout: 10000 });

    // ── CREATE path ──────────────────────────────────────────────────────────
    // The lane's keyboard entry point is a visually-hidden "Add shift to
    // <lane> lane" button (sr-only, TimelineLane.tsx). With no area set on
    // either employee, the lane's label is "Unassigned". It's an `sr-only`
    // element meant for keyboard/screen-reader activation (not a mouse
    // target sitting visibly in the layout), so we focus + activate it via
    // keyboard rather than a pointer click, matching its intended use.
    const addShiftButton = page.getByRole('button', { name: /^add shift to unassigned lane$/i });
    await expect(addShiftButton).toBeVisible({ timeout: 10000 });
    await addShiftButton.focus();
    await addShiftButton.press('Enter');

    // Quick-add popover opens with a "New shift" header
    await expect(page.getByText(/^new shift$/i)).toBeVisible({ timeout: 5000 });

    // Select the seeded employee
    await page.getByLabel(/select employee/i).click();
    await page.getByRole('option', { name: /dana ortiz/i }).click();

    // Confirm/set start & end time (native time inputs, labeled "Start Time" / "End Time")
    await page.getByLabel(/start time/i).fill('09:00');
    await page.getByLabel(/end time/i).fill('13:00');

    const createResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('rest/v1/shifts') && resp.request().method() === 'POST' && resp.status() === 201,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: /^add shift$/i }).click();
    await createResponsePromise;

    // Popover closes and the new shift bar appears on the timeline. Each bar is
    // a <button> whose accessible name is "<employee>, <position>, <start> to
    // <end>, <hours> hours" (TimelineBar.tsx / timelineModel.ts assignRows —
    // times formatted via minutesToCompact, e.g. "9a to 1p").
    await expect(page.getByText(/^new shift$/i)).not.toBeVisible({ timeout: 5000 });
    const createdBar = page.getByRole('button', { name: /dana ortiz, server, 9a to 1p, 4\.0 hours/i });
    await expect(createdBar).toBeVisible({ timeout: 10000 });

    // ── EDIT path ─────────────────────────────────────────────────────────────
    // Click the shift bar just created to open its view popover.
    await createdBar.click();

    const editButton = page.getByRole('button', { name: /^edit$/i });
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    // Extend the end time by an hour: 13:00 -> 14:00
    const endTimeInput = page.getByLabel(/end time/i);
    await expect(endTimeInput).toBeVisible({ timeout: 5000 });
    await endTimeInput.fill('14:00');

    const updateResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('rest/v1/shifts') &&
        ['PATCH', 'PUT'].includes(resp.request().method()) &&
        resp.status() < 300,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: /^save$/i }).click();
    await updateResponsePromise;

    // The updated time range is reflected on the timeline (new accessible name);
    // the old accessible name is gone.
    await expect(
      page.getByRole('button', { name: /dana ortiz, server, 9a to 2p, 5\.0 hours/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('button', { name: /dana ortiz, server, 9a to 1p, 4\.0 hours/i }),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('edits an existing shift seeded directly via Supabase', async ({ page }) => {
    const testUser = generateTestUser('timeline-edit-seeded');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const employees = await page.evaluate(
      ({ emps, restId }) => (window as any).__insertEmployees(emps, restId),
      {
        emps: [
          { name: 'Evan Cruz', position: 'Cook', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1700 },
        ],
        restId: restaurantId,
      },
    );
    const evan = (employees as any[]).find((e: any) => e.name === 'Evan Cruz');
    expect(evan).toBeTruthy();

    const monday = getMondayOfCurrentWeek();
    const monStr = formatDate(monday);
    const tzStr = getTimezoneOffsetString();

    // Seed a shift for today-or-Monday directly, independent of the create path,
    // so this test doesn't depend on the quick-add flow consuming a shift first.
    await page.evaluate(
      ({ rows, restId }: any) => (window as any).__insertShifts(rows, restId),
      {
        rows: [{
          employee_id: evan.id,
          start_time: `${monStr}T10:00:00${tzStr}`,
          end_time: `${monStr}T15:00:00${tzStr}`,
          position: 'Cook',
          status: 'scheduled',
          break_duration: 0,
          is_published: false,
          locked: false,
        }],
        restId: restaurantId,
      },
    );

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });

    const plannerTab = page.getByRole('tab', { name: /planner/i });
    await expect(plannerTab).toBeVisible({ timeout: 10000 });
    await plannerTab.click();

    const timelineToggle = page.getByRole('radio', { name: /^timeline$/i });
    await expect(timelineToggle).toBeVisible({ timeout: 10000 });
    await timelineToggle.click();

    // Navigate the day selector to Monday of this week (the Timeline defaults
    // to today, which may not be the day the shift was seeded on).
    const mondayLabel = monday.toLocaleDateString('en-US', { weekday: 'short' });
    await page.getByRole('button', { name: new RegExp(`^${mondayLabel}`, 'i') }).click();

    // Accessible name: "<employee>, <position>, <start> to <end>, <hours> hours"
    // (10:00-15:00 -> "10a to 3p", 5.0 hours).
    const shiftBar = page.getByRole('button', { name: /evan cruz, cook, 10a to 3p, 5\.0 hours/i });
    await expect(shiftBar).toBeVisible({ timeout: 10000 });
    await shiftBar.click();

    const editButton = page.getByRole('button', { name: /^edit$/i });
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    // Shift the start time an hour later: 10:00 -> 11:00
    const startTimeInput = page.getByLabel(/start time/i);
    await expect(startTimeInput).toBeVisible({ timeout: 5000 });
    await startTimeInput.fill('11:00');

    const updateResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('rest/v1/shifts') &&
        ['PATCH', 'PUT'].includes(resp.request().method()) &&
        resp.status() < 300,
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: /^save$/i }).click();
    await updateResponsePromise;

    await expect(
      page.getByRole('button', { name: /evan cruz, cook, 11a to 3p, 4\.0 hours/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('button', { name: /evan cruz, cook, 10a to 3p, 5\.0 hours/i }),
    ).not.toBeVisible({ timeout: 5000 });
  });
});
