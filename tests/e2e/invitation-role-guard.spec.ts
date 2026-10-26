import { test, expect } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * E2E coverage for the invitation role guard
 * (supabase/migrations/20261026120200_invitation_role_guard.sql).
 *
 * The seam under test: a browser session that writes `invitations` straight
 * through PostgREST. Before the fix, the FOR ALL policy checked only the
 * caller's membership, so the row could carry any role and any invited_by.
 *
 * The owner is the only role that a fresh sign-up gets, so this spec drives
 * the owner. The pgTAP file supabase/tests/invitation_role_guard_test.sql
 * covers the manager, operations_manager, staff and invitee rows.
 */

type WriteResult = { ok: boolean; code: string | null; message: string | null };

test.describe('invitation role guard', () => {
  test('an owner can write a staff invitation but cannot forge one', async ({ page }) => {
    const owner = generateTestUser('inv-guard-owner');
    const restaurantId = await signUpAndCreateRestaurant(page, owner);

    const results = await page.evaluate(async ({ restId }) => {
      const w = window as E2EHelperWindow;
      if (!w.__supabase) throw new Error('__supabase helper not exposed');
      const { data: { user } } = await w.__supabase.auth.getUser();
      if (!user) throw new Error('owner session missing');

      const stamp = Date.now();
      const toResult = (error: { code?: string; message?: string } | null): WriteResult => ({
        ok: !error,
        code: error?.code ?? null,
        message: error?.message ?? null,
      });
      const insert = (role: string, invitedBy: string, email: string) =>
        w.__supabase.from('invitations').insert({
          restaurant_id: restId,
          invited_by: invitedBy,
          email,
          role,
          status: 'pending',
          token: `e2e-guard-${role}-${stamp}`,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });

      // 1. The allowed write: the same shape as pending-invitation-dashboard.spec.ts.
      const staffEmail = `guard-staff-${stamp}@example.test`;
      const staff = toResult((await insert('staff', user.id, staffEmail)).error);

      // 2. A forged invited_by.
      const forged = toResult(
        (await insert('staff', crypto.randomUUID(), `guard-forged-${stamp}@example.test`)).error,
      );

      // 3. A role that nobody may invite.
      const kiosk = toResult((await insert('kiosk', user.id, `guard-kiosk-${stamp}@example.test`)).error);

      // 4. A role change on the row from step 1.
      const { data: row } = await w.__supabase
        .from('invitations')
        .select('id')
        .eq('restaurant_id', restId)
        .eq('email', staffEmail)
        .single();
      const roleChange = toResult(
        (await w.__supabase.from('invitations').update({ role: 'owner' }).eq('id', row?.id ?? '')).error,
      );
      const { data: after } = await w.__supabase
        .from('invitations')
        .select('role')
        .eq('id', row?.id ?? '')
        .single();

      // 5. Cancel still works.
      const cancel = toResult(
        (await w.__supabase.from('invitations').delete().eq('id', row?.id ?? '')).error,
      );

      return { staff, forged, kiosk, roleChange, roleAfter: after?.role ?? null, cancel };
    }, { restId: restaurantId });

    expect(results.staff).toEqual({ ok: true, code: null, message: null });
    expect(results.forged.ok).toBe(false);
    expect(results.forged.code).toBe('42501');
    expect(results.kiosk.ok).toBe(false);
    expect(results.kiosk.code).toBe('42501');
    expect(results.roleChange.ok).toBe(false);
    expect(results.roleChange.code).toBe('42501');
    expect(results.roleAfter).toBe('staff');
    expect(results.cancel.ok).toBe(true);
  });
});
