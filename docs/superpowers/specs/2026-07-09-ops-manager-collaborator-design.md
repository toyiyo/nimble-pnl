# Design: `collaborator_operations_manager` — scoped external operations collaborator

**Date:** 2026-07-09
**Status:** Approved
**Author:** Claude (via /dev)

## Problem

The **Collaborators** tab under `/team` (`CollaboratorInvitations`) lets an owner/manager
invite external, isolated specialists via preset cards: **Accountant**, **Inventory
Helper**, **Recipe Consultant** (Chef). There is no way to invite an **Operations
Manager** collaborator — someone brought in externally to run day-to-day operations
(scheduling, labor, tips, inventory) without access to the owner's books or admin
settings.

An internal `operations_manager` role already exists and is invitable from the
**Invitations** tab, but that is a *full internal team member* (team + employee
management, settings view). It is the wrong fit for the "external isolated
collaborator" model, and it does not appear in the Collaborators UI (which keys on the
`collaborator_%` role prefix). Users want an Operations Manager option **in the
Collaborators tab** for discoverability and easy invite.

## Decision

Add a **new** external collaborator role: `collaborator_operations_manager`.

It follows the existing `collaborator_%` convention, so it appears correctly in the
Collaborators list, invites list, and preset cards, and stays isolated by RLS (it is
NOT added to `user_is_internal_team`, so the collaborator sees only their own
`user_restaurants` row).

### Capability scope

Mirrors the internal `operations_manager` **minus** admin surfaces, with payroll
**view-only**. Full operational breadth was explicitly requested (inventory + recipe
ops + view payroll + AI assistant included).

**Included capabilities:**

| Surface | Capabilities |
|---|---|
| Dashboard / AI | `view:dashboard`, `view:ai_assistant` (subscription-gated) |
| Inventory | `view:inventory`, `edit:inventory`, `view:inventory_audit`, `edit:inventory_audit`, `view:purchase_orders`, `edit:purchase_orders`, `view:receipt_import`, `edit:receipt_import`, `view:reports`, `view:inventory_transactions`, `edit:inventory_transactions` |
| Recipes | `view:recipes`, `edit:recipes`, `view:prep_recipes`, `edit:prep_recipes`, `view:batches`, `edit:batches` |
| Operations | `view:pos_sales`, `view:scheduling`, `edit:scheduling`, `view:time_punches`, `edit:time_punches`, `view:tips`, `edit:tips` |
| Labor context | `view:payroll` (read-only), `view:employees` (read-only, required to assign shifts) |
| Account | `view:settings` (own account only) |

**Explicitly excluded** (external isolation / admin / accounting):
`view:team`, `manage:team`, `manage:employees`, `edit:payroll`, `edit:settings`,
`view:integrations`, `manage:integrations`, `view:collaborators`,
`manage:collaborators`, `manage:subscription`, and the entire accounting surface
(`transactions`, `banking`, `expenses`, `financial_statements`, `chart_of_accounts`,
`invoices`, `customers`, `pending_outflows`, `assets`, `financial_intelligence`).

This is the same "included" set as internal `operations_manager` except: **team/manage
branches dropped**, **`manage:employees` dropped** (`view:employees` kept),
**`edit:payroll` dropped** (`view:payroll` kept).

## Architecture / Changes by layer

### 1. TypeScript permissions (single source of truth)

- `src/lib/permissions/types.ts`: add `'collaborator_operations_manager'` to the `Role`
  union and update the doc comment.
- `src/lib/permissions/definitions.ts`:
  - `ROLE_CAPABILITIES`: add the capability array above.
  - `ROLE_METADATA`: `label: 'Operations Manager'`, `description` (external ops),
    `category: 'collaborator'`, `landingPath: '/scheduling'`, `color: 'outline'`.
  - `COLLABORATOR_PRESETS`: append a 4th preset (`title: 'Operations Manager'`,
    description "Can run scheduling, labor, tips, and inventory operations", `features`
    bullet list).

### 2. Invite matrix

- `src/lib/permissions/invitations.ts`: add `collaborator_operations_manager` to the
  `owner` and `manager` `INVITABLE_ROLES` arrays, and add an empty `[]` entry for the
  new role itself (default-deny; it cannot invite anyone).
- `supabase/functions/send-team-invitation/index.ts`: mirror the same matrix additions
  (this file duplicates the matrix and MUST stay in sync), and add
  `'collaborator_operations_manager': 'Operations Manager'` to the `friendlyRole` map.
  The existing `role.startsWith('collaborator_')` logic already routes it through the
  "collaborate with" email copy — no change needed there.

### 3. UI

- `src/components/CollaboratorInvitations.tsx`: add an icon to `roleIcons`
  (`collaborator_operations_manager: ClipboardList` — imported from `lucide-react`).
  The role-selection grid already maps over `COLLABORATOR_PRESETS`; it uses
  `md:grid-cols-3`. With 4 presets, change to `md:grid-cols-2 lg:grid-cols-4` so the
  cards wrap cleanly on all breakpoints instead of leaving an orphan card.

