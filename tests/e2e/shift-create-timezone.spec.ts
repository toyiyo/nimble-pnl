import { test, expect, type Page, type Locator } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Reproduction for the shift-creation timezone defect.
 *
 * Shift creation computes the stored instant with `new Date("YYYY-MM-DDTHH:mm")`,
 * which JS parses in the *host* timezone. The restaurant's timezone is never
 * consulted, so a manager whose laptop clock differs from the restaurant's zone
 * writes the wrong instant. Rush Bowls hit this: the manager's device was on
 * America/Los_Angeles, the restaurant is America/Chicago, and every shift landed
 * exactly 2 hours late.
 *
 * WHY THE TIMEZONE IS PINNED
 * --------------------------
 * `timezoneId` is the whole point of this spec. Playwright sets no timezone by
 * default and CI runs UTC — and UTC is the one zone where a restaurant in
 * Chicago still produces a *wrong* answer but a spec written against the host
 * clock could look self-consistent. Pinning makes the failure a fixed, known
 * quantity on every machine: an exact +120 minutes, matching the production
 * rows and the PostHog session ($timezone_offset 420 vs Chicago's 300).
 * Unpinned, these assertions would pass before the fix, after the fix, and
 * straight through a future regression. Precedent: schedule-publish-week-range.spec.ts.
 *
 * WHY THIS DATE
 * -------------
 * 2026-08-12 is a Wednesday on which BOTH zones are in daylight time
 * (Chicago CDT = UTC-5, Los Angeles PDT = UTC-7). The gap is therefore a clean
 * 120 minutes with no DST transition confounding it. DST-boundary behaviour is
 * a separate concern covered by the converter's own unit tests.
 */

const SHIFT_DATE = '2026-08-12';
const START_TIME = '06:30';
const END_TIME = '12:30';

/** 06:30 in Chicago (UTC-5 on this date) is 11:30 UTC. This is the correct answer. */
const EXPECTED_START_UTC = '2026-08-12T11:30:00+00:00';
/** 12:30 in Chicago is 17:30 UTC. */
const EXPECTED_END_UTC = '2026-08-12T17:30:00+00:00';

/**
 * Points the restaurant at an explicit timezone.
 *
 * `signUpAndCreateRestaurant` sets no timezone, and `restaurants.timezone` is
 * nullable with a DEFAULT of 'America/Chicago'. Leaning on that default would
 * leave the premise of this whole spec implicit and silently invisible if the
 * default ever changed — so state it.
 */
async function setRestaurantTimezone(page: Page, restaurantId: string, timezone: string) {
  const result = await page.evaluate(
    async ({ restId, tz }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { error } = await supabase.from('restaurants').update({ timezone: tz }).eq('id', restId);
      if (error) return { ok: false, message: error.message };
      const { data } = await supabase.from('restaurants').select('timezone').eq('id', restId).single();
      return { ok: true, stored: data?.timezone };
    },
    { restId: restaurantId, tz: timezone },
  );
  expect(result.ok, `failed to set restaurant timezone: ${result.message}`).toBe(true);
  // Guard the premise: if this write silently no-ops (RLS, column rename), every
  // assertion below would be measuring the wrong thing.
  expect(result.stored).toBe(timezone);
}

async function createEmployee(page: Page, restaurantId: string, name: string) {
  const employee = await page.evaluate(
    async ({ restId, empName }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data, error } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: empName,
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select()
        .single();
      if (error) throw new Error(`employees insert failed: ${error.message}`);
      return data;
    },
    { restId: restaurantId, empName: name },
  );
  expect(employee?.id).toBeTruthy();
  return employee;
}

