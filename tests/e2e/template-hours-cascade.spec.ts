import { test, expect } from '@playwright/test';

import {
  generateTestUser,
  signUpAndCreateRestaurant,
  exposeSupabaseHelpers,
  seedTemplateWithShifts,
} from '../helpers/e2e-supabase';

/**
 * E2E coverage for the template-hours cascade (Task 10). See
 * docs/superpowers/specs/2026-08-03-template-hours-cascade-design.md.
 *
 * Every shift-time assertion below reads a `timestamptz` back through the
 * restaurant's own IANA timezone (America/Chicago) via `Intl.DateTimeFormat`
 * with an explicit `timeZone`, never the Playwright runner's local zone or
 * `Date.prototype.getTimezoneOffset()` — a test built on the runner's offset
 * would pass or fail depending on which machine ran it, which is exactly the
 * class of bug this feature exists to prevent.
 */
const TIMEZONE = 'America/Chicago';

/** Restaurant-local `HH:MM` (24h) for a UTC ISO timestamp, in `TIMEZONE`. */
function localHHMM(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

async function setRestaurantTimezone(page: import('@playwright/test').Page, restaurantId: string) {
  const result = await page.evaluate(
    async ({ restId, tz }) => {
      const supabase = (window as any).__supabase;
      const { error } = await supabase.from('restaurants').update({ timezone: tz }).eq('id', restId);
      if (error) return { ok: false, message: error.message };
      const { data } = await supabase.from('restaurants').select('timezone').eq('id', restId).single();
      return { ok: true, stored: data?.timezone };
    },
    { restId: restaurantId, tz: TIMEZONE }
  );
  expect(result.ok, `failed to set restaurant timezone: ${result.message}`).toBe(true);
  // Guard the premise: every downstream assertion assumes this stuck.
  expect(result.stored).toBe(TIMEZONE);
}

/** Reads a shift's `start_time`/`end_time` straight from Supabase, bypassing the UI. */
async function fetchShiftTimes(
  page: import('@playwright/test').Page,
  restaurantId: string,
  shiftId: string
): Promise<{ start_time: string; end_time: string }> {
  return page.evaluate(
    // Filtered on restaurant_id as well as the primary key: every query in this
    // codebase is tenant-scoped, and a test that reads across tenants would pass
    // even if a cascade leaked into someone else's shifts.
    async (args: { restId: string; id: string }) => {
      const supabase = (window as any).__supabase;
      const { data, error } = await supabase
        .from('shifts')
        .select('start_time, end_time')
        .eq('restaurant_id', args.restId)
        .eq('id', args.id)
        .single();
      if (error) throw new Error(error.message);
      return data as { start_time: string; end_time: string };
    },
    { restId: restaurantId, id: shiftId }
  );
}

test.describe('template hours cascade', () => {
  test("moving a template's hours moves the linked shifts", async ({ page }) => {
    const user = generateTestUser('cascade-happy');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await setRestaurantTimezone(page, restaurantId as string);

    // Two future, unlocked, unpublished shifts at 09:00-17:00 local, linked to the template.
    const { template } = await seedTemplateWithShifts(page, restaurantId as string, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 2,
      timezone: TIMEZONE,
    });

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText(template.name)).toBeVisible({ timeout: 15000 });

    // Row actions are hover-revealed — hover the row, then Actions -> Edit.
    const templateRow = page.locator('.group', { has: page.getByText(template.name) }).first();
    await templateRow.hover();
    const actionsButton = page.getByRole('button', { name: `Actions for ${template.name}` });
    await expect(actionsButton).toBeVisible({ timeout: 5000 });
    await actionsButton.click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Before any edit there is no cascade choice — the primary CTA is plain.
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeVisible();

    await dialog.getByLabel('Start Time').fill('10:00');
    await dialog.getByLabel('End Time').fill('18:00');

    // The ledger appears, and the primary CTA switches to the counted label.
    const cascadeButton = dialog.getByRole('button', { name: 'Save & update 2 shifts' });
    await expect(cascadeButton).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('button', { name: 'Template only' })).toBeVisible();

    await cascadeButton.click();

    // Two nodes carry this text: the visible toast description and a hidden
    // aria-live region that echoes it for screen readers — both are correct,
    // so match either rather than asserting a single instance.
    await expect(page.getByText('2 shifts moved to the new hours.').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // The manager Planner grid renders only names/positions on each shift
    // chip, never times (ShiftCell/EmployeeChip), so "the grid reflects the
    // move" has to be verified at the source of truth instead: every shift
    // still linked to the template now has the new wall-clock hours in the
    // restaurant's own timezone.
    const movedShifts = await page.evaluate(
      async (args: { restId: string; templateId: string }) => {
        const supabase = (window as any).__supabase;
        const { data, error } = await supabase
          .from('shifts')
          .select('start_time, end_time')
          .eq('restaurant_id', args.restId)
          .eq('shift_template_id', args.templateId)
          .order('start_time');
        if (error) throw new Error(error.message);
        return data as { start_time: string; end_time: string }[];
      },
      { restId: restaurantId as string, templateId: template.id }
    );

    expect(movedShifts).toHaveLength(2);
    for (const shift of movedShifts) {
      expect(localHHMM(shift.start_time)).toBe('10:00');
      expect(localHHMM(shift.end_time)).toBe('18:00');
    }
  });

  test('a hand-edited shift is left alone unless its checkbox is ticked', async ({ page }) => {
    const user = generateTestUser('cascade-drift');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await setRestaurantTimezone(page, restaurantId as string);

    const { template, drifted } = await seedTemplateWithShifts(page, restaurantId as string, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 1,
      driftedShift: { start_time: '11:00', end_time: '19:00', employeeName: 'Casey Chicago' },
      timezone: TIMEZONE,
    });
    expect(drifted).not.toBeNull();

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText(template.name)).toBeVisible({ timeout: 15000 });

    const templateRow = page.locator('.group', { has: page.getByText(template.name) }).first();
    await templateRow.hover();
    const actionsButton = page.getByRole('button', { name: `Actions for ${template.name}` });
    await expect(actionsButton).toBeVisible({ timeout: 5000 });
    await actionsButton.click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Start Time').fill('10:00');
    await dialog.getByLabel('End Time').fill('18:00');

    // Not counted until it is picked — only the one exact-hours shift moves.
    await expect(dialog.getByRole('button', { name: 'Save & update 1 shift' })).toBeVisible({ timeout: 5000 });

    // The drift disclosure lives inside the ledger's own collapsible body,
    // which starts closed (TemplateHoursImpact.tsx `expanded` defaults to
    // false) — open it first, or the drift button below is hidden from the
    // accessibility tree. The trigger has no explicit label, but its
    // accessible name always includes the ledger summary's moving clause
    // ("N shift(s) move(s)"), which is unique among the dialog's buttons.
    await dialog.getByRole('button', { name: /shift moves|shifts move/i }).click();

    await dialog.getByRole('button', { name: /hand-edited/i }).click();
    // The label names the employee and the date — this is the a11y assertion:
    // the drift row's checkbox is reachable only via its real <label>, not a
    // CSS hook.
    await dialog.getByLabel(new RegExp(`Casey Chicago — ${drifted!.localDate}`, 'i')).check();

    await expect(dialog.getByRole('button', { name: 'Save & update 2 shifts' })).toBeVisible({ timeout: 5000 });
  });

  test('ticking one drifted shift saves it and leaves the other drifted shift byte-identical', async ({ page }) => {
    const user = generateTestUser('cascade-drift-optin');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await setRestaurantTimezone(page, restaurantId as string);

    const { template, driftedShifts } = await seedTemplateWithShifts(page, restaurantId as string, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 1,
      driftedShifts: [
        { start_time: '11:00', end_time: '19:00', employeeName: 'Casey Chicago' },
        { start_time: '12:00', end_time: '20:00', employeeName: 'Drew Dallas' },
      ],
      timezone: TIMEZONE,
    });
    expect(driftedShifts).toHaveLength(2);
    const [pickedDrift, untouchedDrift] = driftedShifts;

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText(template.name)).toBeVisible({ timeout: 15000 });

    const templateRow = page.locator('.group', { has: page.getByText(template.name) }).first();
    await templateRow.hover();
    const actionsButton = page.getByRole('button', { name: `Actions for ${template.name}` });
    await expect(actionsButton).toBeVisible({ timeout: 5000 });
    await actionsButton.click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Start Time').fill('10:00');
    await dialog.getByLabel('End Time').fill('18:00');

    // Only the one exact-hours ("moving") shift is counted before any drift pick.
    await expect(dialog.getByRole('button', { name: 'Save & update 1 shift' })).toBeVisible({ timeout: 5000 });

    // Ledger's outer disclosure starts closed — open it, then open the nested
    // drift disclosure inside it, before either drift checkbox is reachable.
    await dialog.getByRole('button', { name: /shift moves|shifts move/i }).click();
    await dialog.getByRole('button', { name: /hand-edited/i }).click();

    // Tick only the picked employee's checkbox, via its real <label> — the
    // unticked one is left strictly alone.
    await dialog.getByLabel(new RegExp(`${pickedDrift.employeeName} — ${pickedDrift.localDate}`, 'i')).check();

    const cascadeButton = dialog.getByRole('button', { name: 'Save & update 2 shifts' });
    await expect(cascadeButton).toBeVisible({ timeout: 5000 });
    await cascadeButton.click();

    await expect(page.getByText('2 shifts moved to the new hours.').first()).toBeVisible({ timeout: 10000 });
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    const [pickedRow, untouchedRow] = await Promise.all([
      page.evaluate(
        async (shiftId: string) => {
          const supabase = (window as any).__supabase;
          const { data, error } = await supabase
            .from('shifts')
            .select('start_time, end_time')
            .eq('id', shiftId)
            .single();
          if (error) throw new Error(error.message);
          return data as { start_time: string; end_time: string };
        },
        pickedDrift.shiftId
      ),
      page.evaluate(
        async (shiftId: string) => {
          const supabase = (window as any).__supabase;
          const { data, error } = await supabase
            .from('shifts')
            .select('start_time, end_time')
            .eq('id', shiftId)
            .single();
          if (error) throw new Error(error.message);
          return data as { start_time: string; end_time: string };
        },
        untouchedDrift.shiftId
      ),
    ]);

    // The picked drifted shift moved to the new template hours.
    expect(localHHMM(pickedRow.start_time)).toBe('10:00');
    expect(localHHMM(pickedRow.end_time)).toBe('18:00');

    // The unpicked drifted shift is byte-identical to how it was seeded — not
    // merely "still shows 12:00-20:00 locally", but the exact same stored
    // string, proving the write never touched this row at all.
    expect(untouchedRow.start_time).toBe(untouchedDrift.startTime);
    expect(untouchedRow.end_time).toBe(untouchedDrift.endTime);
  });

  test('past and locked shifts are never touched, while a normal moving shift in the same cascade does move', async ({ page }) => {
    const user = generateTestUser('cascade-past-locked');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await setRestaurantTimezone(page, restaurantId as string);

    // Past and locked shifts are seeded at the TEMPLATE'S OWN hours, so the
    // only reason either is excluded from the cascade is its bucket (past /
    // locked) — not a coincidental hours mismatch that would exclude it anyway.
    const { template, moving, past, locked } = await seedTemplateWithShifts(page, restaurantId as string, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 1,
      pastShift: { employeeName: 'Riley Past' },
      lockedShift: { employeeName: 'Sam Locked' },
      timezone: TIMEZONE,
    });
    expect(moving).toHaveLength(1);
    expect(past).not.toBeNull();
    expect(locked).not.toBeNull();

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText(template.name)).toBeVisible({ timeout: 15000 });

    const templateRow = page.locator('.group', { has: page.getByText(template.name) }).first();
    await templateRow.hover();
    const actionsButton = page.getByRole('button', { name: `Actions for ${template.name}` });
    await expect(actionsButton).toBeVisible({ timeout: 5000 });
    await actionsButton.click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Start Time').fill('10:00');
    await dialog.getByLabel('End Time').fill('18:00');

    // Only the moving shift is counted — past and locked never enter the count,
    // even though both share the template's exact old hours.
    const cascadeButton = dialog.getByRole('button', { name: 'Save & update 1 shift' });
    await expect(cascadeButton).toBeVisible({ timeout: 5000 });
    await cascadeButton.click();

    await expect(page.getByText('1 shift moved to the new hours.').first()).toBeVisible({ timeout: 10000 });
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    const [movingRow, pastRow, lockedRow] = await Promise.all(
      [moving[0].shiftId, past!.shiftId, locked!.shiftId].map((shiftId) =>
        page.evaluate(
          async (id: string) => {
            const supabase = (window as any).__supabase;
            const { data, error } = await supabase
              .from('shifts')
              .select('start_time, end_time')
              .eq('id', id)
              .single();
            if (error) throw new Error(error.message);
            return data as { start_time: string; end_time: string };
          },
          shiftId
        )
      )
    );

    // The positive assertion: the cascade actually ran and moved the
    // eligible shift — this is what rules out "the cascade silently did
    // nothing at all" as an explanation for the untouched rows below.
    expect(localHHMM(movingRow.start_time)).toBe('10:00');
    expect(localHHMM(movingRow.end_time)).toBe('18:00');

    // The negative assertions: past and locked are byte-identical to how
    // they were seeded.
    expect(pastRow.start_time).toBe(past!.startTime);
    expect(pastRow.end_time).toBe(past!.endTime);
    expect(lockedRow.start_time).toBe(locked!.startTime);
    expect(lockedRow.end_time).toBe(locked!.endTime);
  });

  test('clicking Undo on the cascade toast restores the shifts to their pre-cascade times', async ({ page }) => {
    const user = generateTestUser('cascade-undo');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await setRestaurantTimezone(page, restaurantId as string);

    const { template } = await seedTemplateWithShifts(page, restaurantId as string, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 2,
      timezone: TIMEZONE,
    });

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText(template.name)).toBeVisible({ timeout: 15000 });

    const templateRow = page.locator('.group', { has: page.getByText(template.name) }).first();
    await templateRow.hover();
    const actionsButton = page.getByRole('button', { name: `Actions for ${template.name}` });
    await expect(actionsButton).toBeVisible({ timeout: 5000 });
    await actionsButton.click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Start Time').fill('10:00');
    await dialog.getByLabel('End Time').fill('18:00');

    const cascadeButton = dialog.getByRole('button', { name: 'Save & update 2 shifts' });
    await expect(cascadeButton).toBeVisible({ timeout: 5000 });
    await cascadeButton.click();

    await expect(page.getByText('2 shifts moved to the new hours.').first()).toBeVisible({ timeout: 10000 });
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // exact: true — the generated test-user name embeds this test's own title
    // ("cascade-undo-<timestamp>"), which is itself a substring match for
    // "Undo" against the account-menu button in the header. Without `exact`,
    // Playwright's default substring/case-insensitive name matching resolves
    // both buttons and throws a strict-mode violation.
    const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
    await expect(undoButton).toBeVisible();
    await undoButton.click();

    // The undo toast's description text confirms the RPC has already resolved
    // (onSuccess fires only after the awaited RPC settles), so the DB read
    // below is guaranteed to observe the reverted rows, not a race.
    await expect(page.getByText('Restored 2 shifts.').first()).toBeVisible({ timeout: 10000 });

    const revertedShifts = await page.evaluate(
      async (args: { restId: string; templateId: string }) => {
        const supabase = (window as any).__supabase;
        const { data, error } = await supabase
          .from('shifts')
          .select('start_time, end_time')
          .eq('restaurant_id', args.restId)
          .eq('shift_template_id', args.templateId)
          .order('start_time');
        if (error) throw new Error(error.message);
        return data as { start_time: string; end_time: string }[];
      },
      { restId: restaurantId as string, templateId: template.id }
    );

    expect(revertedShifts).toHaveLength(2);
    for (const shift of revertedShifts) {
      expect(localHHMM(shift.start_time)).toBe('09:00');
      expect(localHHMM(shift.end_time)).toBe('17:00');
    }
  });

  test('a cascade after an undo still moves the shifts', async ({ page }) => {
    const user = generateTestUser('cascade-redo-after-undo');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await setRestaurantTimezone(page, restaurantId as string);

    const { template } = await seedTemplateWithShifts(page, restaurantId as string, {
      start_time: '10:00',
      end_time: '16:30',
      shiftCount: 2,
      timezone: TIMEZONE,
    });

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText(template.name)).toBeVisible({ timeout: 15000 });

    const templateRow = page.locator('.group', { has: page.getByText(template.name) }).first();
    const actionsButton = page.getByRole('button', { name: `Actions for ${template.name}` });

    const openEditDialog = async () => {
      await templateRow.hover();
      await expect(actionsButton).toBeVisible({ timeout: 5000 });
      await actionsButton.click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const editDialog = page.getByRole('dialog');
      await expect(editDialog).toBeVisible();
      return editDialog;
    };

    // 1. Cascade 10:00-16:30 -> 10:00-17:30.
    let dialog = await openEditDialog();
    await dialog.getByLabel('Start Time').fill('10:00');
    await dialog.getByLabel('End Time').fill('17:30');

    const firstCascadeButton = dialog.getByRole('button', { name: 'Save & update 2 shifts' });
    await expect(firstCascadeButton).toBeVisible({ timeout: 5000 });
    await firstCascadeButton.click();

    await expect(page.getByText('2 shifts moved to the new hours.').first()).toBeVisible({ timeout: 10000 });
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // 2. Undo — the toast's own Undo button, not the header's account menu.
    const undoButton = page.getByRole('button', { name: 'Undo', exact: true });
    await expect(undoButton).toBeVisible();
    await undoButton.click();
    await expect(page.getByText('Restored 2 shifts.').first()).toBeVisible({ timeout: 10000 });

    const afterUndo = await page.evaluate(
      async (args: { restId: string; templateId: string }) => {
        const supabase = (window as any).__supabase;
        const { data, error } = await supabase
          .from('shifts')
          .select('start_time, end_time')
          .eq('restaurant_id', args.restId)
          .eq('shift_template_id', args.templateId)
          .order('start_time');
        if (error) throw new Error(error.message);
        return data as { start_time: string; end_time: string }[];
      },
      { restId: restaurantId as string, templateId: template.id }
    );
    expect(afterUndo).toHaveLength(2);
    for (const shift of afterUndo) {
      expect(localHHMM(shift.start_time)).toBe('10:00');
      expect(localHHMM(shift.end_time)).toBe('16:30');
    }

    // 3. Edit hours again: 10:00 -> 11:00. Before Task 1's fix, the undo left the
    // template row itself desynced (only the shifts were restored, not the
    // template's own start/end columns), so re-opening this dialog would
    // reclassify both shifts as hand-edited drift and the primary button would
    // read the plain "Save changes" instead of a cascade count.
    dialog = await openEditDialog();
    await expect(dialog.getByLabel('Start Time')).toHaveValue('10:00');
    await expect(dialog.getByLabel('End Time')).toHaveValue('16:30');
    await dialog.getByLabel('Start Time').fill('11:00');

    const secondCascadeButton = dialog.getByRole('button', { name: 'Save & update 2 shifts' });
    await expect(secondCascadeButton).toBeVisible({ timeout: 5000 });
    await secondCascadeButton.click();

    await expect(page.getByText('2 shifts moved to the new hours.').first()).toBeVisible({ timeout: 10000 });
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    const finalShifts = await page.evaluate(
      async (args: { restId: string; templateId: string }) => {
        const supabase = (window as any).__supabase;
        const { data, error } = await supabase
          .from('shifts')
          .select('start_time, end_time')
          .eq('restaurant_id', args.restId)
          .eq('shift_template_id', args.templateId)
          .order('start_time');
        if (error) throw new Error(error.message);
        return data as { start_time: string; end_time: string }[];
      },
      { restId: restaurantId as string, templateId: template.id }
    );
    expect(finalShifts).toHaveLength(2);
    for (const shift of finalShifts) {
      expect(localHHMM(shift.start_time)).toBe('11:00');
      expect(localHHMM(shift.end_time)).toBe('16:30');
    }
  });

  test('a manager can pick hand-edited shifts into the cascade', async ({ page }) => {
    const user = generateTestUser('cascade-drift-panel-open');
    await signUpAndCreateRestaurant(page, user);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();
    await setRestaurantTimezone(page, restaurantId as string);

    // No "moving" shifts at all — both linked shifts are hand-edited away from
    // the template's hours, so before the cascade is even edited there is
    // nothing to move, and the drift picks are the only action available.
    const { template, driftedShifts } = await seedTemplateWithShifts(page, restaurantId as string, {
      start_time: '09:00',
      end_time: '17:00',
      shiftCount: 0,
      driftedShifts: [
        { start_time: '11:00', end_time: '19:00', employeeName: 'Casey Chicago' },
        { start_time: '12:00', end_time: '20:00', employeeName: 'Drew Dallas' },
      ],
      timezone: TIMEZONE,
    });
    expect(driftedShifts).toHaveLength(2);
    const [pickedDrift, untouchedDrift] = driftedShifts;

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 8000 });
    await page.getByRole('tab', { name: /planner/i }).click();

    await expect(page.getByText(template.name)).toBeVisible({ timeout: 15000 });

    const templateRow = page.locator('.group', { has: page.getByText(template.name) }).first();
    await templateRow.hover();
    const actionsButton = page.getByRole('button', { name: `Actions for ${template.name}` });
    await expect(actionsButton).toBeVisible({ timeout: 5000 });
    await actionsButton.click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Start Time').fill('10:00');
    await dialog.getByLabel('End Time').fill('18:00');

    // Nothing moves on its own — the collapsed summary names the drifted
    // shifts as the only thing the manager can act on.
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/hand-edited shifts you can pick/i)).toBeVisible();

    // Expand the outer summary — this is the only click. The drift picker
    // opens on its own (Task 4) because there is nothing else to disclose.
    await dialog.getByRole('button', { name: /shift moves|shifts move/i }).click();

    const pickedCheckbox = dialog.getByLabel(
      new RegExp(`${pickedDrift.employeeName} — ${pickedDrift.localDate}`, 'i')
    );
    await expect(pickedCheckbox).toBeVisible({ timeout: 5000 });
    // With no "moving" section above it (shiftCount: 0), the checkbox row
    // lands close enough to the bottom of the scrollable dialog body that
    // Playwright's default scroll-into-view centers it right under the
    // sticky footer (TemplateFormDialog.tsx's `DialogFooter`), which then
    // intercepts the click. Center it explicitly first.
    await pickedCheckbox.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // Not `.check()`: `.check()`'s click-then-verify retry loop fights the
    // row's plain toggle semantics (`onCheckedChange` flips a Set, it does
    // not accept Radix's boolean argument), so a single `.click()` is used
    // instead.
    await pickedCheckbox.click();

    // The still-unpicked drifted shift's checkbox stays reachable after the
    // first pick. Ticking Casey's checkbox makes `ledger.totalAffected` go
    // from 0 to 1 on the next render, which used to collapse this
    // disclosure (it was only ever open by the "nothing else to do"
    // default, never by an explicit manual toggle) and hide Drew's
    // still-unpicked checkbox behind a second click — see
    // TemplateHoursImpact.tsx's `onCheckedChange` handler, which now latches
    // the disclosure open on the first tick.
    const untouchedCheckbox = dialog.getByLabel(
      new RegExp(`${untouchedDrift.employeeName} — ${untouchedDrift.localDate}`, 'i')
    );
    await expect(untouchedCheckbox).toBeVisible({ timeout: 5000 });

    const cascadeButton = dialog.getByRole('button', { name: 'Save & update 1 shift' });
    await expect(cascadeButton).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('button', { name: 'Template only' })).toBeVisible();
    await cascadeButton.click();

    await expect(page.getByText('1 shift moved to the new hours.').first()).toBeVisible({ timeout: 10000 });
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    const [pickedRow, untouchedRow] = await Promise.all([
      fetchShiftTimes(page, restaurantId as string, pickedDrift.shiftId),
      fetchShiftTimes(page, restaurantId as string, untouchedDrift.shiftId),
    ]);

    expect(localHHMM(pickedRow.start_time)).toBe('10:00');
    expect(localHHMM(pickedRow.end_time)).toBe('18:00');

    expect(untouchedRow.start_time).toBe(untouchedDrift.startTime);
    expect(untouchedRow.end_time).toBe(untouchedDrift.endTime);
  });
});
