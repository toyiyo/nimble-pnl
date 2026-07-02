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
purchase_orders, employees, invoices, customers — to
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
- **Residual hardcoded-role-list policies** on older operational tables
  (scheduling/shifts, time punches, tips, payroll, POS `unified_sales`,
  `invitations`) must have `operations_manager` added explicitly. The
  Plan phase enumerates the exact live policies; pgTAP tests assert
  access is granted.

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
  index.ts` currently allows any `owner`/`manager` to invite any role.
  It must (a) permit `operations_manager` as an inviter and (b) reject
  any `(inviter, target)` pair not allowed by the matrix — a
  privilege-escalation guard so an ops manager cannot forge a
  higher-privileged invite by calling the function directly. The matrix
  is duplicated in Deno (like the existing SQL↔TS mirror); a comment
  cross-references the TS helper as source of truth.
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
- `src/components/TeamInvitations.tsx` — scope dropdown + `canManageInvites`.
- Audit for hardcoded `=== 'manager'` / `role IN [...]` literals that
  should also accept `operations_manager` (e.g. `usePermissions`
  convenience booleans, `AppSidebar`, `send-team-invitation`).

**SQL migrations** (new, timestamped)
1. Extend `user_restaurants_role_check` CHECK to include
   `'operations_manager'` (follows the kiosk/collaborator precedent).
2. `CREATE OR REPLACE FUNCTION user_has_capability` adding
   `operations_manager` to every **included** capability branch; leave
   it out of all accounting/admin branches.
3. Add `operations_manager` to residual hardcoded-role-list RLS policies
   on operational tables (scheduling/shifts, time punches, tips,
   payroll, POS/unified_sales, invitations) — exact set finalized in the
   Plan phase and pinned by pgTAP.

**Edge function**
- `supabase/functions/send-team-invitation/index.ts` — inviter allow-list
  + target-role guard; role label map already lists the friendly names,
  add `operations_manager` → "Operations Manager".

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
- `user_has_capability` returns TRUE for a representative kept capability
  in each domain (`view:inventory`, `edit:recipes`, `edit:scheduling`,
  `edit:payroll`, `manage:employees`, `manage:team`).
- `user_has_capability` returns FALSE for every accounting capability
  (`view:transactions`, `view:banking`, `view:invoices`,
  `view:pending_outflows`, `view:financial_statements`) and excluded
  admin (`edit:settings`, `manage:integrations`, `manage:collaborators`).
- RLS: as `operations_manager`, `SELECT` on an operational table
  (e.g. `products`) succeeds; `SELECT` on `bank_transactions` /
  `chart_of_accounts` returns zero rows / is denied.

**Edge function** — reject path: an `operations_manager` inviting a
`manager` is rejected; inviting `staff` succeeds (logic-level test or
documented manual check per existing edge-fn test conventions).

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

## Out of scope

- Redefining or splitting the existing `manager` role.
- Migrating remaining hardcoded-role-list policies to capabilities
  wholesale.
- Per-capability UI settings editor for roles.
