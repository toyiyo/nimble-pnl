import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/** The helpers that `exposeSupabaseHelpers` puts on `window`. */
type E2EWindow = Window & { __supabase: SupabaseClient; __getRestaurantId: () => string };

/** The restaurant zone under test. It differs from the browser's zone. */
const RESTAURANT_TZ = 'America/Los_Angeles';

/** Formats `date` in `RESTAURANT_TZ`, matching a `date-fns` pattern's output. */
function formatInLA(date: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: RESTAURANT_TZ, ...opts }).format(date);
}

/**
 * E2E for the "Teammates need cover" home card, the "More" tab badge, and the
 * marketplace deep link.
 * Design: docs/superpowers/specs/2026-09-25-shift-trade-reminders-design.md (Part A).
 * Design: docs/superpowers/specs/2026-09-26-marketplace-restaurant-timezone-design.md.
 *
 * P (owner) posts an open trade for P's own shift. Q (a staff user) opens the
 * home screen on a phone viewport. Q sees the card and the badge, taps the
 * trade row, lands on the highlighted trade, and accepts it. The card then
 * disappears from Q's home screen.
 *
 * The seed copies tests/e2e/shift-trade-accept.spec.ts: RLS requires the
 * trade's offerer to be the caller's own employee, so P seeds as P.
 *
 * The browser zone is Tokyo. The restaurant zone is Los Angeles. The home
 * card and the marketplace card must both show the shift in the restaurant
 * zone, not the browser zone — see
 * tests/e2e/coverage-chart-explainer.spec.ts:41 for the zone-pin pattern.
 */
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo' });

