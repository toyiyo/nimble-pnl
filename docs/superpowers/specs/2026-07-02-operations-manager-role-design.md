# Design: `operations_manager` Role

**Date:** 2026-07-02
**Status:** Approved (pending spec review)
**Author:** Development workflow (`/dev`)

## Problem

Owners need to invite a team member who can run the full operation —
inventory, recipes, purchasing, scheduling, labor (payroll/tips/time),
POS visibility, and staffing — **without** access to accounting
(bookkeeping) or administrative controls (settings, integrations,
external collaborators).

The existing `manager` role is unsuitable: it already grants **full
accounting** (transactions, banking, expenses, financial statements,
invoices, customers) **and** admin surfaces (integrations, collaborator
management). "Everything except accounting and admin" therefore
describes a **new, more-restricted tier**, not the current manager.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Model as new role or redefine `manager`? | **New role** `operations_manager`; existing `manager` unchanged (non-breaking). |
| UI label | **"Operations Manager"** |
| Can the role invite / manage team? | **Yes, scoped**: can invite **Staff only**, and can activate/deactivate employees. |
| Accounting boundary (payroll/tips) | **Keep** payroll, tips, scheduling, time punches. Exclude pure bookkeeping. |
| Admin boundary | **Exclude all admin** (settings-edit, integrations, collaborators) but **allow employee management**. |
| `pending_outflows` | Treated as accounting (accounts-payable surface, gated to accountant in SQL) → **excluded**. |

## Architecture

The permission system has three layers that must stay in sync:

1. **TypeScript source of truth** — `src/lib/permissions/definitions.ts`
   (`ROLE_CAPABILITIES`, `ROLE_METADATA`) + `types.ts` (`Role`,
   `Capability`). Drives frontend route/UI gating via `usePermissions`.
2. **SQL capability mirror** — `public.user_has_capability(restaurant_id,
   capability)`. Used by RLS policies and MUST mirror the TS map.
3. **RLS policies** — a mix of `user_has_capability()`-based policies
   (the major operational + financial tables, migrated when collaborator
   roles were added) and older **hardcoded `role IN (...)`** policies.

### Chosen approach: capability-first (Approach A)

The collaborator migration (`20260120100100_update_rls_for_collaborators.sql`)
already converted the major operational tables — products/inventory,
inventory_transactions, recipes, prep_recipes, production_runs,
purchase_orders, invoices, customers — to
`user_has_capability()`-based RLS. Consequences:

- **Capability-gated operational tables** are covered **automatically**
  once `operations_manager` is added to the relevant capabilities in
  `user_has_capability()`. No per-policy edits.
- **Accounting tables** (bank_transactions, chart_of_accounts,
  journal_entries, financial_statement_cache, invoices, customers,
  pending_outflows, connected_banks, bank_account_balances) are gated by
  accounting capabilities (`view:transactions`, `view:invoices`, …).
  `operations_manager` is **absent** from those capabilities, so RLS
  **denies** it — defense-in-depth, not just UI hiding. **Zero edits.**
  (Design review confirmed all are capability-gated in the live function.)
- **Residual hardcoded-role-list policies** on older operational tables
  must have `operations_manager` added explicitly. Design review found
  this set is **larger** than first assumed — full enumeration below.
  pgTAP DML tests assert access per table.

> **CRITICAL — base the new `user_has_capability` on the LIVE definition.**
> The authoritative body is in
> `supabase/migrations/20260129000000_add_subscription_system.sql`, **not**
> the older `20260120100200_...`. The live version wraps
> `view:ai_assistant` and `view:financial_intelligence` in
> `has_subscription_feature()` and adds `view:assets` / `edit:assets` /
> `manage:subscription` branches. The new migration MUST `CREATE OR
> REPLACE` from the 20260129 body and only add `operations_manager` to the
> included branches — copying an older body silently reverts the paywall.

#### Central helper to extend

`public.user_is_internal_team(restaurant_id)`
(`20260120100000_add_collaborator_roles.sql`) hardcodes
`role IN ('owner','manager','chef','staff')` and gates the
`user_restaurants` SELECT policy. `operations_manager` must be added to
this helper, otherwise the role sees only its own membership row and the
**team-management UI is empty**. Extending this one function unblocks
`user_restaurants` visibility for the whole role.

#### Residual hardcoded-role-list policies to update (add `operations_manager`)

Grouped by the capability that justifies inclusion. Exact policy
names/lines pinned in the Plan phase; each gets a pgTAP DML test.

