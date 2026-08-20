/* eslint-disable @typescript-eslint/no-explicit-any */
// `(window as any).__supabase` / `__getRestaurantId` are the e2e page-side test
// hooks exposed by exposeSupabaseHelpers — untyped by design, as in the
// sibling scheduling e2e specs (manager-initiated-shift-trade.spec.ts,
// shift-trade-accept.spec.ts).
import { test, expect, type Page } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E for the trade-approval area grant
 * (docs/superpowers/specs/2026-08-20-trade-approval-area-grant-design.md):
 * approve_shift_trade, reject_shift_trade, and the shift_trades RLS gate now
 * check user_has_capability(restaurant_id, 'edit:scheduling') instead of a
 * hardcoded owner/manager role, so a CUSTOM role granted scheduling@manage
 * can approve trades too, and a custom role at scheduling@view only cannot.
 *
 * Real second sign-in is not used to become "that member": as established by
 * roles-and-areas.spec.ts's simulateAcceptedCustomRole (see that file's
 * header banner for the full rationale), this spec instead points the
 * current session's own user_restaurants row at the new custom role and
 * reloads — the exact membership shape a real invite-accept round trip would
 * produce.
 */

interface WindowHelpers {
  __supabase: any;
  __getRestaurantId: () => Promise<string | null>;
}

/**
 * Insert a restaurant-owned custom role granting `scheduling` at `level`,
 * then point the current session's own user_restaurants row at it and
 * reload — the same pattern as roles-and-areas.spec.ts's
 * simulateAcceptedCustomRole, spelled out locally here rather than imported
 * (a spec file is not a shared module).
 */
async function grantCustomSchedulingRole(
  page: Page,
  restaurantId: string,
  level: 'manage' | 'view',
): Promise<void> {
  await page.evaluate(
    async ({ restId, level }: { restId: string; level: 'manage' | 'view' }) => {
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No session');

      const { data: role, error: roleErr } = await supabase
        .from('roles')
        .insert({
          restaurant_id: restId,
          name: `Trade Test Role ${level} ${Date.now()}`,
          description: 'e2e fixture role',
          flavor: 'platform',
          builtin: false,
        })
        .select('id')
        .single();
      if (roleErr) throw new Error(`role insert: ${roleErr.message}`);

      const { error: areaErr } = await supabase
        .from('role_areas')
        .insert({ role_id: role.id, area_key: 'scheduling', level });
      if (areaErr) throw new Error(`role_areas insert: ${areaErr.message}`);

      const { error: memErr } = await supabase
        .from('user_restaurants')
        .update({ role: 'collaborator_custom', role_id: role.id })
        .eq('user_id', user.id)
        .eq('restaurant_id', restId);
      if (memErr) throw new Error(`user_restaurants update: ${memErr.message}`);
    },
    { restId: restaurantId, level },
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Seed an offerer employee (linked to the current session's user so the
 * shift_trades INSERT RLS check — offered_by_employee_id belongs to the
 * caller — is satisfied), an accepter employee (no user_id, same as every
 * other directed-trade fixture in this suite), a future shift, and a trade
 * already at 'pending_approval' with the accepter recorded — the exact state
 * a real accept_shift_trade call would leave behind.
 */
async function seedPendingTrade(page: Page, restaurantId: string): Promise<{ tradeId: string }> {
  return page.evaluate(async (restId: string) => {
    const supabase = (window as any).__supabase;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) throw new Error('No session');

    const { data: offerer, error: offErr } = await supabase
      .from('employees')
      .insert({
        restaurant_id: restId, user_id: user.id, name: 'Ollie Offerer', position: 'Server',
        status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
      })
      .select('id').single();
    if (offErr) throw new Error(`offerer insert: ${offErr.message}`);

    const { data: accepter, error: accErr } = await supabase
      .from('employees')
      .insert({
        restaurant_id: restId, name: 'Alex Accepter', position: 'Server',
        status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
      })
      .select('id').single();
    if (accErr) throw new Error(`accepter insert: ${accErr.message}`);

    const start = new Date();
    start.setDate(start.getDate() + 3);
    start.setHours(16, 0, 0, 0);
    const end = new Date(start);
    end.setHours(22, 0, 0, 0);
    const { data: shift, error: sErr } = await supabase
      .from('shifts')
      .insert({
        restaurant_id: restId, employee_id: offerer.id,
        start_time: start.toISOString(), end_time: end.toISOString(),
        position: 'Server', status: 'scheduled', break_duration: 30,
        is_published: true, locked: false,
      })
      .select('id').single();
    if (sErr) throw new Error(`shift insert: ${sErr.message}`);

    const { data: trade, error: tErr } = await supabase
      .from('shift_trades')
      .insert({
        restaurant_id: restId, offered_shift_id: shift.id,
        offered_by_employee_id: offerer.id, accepted_by_employee_id: accepter.id,
        target_employee_id: null, status: 'pending_approval',
      })
      .select('id').single();
    if (tErr) throw new Error(`trade insert: ${tErr.message}`);

    return { tradeId: trade.id as string };
  }, restaurantId);
}

test.describe('Trade approval from a custom scheduling role', () => {
  test('a scheduling@manage custom role sees the trades tab and approves a pending trade', async ({ page }) => {
    const owner = generateTestUser('trade-approve-owner');
    await signUpAndCreateRestaurant(page, owner);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as unknown as WindowHelpers).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const seed = await seedPendingTrade(page, restaurantId as string);

    await grantCustomSchedulingRole(page, restaurantId as string, 'manage');

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 15000 });

    const tradesTab = page.getByRole('tab', { name: /shift trades/i });
    await expect(tradesTab).toBeVisible({ timeout: 15000 });
    await tradesTab.click();

    const card = page.getByTestId('pending-trade').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: /approve/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Approve Trade Request/i)).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: /^approve$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });

    // Authoritative: the trade status moved to 'approved'.
    await expect
      .poll(
        async () =>
          page.evaluate(async (tradeId: string) => {
            const supabase = (window as any).__supabase;
            const { data } = await supabase
              .from('shift_trades')
              .select('status')
              .eq('id', tradeId)
              .single();
            return data?.status ?? null;
          }, seed.tradeId),
        { timeout: 15000 },
      )
      .toBe('approved');
  });

  test('a scheduling@view custom role does not see the trades tab', async ({ page }) => {
    const owner = generateTestUser('trade-view-owner');
    await signUpAndCreateRestaurant(page, owner);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as unknown as WindowHelpers).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    await grantCustomSchedulingRole(page, restaurantId as string, 'view');

    await page.goto('/scheduling');
    await page.waitForURL(/\/scheduling/, { timeout: 15000 });

    // A scheduling@view role still lands on /scheduling (view:scheduling),
    // but never edit:scheduling, so the trades tab must not render at all —
    // a DOM-absence check, not merely "not visible" (Radix Tabs unmounts an
    // absent trigger rather than hiding it).
    await expect(page.getByRole('tab', { name: /schedule/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('tab', { name: /shift trades/i })).toHaveCount(0);
  });
});