test.describe('Teammates need cover', () => {
  test('a staff user sees an open trade on the home screen and accepts it through the deep link', async ({ page }) => {
    const primary = generateTestUser('cover-P');
    const acceptor = generateTestUser('cover-Q');
    await signUpAndCreateRestaurant(page, primary);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as unknown as E2EWindow).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Pin the restaurant zone to LA, which differs from the browser's Tokyo
    // zone. Both the home card and the marketplace card must read this zone,
    // not the browser zone.
    {
      const tzError = await page.evaluate(
        async ({ restId, tz }) => {
          const supabase = (window as unknown as E2EWindow).__supabase;
          const { error } = await supabase.from('restaurants').update({ timezone: tz }).eq('id', restId);
          return error?.message ?? null;
        },
        { restId: restaurantId as string, tz: RESTAURANT_TZ },
      );
      expect(tzError).toBeNull();
    }

    // A fixed UTC instant 3 days out: 01:00Z-07:00Z. That is 18:00-00:00 in
    // Los Angeles (a different calendar day at each end) and a different day
    // again in Tokyo, so a bug that used the browser zone or the UTC day
    // would show a different date or time than the restaurant zone does.
    const base = new Date();
    base.setUTCDate(base.getUTCDate() + 3);
    const startAt = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 1, 0, 0));
    const endAt = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 7, 0, 0));
    const startIso = startAt.toISOString();
    const endIso = endAt.toISOString();

    const seed = await page.evaluate(
      async ({ restId, qEmail, qPassword, pEmail, pPassword, startTime, endTime }) => {
        const supabase = (window as unknown as E2EWindow).__supabase;

        const pUserId = (await supabase.auth.getUser()).data.user?.id;
        if (!pUserId) throw new Error('No P session');

        const { data: pEmp, error: pErr } = await supabase
          .from('employees')
          .insert({
            restaurant_id: restId, user_id: pUserId, name: 'Pat Offerer', position: 'Server',
            status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
          })
          .select('id').single();
        if (pErr) throw new Error(`P employee insert: ${pErr.message}`);

        // A future published shift, 3 days out. Q has no shift then, so the
        // trade is claimable for Q.
        const { data: shift, error: sErr } = await supabase
          .from('shifts')
          .insert({
            restaurant_id: restId, employee_id: pEmp.id,
            start_time: startTime, end_time: endTime,
            position: 'Server', status: 'scheduled', break_duration: 30,
            is_published: true, locked: false,
          })
          .select('id').single();
        if (sErr) throw new Error(`shift insert: ${sErr.message}`);

        const { data: trade, error: tErr } = await supabase
          .from('shift_trades')
          .insert({
            restaurant_id: restId, offered_shift_id: shift.id,
            offered_by_employee_id: pEmp.id, target_employee_id: null, status: 'open',
            reason: 'Family event',
          })
          .select('id').single();
        if (tErr) throw new Error(`trade insert: ${tErr.message}`);

        // signUp switches the session to Q.
        const { data: qAuth, error: qErr } = await supabase.auth.signUp({ email: qEmail, password: qPassword });
        if (qErr) throw new Error(`Q signUp: ${qErr.message}`);
        const qUserId = qAuth?.user?.id;
        if (!qUserId) throw new Error('Q signUp returned no user id');

        // Sign in as owner P again to create Q's employee and membership.
        const { error: pSignIn } = await supabase.auth.signInWithPassword({ email: pEmail, password: pPassword });
        if (pSignIn) throw new Error(`P re-signin: ${pSignIn.message}`);

        const { data: qEmp, error: qEmpErr } = await supabase
          .from('employees')
          .insert({
            restaurant_id: restId, user_id: qUserId, name: 'Quinn Cover', position: 'Server',
            status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 1500,
          })
          .select('id').single();
        if (qEmpErr) throw new Error(`Q employee insert: ${qEmpErr.message}`);

        const { error: memErr } = await supabase
          .from('user_restaurants')
          .upsert({ user_id: qUserId, restaurant_id: restId, role: 'staff' }, { onConflict: 'user_id,restaurant_id' });
        if (memErr) throw new Error(`Q membership: ${memErr.message}`);

        return { tradeId: trade.id as string, qEmpId: qEmp.id as string };
      },
      {
        restId: restaurantId as string, qEmail: acceptor.email, qPassword: acceptor.password,
        pEmail: primary.email, pPassword: primary.password, startTime: startIso, endTime: endIso,
      },
    );

    await page.evaluate(async ({ qEmail, qPassword }) => {
      const supabase = (window as unknown as E2EWindow).__supabase;
      const { error } = await supabase.auth.signInWithPassword({ email: qEmail, password: qPassword });
      if (error) throw new Error(`Q signin: ${error.message}`);
    }, { qEmail: acceptor.email, qPassword: acceptor.password });

    // The expected date and time, computed in the restaurant zone (LA), not
    // the browser zone (Tokyo) and not the UTC day.
    const homeSpokenDate = formatInLA(startAt, { weekday: 'long', month: 'long', day: 'numeric' });
    const homeStartTime = formatInLA(startAt, { hour: 'numeric', minute: '2-digit', hour12: true });
    const homeEndTime = formatInLA(endAt, { hour: 'numeric', minute: '2-digit', hour12: true });
    const marketDate = formatInLA(startAt, { weekday: 'short', month: 'short', day: 'numeric' });

    // 1. The home screen shows the card with P's trade, in the restaurant zone.
    await page.goto('/employee/schedule');
    const card = page.getByRole('region', { name: 'Teammates need cover' });
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card.getByText(/It fits around your shifts/i)).toBeVisible();
    await expect(card.getByText(/Family event/)).toBeVisible();
    const homeLink = card.getByRole('link', {
      name: new RegExp(
        `View Server shift on ${homeSpokenDate}, ${homeStartTime} to ${homeEndTime}, from Pat Offerer`,
      ),
    });
    await expect(homeLink).toBeVisible();

    // 2. The "More" tab carries the count in its accessible name.
    await expect(
      page.getByRole('navigation', { name: 'Employee navigation' }).getByRole('link', { name: 'More, 1 shift up for grabs' }),
    ).toBeVisible();

    // 3. The row is one link. It opens the marketplace on the linked trade.
    await homeLink.click();
    await page.waitForURL(/\/employee\/shifts/, { timeout: 15000 });
    await expect(page.getByText('From your home screen')).toBeVisible({ timeout: 20000 });

    // The highlighted marketplace card shows the same restaurant-zone date
    // and time as the home card — not the browser's Tokyo zone.
    const highlighted = page.locator(`[data-trade-id="${seed.tradeId}"]`);
    await expect(highlighted).toHaveAttribute('aria-current', 'true');
    await expect(highlighted.getByText(marketDate)).toBeVisible();
    await expect(highlighted.getByText(`${homeStartTime} - ${homeEndTime}`)).toBeVisible();

    // 4. Q accepts the highlighted trade through the one accept flow.
    const acceptButton = page.getByRole('button', { name: /accept trade from pat offerer/i }).first();
    await expect(acceptButton).toBeVisible();
    const acceptResponse = page
      .waitForResponse((r) => r.url().includes('accept_shift_trade'), { timeout: 15000 })
      .catch(() => null);
    await acceptButton.click();
    await acceptResponse;

    await expect
      .poll(
        async () =>
          page.evaluate(async (tradeId: string) => {
            const supabase = (window as unknown as E2EWindow).__supabase;
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

    // 5. The trade is no longer open, so the card and the badge disappear.
    await page.goto('/employee/schedule');
    await expect(page.getByRole('heading', { name: 'My Schedule' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('region', { name: 'Teammates need cover' })).toHaveCount(0);
    // exact: a plain name match would also accept "More, 1 shift up for grabs".
    await expect(
      page.getByRole('navigation', { name: 'Employee navigation' }).getByRole('link', { name: 'More', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /up for grabs/ })).toHaveCount(0);
  });
});
