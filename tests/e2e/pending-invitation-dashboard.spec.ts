import { test, expect } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
  type E2EHelperWindow,
} from '../helpers/e2e-supabase';

/**
 * E2E coverage for the pending-invitation notice on the empty dashboard
 * (invite owner-account leak fix).
 *
 * The behavioral change: an invitee who signs up self-serve (without the
 * invite link) no longer lands on a bare "create a restaurant" screen.
 * The dashboard lists their pending invitation, and Accept joins the
 * restaurant through the token-free accept_my_invitation RPC. With one
 * membership, the restaurant auto-selects, the staff gate routes the
 * member to /employee/schedule, and no owner trial starts.
 *
 * Seeding note: the invitation row is inserted from the OWNER's browser
 * session — the "Restaurant owners and managers can manage invitations"
 * RLS policy admits it. No edge function runs, so the spec stays inside
 * the local/CI grant model (see accountless-employee-invite.spec.ts for
 * why the token path itself cannot be driven here).
 */

test.describe('pending invitation on the empty dashboard', () => {
  test('a self-serve invitee sees the invitation and joins the restaurant', async ({ page }) => {
    // 1. The owner signs up, creates the restaurant, and seeds an
    //    invitation for the invitee.
    const owner = generateTestUser('inv-owner');
    const invitee = generateTestUser('inv-staff');
    const restaurantId = await signUpAndCreateRestaurant(page, owner);

    await page.evaluate(
      async ({ restId, email }) => {
        const w = window as E2EHelperWindow;
        if (!w.__supabase) throw new Error('__supabase helper not exposed');
        const { data: { user } } = await w.__supabase.auth.getUser();
        if (!user) throw new Error('owner session missing');
        const { error } = await w.__supabase.from('invitations').insert({
          restaurant_id: restId,
          invited_by: user.id,
          email,
          role: 'staff',
          status: 'pending',
          token: `e2e-hash-${Date.now()}`,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (error) throw new Error(error.message);
      },
      { restId: restaurantId, email: invitee.email },
    );

    // 2. The owner signs out.
    await page.evaluate(async () => {
      const w = window as E2EHelperWindow;
      await w.__supabase.auth.signOut({ scope: 'local' });
    });

    // 3. The invitee signs up SELF-SERVE — the exact path that used to
    //    end in a second owner account.
    await page.goto('/auth');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForURL(/\/auth/);
    await exposeSupabaseHelpers(page);

    await page.getByRole('tab', { name: /sign up/i }).click();
    await expect(page.getByLabel(/full name/i)).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/email/i).first().fill(invitee.email);
    await page.getByLabel(/full name/i).fill(invitee.fullName);
    await page.getByLabel(/password/i).first().fill(invitee.password);
    await page.getByRole('button', { name: /sign up|create account/i }).click();
    await page.waitForURL('/', { timeout: 15000 });

    // Close the welcome modal when it appears.
    try {
      await page.getByRole('button', { name: 'Get Started', exact: true }).click({ timeout: 5000 });
    } catch {
      // Modal did not appear — continue.
    }

    // 4. The empty dashboard shows the pending invitation.
    await expect(page.getByText('You have a team invitation')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(owner.restaurantName)).toBeVisible();

    // 5. Accept joins the restaurant. The single membership auto-selects,
    //    the role resolves to staff, and StaffRoleChecker (src/App.tsx)
    //    routes the new member to the employee schedule — staff never
    //    sees the owner P&L dashboard. The redirect is the proof of the
    //    join: it only happens once the membership row exists and loads.
    await page
      .getByRole('button', { name: `Accept invitation to ${owner.restaurantName}` })
      .click();

    await page.waitForURL(/\/employee\/schedule/, { timeout: 20000 });
  });
});
