# Operations Manager Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal `operations_manager` role that can run all operations (inventory, recipes, scheduling, POS-view, payroll, tips, time, employee management) and invite Staff, but has no access to accounting/bookkeeping or admin (settings-edit, integrations, collaborators).

**Architecture:** Capability-first. Add the role to the TS `ROLE_CAPABILITIES`/`ROLE_METADATA` source of truth and mirror it in the SQL `user_has_capability()` function (based on the live subscription-migration body). Capability-gated tables and accounting-table denial are automatic; residual hardcoded `role IN ('owner','manager')` policies on labor/tips/payroll/scheduling/receipts/employees get the role added explicitly. A pure `canInviteRole` matrix (TS + duplicated in the Deno edge function with default-deny) enforces Staff-only invites. Frontend surfaces the role in the invite dropdown and a dedicated sidebar nav (no Accounting group).

**Tech Stack:** React 18 + TS + shadcn (Vite), Supabase Postgres + RLS + pgTAP, Deno edge functions, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-operations-manager-role-design.md`

**Conventions:**
- Run all commands from the worktree root.
- pgTAP tests live in `supabase/tests/*.sql`, run via `npm run test:db`.
- Vitest unit tests in `tests/unit/*.test.ts`, run via `npm run test`.
- Commit after every green step.

---

## Task 1: Add `operations_manager` to the `Role` type

**Files:**
- Modify: `src/lib/permissions/types.ts`

- [ ] **Step 1: Add the role to the union**

In `src/lib/permissions/types.ts`, update the `Role` union and the internal-roles doc comment:

```ts
/**
 * Internal roles (full team members):
 * - owner: Full access to all features
 * - manager: Most features except some admin
 * - operations_manager: All operations except accounting and admin
 * - chef: Recipes and inventory focus
 * - staff: Employee self-service only
 * - kiosk: Time clock only
 * ...
 */
export type Role =
  | 'owner'
  | 'manager'
  | 'operations_manager'
  | 'chef'
  | 'staff'
  | 'kiosk'
  | 'collaborator_accountant'
  | 'collaborator_inventory'
  | 'collaborator_chef';
```

- [ ] **Step 2: Typecheck fails until definitions are updated**

Run: `npm run typecheck`
Expected: FAIL — `ROLE_CAPABILITIES` and `ROLE_METADATA` in `definitions.ts` no longer satisfy `Record<Role, ...>` (missing `operations_manager` key). This confirms the type is wired. Proceed to Task 2 (do not commit a red typecheck).

---

## Task 2: Define `operations_manager` capabilities + metadata (TDD)

**Files:**
- Test: `tests/unit/operationsManagerRole.test.ts` (create)
- Modify: `src/lib/permissions/definitions.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/operationsManagerRole.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ROLE_CAPABILITIES, ROLE_METADATA } from '@/lib/permissions/definitions';
import type { Capability } from '@/lib/permissions/types';

const ACCOUNTING: Capability[] = [
  'view:transactions', 'edit:transactions', 'view:banking', 'edit:banking',
  'view:expenses', 'edit:expenses', 'view:financial_statements',
  'view:chart_of_accounts', 'edit:chart_of_accounts', 'view:invoices',
  'edit:invoices', 'view:customers', 'edit:customers',
  'view:financial_intelligence', 'view:pending_outflows', 'edit:pending_outflows',
];

const EXCLUDED_ADMIN: Capability[] = [
  'view:integrations', 'manage:integrations', 'edit:settings',
  'view:collaborators', 'manage:collaborators',
];

const REQUIRED: Capability[] = [
  'view:dashboard', 'view:inventory', 'edit:inventory', 'edit:recipes',
  'view:pos_sales', 'view:scheduling', 'edit:scheduling', 'view:payroll',
  'edit:payroll', 'view:tips', 'edit:tips', 'view:time_punches',
  'edit:time_punches', 'view:team', 'manage:team', 'view:employees',
  'manage:employees', 'view:settings', 'view:reports', 'edit:receipt_import',
];

