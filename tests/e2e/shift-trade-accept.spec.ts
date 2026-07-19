import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E for PR #615 (harden accept_shift_trade authz). Proves the permission change does NOT
 * break the legitimate employee flow: employee Q logs in and accepts a COWORKER's (P's) open
 * shift trade through the real "Accept Shift" button, and the trade moves to pending_approval
 * with Q recorded as the accepter.
 *
 * The new server check requires the accepting employee row to belong to the caller
 * (user_id = auth.uid(), active, same restaurant); the client passes currentEmployee.id
 * (resolved by user_id = the caller). Negative paths (forged id, non-target on directed,
 * cross-restaurant) are covered by pgTAP (supabase/tests/54_accept_shift_trade_authz.sql);
 * this spec proves the happy path through real auth + UI + RPC.
 *
 * Two real users because RLS requires the trade's offerer to be the caller's own employee:
 *   P (owner) offers P's own shift; Q (a second real user) accepts it.
 */
test.describe('Shift Trade Acceptance (accept_shift_trade authz)', () => {
  test('an employee can accept a coworker\'s open shift trade', async ({ page }) => {
    const primary = generateTestUser('trade-P');
    const acceptor = generateTestUser('trade-Q');
    await signUpAndCreateRestaurant(page, primary);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed: P (offerer) creates P's employee + future published shift + an OPEN trade
    // (RLS-legit: offered_by is P's own employee). Then create acceptor Q (a second real
    // user), Q's employee + staff membership — done while re-authenticated as owner P.
    const seed = await page.evaluate(
      async ({ restId, qEmail, qPassword, pEmail, pPassword }) => {
        const supabase = (window as any).__supabase;

        const pUserId = (await supabase.auth.getUser()).data.user?.id;
        if (!pUserId) throw new Error('No P session');

        // P's employee (offerer).
        const { data: pEmp, error: pErr } = await supabase
          .from('employees')
          .insert({
            restaurant_id: restId, user_id: pUserId, name: 'Pat Offerer', position: 'Server',
            status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
          })
          .select().single();
        if (pErr) throw new Error(`P employee insert: ${pErr.message}`);

        // P's future published shift.
        const start = new Date();
        start.setDate(start.getDate() + 3);
        start.setHours(16, 0, 0, 0);
        const end = new Date(start);
        end.setHours(22, 0, 0, 0);
        const { data: shift, error: sErr } = await supabase
          .from('shifts')
          .insert({
            restaurant_id: restId, employee_id: pEmp.id,
            start_time: start.toISOString(), end_time: end.toISOString(),
            position: 'Server', status: 'scheduled', break_duration: 30,
            is_published: true, locked: false,
          })
          .select().single();
        if (sErr) throw new Error(`shift insert: ${sErr.message}`);

        // OPEN marketplace trade offered by P (RLS WITH CHECK: offered_by is P's employee).
        const { data: trade, error: tErr } = await supabase
          .from('shift_trades')
          .insert({
            restaurant_id: restId, offered_shift_id: shift.id,
            offered_by_employee_id: pEmp.id, target_employee_id: null, status: 'open',
          })
          .select().single();
        if (tErr) throw new Error(`trade insert: ${tErr.message}`);

        // Create acceptor Q as a real auth user (signUp switches the session to Q).
        const { data: qAuth, error: qErr } = await supabase.auth.signUp({ email: qEmail, password: qPassword });
        if (qErr) throw new Error(`Q signUp: ${qErr.message}`);
        const qUserId = qAuth?.user?.id;
        if (!qUserId) throw new Error('Q signUp returned no user id');

        // Re-authenticate as owner P to create Q's employee + membership.
        const { error: pSignIn } = await supabase.auth.signInWithPassword({ email: pEmail, password: pPassword });
        if (pSignIn) throw new Error(`P re-signin: ${pSignIn.message}`);

        const { data: qEmp, error: qEmpErr } = await supabase
          .from('employees')
          .insert({
            restaurant_id: restId, user_id: qUserId, name: 'Quinn Acceptor', position: 'Server',
            status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
          })
          .select().single();
        if (qEmpErr) throw new Error(`Q employee insert: ${qEmpErr.message}`);

        const { error: memErr } = await supabase
          .from('user_restaurants')
          .upsert({ user_id: qUserId, restaurant_id: restId, role: 'staff' }, { onConflict: 'user_id,restaurant_id' });
        if (memErr) throw new Error(`Q membership: ${memErr.message}`);

        return { tradeId: trade.id as string, qEmpId: qEmp.id as string };
      },
      { restId: restaurantId as string, qEmail: acceptor.email, qPassword: acceptor.password, pEmail: primary.email, pPassword: primary.password },
    );

    // Log in as Q (the acceptor) and reload so the app runs under Q's session.
    await page.evaluate(async ({ qEmail, qPassword }) => {
      const supabase = (window as any).__supabase;
      const { error } = await supabase.auth.signInWithPassword({ email: qEmail, password: qPassword });
      if (error) throw new Error(`Q signin: ${error.message}`);
    }, { qEmail: acceptor.email, qPassword: acceptor.password });

    await page.goto('/employee/shifts');
    await page.waitForURL(/\/employee\/shifts/, { timeout: 15000 });

    // Q sees P's open trade and accepts it via the real button. The trade card's
    // accept control is labelled "Accept trade from <offerer> on <date>".
    const acceptButton = page.getByRole('button', { name: /accept trade from/i }).first();
    await expect(acceptButton).toBeVisible({ timeout: 20000 });

    const acceptResponse = page
      .waitForResponse((r) => r.url().includes('accept_shift_trade'), { timeout: 15000 })
      .catch(() => null);
    await acceptButton.click();
    await acceptResponse;

    // Authoritative: the trade is now pending_approval with Q recorded as accepter.
    await expect
      .poll(
        async () =>
          page.evaluate(async (tradeId: string) => {
            const supabase = (window as any).__supabase;
            const { data } = await supabase
              .from('shift_trades')
              .select('status, accepted_by_employee_id')
              .eq('id', tradeId)
              .single();
            return data ? `${data.status}:${data.accepted_by_employee_id}` : null;
          }, seed.tradeId),
        { timeout: 15000 },
      )
      .toBe(`pending_approval:${seed.qEmpId}`);
  });
});