/** Drives the real Add-Shift dialog — the same path a manager clicks through. */
async function createShiftViaDialog(page: Page, employeeName: string) {
  await page.goto('/scheduling');
  await page.waitForLoadState('networkidle');

  // Either the empty-state CTA or the toolbar button, depending on whether the
  // week already has shifts. Both call the same handler.
  const emptyStateBtn = page.getByRole('button', { name: /create first shift/i });
  const toolbarBtn = page.getByRole('button', { name: 'Shift', exact: true });
  const addBtn = (await emptyStateBtn.count()) > 0 ? emptyStateBtn : toolbarBtn;
  await expect(addBtn.first()).toBeVisible({ timeout: 15000 });
  await addBtn.first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10000 });

  await dialog.getByRole('combobox', { name: /select employee/i }).click();
  await page.getByRole('option', { name: new RegExp(employeeName, 'i') }).click();

  await dialog.getByRole('combobox', { name: /select position/i }).click();
  await page.getByRole('option', { name: 'Server', exact: true }).click();

  await dialog.getByLabel('Shift start date').fill(SHIFT_DATE);
  await dialog.getByLabel('Shift start time').fill(START_TIME);
  await dialog.getByLabel('Shift end date').fill(SHIFT_DATE);
  await dialog.getByLabel('Shift end time').fill(END_TIME);

  await dialog.getByRole('button', { name: /create shift/i }).click();
  await expect(dialog).not.toBeVisible({ timeout: 15000 });
}

async function readBackShift(page: Page, restaurantId: string) {
  const shift = await page.evaluate(
    async ({ restId }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('shifts')
        .select('start_time, end_time')
        .eq('restaurant_id', restId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    { restId: restaurantId },
  );
  expect(shift, 'no shift row was written').toBeTruthy();
  return shift as { start_time: string; end_time: string };
}

/** All shifts for one employee, oldest wall-clock first — used by the recurring-shift case. */
async function readAllShiftsForEmployee(page: Page, restaurantId: string, employeeId: string) {
  const shifts = await page.evaluate(
    async ({ restId, empId }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('shifts')
        .select('start_time, end_time')
        .eq('restaurant_id', restId)
        .eq('employee_id', empId)
        .order('start_time', { ascending: true });
      return data;
    },
    { restId: restaurantId, empId: employeeId },
  );
  expect(Array.isArray(shifts), 'no shift rows were written').toBe(true);
  return shifts as Array<{ start_time: string; end_time: string }>;
}

/** Inserts a shift directly, bypassing every client write surface — used to seed a known-correct row. */
async function seedShift(
  page: Page,
  restaurantId: string,
  employeeId: string,
  startIso: string,
  endIso: string,
) {
  const result = await page.evaluate(
    async ({ restId, empId, start, end }) => {
      // `window` has no type declarations for the test-only Supabase client exposeSupabaseHelpers attaches.
      const supabase = (window as any).__supabase;
      const { error } = await supabase.from('shifts').insert({
        restaurant_id: restId,
        employee_id: empId,
        start_time: start,
        end_time: end,
        position: 'Server',
        status: 'scheduled',
        break_duration: 30,
        is_published: false,
        locked: false,
      });
      if (error) return { ok: false, message: error.message };
      return { ok: true };
    },
    { restId: restaurantId, empId: employeeId, start: startIso, end: endIso },
  );
  expect(result.ok, `failed to seed shift: ${result.message}`).toBe(true);
}

/** Minutes the stored instant is off by, signed. Reported so a failure names the defect. */
function driftMinutes(actualIso: string, expectedIso: string) {
  return Math.round((new Date(actualIso).getTime() - new Date(expectedIso).getTime()) / 60_000);
}

/**
 * Drags a shift card (dnd-kit `useDraggable`) onto a droppable day cell
 * (`useDroppable`) using raw mouse events. Playwright's `dragTo` doesn't
 * produce the pointer events @dnd-kit's PointerSensor requires — same
 * constraint documented at length in `scheduling-conflicts.spec.ts`.
 *
 * `DroppableDayCell` applies `ring-primary/30` iff dnd-kit currently reports
 * the pointer `isOver` this cell, so — as in that precedent — we hold the
 * pointer over the target with tiny nudges and release only once that class
 * appears, proving the drop will land on the intended cell rather than
 * hoping a single release lands mid-render.
 */
async function dragCardToCell(page: Page, card: Locator, targetCell: Locator) {
  let lastBlocker = 'never measured';

  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(card).toBeVisible({ timeout: 10000 });

    // Scroll BOTH ends into view before measuring. Raw page.mouse events address viewport
    // coordinates, so unlike locator.click() they get no actionability auto-scroll: a row or
    // column sitting outside a 1280x720 CI viewport yields coordinates the pointer can never
    // reach, and dnd-kit then reports isOver on nothing at all. Scroll the target first and
    // the source second, so the source — the element we are about to hit-test — is the one
    // whose position is settled last.
    await targetCell.evaluate((el: Element) => el.scrollIntoView({ block: 'center', inline: 'center' }));
    const press = await card.evaluate((el: Element) => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return { point: null, blockedBy: 'nothing (card has no layout box yet)' };
      }
      // Upper-left candidates first: clear of the top-right Edit/Delete hover icons and of
      // the corner-anchored FAB. Require the hit to be this card (or a descendant) — a
      // looser check would happily accept a neighbouring card showing through and drag the
      // wrong shift, which fails later as a confusing wrong-instant assertion.
      const candidates = [
        [0.35, 0.2], [0.5, 0.18], [0.3, 0.35], [0.2, 0.5], [0.5, 0.5],
      ].map(([fx, fy]) => ({ x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }));
      for (const p of candidates) {
        const hit = document.elementFromPoint(p.x, p.y);
        if (hit && (el === hit || el.contains(hit))) return { point: p, blockedBy: null };
      }
      const top = document.elementFromPoint(candidates[0].x, candidates[0].y);
      // Name WHAT is on top when this fails, so a blocked pointer is distinguishable from a
      // slow one — that ambiguity is what makes these failures expensive to diagnose.
      return {
        point: null,
        blockedBy: top
          ? `<${top.tagName.toLowerCase()} class="${top.getAttribute('class') ?? ''}">`
          : 'nothing (point is outside the viewport)',
      };
    });

    if (!press.point) {
      lastBlocker = press.blockedBy ?? 'unknown';
      if (attempt < 2) await page.waitForTimeout(500);
      continue;
    }
    const { x: srcX, y: srcY } = press.point;

    const targetBox = await targetCell.boundingBox();
    if (!targetBox) throw new Error('target cell has no bounding box');
    const tgtX = targetBox.x + targetBox.width / 2;
    const tgtY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(srcX, srcY);
    await page.mouse.down();
    // Cross the PointerSensor 8px activation threshold, then travel onto the target cell.
    await page.mouse.move(srcX + 12, srcY, { steps: 2 });
    await page.mouse.move(tgtX, tgtY, { steps: 12 });

    let over = false;
    for (let i = 0; i < 15 && !over; i++) {
      await page.mouse.move(tgtX + (i % 2 === 0 ? 1 : -1), tgtY);
      over = await targetCell
        .evaluate((el) => el.className.includes('ring-primary/30'))
        .catch(() => false);
    }

    if (over) {
      await page.mouse.up();
      return;
    }

    // Never registered — drop back on the source so no stray shift is created, then retry.
    await page.mouse.move(srcX, srcY, { steps: 4 });
    await page.mouse.up();
    if (attempt < 2) await page.waitForTimeout(500);
  }
  throw new Error(
    'drag never registered isOver on the target cell after 3 attempts. Last press-point ' +
      `hit-test: ${lastBlocker}.`,
  );
}