### 4. SQL migration `supabase/migrations/<ts>_add_collaborator_operations_manager_role.sql`

Ordered: constraint → `user_has_capability` → RLS policies.

1. **Role CHECK constraint** on `user_restaurants`: drop/recreate including
   `collaborator_operations_manager` (keep all existing roles).
2. **`user_has_capability`**: `CREATE OR REPLACE` from the *live* body
   (`20260702170000_add_operations_manager_role.sql`), adding
   `collaborator_operations_manager` to the same branches operations_manager is in,
   **except**: NOT to `view:team`, `manage:team`, `manage:employees`, `edit:payroll`.
   Add it to `view:payroll` and `view:employees`. Add to `view:ai_assistant` (keeps the
   subscription gate). `view:settings` already passes (all except kiosk).
3. **Hardcoded operational RLS policies** — add `collaborator_operations_manager`
   alongside `operations_manager` in every policy that currently lists it:
   `tip_pool_settings`, `tip_splits`, `tip_split_items`, `tip_disputes`,
   `tip_contribution_pools`, `tip_server_earnings`, `tip_pool_allocations`,
   `tip_payouts`, `overtime_rules`, `overtime_adjustments`,
   `daily_labor_allocations`, `schedule_publications`, `schedule_change_logs`,
   `open_shift_claims`, `staffing_settings`, `time_punches` (INSERT),
   `receipt_imports` (view/insert/update). **Not** `employee_compensation_history`
   INSERT (collaborator has no `edit:payroll`).
4. **Core scheduling tables** — `shifts`, `shift_templates`, `time_off_requests`
   INSERT/UPDATE/DELETE policies currently allow `('owner','manager')` only. Widen to
   `('owner','manager','operations_manager','collaborator_operations_manager')`.
   **Decided trade-off:** this also fixes the latent gap where internal
   `operations_manager` could not directly edit shifts despite holding
   `edit:scheduling`. It is a one-literal-per-policy change and leaving the internal
   role broken while the external collaborator works would be incoherent. Documented in
   the migration header.
5. **`employees` SELECT** — ensure `collaborator_operations_manager` can read the
   employee list (required for scheduling). Mirror however `collaborator_accountant`
   currently gets `view:employees` read access (capability-gated or role-list); add the
   new role to the same SELECT policy. Do **not** grant employee INSERT/UPDATE/DELETE.
6. Update the `COMMENT ON FUNCTION user_has_capability` to document the new role.

Capability-gated tables (products, recipes, prep_recipes, production_runs,
inventory_transactions, purchase_orders, invoices, customers, pending_outflows — all
migrated to `user_has_capability()` in `20260120100100`) require **no** policy change:
they resolve automatically once the capability function includes the new role.

### 5. Tests

- **pgTAP** (`supabase/tests/`): with a fixture user assigned
  `collaborator_operations_manager`, assert `user_has_capability` returns:
  - TRUE for a representative granted set (`view:scheduling`, `edit:scheduling`,
    `edit:tips`, `edit:inventory`, `edit:recipes`, `view:payroll`, `view:employees`,
    `view:pos_sales`).
  - FALSE for the denied set (`manage:team`, `manage:employees`, `edit:payroll`,
    `edit:settings`, `manage:collaborators`, `view:transactions`).
  - Assert `user_is_internal_team` is FALSE and `user_is_collaborator` is TRUE for the
    role (isolation preserved).
  - Assert an `INSERT` into `shifts` succeeds under the new role (scheduling write
    works) and an `INSERT` into `bank_transactions`/accounting is denied.
- **Vitest** (`tests/unit/`): `canInviteRole('owner', 'collaborator_operations_manager')`
  and `('manager', ...)` are TRUE; `getInvitableRoles('collaborator_operations_manager')`
  is empty; `isCollaboratorRole('collaborator_operations_manager')` is TRUE;
  `getCollaboratorRoles()` includes it; `COLLABORATOR_PRESETS` has 4 entries and the new
  one has non-empty `features`.

## Non-goals

- Not converting the hardcoded operational RLS policies to `user_has_capability()`
  (large risky refactor; out of scope — follow the established add-the-literal
  precedent).
- Not renaming or removing the internal `operations_manager` role.
- Not changing collaborator acceptance / onboarding flow (handled generically by
  `accept-invitation`, which is role-agnostic and writes with the service role).

## Risks

- **RLS blast radius:** ~40 policy statements touched. Mitigated by following the exact
  precedent of `20260702170000` (mechanical, add-the-literal) and by pgTAP coverage of
  both a granted and a denied path, plus a scheduling-write assertion.
- **Sync drift:** three sources must agree — `ROLE_CAPABILITIES` (TS),
  `user_has_capability` (SQL), and the invite matrix (TS + edge fn). The plan sequences
  these together and tests pin the SQL side.
