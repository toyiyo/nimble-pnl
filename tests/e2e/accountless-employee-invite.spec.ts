import { test, expect } from '@playwright/test';
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
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

/**
 * The third invite surface: the employee dialog itself.
 *
 * Before this, that dialog hardcoded `role: 'staff'` and told the admin the
 * invite would let the person "clock in, view their own schedule, and request
 * time off" no matter what — so a restaurant that had built a custom role had
 * no way to reach it from the place they were actually standing.
 *
 * Scope note, same shape as the one above: this asserts on the picker and the
 * employee record, NOT on a row in `invitations`. The send runs through the
 * `send-team-invitation` edge function as `service_role`, which has no INSERT
 * grant on `invitations` in the local/CI stack, so a "the invitation carries
 * this role" assertion would fail here for a reason unrelated to the code
 * under test. The payload the dialog builds — including the CUSTOM_ROLE /
 * roleId pairing the edge function requires — is pinned instead by
 * `tests/unit/EmployeeDialog.appAccess.test.tsx`. What only a browser can
 * prove is what this test covers: that the custom role reaches the picker at
 * all, through the real `roles` table under real RLS.
 */
test('the employee dialog invites into a custom role, and says so', async ({ page }) => {
  const owner = generateTestUser('emp-invite-owner');
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  const roleName = `Pastry Lead ${Date.now()}`;
  const roleDescription = 'Runs the pastry station and owns its recipes.';

  await page.evaluate(
    async ({ roleName, roleDescription }) => {
      // `any`: both are test-only globals attached by exposeSupabaseHelpers, no typed surface.
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { data: role, error: roleError } = await supabase
        .from('roles')
        .insert({
          restaurant_id: restaurantId,
          name: roleName,
          description: roleDescription,
          flavor: 'collaborator',
          builtin: false,
        })
        .select('id')
        .single();
      if (roleError) throw new Error(`role insert failed: ${roleError.message}`);

      const { error: grantError } = await supabase
        .from('role_areas')
        .insert({ role_id: role.id, area_key: 'recipes', level: 'manage' });
      if (grantError) throw new Error(`grant insert failed: ${grantError.message}`);
    },
    { roleName, roleDescription },
  );

  await page.goto('/employees');
  // Scoped by name, not a bare getByRole('dialog'): Radix portals an open
  // Popover as its own top-level `dialog`, so while the role picker is open
  // there are two on the page and an unnamed locator is ambiguous.
  const dialog = page.getByRole('dialog', { name: /add new employee/i });

  await page.getByRole('button', { name: 'Add Employee' }).click();
  await expect(dialog).toBeVisible();

  // Both fields carry an aria-label that overrides their visible <Label>, so
  // the accessible names are "Employee name" / "Employee email", not "Name" /
  // "Email".
  await dialog.getByLabel(/employee name/i).fill('Rae Baker');
  await dialog.getByLabel(/employee email/i).fill(generateTestUser('rae').email);
  // Required on the default hourly compensation path — without it the browser
  // blocks the submit and the dialog never closes.
  await dialog.getByLabel(/hourly rate in dollars/i).fill('18');

  const accessSwitch = dialog.getByRole('switch', { name: /invite to the employee app/i });
  await accessSwitch.click();

  // Unchosen still means staff — the picker changes what you CAN send, not
  // what gets sent by default. The chip shows ROLE_METADATA.staff.label, which
  // is the customer-facing name for that role, not the enum literal.
  const picker = dialog.getByRole('combobox', { name: /invite as .*change role/i });
  await expect(picker).toContainText('Employee (self-service)');

  await picker.click();
  await page.getByRole('option', { name: new RegExp(roleName) }).click();

  // Unlike RolePicker's, this popover has no commit footer — the choice IS the
  // action — so it closes instead of parking a panel over the rest of the form.
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
  await expect(picker).toContainText(roleName);
  // The hint used to describe staff access regardless of the role being sent.
  await expect(dialog.getByText(roleDescription)).toBeVisible();

  await dialog.getByRole('button', { name: 'Add Employee' }).click();

  // The employee lands whether or not the invite email goes out — the two are
  // deliberately not coupled, so a mail failure can't lose the record.
  await expect(dialog).not.toBeVisible();
  // The list row, not getByText — the success toast says the name too.
  await expect(page.getByRole('button', { name: 'Edit Rae Baker' })).toBeVisible({
    timeout: 10000,
  });
});