- **manage:employees** — `employees` "Owners and managers can manage
  employees" `FOR ALL` uses `user_has_role(ARRAY['owner','manager'])`
  (`20260120100100`). Widen to include `operations_manager` (adding the
  capability alone does NOT grant this DML).
- **edit:receipt_import** — `receipt_imports` SELECT/INSERT/UPDATE
  (`20251006212711`) `role IN ('owner','manager')`.
- **edit:scheduling** — `schedule_publications` + `schedule_change_logs`
  INSERT (`20251123000000_schedule_publishing.sql`); `open_shift_claims`
  managers_view + managers_review (`20260412145842`); `staffing_settings`
  (`20260306000000`); any `shifts` write policy on `role IN ('owner','manager')`.
- **edit:tips** — `tip_pool_settings`, `tip_splits`, `tip_split_items`,
  `tip_disputes` (`20251217000001`); `tip_contribution_pools`,
  `tip_server_earnings`, `tip_pool_allocations` (`20260221000000`);
  `tip_payouts` (`20260218000000`).
- **edit:payroll** — `overtime_rules` (`20260221200000`),
  `overtime_adjustments` (`20260221200001`),
  `non_hourly_compensation_allocations` (`20251205164747`),
  `employee_compensation_history` INSERT (`20251216093000`), plus any
  payroll period/entry tables on `role IN ('owner','manager')`.
- **edit:time_punches** — any `time_punches` write policy on
  `role IN ('owner','manager')`.
- **view:team / user_restaurants** — resolved via the
  `user_is_internal_team` extension above.

**Deliberately NOT changed (verified by review):**
- `unified_sales` — SELECT open to any restaurant member (satisfies
  `view:pos_sales`); INSERT/UPDATE stay owner/manager/staff/chef.
  `operations_manager` is **POS view-only** (no `edit:pos_sales`). pgTAP
  asserts SELECT allowed, INSERT denied.
- `assets`/`asset_photos`/`depreciation_schedule` — `view:assets` is an
  accounting capability and is **excluded**; SELECT policies are open to
  any member (pre-existing) and the Accounting nav group is hidden for
  the role, so no functional exposure. Tightening is out of scope.
- `user_has_role(ARRAY['owner','manager'])` hard-delete guards (e.g.
  DELETE on `products`) — deferred as before.

Rejected alternatives:
- **B — add-everywhere-then-subtract:** mechanically add
  `operations_manager` wherever `manager` appears, then strip accounting.
  Larger diff, higher accounting-leak risk. ✗
- **C — migrate all remaining policies to capabilities first:** cleanest
  long-term but large scope-creep beyond this task. ✗ (YAGNI)

## Capability set

`operations_manager` = current `manager` **minus accounting minus
external-admin**, labor retained.

**Included:**
- `view:dashboard`, `view:ai_assistant`
- Inventory: `view/edit:inventory`, `view/edit:inventory_audit`,
  `view/edit:purchase_orders`, `view/edit:receipt_import`,
  `view:reports`, `view/edit:inventory_transactions`
- Recipes: `view/edit:recipes`, `view/edit:prep_recipes`,
  `view/edit:batches`
- Operations/labor: `view:pos_sales`, `view/edit:scheduling`,
  `view/edit:payroll`, `view/edit:tips`, `view/edit:time_punches`
- Team/employees: `view:team`, `manage:team` *(scoped — see below)*,
  `view:employees`, `manage:employees`
- `view:settings`

**Excluded — accounting:** `view/edit:transactions`,
`view/edit:banking`, `view/edit:expenses`, `view:financial_statements`,
`view/edit:chart_of_accounts`, `view/edit:invoices`,
`view/edit:customers`, `view:financial_intelligence`,
`view/edit:pending_outflows`.

**Excluded — admin:** `edit:settings`, `view/manage:integrations`,
`view/manage:collaborators`. (`manage:integrations`/`edit:settings` are
owner-only already.)

## Invite scoping (security-critical)

`manage:team` is a binary capability; it does not encode *which target
roles* an inviter may create. That matrix is enforced separately:

