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
});
