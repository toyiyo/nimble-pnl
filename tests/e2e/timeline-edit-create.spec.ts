import { test, expect, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Smoke test for the Timeline view's popover-based create + edit path.
 *
 * Scope (per docs/superpowers/specs/2026-07-05-timeline-edit-create-design.md
 * "Test plan"): only the popover-driven quick-add and edit flows are covered
 * here. Pointer drag/resize choreography is explicitly excluded from E2E
 * coverage (Playwright drag flake risk) — that's pinned by unit tests on the
 * pure drag-math helpers instead.
 *
 * Timezone discipline: `restaurants.timezone` DEFAULTS to 'America/Chicago',
 * and the Timeline renders shift bars in the restaurant's timezone. To keep the
 * test deterministic across host timezones (a dev machine on CT vs CI on UTC),
 * each test explicitly pins the restaurant timezone to 'UTC', seeds shifts as
 * UTC ('Z') instants on the host-local "today" (which the Timeline selects by
 * default), and locates bars by the tz-independent part of their accessible
 * name (employee + position) rather than exact clock labels.
 */

/** Host-local YYYY-MM-DD for today — matches the Timeline's default day selection. */
function todayLocalDateStr(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Pin the restaurant's timezone so bar rendering is deterministic regardless of host TZ. */
async function pinRestaurantTimezone(page: Page, restaurantId: string, timezone = 'UTC') {
  const error = await page.evaluate(
    async ({ restId, tz }) => {
      const supabase = (window as { __supabase?: { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } } } }).__supabase;
      if (!supabase) return 'no supabase helper';
      const { error } = await supabase.from('restaurants').update({ timezone: tz }).eq('id', restId);
      return error?.message ?? null;
    },
    { restId: restaurantId, tz: timezone },
  );
  expect(error).toBeNull();
}

/** Seed one employee and a shift on today (UTC instants) so a Timeline lane + bar renders. */
async function seedEmployeeAndShift(
  page: Page,
  restaurantId: string,
  employee: { name: string; position: string },
  hours: { startHour: number; endHour: number },
) {
  const inserted = await page.evaluate(
    ({ emps, restId }) => (window as { __insertEmployees: (e: unknown[], r: string) => Promise<Array<{ id: string; name: string }>> }).__insertEmployees(emps, restId),
    {
      emps: [{ ...employee, status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1600 }],
      restId: restaurantId,
    },
  );
  const emp = inserted.find((e) => e.name === employee.name)!;
  const day = todayLocalDateStr();
  const pad = (n: number) => n.toString().padStart(2, '0');

  await page.evaluate(
    ({ restId, empId, dayStr, sh, eh, position }) =>
      (window as { __insertShifts: (rows: unknown[], r: string) => Promise<unknown> }).__insertShifts(
        [{
          employee_id: empId,
          start_time: `${dayStr}T${sh}:00:00Z`,
          end_time: `${dayStr}T${eh}:00:00Z`,
          position,
          status: 'scheduled',
          break_duration: 0,
          is_published: false,
          locked: false,
        }],
        restId,
      ),
    { restId: restaurantId, empId: emp.id, dayStr: day, sh: pad(hours.startHour), eh: pad(hours.endHour), position: employee.position },
  );

  return emp;
}

/** Navigate to the planner and switch to the Timeline view (defaults to today). */
async function openTimeline(page: Page) {
  await page.goto('/scheduling');
  await page.waitForURL(/\/scheduling/, { timeout: 8000 });

  const plannerTab = page.getByRole('tab', { name: /planner/i });
  await expect(plannerTab).toBeVisible({ timeout: 10000 });
  await plannerTab.click();

  // Switch Plan -> Timeline (ToggleGroupItem renders with role="radio")
  const timelineToggle = page.getByRole('radio', { name: /^timeline$/i });
  await expect(timelineToggle).toBeVisible({ timeout: 10000 });
  await timelineToggle.click();
}

test.describe('Timeline view — shift create/edit via popover', () => {
  test('creates a shift via the quick-add popover', async ({ page }) => {
    const testUser = generateTestUser('timeline-create');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as { __getRestaurantId: () => Promise<string> }).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await pinRestaurantTimezone(page, restaurantId);

    // Seed an anchor shift so a lane (and its "Add shift" entry point) renders —
    // an empty day has zero lanes and no quick-add affordance by design.
    await seedEmployeeAndShift(page, restaurantId, { name: 'Anchor Alvarez', position: 'Host' }, { startHour: 8, endHour: 12 });
    // A second active employee to assign the new shift to.
    await page.evaluate(
      ({ emps, restId }) => (window as { __insertEmployees: (e: unknown[], r: string) => Promise<unknown> }).__insertEmployees(emps, restId),
      { emps: [{ name: 'Dana Ortiz', position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1600 }], restId: restaurantId },
    );

    await openTimeline(page);

    // Anchor bar renders (name-based locator — tz-independent).
    await expect(page.getByRole('button', { name: /anchor alvarez, host/i })).toBeVisible({ timeout: 10000 });

    // Open quick-add via the visible "Add shift" control (the discoverable entry
    // point). Before the popover opens, this is the only "Add shift" button.
    await page.getByRole('button', { name: /^add shift$/i }).click();

    // Quick-add popover opens.
    const createPopover = page.getByRole('dialog').filter({ hasText: /new shift/i });
    await expect(createPopover.getByText(/^new shift$/i)).toBeVisible({ timeout: 5000 });

    // Pick the employee for the new shift.
    await createPopover.getByLabel(/select employee/i).click();
    await page.getByRole('option', { name: /dana ortiz/i }).click();

    // Commit — assert the POST to shifts succeeds. Scope the submit to the
    // dialog so it isn't ambiguous with the controls-row "Add shift" button.
    const postPromise = page.waitForResponse(
      (resp) => resp.url().includes('/rest/v1/shifts') && resp.request().method() === 'POST' && resp.ok(),
      { timeout: 15000 },
    );
    await createPopover.getByRole('button', { name: /^add shift$/i }).click();
    await postPromise;

    // Dialog closes.
    await expect(page.getByText(/^new shift$/i)).not.toBeVisible({ timeout: 5000 });
  });

  test('edits an existing shift via the shift popover', async ({ page }) => {
    const testUser = generateTestUser('timeline-edit');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as { __getRestaurantId: () => Promise<string> }).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await pinRestaurantTimezone(page, restaurantId);

    await seedEmployeeAndShift(page, restaurantId, { name: 'Evan Cruz', position: 'Cook' }, { startHour: 10, endHour: 15 });

    await openTimeline(page);

    // Locate the seeded bar by employee + position (tz-independent) and open it.
    const shiftBar = page.getByRole('button', { name: /evan cruz, cook/i });
    await expect(shiftBar).toBeVisible({ timeout: 10000 });
    await shiftBar.click();

    // View popover → Edit.
    const editButton = page.getByRole('button', { name: /^edit$/i });
    await expect(editButton).toBeVisible({ timeout: 5000 });
    await editButton.click();

    // Change the end time and save; assert the PATCH succeeds.
    const endTime = page.locator('#timeline-editor-end-time');
    await expect(endTime).toBeVisible({ timeout: 5000 });
    await endTime.fill('16:00');

    const patchPromise = page.waitForResponse(
      (resp) => resp.url().includes('/rest/v1/shifts') && resp.request().method() === 'PATCH' && resp.ok(),
      { timeout: 15000 },
    );
    await page.getByRole('button', { name: /^save$/i }).click();
    await patchPromise;
  });
});