- **New pure helper** `canInviteRole(inviter: Role, target: Role):
  boolean` in `src/lib/permissions/` (own file, e.g. `invitations.ts`),
  exported via the permissions index.
  - `operations_manager` → may invite **`staff`** only.
  - `owner` → may invite `owner`, `manager`, `operations_manager`,
    `chef`, `staff` (adds `operations_manager` to today's set).
  - `manager` → may invite `manager`, `operations_manager`, `chef`,
    `staff` (adds `operations_manager`).
  - all other roles → invite nothing.
- **Server enforcement:** `supabase/functions/send-team-invitation/
  index.ts` currently allows any `owner`/`manager` to invite **any** role
  string with **no target validation** (an existing privilege-escalation
  hole — a manager could invite an `owner` via a direct call). It must
  (a) widen the inviter allow-list to
  `['owner','manager','operations_manager']` and (b) enforce the
  `(inviter, target)` matrix with **default-deny BEFORE the insert** —
  return a structured `403 { error: 'role_not_allowed' }` rather than
  inserting the invitation row first (avoids storing an escalated-role
  invite). The matrix is duplicated in Deno (like the existing SQL↔TS
  mirror); a comment cross-references the TS helper as source of truth.
  Add `operations_manager` → "Operations Manager" to the `roleLabels`
  map used for the email.
- **UI:** `TeamInvitations.tsx` — the role `<Select>` renders only the
  targets allowed for the current `userRole`; `canManageInvites`
  includes `operations_manager`.
- **Activate/deactivate users:** already satisfied by `manage:employees`
  (the `employees` table is capability-gated).

## Files to change

**TypeScript**
- `src/lib/permissions/types.ts` — add `'operations_manager'` to `Role`.
- `src/lib/permissions/definitions.ts` — add capability array +
  `ROLE_METADATA` entry (label "Operations Manager", category
  `internal`, landing `/`, color `secondary`).
- `src/lib/permissions/invitations.ts` *(new)* — `canInviteRole` +
  `getInvitableRoles(inviter)`.
- `src/lib/permissions/index.ts` — export the new helper.
- `src/components/TeamInvitations.tsx` — per frontend review:
  - `userRole` prop typed as `Role` (not `string`).
  - `canManageInvites` derived from `manage:team` capability (or include
    `operations_manager`), not a hardcoded `owner||manager` literal.
  - Role `<Select>` rendered from `getInvitableRoles(userRole)` (kills
    the drift-prone hardcoded `<SelectItem>` list); default/reset role =
    `getInvitableRoles(userRole)[0]`.
  - `fetchInvitations` selects explicit columns, not `select('*')`.
  - Loading state → `<Skeleton>` matching the card shape; add `id="role"`
    to `<SelectTrigger>` for the existing `<Label htmlFor="role">`.
- `src/components/AppSidebar.tsx` — add an explicit
  `case 'operations_manager':` in `getNavigationForRole` returning the
  full nav **minus the Accounting group** and **minus `/integrations`**
  (keeps Operations, Inventory, and an Admin group of Employees/Team/
  Settings/Help). Without this the role falls through `default` and sees
  accounting links.
- Audit remaining hardcoded literals and switch operational ones to
  capability checks or add `operations_manager`: `TimePunchesManager`
  (`isManager`), `POSSales`, `Inventory` delete-guard, `useApproverCount`.
  Leave accounting/admin literals as-is (`useChartOfAccounts`,
  `RestaurantSettings` canEdit, `CollaboratorInvitations` — the role is
  correctly excluded there).

**SQL migrations** (new, timestamped — ordered: constraint → helper →
function → policies)
1. Extend `user_restaurants_role_check` CHECK to include
   `'operations_manager'` (kiosk/collaborator precedent).
2. `CREATE OR REPLACE FUNCTION user_is_internal_team` to include
   `'operations_manager'`.
3. `CREATE OR REPLACE FUNCTION user_has_capability` **based on the live
   20260129 body**, adding `operations_manager` to every included branch;
   leave it out of all accounting/admin/subscription-mgmt branches.
4. Add `operations_manager` to the residual hardcoded-role-list RLS
   policies enumerated above (employees, receipt_imports, scheduling
   set, tips set, payroll/overtime/comp set, time_punches). Each pinned
   by a pgTAP DML test.

**Edge function**
- `supabase/functions/send-team-invitation/index.ts` — widen inviter
  allow-list, add default-deny target-role matrix **before insert**, add
  `operations_manager` label.

## Test plan

**Unit (Vitest)** — `tests/unit/`
- `operations_manager` capability array: contains every kept capability;
  contains **none** of the accounting/admin capabilities (assert the
  exclusion list explicitly, not just inclusion).
- `canInviteRole` matrix: `operations_manager`→`staff` true;
  `operations_manager`→{`manager`,`owner`,`chef`,`operations_manager`}
  false; `owner`/`manager`→`operations_manager` true; `chef`/`staff`
  invite nothing.

**pgTAP** — `supabase/tests/`
- Seed a user as `operations_manager` for a restaurant.
- **Capability sentinel (drift guard):** `user_has_capability` returns
  TRUE for a representative kept capability in each domain
  (`view:inventory`, `edit:recipes`, `edit:scheduling`, `edit:payroll`,
  `edit:tips`, `edit:time_punches`, `manage:employees`, `manage:team`,
  `view:settings`) and FALSE for every accounting capability
  (`view:transactions`, `view:banking`, `view:invoices`,
  `view:pending_outflows`, `view:financial_statements`, `view:assets`,
  `view:financial_intelligence`) and excluded admin
  (`edit:settings`, `manage:integrations`, `manage:collaborators`,
  `view:integrations`, `manage:subscription`).
- **DML per residual-policy category** (this is what catches the
  hardcoded-policy class of failures):
  - `user_restaurants` SELECT returns >1 team row (via
    `user_is_internal_team`).
  - INSERT/UPDATE on `employees` succeeds.
  - INSERT on `schedule_publications` (or a `shifts` write) succeeds.
  - INSERT on `tip_pool_settings` succeeds.
  - INSERT on an overtime/payroll table succeeds.
  - SELECT on `receipt_imports` returns rows.
  - INSERT on a `time_punches` write path succeeds.
- **Accounting/POS deny:** `SELECT` on `bank_transactions` /
  `chart_of_accounts` returns zero rows; INSERT on `unified_sales` is
  denied while SELECT succeeds.

**Edge function** — reject path: an `operations_manager` inviting a
`manager`/`owner` is rejected (403, no row inserted); inviting `staff`
succeeds. Test at the matrix-helper level (Vitest) plus, if edge-fn test
harness exists, an integration assertion.

## Decided trade-offs

- **`pending_outflows` classified as accounting** and excluded. It is
  an accounts-payable surface gated to `collaborator_accountant` in the
  SQL function, so it belongs on the accounting side of the line.
- **Invites limited to `staff`** per the explicit answer. Chef/manager/
  operations_manager invites remain with owner/full-manager. Easily
  widened later by editing the `canInviteRole` matrix + edge guard.
- **`user_has_role(...ARRAY['owner','manager'])` DELETE guards** (e.g.
  delete product) are left as-is; `operations_manager` will not get
  those specific hard-delete rights unless a residual policy is
  explicitly widened. Non-goal for this task; noted for reviewers.
- **Landing path `/`** (same as manager); no bespoke landing page.
- **`view:assets` excluded** (accounting surface). The open SELECT policy
  on `assets` is pre-existing and left untouched; the Accounting nav
  group is hidden, so no functional exposure.
- **Existing TS↔SQL drift left as-is:** the SQL function already has
  `view:assets`/`edit:assets`/`manage:subscription` branches absent from
  the TS `Capability` union. Reconciling that pre-existing drift is out
  of scope; the new role is simply not added to those branches.
- **POS view-only:** `operations_manager` gets `view:pos_sales` but not
  `edit:pos_sales`, so it cannot create/edit manual sales entries.

## Design review outcomes (Phase 2.5)

Supabase + Frontend reviewers ran against this doc. Folded in:
- **[critical]** Base `user_has_capability` on the live 20260129 body
  (preserve subscription gating). *(fixed in doc)*
- **[critical]** Edge fn must widen inviter allow-list + default-deny
  matrix before insert. *(fixed in doc)*
- **[critical/frontend]** `canManageInvites` literal + invite dropdown
  drift + AppSidebar accounting-nav leak. *(fixed in doc)*
- **[major]** Extend `user_is_internal_team`; large residual
  hardcoded-policy set (employees/receipts/scheduling/tips/payroll/time).
  *(fully enumerated above)*
- **[minor]** `select('*')`, Skeleton, `id="role"`, DML-level pgTAP.
  *(folded)*
Deferred (noted for retrospective): converting the `view:settings`
deny-list to an allow-list; a CI drift check for `user_has_capability`.

## Out of scope

- Redefining or splitting the existing `manager` role.
- Migrating remaining hardcoded-role-list policies to capabilities
  wholesale.
- Per-capability UI settings editor for roles.
