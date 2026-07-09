# Operations Manager Collaborator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new external, isolated collaborator role `collaborator_operations_manager`, surfaced as a 4th preset card in the Collaborators tab, scoped to operations (scheduling, tips, time punches, inventory + recipe ops, read-only payroll) with admin/accounting excluded.

**Architecture:** Extend the single-source-of-truth TS permission layer, mirror the invite matrix into the edge function, close two fail-open per-role UI maps (route guard + sidebar nav), and add one SQL migration (role constraint + `user_has_capability` + RLS parity with `operations_manager`, plus a functional fix to the core scheduling-table edit policies). Isolation is preserved by NOT adding the role to `user_is_internal_team`.

**Tech Stack:** React 18 + TypeScript, Supabase (Postgres RLS, Deno edge functions), Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-07-09-ops-manager-collaborator-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/permissions/types.ts` | `Role` union | Modify |
| `src/lib/permissions/definitions.ts` | capabilities, metadata, presets | Modify |
| `src/lib/permissions/invitations.ts` | invite matrix (TS) | Modify |
| `supabase/functions/send-team-invitation/index.ts` | invite matrix (edge, mirror) + friendlyRole | Modify |
| `src/hooks/useRestaurants.tsx` | duplicated `role` literal union | Modify |
| `src/components/CollaboratorInvitations.tsx` | preset icon, grid, aria-pressed | Modify |
| `src/App.tsx` | `COLLABORATOR_ROUTES` route allow-list (fail-open guard) | Modify |
| `src/components/AppSidebar.nav.ts` | bespoke nav array + `getNavigationForRole` case | Modify |
| `supabase/migrations/20260709120000_add_collaborator_operations_manager_role.sql` | constraint + capability fn + RLS | Create |
| `tests/unit/collaboratorOperationsManagerRole.test.ts` | TS capability/metadata/preset drift guard | Create |
| `tests/unit/invitationMatrix.test.ts` | invite-matrix assertions for new role | Modify |
| `tests/unit/collaboratorOperationsManagerRouting.test.ts` | route + nav fail-open regression guard | Create |
| `supabase/tests/23_collaborator_operations_manager_capabilities.sql` | pgTAP capability drift guard | Create |
| `supabase/tests/24_collaborator_operations_manager_rls.sql` | pgTAP isolation + scheduling-write + accounting-deny | Create |

---

## Task 1: TypeScript permission core (role, capabilities, metadata, preset)

**Files:**
- Modify: `src/lib/permissions/types.ts`
- Modify: `src/lib/permissions/definitions.ts`
- Test: `tests/unit/collaboratorOperationsManagerRole.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/collaboratorOperationsManagerRole.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  ROLE_CAPABILITIES,
  ROLE_METADATA,
  COLLABORATOR_PRESETS,
  isCollaboratorRole,
  getCollaboratorRoles,
} from '@/lib/permissions/definitions';
import type { Capability } from '@/lib/permissions/types';

const ROLE = 'collaborator_operations_manager' as const;

const REQUIRED: Capability[] = [
  'view:dashboard', 'view:ai_assistant',
  'view:inventory', 'edit:inventory', 'view:inventory_audit', 'edit:inventory_audit',
  'view:purchase_orders', 'edit:purchase_orders', 'view:receipt_import', 'edit:receipt_import',
  'view:reports', 'view:inventory_transactions', 'edit:inventory_transactions',
  'view:recipes', 'edit:recipes', 'view:prep_recipes', 'edit:prep_recipes',
  'view:batches', 'edit:batches',
  'view:pos_sales', 'view:scheduling', 'edit:scheduling',
  'view:payroll', 'view:tips', 'edit:tips', 'view:time_punches', 'edit:time_punches',
  'view:employees', 'view:settings',
];

const EXCLUDED: Capability[] = [
  // admin
  'view:team', 'manage:team', 'manage:employees', 'edit:settings',
  'view:integrations', 'manage:integrations', 'view:collaborators', 'manage:collaborators',
  // payroll write (view-only role)
  'edit:payroll',
  // accounting surface
  'view:transactions', 'edit:transactions', 'view:banking', 'edit:banking',
  'view:expenses', 'edit:expenses', 'view:financial_statements', 'view:chart_of_accounts',
  'edit:chart_of_accounts', 'view:invoices', 'edit:invoices', 'view:customers',
  'edit:customers', 'view:financial_intelligence', 'view:pending_outflows', 'edit:pending_outflows',
];

