/* eslint-disable @typescript-eslint/no-explicit-any */
// `(window as any).__supabase` / `__getRestaurantId` are the e2e page-side test
// hooks exposed by exposeSupabaseHelpers — untyped by design, as in the sibling
// scheduling e2e specs.
import { test, expect, type Page, type Request } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E for manager-initiated shift trade. An owner posts an employee's shift for
 * trade from the schedule grid card, and the trade lands with status 'open'.
 *
 * The notify edge function is not served in the e2e stack, so intercept the
 * send-shift-trade-notification request (stub 200) and assert the client
 * invokes it with action 'created'.
 */

const NOTIFY_GLOB = '**/functions/v1/send-shift-trade-notification';

/** Intercept the fire-and-forget notify invoke; return the collected POST bodies. */
async function interceptNotify(page: Page): Promise<Array<Record<string, unknown>>> {
  const notifyBodies: Array<Record<string, unknown>> = [];
  await page.route(NOTIFY_GLOB, async (route) => {
    const req: Request = route.request();
    if (req.method() === 'POST') {
      try {
        notifyBodies.push(req.postDataJSON() as Record<string, unknown>);
      } catch {
        // ignore unparseable body
      }
    }
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
  return notifyBodies;
}

test.describe('Manager-initiated shift trade', () => {
  test('an owner posts an employee\'s shift for trade from the grid', async ({ page }) => {
    const owner = generateTestUser('mgr-trade');
    await signUpAndCreateRestaurant(page, owner);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed employee A and A's shift TODAY (so it renders in the current week
    // view). A is linked to the owner's user id so RLS permits the insert.
    const seed = await page.evaluate(async (restId: string) => {
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No owner session');

      const { data: emp, error: empErr } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId, user_id: user.id, name: 'Alex Absent', position: 'Server',
          status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
        })
        .select('id, name').single();
      if (empErr) throw new Error(`employee insert: ${empErr.message}`);

      const start = new Date();
      start.setHours(16, 0, 0, 0);
      const end = new Date(start);
      end.setHours(22, 0, 0, 0);
      const { data: shift, error: sErr } = await supabase
        .from('shifts')
        .insert({
          restaurant_id: restId, employee_id: emp.id,
          start_time: start.toISOString(), end_time: end.toISOString(),
          position: 'Server', status: 'scheduled', break_duration: 30,
          is_published: true, locked: false,
        })
        .select('id').single();
      if (sErr) throw new Error(`shift insert: ${sErr.message}`);

      return { empId: emp.id as string, shiftId: shift.id as string };
    }, restaurantId as string);

    const notifyBodies = await interceptNotify(page);

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 15000 });

    // The seeded shift card renders in the grid.
    const card = page.getByTestId('shift-card').first();
    await expect(card).toBeVisible({ timeout: 20000 });

    // Reveal the hover actions and click the offer action.
    await card.hover();
    const offerButton = page.getByRole('button', { name: /offer shift for trade/i }).first();
    await offerButton.click();

    // The manager-mode dialog opens with the employee name in the title.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Alex Absent/)).toBeVisible({ timeout: 5000 });

    // Post the marketplace trade (default type).
    await dialog.getByRole('button', { name: /post trade/i }).click();

    // The dialog closes.
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Authoritative: an open trade exists for the seeded shift, offered by A.
    await expect
      .poll(
        async () =>
          page.evaluate(async (shiftId: string) => {
            const supabase = (window as any).__supabase;
            const { data } = await supabase
              .from('shift_trades')
              .select('status, offered_by_employee_id, target_employee_id')
              .eq('offered_shift_id', shiftId)
              .maybeSingle();
            return data ? `${data.status}:${data.offered_by_employee_id}:${data.target_employee_id ?? 'null'}` : null;
          }, seed.shiftId),
        { timeout: 15000 },
      )
      .toBe(`open:${seed.empId}:null`);

    // The client invoked the notification with the created action.
    await expect.poll(() => notifyBodies.length, { timeout: 10000 }).toBeGreaterThan(0);
    expect(notifyBodies.some((b) => b.action === 'created')).toBe(true);
  });
});
