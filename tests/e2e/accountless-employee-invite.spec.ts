import { test, expect } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
} from '../helpers/e2e-supabase';

type EmployeeSeed = {
  name: string;
  email: string;
  position: string;
  status: string;
};

type WindowWithHelpers = Window & {
  __getRestaurantId?: (userId?: string) => Promise<string | null> | string | null;
  __insertEmployees?: (rows: EmployeeSeed[], restaurantId: string) => Promise<unknown>;
};

/**
 * E2E coverage for accountless-employee detection in the invite flows
 * (follow-up to #641 / PR #648).
 *
 * The behavioral change this feature ships is: when an invite email matches an
 * active employee who has no linked account yet (`employees.user_id IS NULL`),
 * BOTH invite surfaces surface the shared AccountlessEmployeeHint — for any
 * invitable role, not just staff. This spec drives that end to end against the
 * real app + local Supabase (auth, RLS-scoped `useAccountlessEmployees` query,
 * the member-vs-accountless precedence gating) across both surfaces:
 *   - Team → Invitations tab (member/manager context)
 *   - Team → Collaborators tab (collaborator context)
 *
 * Scope note — the accept→link half of the seam (accept-invitation +
 * link_invited_employee writing `employees.user_id`) is NOT driven here: the
 * invitation edge functions run as `service_role`, which has no INSERT/UPDATE
 * grant on `invitations`/`user_restaurants`/`employees` in the local/CI stack
 * (only `authenticated` does, and that path is RLS-blocked by design — there is
 * no owner INSERT policy on `invitations`). So there is no way to seed or run
 * that flow in CI. That half is covered instead by the pgTAP test
 * `supabase/tests/link_invited_employee.test.sql` (runs as owner via
 * `npm run test:db`) plus the send-body unit tests. See PR #648.
 */

test.describe('accountless employee invite detection', () => {
  test('surfaces the hint on both the member and collaborator invite surfaces, and only for a matching email', async ({ page }) => {
    const owner = generateTestUser('acct-owner');
    await signUpAndCreateRestaurant(page, owner);

    const restaurantId = await page.evaluate<string | null>(async () => {
      const fn = (window as WindowWithHelpers).__getRestaurantId;
      return fn ? await fn() : null;
    });
    expect(restaurantId).toBeTruthy();

    // An active employee with no linked account yet (user_id defaults to NULL).
    const employeeEmail = generateTestUser('acct-chef').email;
    await page.evaluate(
      async ({ email, restId }) => {
        const insert = (window as WindowWithHelpers).__insertEmployees;
        if (!insert) throw new Error('__insertEmployees helper not exposed');
        await insert(
          [{ name: 'Dana Prep', email, position: 'Chef', status: 'active' }],
          restId,
        );
      },
      { email: employeeEmail, restId: restaurantId as string },
    );

    const strangerEmail = generateTestUser('stranger').email;
    const hint = page.getByText(/already set up for scheduling here/i);

    // --- Member invite surface: Team → Invitations tab → Send Invitation ---
    await page.goto('/team');
    await page.getByRole('tab', { name: /view pending invitations/i }).click();
    await page.getByRole('button', { name: /send invitation/i }).click();

    const memberEmail = page.getByLabel(/email address/i);
    await expect(memberEmail).toBeVisible();

    await memberEmail.fill(employeeEmail);
    await expect(hint).toBeVisible();
    await expect(page.getByText('Dana Prep')).toBeVisible();

    // Non-matching email → hint gone (restaurant-scoped, no enumeration leak).
    await memberEmail.fill(strangerEmail);
    await expect(hint).not.toBeVisible();

    await page.keyboard.press('Escape');

    // --- Collaborator invite surface: Team → Collaborators tab → pick a preset ---
    await page.getByRole('tab', { name: /view collaborators/i }).click();
    await page.getByRole('button', { name: /Accountant/ }).click();

    const collabEmail = page.getByLabel(/email address/i);
    await expect(collabEmail).toBeVisible();

    // Same accountless employee, a non-staff collaborator role → hint still fires.
    await collabEmail.fill(employeeEmail);
    await expect(hint).toBeVisible();
    await expect(page.getByText('Dana Prep')).toBeVisible();

    await collabEmail.fill(strangerEmail);
    await expect(hint).not.toBeVisible();
  });
});