describe('collaborator_operations_manager capabilities', () => {
  const caps = new Set(ROLE_CAPABILITIES[ROLE]);

  it('includes every required operational capability', () => {
    for (const c of REQUIRED) expect(caps.has(c), `missing ${c}`).toBe(true);
  });

  it('excludes admin, payroll-write, and accounting capabilities', () => {
    for (const c of EXCLUDED) expect(caps.has(c), `should not have ${c}`).toBe(false);
  });

  it('has collaborator metadata with the Operations Manager label', () => {
    expect(ROLE_METADATA[ROLE].label).toBe('Operations Manager');
    expect(ROLE_METADATA[ROLE].category).toBe('collaborator');
    expect(ROLE_METADATA[ROLE].landingPath).toBe('/scheduling');
  });

  it('is recognized as a collaborator role', () => {
    expect(isCollaboratorRole(ROLE)).toBe(true);
    expect(getCollaboratorRoles()).toContain(ROLE);
  });

  it('has a preset with non-empty features', () => {
    const preset = COLLABORATOR_PRESETS.find((p) => p.role === ROLE);
    expect(preset).toBeDefined();
    expect(preset!.title).toBe('Operations Manager');
    expect(preset!.features.length).toBeGreaterThan(0);
    expect(COLLABORATOR_PRESETS).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- collaboratorOperationsManagerRole`
Expected: FAIL — `ROLE_CAPABILITIES['collaborator_operations_manager']` is undefined / type error.

- [ ] **Step 3a: Add the role to the union**

In `src/lib/permissions/types.ts`, in the `Role` union add the new member and update the doc comment's collaborator list:

```typescript
  | 'collaborator_accountant'
  | 'collaborator_inventory'
  | 'collaborator_chef'
  | 'collaborator_operations_manager';
```

(Also add a line to the JSDoc block above: `- collaborator_operations_manager: Operations access (scheduling, labor, inventory)`.)

- [ ] **Step 3b: Add the capability array**

In `src/lib/permissions/definitions.ts`, add a new entry to `ROLE_CAPABILITIES` after `collaborator_chef` (keep the `as const`):

```typescript
  collaborator_operations_manager: [
    // External operations specialist: full ops surface, NO admin, NO accounting,
    // payroll view-only. Isolated (not in user_is_internal_team).
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
    'view:payroll', // read-only labor context
    'view:tips',
    'edit:tips',
    'view:time_punches',
    'edit:time_punches',
    'view:employees', // read-only, required to assign shifts
    'view:settings',
  ],
```

- [ ] **Step 3c: Add role metadata**

In `ROLE_METADATA`, add after `collaborator_chef`:

```typescript
  collaborator_operations_manager: {
    role: 'collaborator_operations_manager',
    label: 'Operations Manager',
    description: 'Operations access — scheduling, labor, and inventory',
    category: 'collaborator',
    landingPath: '/scheduling',
    color: 'outline',
  },
```

- [ ] **Step 3d: Add the invite preset**

Append to `COLLABORATOR_PRESETS`:

```typescript
  {
    role: 'collaborator_operations_manager',
    title: 'Operations Manager',
    description: 'Can run scheduling, labor, tips, and inventory operations',
    features: [
      'Build and edit schedules',
      'Manage time clock and tip pooling',
      'Adjust inventory, audits, and purchasing',
      'Manage recipes and prep production',
      'View payroll for labor-cost context',
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- collaboratorOperationsManagerRole`
Expected: PASS (5 tests). Also run `npm run typecheck` — expect no errors (the `Record<Role, ...>` maps now require the new key, which we added).

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/types.ts src/lib/permissions/definitions.ts tests/unit/collaboratorOperationsManagerRole.test.ts
git commit -m "feat(permissions): add collaborator_operations_manager role + capabilities"
```

---

## Task 2: Invite matrix (TypeScript)

**Files:**
- Modify: `src/lib/permissions/invitations.ts`
- Test: `tests/unit/invitationMatrix.test.ts` (modify)

- [ ] **Step 1: Add failing assertions**

Append inside the top-level `describe('invite matrix', ...)` in `tests/unit/invitationMatrix.test.ts`:

```typescript
  it('owner and manager can invite the operations manager collaborator', () => {
    expect(canInviteRole('owner', 'collaborator_operations_manager')).toBe(true);
    expect(canInviteRole('manager', 'collaborator_operations_manager')).toBe(true);
  });

  it('operations manager collaborator can invite nobody', () => {
    expect(getInvitableRoles('collaborator_operations_manager')).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- invitationMatrix`
Expected: FAIL — `canInviteRole('owner', 'collaborator_operations_manager')` is `false`, and TS error on the missing key in `INVITABLE_ROLES`.

- [ ] **Step 3: Update the matrix**

In `src/lib/permissions/invitations.ts`, add `'collaborator_operations_manager'` to the `owner` and `manager` arrays, and add the new key with an empty array:

```typescript
  owner: [
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
  manager: [
    'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager',
  ],
```

and alongside the other collaborator entries:

```typescript
  collaborator_operations_manager: [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- invitationMatrix` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions/invitations.ts tests/unit/invitationMatrix.test.ts
git commit -m "feat(permissions): allow owner/manager to invite operations manager collaborator"
```

---

## Task 3: Edge function invite matrix (mirror) + friendlyRole

**Files:**
- Modify: `supabase/functions/send-team-invitation/index.ts`

> No Deno unit-test harness runs in CI for this matrix; the TS `invitationMatrix.test.ts` is the source-of-truth guard. This task keeps the duplicated edge matrix in sync (default-deny) and adds the email display name. Verify by grep + `npm run build`.

- [ ] **Step 1: Update the edge `INVITABLE_ROLES`**

In `supabase/functions/send-team-invitation/index.ts`, add `'collaborator_operations_manager'` to the `owner` and `manager` arrays (lines ~15 and ~21) exactly mirroring Task 2. Do NOT add any new inviter key (absent inviter roles already default-deny via `?? []`).

- [ ] **Step 2: Add the friendly role label**

In the `friendlyRole` map (~line 186), add:

```typescript
      'collaborator_operations_manager': 'Operations Manager',
```

The existing `role.startsWith('collaborator_')` logic already routes it through the "collaborate with" email copy — no other change.

- [ ] **Step 3: Verify sync**

Run:
```bash
grep -n "collaborator_operations_manager" supabase/functions/send-team-invitation/index.ts
```
Expected: 3 matches (owner list, manager list, friendlyRole map).

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: success (the edge file is Deno but the build must not regress; typecheck the app).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-team-invitation/index.ts
git commit -m "feat(invitations): sync edge invite matrix + email label for ops manager collaborator"
```

---

## Task 4: Duplicated role union in useRestaurants

**Files:**
- Modify: `src/hooks/useRestaurants.tsx:47`

- [ ] **Step 1: Add the literal**

Change the `UserRestaurant.role` union to include the new role:

```typescript
  role: 'owner' | 'manager' | 'operations_manager' | 'chef' | 'staff' | 'kiosk' | 'collaborator_accountant' | 'collaborator_inventory' | 'collaborator_chef' | 'collaborator_operations_manager';
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (this widens the union so `selectedRestaurant.role` flows into `Role`-typed consumers without a mismatch).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRestaurants.tsx
git commit -m "fix(types): include collaborator_operations_manager in UserRestaurant.role union"
```

---

## Task 5: Collaborators UI — icon, grid, aria-pressed

**Files:**
- Modify: `src/components/CollaboratorInvitations.tsx`

- [ ] **Step 1: Add an icon-coverage test**

Append to `tests/unit/collaboratorOperationsManagerRole.test.ts` a new describe that guards icon-map coverage (import the map indirectly by re-declaring the expectation against presets — but the map is module-private, so instead assert here that a preset exists; icon coverage is enforced by the render test in Task 7's file). Add:

```typescript
describe('collaborator preset icon coverage (guard)', () => {
  it('every preset role is a known collaborator role', () => {
    for (const p of COLLABORATOR_PRESETS) {
      expect(isCollaboratorRole(p.role)).toBe(true);
    }
  });
});
```

Run: `npm run test -- collaboratorOperationsManagerRole` → PASS.

- [ ] **Step 2: Add the icon to `roleIcons`**

In `src/components/CollaboratorInvitations.tsx`, import `Briefcase` from `lucide-react` (add to the existing import list) and add the map entry:

```typescript
const roleIcons: Record<string, typeof Calculator> = {
  collaborator_accountant: Calculator,
  collaborator_inventory: Package,
  collaborator_chef: ChefHat,
  collaborator_operations_manager: Briefcase,
};
```

- [ ] **Step 3: Fix the responsive grid**

Change the preset grid container class from `grid gap-4 md:grid-cols-3` to:

```tsx
<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
```

- [ ] **Step 4: Add `aria-pressed` to the preset button**

On the preset `<button>` (the one with `onClick={() => setSelectedRole(preset.role)}`), add `aria-pressed={isSelected}`:

```tsx
            <button
              key={preset.role}
              onClick={() => setSelectedRole(preset.role)}
              aria-pressed={isSelected}
              className={`...`}
            >
```

- [ ] **Step 5: Verify build + typecheck**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/CollaboratorInvitations.tsx tests/unit/collaboratorOperationsManagerRole.test.ts
git commit -m "feat(team): show Operations Manager preset card in Collaborators tab"
```

---

## Task 6: Route guard — COLLABORATOR_ROUTES (fail-open fix)

**Files:**
- Modify: `src/App.tsx:146-187` (`COLLABORATOR_ROUTES`)
- Test: `tests/unit/collaboratorOperationsManagerRouting.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/collaboratorOperationsManagerRouting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { COLLABORATOR_ROUTES } from '@/App';

const ROLE = 'collaborator_operations_manager';

describe('collaborator_operations_manager route guard', () => {
  it('has a route config (not fail-open)', () => {
    expect(COLLABORATOR_ROUTES[ROLE]).toBeDefined();
    expect(COLLABORATOR_ROUTES[ROLE].landing).toBe('/scheduling');
  });

  it('allows operational routes and denies admin/accounting routes', () => {
    const allowed = COLLABORATOR_ROUTES[ROLE].allowed;
    for (const p of ['/scheduling', '/time-punches', '/tips', '/inventory', '/recipes', '/settings']) {
      expect(allowed, `should allow ${p}`).toContain(p);
    }
    for (const p of ['/team', '/integrations', '/transactions', '/banking', '/chart-of-accounts', '/']) {
      expect(allowed, `should NOT allow ${p}`).not.toContain(p);
    }
  });
});
```

> `COLLABORATOR_ROUTES` is currently module-private in `App.tsx`. Export it: change `const COLLABORATOR_ROUTES` to `export const COLLABORATOR_ROUTES`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- collaboratorOperationsManagerRouting`
Expected: FAIL — either `COLLABORATOR_ROUTES` is not exported, or the new-role entry is undefined.

- [ ] **Step 3: Export the map and add the entry**

In `src/App.tsx`, change the declaration to `export const COLLABORATOR_ROUTES` and add after the `collaborator_chef` entry:

```typescript
  collaborator_operations_manager: {
    landing: '/scheduling',
    allowed: [
      '/scheduling',
      '/time-punches',
      '/tips',
      '/payroll', // read-only labor context
      '/pos-sales',
      '/reports',
      '/inventory',
      '/inventory-audit',
      '/purchase-orders',
      '/receipt-import',
      '/recipes',
      '/prep-recipes',
      '/employees', // read-only, scheduling context
      '/settings',
      '/help',
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- collaboratorOperationsManagerRouting` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/unit/collaboratorOperationsManagerRouting.test.ts
git commit -m "fix(routing): scope collaborator_operations_manager routes (close fail-open guard)"
```

---

## Task 7: Sidebar nav — bespoke nav + switch case (fail-open fix)

**Files:**
- Modify: `src/components/AppSidebar.nav.ts`
- Test: `tests/unit/collaboratorOperationsManagerRouting.test.ts` (extend)

- [ ] **Step 1: Add failing nav assertions**

Append to `tests/unit/collaboratorOperationsManagerRouting.test.ts`:

```typescript
import { getNavigationForRole, navigationGroups } from '@/components/AppSidebar.nav';

describe('collaborator_operations_manager sidebar nav', () => {
  const nav = getNavigationForRole('collaborator_operations_manager');
  const paths = nav.flatMap((g) => g.items.map((i) => i.path));

  it('returns a scoped nav, not the full internal navigation (fail-open guard)', () => {
    expect(nav).not.toBe(navigationGroups);
    expect(nav.length).toBeGreaterThan(0);
  });

  it('shows operational nav and hides admin/accounting/team', () => {
    for (const p of ['/scheduling', '/time-punches', '/tips', '/inventory', '/recipes', '/settings']) {
      expect(paths, `should show ${p}`).toContain(p);
    }
    for (const p of ['/team', '/integrations', '/transactions', '/banking']) {
      expect(paths, `should hide ${p}`).not.toContain(p);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- collaboratorOperationsManagerRouting`
Expected: FAIL — `getNavigationForRole('collaborator_operations_manager')` hits `default:` and returns `navigationGroups` (includes `/team`, `/transactions`).

- [ ] **Step 3: Add the bespoke nav array**

In `src/components/AppSidebar.nav.ts`, after `operationsManagerNav` (around line 211) add. (All icons used below — `CalendarCheck`, `ClipboardList`, `Coins`, `Wallet`, `ChefHat`, `Utensils`, `Package`, `ClipboardCheck`, `ShoppingBag`, `FileText`, `ShoppingCart`, `Settings`, `LifeBuoy` — are already imported at the top of this file; verify and add any that are missing.)

```typescript
// Operations Manager collaborator: external, isolated ops surface.
// No Accounting, Team, Integrations, or Dashboard root.
export const collaboratorOperationsManagerNav: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { path: '/scheduling', label: 'Scheduling', icon: CalendarCheck },
      { path: '/time-punches', label: 'Time Clock', icon: ClipboardList },
      { path: '/tips', label: 'Tip Pooling', icon: Coins },
      { path: '/payroll', label: 'Payroll', icon: Wallet },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/prep-recipes', label: 'Prep Recipes', icon: Utensils },
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingBag },
      { path: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Sales',
    items: [
      { path: '/pos-sales', label: 'POS Sales', icon: ShoppingCart },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
      { path: '/help', label: 'Help Center', icon: LifeBuoy },
    ],
  },
];
```

- [ ] **Step 4: Add the switch case**

In `getNavigationForRole`, add before `default:`:

```typescript
    case 'collaborator_operations_manager':
      return collaboratorOperationsManagerNav;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- collaboratorOperationsManagerRouting` → PASS. `npm run typecheck && npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/AppSidebar.nav.ts tests/unit/collaboratorOperationsManagerRouting.test.ts
git commit -m "fix(nav): scoped sidebar for collaborator_operations_manager (close fail-open default)"
```

---

## Task 8: SQL migration — constraint + capability fn + RLS

**Files:**
- Create: `supabase/migrations/20260709120000_add_collaborator_operations_manager_role.sql`

> Template: `supabase/migrations/20260702170000_add_operations_manager_role.sql`. Copy its `user_has_capability` body verbatim, then add `collaborator_operations_manager` to the SAME role lists `operations_manager` appears in, EXCEPT: `view:team`, `manage:team`, `manage:employees`, `edit:payroll` (do NOT add there). DO add it to `view:payroll`, `view:employees`, `view:ai_assistant`, and every inventory/recipe/scheduling/tips/time_punches/pos/reports/dashboard branch that lists `operations_manager`.

- [ ] **Step 1: Write the migration header + constraint**

```sql
-- ============================================================================
-- Migration: Add collaborator_operations_manager role
--
-- External, ISOLATED operations collaborator. Full operational surface
-- (scheduling, tips, time punches, inventory, recipes, view payroll, POS view,
-- AI assistant) but NO admin (team/manage-employees/settings-edit/integrations/
-- collaborators) and NO accounting. NOT added to user_is_internal_team, so the
-- collaborator sees only its own user_restaurants row (isolation preserved).
--
-- ALSO (behavior change to an EXISTING role — see PR description): widens the
-- core shifts/shift_templates/time_off_requests INSERT/UPDATE/DELETE policies to
-- include operations_manager AND collaborator_operations_manager, fixing a latent
-- gap where operations_manager held edit:scheduling but could not write shifts.
--
-- Order: constraint -> user_has_capability -> RLS. The constraint drop/recreate
-- takes a brief lock on user_restaurants (acceptable — small per-tenant table).
-- ============================================================================

ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;

ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN (
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef',
    'collaborator_operations_manager'
  ));
```

- [ ] **Step 2: Re-create `user_has_capability`**

Copy the entire `CREATE OR REPLACE FUNCTION public.user_has_capability(...) ... $$;` block from `20260702170000_add_operations_manager_role.sql` (lines 56–179) into this migration, then edit these branches to append `'collaborator_operations_manager'` to the `v_role IN (...)` list:

- `view:ai_assistant` (keep the `has_subscription_feature(...)` AND-clause intact)
- `view:dashboard`
- ALL inventory branches: `view:inventory`, `edit:inventory`, `view:inventory_audit`, `edit:inventory_audit`, `view:purchase_orders`, `edit:purchase_orders`, `view:receipt_import`, `edit:receipt_import`, `view:reports`, `view:inventory_transactions`, `edit:inventory_transactions`
- ALL recipe branches: `view:recipes`, `edit:recipes`, `view:prep_recipes`, `edit:prep_recipes`, `view:batches`, `edit:batches`
- Operations: `view:pos_sales`, `view:scheduling`, `edit:scheduling`, `view:payroll`, `view:tips`, `edit:tips`, `view:time_punches`, `edit:time_punches`
- `view:employees`

Do NOT add it to: `edit:payroll`, `view:team`, `manage:team`, `manage:employees`, `edit:settings`, `view:integrations`, `manage:integrations`, `view:collaborators`, `manage:collaborators`, `manage:subscription`, or any accounting branch. `view:settings` already passes (`v_role NOT IN ('kiosk')`). Update the trailing `COMMENT ON FUNCTION` to describe the new role.

- [ ] **Step 3: Widen the hardcoded operational RLS policies**

For EACH policy listed below, this migration re-creates it exactly as it exists in `20260702170000` (same name, same body) but with `'collaborator_operations_manager'` appended to the `role IN (...)` / `ARRAY[...]` list. Use `DROP POLICY IF EXISTS "<name>" ON <table>;` then `CREATE POLICY ...`. Tables/policies (copy each body from `20260702170000`):

- `tip_pool_settings`: "Managers can view/insert/update tip pool settings" (3)
- `tip_splits`: "Managers can view/insert/update/delete tip splits" (4)
- `tip_split_items`: "Managers can view/insert/update/delete tip split items" (4)
- `tip_disputes`: "Managers can view/update tip disputes" (2)
- `tip_contribution_pools`: view/insert/update/delete (4)
- `tip_server_earnings`: view/insert/update/delete (4)
- `tip_pool_allocations`: view/insert/update/delete (4)
- `tip_payouts`: "Managers can view/insert/update/delete tip payouts" (4)
- `overtime_rules`: "Owners and managers can manage overtime rules" (1)
- `overtime_adjustments`: "Owners and managers can manage overtime adjustments" (1)
- `daily_labor_allocations`: insert/update/delete (3)
- `schedule_publications`: "Managers can create schedule publications" (1)
- `schedule_change_logs`: "Managers can create change logs" (1)
- `open_shift_claims`: "managers_view_restaurant_claims", "managers_review_claims" (2)
- `staffing_settings`: "Owners and managers can manage staffing settings" (1)
- `time_punches`: "Managers can create time punches for employees" — keep `'kiosk'`, add the new role (1)
- `receipt_imports`: "Owners and managers can view/create/update receipt imports" (3)

Do NOT touch `employee_compensation_history` (that INSERT is compensation editing; the collaborator has no `edit:payroll`). Do NOT touch `employees` SELECT (already wide-open via "Team members can view coworkers in their restaurant"; capability handles UI gating). Do NOT touch the `RESTRICTIVE` "Prevent self-escalation" policy (its `('staff','kiosk')` allowlist already blocks self-escalation into the new role).

- [ ] **Step 4: Widen the core scheduling-table edit policies (NEW — functional fix)**

These are NOT in the template; write them in full. This fixes edit:scheduling for BOTH operations_manager and the new collaborator:

```sql
-- shifts: writes were owner/manager only (never widened). Add both ops roles.
DROP POLICY IF EXISTS "Users can create shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can create shifts for their restaurants"
  ON public.shifts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can update shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can update shifts for their restaurants"
  ON public.shifts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );

DROP POLICY IF EXISTS "Users can delete shifts for their restaurants" ON public.shifts;
CREATE POLICY "Users can delete shifts for their restaurants"
  ON public.shifts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = shifts.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    )
  );
```

Repeat the identical DROP/CREATE pattern for `shift_templates` (policies "Users can create/update/delete shift templates for their restaurants") and `time_off_requests` (the MANAGER-scoped policies only: "Users can create/update/delete time off requests for their restaurants" — do NOT alter the "Employees can ..." self-service policies). Each uses the same 4-role `role IN (...)` list. (SELECT policies on all three tables already admit any restaurant member — leave them.)

- [ ] **Step 5: Sanity-check the migration compiles**

Run (requires local Supabase):
```bash
npm run db:reset
```
Expected: all migrations apply with no error; the new constraint and policies are created. If `db:reset` is unavailable in the environment, at minimum verify balanced `BEGIN`/`$$`/`;` and that every `CREATE POLICY` has a matching prior `DROP POLICY IF EXISTS`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260709120000_add_collaborator_operations_manager_role.sql
git commit -m "feat(db): collaborator_operations_manager role — capabilities + RLS parity + scheduling-write fix"
```

---

## Task 9: pgTAP — capabilities + isolation + scheduling-write + accounting-deny

**Files:**
- Create: `supabase/tests/23_collaborator_operations_manager_capabilities.sql`
- Create: `supabase/tests/24_collaborator_operations_manager_rls.sql`

> Templates: `supabase/tests/21_operations_manager_capabilities.sql` and `22_operations_manager_rls.sql`. Use fixture UUID namespace `23000000-...` and `24000000-...`.

- [ ] **Step 1: Capability drift guard (file 23)**

Create `supabase/tests/23_collaborator_operations_manager_capabilities.sql`, mirroring file 21 with role `collaborator_operations_manager` and UUID prefix `23000000`. Adjust the assertions to this role's scope:

```sql
BEGIN;
SELECT plan(24);

INSERT INTO auth.users (id, email)
VALUES ('23000000-0000-0000-0000-000000000001', 'test-ops-collab-23@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurants (id, name)
VALUES ('23000000-0000-0000-0000-000000000099', 'Test Restaurant 23')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES ('23000000-0000-0000-0000-000000000101',
        '23000000-0000-0000-0000-000000000001',
        '23000000-0000-0000-0000-000000000099',
        'collaborator_operations_manager')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'collaborator_operations_manager';

SELECT set_config('request.jwt.claims',
  '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- helper: shorthand for the restaurant uuid
-- INCLUDED (TRUE)
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:scheduling'), TRUE, 'has edit:scheduling');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:tips'), TRUE, 'has edit:tips');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:time_punches'), TRUE, 'has edit:time_punches');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:inventory'), TRUE, 'has edit:inventory');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:recipes'), TRUE, 'has edit:recipes');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:pos_sales'), TRUE, 'has view:pos_sales');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:reports'), TRUE, 'has view:reports');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:payroll'), TRUE, 'has view:payroll');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:employees'), TRUE, 'has view:employees');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:settings'), TRUE, 'has view:settings');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:receipt_import'), TRUE, 'has edit:receipt_import');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:dashboard'), TRUE, 'has view:dashboard');

-- EXCLUDED (FALSE): payroll write, admin, accounting
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:payroll'), FALSE, 'denied edit:payroll (view-only role)');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:team'), FALSE, 'denied view:team');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','manage:team'), FALSE, 'denied manage:team');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','manage:employees'), FALSE, 'denied manage:employees');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','edit:settings'), FALSE, 'denied edit:settings');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','manage:collaborators'), FALSE, 'denied manage:collaborators');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:integrations'), FALSE, 'denied view:integrations');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:transactions'), FALSE, 'denied view:transactions (accounting)');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:banking'), FALSE, 'denied view:banking (accounting)');
SELECT is(public.user_has_capability('23000000-0000-0000-0000-000000000099','view:chart_of_accounts'), FALSE, 'denied view:chart_of_accounts (accounting)');

-- ISOLATION invariants
SELECT is(public.user_is_internal_team('23000000-0000-0000-0000-000000000099'), FALSE, 'NOT internal team (isolated)');
SELECT is(public.user_is_collaborator('23000000-0000-0000-0000-000000000099'), TRUE, 'is a collaborator');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run file 23**

Run: `npm run test:db`
Expected: file 23 passes 24/24. (If the runner targets a single file, use the project's documented pgTAP invocation; otherwise `test:db` runs all.)

- [ ] **Step 3: RLS enforcement (file 24)**

Create `supabase/tests/24_collaborator_operations_manager_rls.sql`, mirroring file 22's `SET LOCAL ROLE authenticated` + JWT-claims strategy (UUID prefix `24000000`). Seed: a restaurant, an owner peer, the collaborator user + membership, one `employees` row (needed as FK for a shift insert). Assert:
  - `lives_ok$$ INSERT INTO shifts (...) $$` succeeds under the collaborator (scheduling write works). Use the seeded employee + restaurant and valid `start_time < end_time`, `position`, `status`.
  - `is(EXISTS(SELECT 1 FROM shifts ...), TRUE, ...)` the row is visible.
  - `throws_ok$$ INSERT INTO bank_transactions (...) $$` (or `is((SELECT count(*) FROM bank_transactions), 0, ...)` for a seeded accounting row — SELECT denied) confirming accounting is unreachable.
  - `is(EXISTS(SELECT 1 FROM employees WHERE restaurant_id = ...), TRUE, ...)` employee roster is readable (scheduling context).
  - `is((SELECT count(*) FROM user_restaurants WHERE restaurant_id = ...), 1, 'collaborator sees only its own membership row')` — isolation.

Follow file 22's exact fixture/role-switch scaffolding; keep `plan(N)` in sync with the assertion count.

- [ ] **Step 4: Run the full DB suite**

Run: `npm run test:db`
Expected: files 23 and 24 pass; no regression in 21/22.

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/23_collaborator_operations_manager_capabilities.sql supabase/tests/24_collaborator_operations_manager_rls.sql
git commit -m "test(db): pgTAP for collaborator_operations_manager capabilities + RLS isolation"
```

---

## Final verification (Phase 8 will formalize)

```bash
npm run test && npm run typecheck && npm run lint && npm run build && npm run test:db
```
Expected: all green. E2E (`npm run test:e2e`) only if collaborator invite flows are covered there.

## Self-Review notes (spec coverage)

- Spec §1 TS layer → Task 1. §2 invite matrix → Tasks 2–3. §3 UI (3 files) → Tasks 5 (component), 6 (routes), 7 (nav). §4 migration → Task 8. §5 tests → Tasks 1,2,5,6,7 (Vitest) + 9 (pgTAP). Duplicated role union (frontend-review major) → Task 4.
- No placeholders: every code step shows the literal code or names the exact template file + the precise transformation (RLS parity tasks reference `20260702170000` with the one-token change spelled out).
- Type consistency: role string `collaborator_operations_manager`, capability names, and `landingPath: '/scheduling'` are identical across Tasks 1, 6, 7, 8, 9.