// ---------------------------------------------------------------------------
// THE BUG: manager's device in Los Angeles, restaurant in Chicago.
// ---------------------------------------------------------------------------
test.describe('Shift creation anchors to the restaurant timezone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('a 06:30 Chicago shift created from a Los Angeles device stores 11:30Z, not 13:30Z', async ({ page }) => {
    const testUser = generateTestUser('tzshift');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await setRestaurantTimezone(page, restaurantId, 'America/Chicago');
    const employee = await createEmployee(page, restaurantId, 'Tina Timezone');

    await createShiftViaDialog(page, employee.name);
    const shift = await readBackShift(page, restaurantId);

    const drift = driftMinutes(shift.start_time, EXPECTED_START_UTC);
    expect(
      drift,
      `start_time drifted ${drift} min. Expected ${EXPECTED_START_UTC} (06:30 Chicago), got ${shift.start_time}. ` +
        'A +120 drift is the known defect: the instant was computed in the browser timezone (America/Los_Angeles) ' +
        'instead of the restaurant timezone (America/Chicago).',
    ).toBe(0);

    expect(new Date(shift.start_time).toISOString()).toBe(new Date(EXPECTED_START_UTC).toISOString());
    expect(new Date(shift.end_time).toISOString()).toBe(new Date(EXPECTED_END_UTC).toISOString());
  });
});