describe('operations_manager capabilities', () => {
  const caps = new Set(ROLE_CAPABILITIES['operations_manager']);

  it('includes every required operational/labor capability', () => {
    for (const c of REQUIRED) expect(caps.has(c), `missing ${c}`).toBe(true);
  });

  it('excludes every accounting capability', () => {
    for (const c of ACCOUNTING) expect(caps.has(c), `should not have ${c}`).toBe(false);
  });

  it('excludes admin capabilities beyond team/employee management', () => {
    for (const c of EXCLUDED_ADMIN) expect(caps.has(c), `should not have ${c}`).toBe(false);
  });

  it('has internal metadata with the Operations Manager label', () => {
    expect(ROLE_METADATA['operations_manager'].label).toBe('Operations Manager');
    expect(ROLE_METADATA['operations_manager'].category).toBe('internal');
    expect(ROLE_METADATA['operations_manager'].landingPath).toBe('/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- operationsManagerRole`
Expected: FAIL — `operations_manager` key missing from `ROLE_CAPABILITIES`/`ROLE_METADATA`.

- [ ] **Step 3: Add the capability array**

In `src/lib/permissions/definitions.ts`, inside `ROLE_CAPABILITIES`, add after the `manager` entry:

```ts
  operations_manager: [
    // All operations except accounting (bookkeeping) and admin.
    'view:dashboard',
    'view:ai_assistant',
    'view:inventory',
    'edit:inventory',
    'view:inventory_audit',
    'edit:inventory_audit',
    'view:purchase_orders',
    'edit:purchase_orders',
    'view:receipt_import',
    'edit:receipt_import',
    'view:reports',
    'view:inventory_transactions',
    'edit:inventory_transactions',
    'view:recipes',
    'edit:recipes',
    'view:prep_recipes',
    'edit:prep_recipes',
    'view:batches',
    'edit:batches',
    'view:pos_sales',
    'view:scheduling',
    'edit:scheduling',
    'view:payroll',
    'edit:payroll',
    'view:tips',
    'edit:tips',
    'view:time_punches',
    'edit:time_punches',
    'view:team',
    'manage:team',
    'view:employees',
    'manage:employees',
    'view:settings',
  ],
```

- [ ] **Step 4: Add the metadata entry**

In `ROLE_METADATA`, add after the `manager` entry:

```ts
  operations_manager: {
    role: 'operations_manager',
    label: 'Operations Manager',
    description: 'Run operations, scheduling, and staffing (no accounting or admin)',
    category: 'internal',
    landingPath: '/',
    color: 'secondary',
  },
```

- [ ] **Step 5: Run test + typecheck to verify pass**

Run: `npm run test -- operationsManagerRole && npm run typecheck`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions/types.ts src/lib/permissions/definitions.ts tests/unit/operationsManagerRole.test.ts
git commit -m "feat(permissions): add operations_manager role capabilities + metadata"
```

---

## Task 3: Invite matrix helper (`canInviteRole` / `getInvitableRoles`) (TDD)

**Files:**
- Test: `tests/unit/invitationMatrix.test.ts` (create)
- Create: `src/lib/permissions/invitations.ts`
- Modify: `src/lib/permissions/index.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/invitationMatrix.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canInviteRole, getInvitableRoles } from '@/lib/permissions/invitations';

describe('invite matrix', () => {
  it('operations_manager can invite only staff', () => {
    expect(getInvitableRoles('operations_manager')).toEqual(['staff']);
    expect(canInviteRole('operations_manager', 'staff')).toBe(true);
    for (const t of ['manager', 'owner', 'chef', 'operations_manager'] as const) {
      expect(canInviteRole('operations_manager', t)).toBe(false);
    }
  });

  it('owner and manager can invite operations_manager', () => {
    expect(canInviteRole('owner', 'operations_manager')).toBe(true);
    expect(canInviteRole('manager', 'operations_manager')).toBe(true);
  });

  it('owner can invite owner; manager cannot invite owner', () => {
    expect(canInviteRole('owner', 'owner')).toBe(true);
    expect(canInviteRole('manager', 'owner')).toBe(false);
  });

  it('non-management roles can invite nobody', () => {
    for (const r of ['chef', 'staff', 'kiosk', 'collaborator_accountant'] as const) {
      expect(getInvitableRoles(r)).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- invitationMatrix`
Expected: FAIL — module `invitations.ts` does not exist.

- [ ] **Step 3: Create the helper**

Create `src/lib/permissions/invitations.ts`:

```ts
/**
 * Invite matrix — which target roles each inviter role may create.
 *
 * SINGLE SOURCE OF TRUTH for team-invite privilege boundaries.
 * The Deno edge function `send-team-invitation` duplicates this matrix
 * and MUST stay in sync (default-deny).
 */
import { Role } from './types';

const INVITABLE_ROLES: Record<Role, readonly Role[]> = {
  owner: ['owner', 'manager', 'operations_manager', 'chef', 'staff'],
  manager: ['manager', 'operations_manager', 'chef', 'staff'],
  operations_manager: ['staff'],
  chef: [],
  staff: [],
  kiosk: [],
  collaborator_accountant: [],
  collaborator_inventory: [],
  collaborator_chef: [],
};

/** Roles that `inviter` is allowed to invite (empty if none). */
export function getInvitableRoles(inviter: Role): Role[] {
  return [...(INVITABLE_ROLES[inviter] ?? [])];
}

/** Whether `inviter` may invite a member with role `target`. */
export function canInviteRole(inviter: Role, target: Role): boolean {
  return (INVITABLE_ROLES[inviter] ?? []).includes(target);
}
```

- [ ] **Step 4: Export from the permissions index**

In `src/lib/permissions/index.ts`, add:

```ts
export { canInviteRole, getInvitableRoles } from './invitations';
```

- [ ] **Step 5: Run test to verify pass**

Run: `npm run test -- invitationMatrix && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions/invitations.ts src/lib/permissions/index.ts tests/unit/invitationMatrix.test.ts
git commit -m "feat(permissions): add canInviteRole/getInvitableRoles matrix (ops-mgr -> staff)"
```

---

## Task 4: Migration — role constraint + `user_is_internal_team` + `user_has_capability`

**Files:**
- Create: `supabase/migrations/20260702120000_add_operations_manager_role.sql`
- Reference (read the LIVE body): `supabase/migrations/20260129000000_add_subscription_system.sql`

- [ ] **Step 1: Create the migration — constraint + internal-team helper**

Create `supabase/migrations/20260702120000_add_operations_manager_role.sql` starting with:

```sql
-- ============================================================================
-- Migration: Add operations_manager role
--
-- Internal role with all operations EXCEPT accounting (bookkeeping) and
-- admin (settings-edit, integrations, collaborators). Can invite Staff and
-- manage employees.
--
-- Order: constraint -> user_is_internal_team -> user_has_capability -> RLS.
-- The user_has_capability body below is copied from the LIVE definition in
-- 20260129000000_add_subscription_system.sql (preserves subscription gating)
-- with 'operations_manager' added ONLY to non-accounting/non-admin branches.
-- ============================================================================

-- 1. Extend the role CHECK constraint (kiosk/collaborator precedent).
ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;

ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN (
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'
  ));

-- 2. Internal-team helper must include operations_manager, else the role can
-- only see its own user_restaurants row (empty team-management UI).
CREATE OR REPLACE FUNCTION public.user_is_internal_team(
  p_restaurant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'chef', 'staff')
  );
$$;
COMMENT ON FUNCTION public.user_is_internal_team IS
'Check if current user is internal team (owner, manager, operations_manager, chef, or staff)';
```

- [ ] **Step 2: Append the `user_has_capability` replacement**

Open `supabase/migrations/20260129000000_add_subscription_system.sql`, copy the entire `CREATE OR REPLACE FUNCTION public.user_has_capability( ... ) $$;` block verbatim into the new migration, then add `, 'operations_manager'` to the `v_role IN (...)` list of **exactly these branches** (leave every accounting/admin/subscription branch untouched):

Included branches to widen: `view:dashboard`, `view:ai_assistant`, `view:inventory`, `edit:inventory`, `view:inventory_audit`, `edit:inventory_audit`, `view:purchase_orders`, `edit:purchase_orders`, `view:receipt_import`, `edit:receipt_import`, `view:reports`, `view:inventory_transactions`, `edit:inventory_transactions`, `view:recipes`, `edit:recipes`, `view:prep_recipes`, `edit:prep_recipes`, `view:batches`, `edit:batches`, `view:pos_sales`, `view:scheduling`, `edit:scheduling`, `view:payroll`, `edit:payroll`, `view:tips`, `edit:tips`, `view:time_punches`, `edit:time_punches`, `view:team`, `manage:team`, `view:employees`, `manage:employees`.

Do NOT add to: `view:transactions`, `edit:transactions`, `view:banking`, `edit:banking`, `view:expenses`, `edit:expenses`, `view:financial_statements`, `view:chart_of_accounts`, `edit:chart_of_accounts`, `view:invoices`, `edit:invoices`, `view:customers`, `edit:customers`, `view:financial_intelligence`, `view:pending_outflows`, `edit:pending_outflows`, `view:assets`, `edit:assets`, `edit:settings`, `view:integrations`, `manage:integrations`, `view:collaborators`, `manage:collaborators`, `manage:subscription`. `view:settings` stays `v_role NOT IN ('kiosk')` (ops-mgr passes automatically).

- [ ] **Step 3: Sanity-check the SQL parses**

Run: `npm run db:reset` (applies all migrations to local Supabase).
Expected: completes without error; the new migration applies cleanly. If `db:reset` is unavailable in the environment, defer verification to Task 5's pgTAP run.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260702120000_add_operations_manager_role.sql
git commit -m "feat(db): operations_manager constraint + internal-team helper + capability function"
```

---

## Task 5: pgTAP — capability sentinel + accounting deny (TDD, drift guard)

**Files:**
- Test: `supabase/tests/21_operations_manager_capabilities.sql` (create)

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/21_operations_manager_capabilities.sql`. Follow the fixture pattern used by `supabase/tests/19_collaborator_role_functions.sql` (read it first for the exact `auth.users`/`user_restaurants` seeding + `set_auth_uid`-style helpers used in this repo). Structure:

```sql
BEGIN;
SELECT plan(30);

-- Fixtures: create a restaurant, an auth user, and a user_restaurants row
-- with role 'operations_manager'. Mirror the seeding approach in
-- 19_collaborator_role_functions.sql. Then set auth.uid() to that user.

-- Included capabilities -> TRUE
SELECT ok(user_has_capability('<rid>', 'view:inventory'), 'ops-mgr view:inventory');
SELECT ok(user_has_capability('<rid>', 'edit:inventory'), 'ops-mgr edit:inventory');
SELECT ok(user_has_capability('<rid>', 'edit:recipes'), 'ops-mgr edit:recipes');
SELECT ok(user_has_capability('<rid>', 'view:pos_sales'), 'ops-mgr view:pos_sales');
SELECT ok(user_has_capability('<rid>', 'edit:scheduling'), 'ops-mgr edit:scheduling');
SELECT ok(user_has_capability('<rid>', 'edit:payroll'), 'ops-mgr edit:payroll');
SELECT ok(user_has_capability('<rid>', 'edit:tips'), 'ops-mgr edit:tips');
SELECT ok(user_has_capability('<rid>', 'edit:time_punches'), 'ops-mgr edit:time_punches');
SELECT ok(user_has_capability('<rid>', 'manage:employees'), 'ops-mgr manage:employees');
SELECT ok(user_has_capability('<rid>', 'manage:team'), 'ops-mgr manage:team');
SELECT ok(user_has_capability('<rid>', 'view:team'), 'ops-mgr view:team');
SELECT ok(user_has_capability('<rid>', 'view:reports'), 'ops-mgr view:reports');
SELECT ok(user_has_capability('<rid>', 'edit:receipt_import'), 'ops-mgr edit:receipt_import');
SELECT ok(user_has_capability('<rid>', 'view:settings'), 'ops-mgr view:settings');

-- Excluded accounting -> FALSE
SELECT ok(NOT user_has_capability('<rid>', 'view:transactions'), 'no view:transactions');
SELECT ok(NOT user_has_capability('<rid>', 'edit:transactions'), 'no edit:transactions');
SELECT ok(NOT user_has_capability('<rid>', 'view:banking'), 'no view:banking');
SELECT ok(NOT user_has_capability('<rid>', 'view:expenses'), 'no view:expenses');
SELECT ok(NOT user_has_capability('<rid>', 'view:financial_statements'), 'no statements');
SELECT ok(NOT user_has_capability('<rid>', 'view:chart_of_accounts'), 'no COA');
SELECT ok(NOT user_has_capability('<rid>', 'view:invoices'), 'no view:invoices');
SELECT ok(NOT user_has_capability('<rid>', 'view:customers'), 'no view:customers');
SELECT ok(NOT user_has_capability('<rid>', 'view:pending_outflows'), 'no pending_outflows');
SELECT ok(NOT user_has_capability('<rid>', 'view:financial_intelligence'), 'no fin-intel');
SELECT ok(NOT user_has_capability('<rid>', 'view:assets'), 'no view:assets');

-- Excluded admin -> FALSE
SELECT ok(NOT user_has_capability('<rid>', 'edit:settings'), 'no edit:settings');
SELECT ok(NOT user_has_capability('<rid>', 'view:integrations'), 'no view:integrations');
SELECT ok(NOT user_has_capability('<rid>', 'manage:integrations'), 'no manage:integrations');
SELECT ok(NOT user_has_capability('<rid>', 'manage:collaborators'), 'no manage:collaborators');
SELECT ok(NOT user_has_capability('<rid>', 'manage:subscription'), 'no manage:subscription');

SELECT * FROM finish();
ROLLBACK;
```

Replace `<rid>` with the fixture restaurant id variable per the repo's pgTAP conventions.

- [ ] **Step 2: Run to verify it fails first (if role not yet applied) then passes**

Run: `npm run test:db`
Expected: PASS once Task 4's migration is applied. (If you author this test before Task 4, it fails — which is the RED state. Given Task 4 is already committed, this test verifies GREEN.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/21_operations_manager_capabilities.sql
git commit -m "test(db): operations_manager capability sentinel + accounting/admin deny"
```

---

## Task 6: Migration — residual hardcoded-role RLS policies (TDD via pgTAP DML)

**Files:**
- Modify: `supabase/migrations/20260702120000_add_operations_manager_role.sql` (append a "residual policies" section)
- Test: `supabase/tests/22_operations_manager_rls.sql` (create)

**Transformation rule (applies to every policy below):** recreate the
policy by name, adding `'operations_manager'` to its role list — i.e.
`role IN ('owner','manager')` → `role IN ('owner','manager','operations_manager')`,
and `user_has_role(restaurant_id, ARRAY['owner','manager'])` →
`user_has_role(restaurant_id, ARRAY['owner','manager','operations_manager'])`.
Use `DROP POLICY IF EXISTS "<exact name>" ON public.<table>;` then
`CREATE POLICY "<exact name>" ...` with the widened list. Find each
policy's current definition with:
`grep -rn -A6 'CREATE POLICY[^;]*<table>' supabase/migrations/*.sql` and
recreate the most recent version verbatim except for the role list.

**Policies to update** (see spec for source files):

| Table | Policy intent | Source migration |
|---|---|---|
| `employees` | "Owners and managers can manage employees" (FOR ALL, `user_has_role`) | 20260120100100 |
| `receipt_imports` | SELECT/INSERT/UPDATE | 20251006212711 |
| `schedule_publications` | INSERT | 20251123000000 |
| `schedule_change_logs` | INSERT | 20251123000000 |
| `open_shift_claims` | managers_view + managers_review | 20260412145842 |
| `staffing_settings` | manage (FOR ALL / write) | 20260306000000 |
| `tip_pool_settings`, `tip_splits`, `tip_split_items`, `tip_disputes` | write policies | 20251217000001 |
| `tip_contribution_pools`, `tip_server_earnings`, `tip_pool_allocations` | write policies | 20260221000000 |
| `tip_payouts` | write policies | 20260218000000 |
| `overtime_rules` | write | 20260221200000 |
| `overtime_adjustments` | write | 20260221200001 |
| `non_hourly_compensation_allocations` | write | 20251205164747 |
| `employee_compensation_history` | INSERT | 20251216093000 |
| `time_punches` | manager write policies gated `role IN ('owner','manager')` | grep to locate |

> If a grep shows a table's write is already capability-gated
> (`user_has_capability`), it needs NO change — skip it and note so in the
> commit message. Only the hardcoded `role IN (...)` / `user_has_role`
> policies are edited.

- [ ] **Step 1: Write the failing pgTAP DML test**

Create `supabase/tests/22_operations_manager_rls.sql`. Seed a restaurant + an `operations_manager` auth user (reuse the fixture pattern from Task 5 / `19_collaborator_role_functions.sql`), set `auth.uid()`, and assert DML as that role. Use `lives_ok` for allowed writes and `is(count,0)`/`throws_ok` for denied reads/writes. Representative coverage (one per residual category) — expand to the full set as you widen policies:

```sql
BEGIN;
SELECT plan(9);

-- Fixture: restaurant <rid>, operations_manager user, auth.uid() set.
-- Also seed a peer team member so user_restaurants SELECT can return >1 row.

-- view:team / user_restaurants visibility (via user_is_internal_team)
SELECT cmp_ok(
  (SELECT count(*) FROM user_restaurants WHERE restaurant_id = '<rid>')::int,
  '>=', 2, 'ops-mgr sees full team roster');

-- manage:employees DML
SELECT lives_ok(
  $$ INSERT INTO employees (restaurant_id, name) VALUES ('<rid>', 'Test Hire') $$,
  'ops-mgr can insert employees');

-- edit:scheduling
SELECT lives_ok(
  $$ INSERT INTO schedule_publications (restaurant_id, week_start, published_by)
     VALUES ('<rid>', current_date, auth.uid()) $$,
  'ops-mgr can publish schedule');

-- edit:tips
SELECT lives_ok(
  $$ INSERT INTO tip_pool_settings (restaurant_id) VALUES ('<rid>') $$,
  'ops-mgr can write tip pool settings');

-- edit:payroll (overtime)
SELECT lives_ok(
  $$ INSERT INTO overtime_rules (restaurant_id) VALUES ('<rid>') $$,
  'ops-mgr can write overtime rules');

-- view:receipt_import
SELECT lives_ok(
  $$ SELECT 1 FROM receipt_imports WHERE restaurant_id = '<rid>' LIMIT 1 $$,
  'ops-mgr can read receipt imports');

-- Accounting DENY
SELECT is(
  (SELECT count(*) FROM bank_transactions WHERE restaurant_id = '<rid>')::int,
  0, 'ops-mgr denied bank_transactions');
SELECT is(
  (SELECT count(*) FROM chart_of_accounts WHERE restaurant_id = '<rid>')::int,
  0, 'ops-mgr denied chart_of_accounts');

-- POS view-only: unified_sales insert denied
SELECT throws_ok(
  $$ INSERT INTO unified_sales (restaurant_id, sale_date, total_amount)
     VALUES ('<rid>', current_date, 10) $$,
  NULL, NULL, 'ops-mgr cannot insert manual sales');

SELECT * FROM finish();
ROLLBACK;
```

Adjust column names to the actual table schemas (inspect with the source migrations). The exact required columns per table come from each table's `CREATE TABLE`.

- [ ] **Step 2: Run — confirm RED (writes denied before policies widened)**

Run: `npm run test:db`
Expected: FAIL — the `lives_ok` writes are denied by RLS for `operations_manager` (policies not yet widened).

- [ ] **Step 3: Append the residual-policy section to the migration**

In `20260702120000_add_operations_manager_role.sql`, append a
`-- 4. Residual hardcoded-role-list operational policies` section that
recreates each policy in the table above per the transformation rule.
Example for `employees` (verbatim current body + widened list):

```sql
DROP POLICY IF EXISTS "Owners and managers can manage employees" ON public.employees;
CREATE POLICY "Owners and managers can manage employees"
ON public.employees
FOR ALL
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager']))
WITH CHECK (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager']));
```

Repeat for every table/policy in the list, sourcing each current body via grep.

- [ ] **Step 4: Run — confirm GREEN**

Run: `npm run test:db`
Expected: PASS (allowed writes succeed; accounting reads return 0; unified_sales insert denied).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260702120000_add_operations_manager_role.sql supabase/tests/22_operations_manager_rls.sql
git commit -m "feat(db): grant operations_manager access on residual operational RLS policies"
```

---

## Task 7: Edge function — inviter allow-list + default-deny invite matrix

**Files:**
- Modify: `supabase/functions/send-team-invitation/index.ts`

- [ ] **Step 1: Add the Deno invite matrix + label**

Near the top of `index.ts` (module scope), add (mirrors `src/lib/permissions/invitations.ts` — keep in sync):

```ts
// MIRRORS src/lib/permissions/invitations.ts — keep in sync (default-deny).
const INVITABLE_ROLES: Record<string, string[]> = {
  owner: ['owner', 'manager', 'operations_manager', 'chef', 'staff'],
  manager: ['manager', 'operations_manager', 'chef', 'staff'],
  operations_manager: ['staff'],
};
function canInviteRole(inviter: string, target: string): boolean {
  return (INVITABLE_ROLES[inviter] ?? []).includes(target);
}
```

- [ ] **Step 2: Replace the permission check (widen inviter + enforce target before insert)**

Replace the existing guard (currently
`if (roleError || !userRole || !['owner', 'manager'].includes(userRole.role))`):

```ts
if (roleError || !userRole || !INVITABLE_ROLES[userRole.role]) {
  throw new Error('Insufficient permissions to send invitations');
}

// Default-deny: reject any (inviter, target) pair not in the matrix
// BEFORE inserting the invitation row (prevents storing escalated-role invites).
if (!canInviteRole(userRole.role, role)) {
  return new Response(
    JSON.stringify({ error: 'role_not_allowed' }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
```

(Use the file's existing `corsHeaders` identifier; match its exact name.)

- [ ] **Step 3: Add the friendly label**

In the `roleLabels` map, add:

```ts
  'operations_manager': 'Operations Manager',
```

- [ ] **Step 4: Typecheck the function compiles (Deno)**

Run: `npm run typecheck`
Expected: PASS (edge fn is Deno; verify at minimum the repo typecheck is green — the function is not part of the Vite tsc project, so also visually confirm no syntax errors).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-team-invitation/index.ts
git commit -m "feat(edge): send-team-invitation enforces default-deny invite matrix; allow operations_manager to invite staff"
```

---

## Task 8: TeamInvitations UI — dynamic dropdown + capability guard + a11y/query fixes

**Files:**
- Modify: `src/components/TeamInvitations.tsx`

- [ ] **Step 1: Type the prop and derive the guard from capability + matrix**

Update imports and the interface:

```ts
import { Role } from '@/lib/permissions/types';
import { ROLE_METADATA } from '@/lib/permissions/definitions';
import { getInvitableRoles } from '@/lib/permissions/invitations';
```

```ts
interface TeamInvitationsProps {
  restaurantId: string;
  userRole: Role;
}
```

Replace line 45:

```ts
const invitableRoles = getInvitableRoles(userRole);
const canManageInvites = invitableRoles.length > 0;
```

- [ ] **Step 2: Default the form role to the first invitable role**

Update the initial state (line ~34) and the reset (line ~156) so the role is always valid for the current inviter:

```ts
const [inviteForm, setInviteForm] = useState({
  email: '',
  role: (getInvitableRoles(userRole)[0] ?? 'staff') as string,
});
```

And every `setInviteForm({ email: '', role: 'staff' })` becomes
`setInviteForm({ email: '', role: getInvitableRoles(userRole)[0] ?? 'staff' })`.

- [ ] **Step 3: Render the Select from the matrix (kills hardcoded SelectItem drift)**

Replace the hardcoded `<SelectContent>` items (lines ~282-290) with:

```tsx
<SelectTrigger id="role" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
  <SelectValue />
</SelectTrigger>
<SelectContent>
  {invitableRoles.map((r) => (
    <SelectItem key={r} value={r}>{ROLE_METADATA[r].label}</SelectItem>
  ))}
</SelectContent>
```

(Note the added `id="role"` on `SelectTrigger` for the existing `<Label htmlFor="role">`.)

- [ ] **Step 4: Replace `select('*')` with explicit columns**

In `fetchInvitations` (line ~55):

```ts
.select('id, email, role, status, created_at, expires_at, invited_by, employee_id')
```

- [ ] **Step 5: Skeleton loading state**

Replace the plain loading `<p>` (line ~319) with a `<Skeleton>` block matching the invitation card shape:

```tsx
import { Skeleton } from '@/components/ui/skeleton';
// ...
{loading ? (
  <div className="space-y-3">
    {[0, 1].map((i) => (
      <div key={i} className="flex items-center gap-3 p-4 border border-border/40 rounded-xl">
        <Skeleton className="h-5 w-5 rounded" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    ))}
  </div>
) : /* ...existing branches... */}
```

- [ ] **Step 6: Verify callers pass a typed role**

Run: `npm run typecheck`
Expected: PASS. If the parent (`src/pages/Team.tsx`) passes `userRole` as a plain string, the cast is compatible (values come from `selectedRestaurant.role`). Fix any type error at the call site by typing it as `Role`.

- [ ] **Step 7: Commit**

```bash
git add src/components/TeamInvitations.tsx src/pages/Team.tsx
git commit -m "feat(team): scope invite dropdown to invitable roles; capability guard; a11y + query fixes"
```

---

## Task 9: AppSidebar — dedicated nav for operations_manager (no Accounting/Integrations)

**Files:**
- Modify: `src/components/AppSidebar.tsx`

- [ ] **Step 1: Build the operations_manager nav array**

Above `getNavigationForRole`, derive it from `navigationGroups` by dropping the Accounting group and the `/integrations` item:

```ts
// Operations Manager: full internal nav minus Accounting group and Integrations.
const operationsManagerNav: NavGroup[] = navigationGroups
  .filter((group) => group.label !== 'Accounting')
  .map((group) => ({
    ...group,
    items: group.items.filter((item) => item.path !== '/integrations'),
  }));
```

- [ ] **Step 2: Add the switch case**

In `getNavigationForRole`, add before `default`:

```ts
    case 'operations_manager':
      return operationsManagerNav;
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppSidebar.tsx
git commit -m "feat(nav): operations_manager sidebar excludes Accounting group and Integrations"
```

---

## Task 10: Audit & fix operational hardcoded role literals

**Files:**
- Modify: `src/pages/TimePunchesManager.tsx`, `src/pages/POSSales.tsx`, `src/pages/Inventory.tsx`, `src/hooks/useApproverCount.ts`

- [ ] **Step 1: TimePunchesManager — include operations_manager**

`src/pages/TimePunchesManager.tsx:123`:

```ts
const isManager = ['owner', 'manager', 'operations_manager'].includes(selectedRestaurant?.role || '');
```

- [ ] **Step 2: POSSales — include operations_manager (view surface)**

`src/pages/POSSales.tsx:1283` — add `operations_manager` to the `role === 'owner' || role === 'manager'` condition:

```ts
(selectedRestaurant.role === "owner" || selectedRestaurant.role === "manager" || selectedRestaurant.role === "operations_manager")
```

Confirm the gated action is a view/read affordance (it is, per POS view-only); if it gates a manual-sale write, leave it OUT (ops-mgr has no `edit:pos_sales`). Inspect the surrounding block before editing.

- [ ] **Step 3: Inventory delete guard — include operations_manager**

`src/pages/Inventory.tsx:116`:

```ts
const canDeleteProducts = ['owner', 'manager', 'operations_manager'].includes(selectedRestaurant?.role || '');
```

(Ops-mgr fully manages inventory; UI parity. Note the DB DELETE guard on `products` uses `user_has_role(['owner','manager'])` and is deferred per spec, so the button is UI-only unless that policy is widened; acceptable trade-off.)

- [ ] **Step 4: useApproverCount — decide inclusion**

Inspect `src/hooks/useApproverCount.ts:12`. If approvers are for an operational flow the ops-mgr participates in (e.g. schedule/PO approval), add `'operations_manager'` to the `.in('role', [...])`. If it is an accounting approval, leave as-is. Document the decision in the commit message.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(permissions): include operations_manager in operational UI role guards"
```

---

## Task 11: Final verification sweep

- [ ] **Step 1: Full local suite**

Run: `npm run test && npm run test:db && npm run typecheck && npm run lint && npm run build`
Expected: all PASS. Fix and re-run until green (max 5 iterations per workflow).

- [ ] **Step 2: Grep for missed literals**

Run: `grep -rnE "\['owner', ?'manager'\]|=== 'manager'" src/ | grep -v permissions/ | grep -v '.test.'`
Review each remaining hit: confirm it is intentionally accounting/admin (excludes ops-mgr) or already handled. Note any deliberate exclusions.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A && git commit -m "chore: operations_manager literal-audit follow-ups" || echo "nothing to commit"
```

---

## Self-review coverage map

- Role type/capabilities/metadata → Tasks 1–2
- Invite matrix (ops-mgr → staff) → Task 3 (+ edge Task 7, UI Task 8)
- SQL constraint + internal-team helper + capability function (live-body based) → Task 4
- Capability sentinel + accounting deny (drift guard) → Task 5
- Residual operational RLS policies + DML tests → Task 6
- Edge-fn default-deny + escalation-hole fix → Task 7
- Invite dropdown/guard + a11y/query fixes → Task 8
- Sidebar (no Accounting/Integrations) → Task 9
- Operational hardcoded-literal audit → Tasks 10–11
- Accounting/admin exclusion verified at: capability fn (Task 4/5), nav (Task 9), left-as-is literals (Task 10)
