import { test, expect, Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

/**
 * The handles `exposeSupabaseHelpers` hangs off `window`. Typed rather than
 * cast to `any` at each use — same convention as tip-sharing.spec.ts. Types
 * are erased before the callback is serialized into the page.
 */
interface WindowHelpers {
  __getAuthUser: () => Promise<{ id: string } | null>;
  __getRestaurantId: (userId?: string) => Promise<string | null>;
  __supabase: SupabaseClient;
}

/**
 * E2E coverage for the roles-and-areas custom role editor and invite flow.
 *
 * This is the RED half of Phase 4 task 9 (roles-and-areas plan, 2026-07-29):
 * none of RolesList.tsx, RoleEditor.tsx, RolePreviewPanel.tsx, or the
 * area-derived nav/route filtering they depend on exist yet, so this spec
 * fails at its very first UI step (the "Roles & areas" tab is not on
 * src/pages/Team.tsx) and would keep failing through every later step even
 * if that tab existed, because AppSidebar.nav.ts's getNavigationForRole()
 * falls through to its `default:` case for `collaborator_custom` and
 * returns the *entire* nav rather than an area-filtered subset. Both gaps
 * are exactly what the remaining task 9 subtasks (9b onward) close.
 *
 * Design source, not to be deviated from:
 * docs/superpowers/specs/2026-07-29-roles-and-areas-design.md, "The roles
 * list" / "The role editor" / "The live preview" sections. The E2E scope
 * itself is spelled out there verbatim: "owner creates a custom
 * collaborator role, grants two areas, invites a user to it, and that user
 * sees exactly those areas — this is the cross-layer seam the Phase 8 gate
 * requires. Selectors are getByRole (radiogroup / radio / switch), which
 * doubles as the accessibility assertion: if the segmented controls are
 * built as toggle buttons, the test cannot find them."
 *
 * Copy and markup conventions asserted below (aria-label = "{Area} access",
 * "{N} granted" counter, "← All roles" back link, "New role" / "Save role"
 * buttons, chip suffix " · manage") are transcribed from the *approved*
 * interactive prototype, docs/design-reference/roles-and-areas.html — not
 * invented — so this test is pinning down the contract that prototype
 * already settled, not adding new requirements. Area *labels* (e.g.
 * "Inventory & Purchasing", not the prototype's differently-worded
 * "Scheduling & Labor") instead come from src/lib/permissions/areas.ts,
 * which is already-built, real GREEN code and the actual single source of
 * truth the editor must render from — the prototype predates it and used
 * placeholder copy for some rows.
 *
 * What this spec deliberately does NOT drive: the real invitation
 * email/accept round trip. accountless-employee-invite.spec.ts already
 * established why — the invite-accept edge functions run as service_role,
 * which nothing in CI can trigger for a fictional inbox, and there is no
 * owner-side INSERT policy on `invitations` for the `authenticated` role to
 * seed one directly either. The UI invite step itself (selecting the new
 * custom role's card, entering a fictional email, sending) IS driven for
 * real. To then verify "that user sees exactly those areas" without a
 * second auth session, this spec reuses the same substitution every other
 * role E2E test in this file already relies on (see setUserRole in
 * permissions-roles.spec.ts, __simulateCollaboratorRole in
 * e2e-supabase.ts): point the *current* session's user_restaurants row at
 * the new role directly, which is the exact state accepting the invitation
 * would produce, and is the sanctioned test-infrastructure substitute per
 * the note above.
 */

async function getRestaurantId(page: Page): Promise<string> {
  const restaurantId = await page.evaluate(() =>
    (window as unknown as WindowHelpers).__getRestaurantId()
  );
  if (!restaurantId) throw new Error('No restaurant id available on window.__getRestaurantId()');
  return restaurantId;
}

/** Look up a role's id by name, the same shape useRoles.ts's ROLES_SELECT queries. */
async function getRoleIdByName(page: Page, restaurantId: string, name: string): Promise<string> {
  const roleId = await page.evaluate(
    async ({ restaurantId, name }) => {
      const { data, error } = await (window as unknown as WindowHelpers).__supabase
        .from('roles')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('name', name)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id ?? null;
    },
    { restaurantId, name }
  );
  if (!roleId) throw new Error(`Role "${name}" was not found for restaurant ${restaurantId}`);
  return roleId;
}

/**
 * Stand-in for "the invited user accepted the invitation and is now signed
 * in" — see the file banner for why the real email round trip can't run in
 * CI. Unlike setUserRole/__simulateCollaboratorRole (which only ever write
 * the legacy `role` text column), this also sets `role_id`, because a
 * collaborator_custom membership's actual capabilities come from the
 * embedded roleRecord keyed off role_id (useRestaurants.tsx), not from the
 * `role` string.
 */
async function simulateAcceptedCustomRole(page: Page, restaurantId: string, roleId: string): Promise<void> {
  await exposeSupabaseHelpers(page);
  await page.evaluate(
    async ({ restaurantId, roleId }) => {
      const win = window as unknown as WindowHelpers;
      const user = await win.__getAuthUser();
      if (!user?.id) throw new Error('No user session');

      const { error } = await win.__supabase
        .from('user_restaurants')
        .update({ role: 'collaborator_custom', role_id: roleId })
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);

      if (error) throw new Error(`Failed to simulate accepted custom-role membership: ${error.message}`);
    },
    { restaurantId, roleId }
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test.describe('Roles & Areas', () => {
  test('owner builds a custom collaborator role, grants two areas, invites a user, and that user sees exactly those areas', async ({
    page,
  }) => {
    const owner = generateTestUser('roles-owner');
    await signUpAndCreateRestaurant(page, owner);
    const restaurantId = await getRestaurantId(page);

    // The design doc's own worked example (the "prose summary" sample under
    // "The live preview") is this exact role name — reused here rather than
    // invented, though this test grants a 2-area subset of that example's 4,
    // per this task's "grant two areas" scope.
    const roleName = `Weekend Supervisor ${Date.now()}`;

    // ---- Team → "Roles & areas" tab ----
    // Tab label, id convention (tab-roles / view-roles), and the sibling
    // "Team members" / "Invite" tabs are transcribed from the approved
    // prototype's <div class="tabs" role="tablist"> markup, not invented.
    await page.goto('/team');
    await page.getByRole('tab', { name: /roles & areas/i }).click();

    // ---- Roles list: dashed "New role" card ----
    await page.getByRole('button', { name: /new role/i }).click();

    // Full-page editor, reached via a "← All roles" back link (design doc:
    // "A full page reached from the roles list, with a ← All roles back
    // link" — not a dialog; an earlier draft that described a dialog was an
    // explicitly corrected mistake).
    await expect(page.getByRole('button', { name: /all roles/i })).toBeVisible();

    await page.getByLabel(/role name/i).fill(roleName);
    // Deliberately names neither granted area: the role card renders this
    // description, so wording it "…scheduling and inventory" would let the
    // area-chip assertions further down pass on the description text alone.
    await page.getByLabel(/what this person does/i).fill('Covers weekend shifts on the floor');

    // ---- Grant counter starts at zero with nothing granted yet ----
    const grantCounter = page.getByText(/^\d+\s+granted$/i);
    await expect(grantCounter).toHaveText(/^0\s+granted$/i);

    // ---- Capped level: Payroll is view-only for a collaborator role ----
    // (area_catalog.max_level_collaborator / AREA_DEFINITIONS['payroll'].maxLevelForCollaborator === 'view')
    const payrollGroup = page.getByRole('radiogroup', { name: /payroll access/i });
    const payrollManage = payrollGroup.getByRole('radio', { name: /^manage$/i });
    await expect(payrollManage).toBeDisabled();
    await expect(payrollManage).toHaveAttribute('aria-disabled', 'true');

    // The disabled reason is the accessible description, not just a visual
    // lock icon (design doc: "capped levels use disabled + aria-disabled
    // with the reason text as their accessible description").
    const payrollDescribedBy = await payrollManage.getAttribute('aria-describedby');
    expect(payrollDescribedBy, 'capped Manage radio must have an aria-describedby pointing at its reason text').toBeTruthy();
    await expect(page.locator(`#${payrollDescribedBy}`)).toContainText(/owners and managers only/i);

    // ---- Ungrantable area: Team & Access can never be granted by any collaborator role ----
    // (AREA_DEFINITIONS['team'].maxLevelForCollaborator === null — the
    // privilege-escalation guard the design doc calls out explicitly.)
    const teamGroup = page.getByRole('radiogroup', { name: /team & access access/i });
    await expect(teamGroup.getByRole('radio', { name: /^view$/i })).toBeDisabled();
    const teamManage = teamGroup.getByRole('radio', { name: /^manage$/i });
    await expect(teamManage).toBeDisabled();
    const teamDescribedBy = await teamManage.getAttribute('aria-describedby');
    expect(teamDescribedBy, 'the ungrantable Team & Access row must explain why via an accessible description').toBeTruthy();
    await expect(page.locator(`#${teamDescribedBy}`)).toContainText(/owners and managers only/i);

    // ---- Grant area 1: Inventory & Purchasing → Manage ----
    // Neither of the two areas granted below is capped for a collaborator
    // role, so the grant is meaningful (not silently clamped), and per
    // AREA_PRIORITY in usePermissions.ts, 'inventory' outranks 'scheduling'
    // for landing-path purposes — asserted further down.
    const inventoryGroup = page.getByRole('radiogroup', { name: /inventory & purchasing access/i });
    await inventoryGroup.getByRole('radio', { name: /^manage$/i }).click();
    await expect(grantCounter).not.toHaveText(/^0\s+granted$/i);
    const countAfterFirstGrant = await grantCounter.textContent();

    // ---- Grant area 2: Scheduling → View ----
    const schedulingGroup = page.getByRole('radiogroup', { name: /^scheduling access$/i });
    await schedulingGroup.getByRole('radio', { name: /^view$/i }).click();
    // Assert the counter moved again rather than pinning an exact number —
    // the exact capability count is expandAreas' internal bundle size, not
    // something this UI test should couple itself to.
    await expect(grantCounter).not.toHaveText(countAfterFirstGrant ?? '');

    // ---- Sensitive-data switches use switch semantics, not checkboxes ----
    // (design doc: "The three sensitive flags are Switches" — the
    // radiogroup/radio/switch role selectors ARE the accessibility
    // assertion per the plan; a ToggleGroup/checkbox implementation would
    // fail to be found here.)
    await expect(page.getByRole('switch', { name: /costs/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: /pay rates/i })).toBeVisible();

    // ---- Save ----
    await page.getByRole('button', { name: /^save role$/i }).click();

    // ---- Back on the roles list: the new card shows exactly what was granted ----
    // The card is an <article>, not a button: it holds two doors (the name
    // block opens the definition, the footer opens who holds the role), and a
    // button inside a button is invalid HTML.
    const roleCard = page.getByRole('article', { name: new RegExp(roleName) });
    await expect(roleCard).toBeVisible();
    await expect(roleCard).toContainText(/inventory & purchasing/i);
    await expect(roleCard).toContainText(/· manage/i); // manage-level chip suffix
    await expect(roleCard).toContainText(/scheduling/i);
    await expect(roleCard).toContainText(/custom/i); // CUSTOM badge, vs. built-ins' BUILT-IN

    // ---- Collaborator invite tab: the new custom role is a selectable option ----
    // The prototype sketched three tabs (Team members / Roles & areas /
    // Invite) because it only modelled the invite step. The real page has a
    // fourth concern the prototype never saw — internal-team invitations —
    // so its collaborator tab stays "Collaborators" (invite + active + pending
    // collaborators) rather than being renamed "Invite", which would sit
    // confusingly beside "Invitations" and understate what the tab holds.
    await page.getByRole('tab', { name: /view collaborators/i }).click();
    await page.getByRole('button', { name: new RegExp(roleName) }).click();

    const invitedEmail = `weekend-supervisor-invite-${Date.now()}@example.com`;
    // /email address/i, the exact visible label — /email/i also matches the
    // per-row "Cancel invitation for {address}" / "Remove collaborator
    // {address}" aria-labels whenever an address happens to contain "email".
    await page.getByLabel(/email address/i).fill(invitedEmail);
    await page.getByRole('button', { name: /send/i }).click();

    // ---- Simulate acceptance and verify the invited user sees exactly those two areas ----
    const roleId = await getRoleIdByName(page, restaurantId, roleName);
    await simulateAcceptedCustomRole(page, restaurantId, roleId);

    // Landing path: 'inventory' precedes 'scheduling' in AREA_PRIORITY
    // (usePermissions.ts), so a role holding both lands on /inventory.
    await expect(page).toHaveURL('/inventory', { timeout: 15000 });

    const sidebar = page.locator('aside[role="navigation"], [data-sidebar]').first();
    await expect(sidebar).toBeVisible();

    // Each nav group is a Collapsible whose content Radix *unmounts* while
    // closed, and only the group holding the current path opens by default.
    // Landing on /inventory therefore opens Inventory and leaves Operations
    // closed. Two consequences this block is written around: a granted item
    // in a closed group has to be revealed before it can be asserted visible,
    // and every negative below must be a DOM-absence check — `not.toBeVisible`
    // would pass for any collapsed group whether or not the role was granted
    // it, which is exactly the assertion that cannot be allowed to be vacuous
    // here.
    await expect(sidebar.getByRole('button', { name: 'Inventory', exact: true })).toBeVisible();

    await sidebar.getByText('Operations', { exact: true }).first().click();
    await expect(sidebar.getByRole('button', { name: 'Scheduling', exact: true })).toBeVisible();

    // Scheduling was granted at *view*, and /time-punches and /tips are gated
    // at manage (routeAreas.ts), so the rest of the now-open Operations group
    // is absent from the DOM rather than merely hidden.
    await expect(sidebar.getByRole('button', { name: 'Time Clock', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Tip Pooling', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Payroll', exact: true })).toHaveCount(0);

    // Ungranted areas produce no group at all — in particular Team, which
    // this role could never have been granted in the first place.
    await expect(sidebar.getByText('Accounting', { exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Transactions', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Team', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Employees', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  });

  test('an owner can grant Invoices without granting Banking', async ({ page }) => {
    // The literal complaint: "I am expecting to be able to set permissions for
    // tip pooling, invoices, and other individual pages."
    const owner = generateTestUser('invoices-only-owner');
    await signUpAndCreateRestaurant(page, owner);

    await page.goto('/team');
    await page.getByRole('tab', { name: /roles & areas/i }).click();
    await page.getByRole('button', { name: /new role/i }).click();
    await page.getByLabel(/role name/i).fill('Invoices only');

    // aria-label convention is "{row.label} access" (RoleEditor.tsx), not
    // "access level" — see the sibling test above for the same pattern.
    await page.getByRole('radiogroup', { name: /^invoices access$/i })
              .getByRole('radio', { name: /^manage$/i }).click();

    // RolePreviewPanel ("What they'll see") is the only <aside> on this page
    // and carries no accessible name, so it lands the implicit
    // "complementary" landmark role — an accessible selector, not a testid.
    const preview = page.getByRole('complementary');
    await expect(preview.getByText('Invoices')).toBeVisible();
    await expect(preview.getByText('Banks')).toBeHidden();

    await page.getByRole('button', { name: /^save role$/i }).click();
    await expect(page.getByText('Invoices only')).toBeVisible();

    // Reopen: the grant persisted as one page, not a bundle.
    await page.getByText('Invoices only').click();
    await expect(
      page.getByRole('radiogroup', { name: /^invoices access$/i })
          .getByRole('radio', { name: /^manage$/i })
    ).toBeChecked();
    await expect(
      page.getByRole('radiogroup', { name: /^banks access$/i })
          .getByRole('radio', { name: /^no access$/i })
    ).toBeChecked();
  });
});