// ---------------------------------------------------------------------------
// THE CONTROL: same restaurant, same wall clock, device already in Chicago.
//
// This must be GREEN both before and after the fix. It is what proves the fix
// re-anchors the conversion to the restaurant rather than shifting every shift
// by a constant two hours — a change that would make the test above pass while
// breaking every manager who is already in the restaurant's own timezone.
// ---------------------------------------------------------------------------
test.describe('Shift creation is unaffected when the device is already in the restaurant timezone', () => {
  test.use({ timezoneId: 'America/Chicago' });

  test('a 06:30 Chicago shift created from a Chicago device stores 11:30Z (green before and after the fix)', async ({ page }) => {
    const testUser = generateTestUser('tzctrl');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await setRestaurantTimezone(page, restaurantId, 'America/Chicago');
    const employee = await createEmployee(page, restaurantId, 'Carl Control');

    await createShiftViaDialog(page, employee.name);
    const shift = await readBackShift(page, restaurantId);

    const drift = driftMinutes(shift.start_time, EXPECTED_START_UTC);
    expect(
      drift,
      `Control case drifted ${drift} min — it must be 0 both before and after the fix. ` +
        `Expected ${EXPECTED_START_UTC}, got ${shift.start_time}.`,
    ).toBe(0);

    expect(new Date(shift.end_time).toISOString()).toBe(new Date(EXPECTED_END_UTC).toISOString());
  });
});

// ---------------------------------------------------------------------------
// SURFACE 3: opening an existing (correctly-anchored) shift in the Add/Edit
// dialog and saving with NO edits must not move start_time. The dialog
// round-trips through host-local `format()`/`new Date()` on both the read
// side (populating the form from the shift) and the write side (submitting
// the form) — a fix applied to only one side would still corrupt this case,
// which is exactly what this test is for (design §6.0: "catches a
// write-only fix").
//
// The shift is seeded directly via Supabase, bypassing every other write
// surface, so a failure here can only be attributed to the edit round trip
// itself and not to how the row got created.
// ---------------------------------------------------------------------------
test.describe('Editing a shift without changing it does not move its start_time', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('opening the Add/Edit dialog on an existing shift and saving unchanged keeps start_time byte-identical', async ({ page }) => {
    const testUser = generateTestUser('tzedit');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await setRestaurantTimezone(page, restaurantId, 'America/Chicago');
    const employee = await createEmployee(page, restaurantId, 'Eddie Edit');
    await seedShift(page, restaurantId, employee.id, EXPECTED_START_UTC, EXPECTED_END_UTC);

    // The seeded shift lives on 2026-08-12 (Wednesday), regardless of the real
    // calendar date the test happens to run on — navigate straight to that
    // week's Monday so the shift card is actually on screen. Without this the
    // scheduling page shows whatever week contains "today", the shift card
    // never appears, and the test times out for a reason that has nothing to
    // do with the timezone defect under test.
    await page.goto('/scheduling?week=2026-08-10');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('shift-card').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText('Edit Shift')).toBeVisible();

    const updateButton = dialog.getByRole('button', { name: /update shift/i });
    await expect(updateButton).toBeVisible();
    await updateButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    const shift = await readBackShift(page, restaurantId);
    const drift = driftMinutes(shift.start_time, EXPECTED_START_UTC);
    expect(
      drift,
      `Saving an unedited shift moved start_time by ${drift} min. Expected it to stay at ` +
        `${EXPECTED_START_UTC}, got ${shift.start_time}. The dialog re-derives the instant from ` +
        'the host-local display of the wall clock instead of leaving it untouched.',
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SURFACE 4: recurring shifts ("Repeat"). `createRecurringShifts` built every
// child after the first via host-local `Date` getters/setters
// (`useShifts.tsx`), the same defect class as the other surfaces. This drives
// the real dialog with a 3-occurrence daily custom recurrence and asserts
// EVERY occurrence — parent included — lands on the correct restaurant-local
// wall clock. All three dates sit inside the same DST regime, so a passing
// fix should show identical +0 drift on every row.
//
// Note: a host/restaurant pair with *constant* offsets across the whole
// recurrence window (as here — LA/Chicago, no DST transition between
// 2026-08-12 and -14) cannot actually distinguish the old host-local bug
// from the fix — "add N days at a fixed host-local hour" and "add N days at
// a fixed restaurant-local hour" land on the same instant when neither zone's
// offset changes in between. The DST-crossing case that *does* distinguish
// them is covered by `tests/unit/useShiftsRecurringCreateTz.test.ts` (Phoenix
// host, Chicago restaurant, spans the 2026-03-08 spring-forward). This E2E
// spec still earns its keep: it is the only test driving the real dialog's
// custom-recurrence UI end to end for this surface.
// ---------------------------------------------------------------------------
test.describe('Recurring shifts anchor every occurrence to the restaurant timezone', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('a daily 3-occurrence 06:30 Chicago recurrence stores 11:30Z on every date', async ({ page }) => {
    const testUser = generateTestUser('tzrepeat');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await setRestaurantTimezone(page, restaurantId, 'America/Chicago');
    const employee = await createEmployee(page, restaurantId, 'Rhonda Repeat');

    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle');

    const emptyStateBtn = page.getByRole('button', { name: /create first shift/i });
    const toolbarBtn = page.getByRole('button', { name: 'Shift', exact: true });
    const addBtn = (await emptyStateBtn.count()) > 0 ? emptyStateBtn : toolbarBtn;
    await expect(addBtn.first()).toBeVisible({ timeout: 15000 });
    await addBtn.first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await dialog.getByRole('combobox', { name: /select employee/i }).click();
    await page.getByRole('option', { name: new RegExp(employee.name, 'i') }).click();

    await dialog.getByRole('combobox', { name: /select position/i }).click();
    await page.getByRole('option', { name: 'Server', exact: true }).click();

    await dialog.getByLabel('Shift start date').fill(SHIFT_DATE);
    await dialog.getByLabel('Shift start time').fill(START_TIME);
    await dialog.getByLabel('Shift end date').fill(SHIFT_DATE);
    await dialog.getByLabel('Shift end time').fill(END_TIME);

    // "Custom..." recurrence: daily, ending after 3 occurrences.
    await dialog.getByRole('combobox', { name: /repeat pattern/i }).click();
    await page.getByRole('option', { name: 'Custom...', exact: true }).click();

    const customDialog = page.getByRole('dialog', { name: /custom recurrence/i });
    await expect(customDialog).toBeVisible({ timeout: 5000 });

    await customDialog.getByRole('combobox', { name: /repeat unit/i }).click();
    await page.getByRole('option', { name: 'day', exact: true }).click();

    await customDialog.getByRole('radio', { name: 'After' }).click();
    await customDialog.getByLabel('Number of occurrences').fill('3');

    await customDialog.getByRole('button', { name: 'Done' }).click();
    await expect(customDialog).not.toBeVisible({ timeout: 5000 });

    await dialog.getByRole('button', { name: /create shift/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    const shifts = await readAllShiftsForEmployee(page, restaurantId, employee.id);
    expect(shifts.length, `expected 3 occurrences (parent + 2 children), got ${shifts.length}`).toBe(3);

    const expectedDates = ['2026-08-12', '2026-08-13', '2026-08-14'];
    shifts.forEach((shift, i) => {
      const expectedStart = `${expectedDates[i]}T11:30:00+00:00`;
      const drift = driftMinutes(shift.start_time, expectedStart);
      expect(
        drift,
        `Occurrence ${i} (${expectedDates[i]}) drifted ${drift} min. Expected ${expectedStart}, got ` +
          `${shift.start_time}.`,
      ).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// SURFACE 6: drag-copy a shift card. `useShiftCopyDnd.buildCopyPayload`
// (`useShiftCopyDnd.ts:57-65`) reconstructs the dropped instant from
// `new Date(year, month, day, srcStart.getHours(), srcStart.getMinutes())`,
// which reads and writes the HOST's local hour/minute, never the
// restaurant's.
//
// That is invisible for an ordinary same-week drag: two fixed IANA zones
// have a constant relative offset except across a DST transition, so this
// case is deliberately built to straddle one. The restaurant
// (America/Chicago) observes DST; the host (America/Phoenix) does not — it
// is fixed at UTC-7 year-round. The 2026 spring-forward transition lands
// 2026-03-08 02:00 America/Chicago, inside the Monday-start calendar week
// 2026-03-02 – 2026-03-08, so both the drag source (Monday) and the target
// (Sunday) are visible in the same grid without navigating weeks mid-drag.
//
// A 09:00 Chicago shift dragged from Monday to Sunday must still read 09:00
// Chicago on Sunday. The buggy reconstruction instead carries Monday's
// *Phoenix* clock reading (08:00 — Phoenix UTC-7, Chicago still CST/UTC-6
// that morning) onto Sunday, where Chicago has since become CDT/UTC-5,
// landing on 10:00 Chicago: a drift of exactly +60 minutes.
// ---------------------------------------------------------------------------
test.describe('Drag-copying a shift card preserves the restaurant-local wall clock', () => {
  test.use({ timezoneId: 'America/Phoenix' });

  const SOURCE_START_UTC = '2026-03-02T15:00:00+00:00'; // 09:00 Chicago (CST, UTC-6), Monday
  const SOURCE_END_UTC = '2026-03-02T19:00:00+00:00'; // 13:00 Chicago
  const EXPECTED_TARGET_START_UTC = '2026-03-08T14:00:00+00:00'; // 09:00 Chicago (CDT, UTC-5), Sunday

  test('a Monday 09:00 Chicago shift dragged to Sunday keeps 09:00 Chicago, not 10:00', async ({ page }) => {
    const testUser = generateTestUser('tzdrag');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    // `window` has no type declarations for the test-only helpers exposeSupabaseHelpers attaches.
    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await setRestaurantTimezone(page, restaurantId, 'America/Chicago');
    const employee = await createEmployee(page, restaurantId, 'Diana Dragcopy');
    await seedShift(page, restaurantId, employee.id, SOURCE_START_UTC, SOURCE_END_UTC);

    await page.goto('/scheduling?week=2026-03-02');
    await page.waitForLoadState('networkidle');

    const sourceCell = page
      .getByRole('button', { name: `Add shift for ${employee.name} on Mon Mar 2` })
      .locator('xpath=ancestor::td[1]');
    const targetCell = page
      .getByRole('button', { name: `Add shift for ${employee.name} on Sun Mar 8` })
      .locator('xpath=ancestor::td[1]');
    await expect(sourceCell).toBeVisible({ timeout: 15000 });
    await expect(targetCell).toBeVisible({ timeout: 15000 });

    const sourceCard = sourceCell.locator('[aria-roledescription="draggable shift"]').first();
    await expect(sourceCard).toBeVisible({ timeout: 10000 });

    await dragCardToCell(page, sourceCard, targetCell);

    // The drag COPIES (the Monday original is untouched) — wait for the second row.
    await expect(async () => {
      const shifts = await readAllShiftsForEmployee(page, restaurantId, employee.id);
      expect(shifts.length, 'expected the original Monday shift plus the dropped Sunday copy').toBe(2);
    }).toPass({ timeout: 15000 });

    const shifts = await readAllShiftsForEmployee(page, restaurantId, employee.id);
    const original = shifts.find((s) => driftMinutes(s.start_time, SOURCE_START_UTC) === 0);
    const copy = shifts.find((s) => driftMinutes(s.start_time, SOURCE_START_UTC) !== 0);
    expect(original, 'the Monday original must be untouched by the copy').toBeTruthy();
    expect(copy, 'no distinct dropped shift was found — did the drag land on the wrong cell?').toBeTruthy();

    const drift = driftMinutes(copy!.start_time, EXPECTED_TARGET_START_UTC);
    expect(
      drift,
      `Dropped shift drifted ${drift} min. Expected ${EXPECTED_TARGET_START_UTC} (09:00 Chicago Sunday), got ` +
        `${copy!.start_time}. A +60 drift is the known defect: the dropped instant was reconstructed from the ` +
        'host-local (America/Phoenix) hour instead of the restaurant-local (America/Chicago) hour, and Chicago ' +
        "crossed into daylight time between the drag's source and target days.",
    ).toBe(0);
  });
});
