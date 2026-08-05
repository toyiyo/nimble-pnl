# Permissions menu-mirror, PR 1 (the model) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-cut `area_catalog` from 15 bundle-shaped keys to 33 page-shaped keys grouped by the app's own sidebar, so Tip Pooling and Invoices become independently grantable — with no role gaining or losing a single capability on deploy.

**Architecture:** The capability vocabulary in `user_has_capability` is already page-shaped (`view:invoices`, `view:tips`); only the `area_key` column bundles. So this is a re-point of one column plus a mechanical fan-out of `role_areas` rows, not an enforcement redesign. On the client, permission metadata is declared per page in `areas.ts` and *joined* against `navigationGroups` for label/icon/group/order, so a page added to the sidebar without a permission fails a test instead of silently becoming ungrantable.

**Tech Stack:** Postgres 15 (Supabase), pgTAP, TypeScript 5, React 18, Vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md` (same branch, commit `d4659412`). Read §3.1, §3.2, §4.0 and §4.1 before Task 3.

## Global Constraints

- **Scope is PR 1 only** — the model. Collapsible groups, roll-up tri-state controls and the sidebar-literal preview panel are PR 2 (spec §6). `RoleEditor` in this PR renders a flat list of 33 rows under five sidebar-named headings and must stay functional; it is not restyled.
- **Nobody gains or loses access on deploy.** Every task that could change a role's effective capability set is proved by an exhaustive per-role, both-directions assertion, never a spot check.
- **`AreaKey` stays an explicit TypeScript union.** It is the contract with SQL. Never widen it to `string`.
- **Never `git add -A` / `git add .` / `git commit -a`.** Stage the exact paths listed in each Commit step.
- **`progress.md` is gitignored and must never be staged**, not even with `git add -f`.
- Work happens in the worktree `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/permissions-menu-mirror` on branch `feature/permissions-menu-mirror`. Every `git` and `npm` invocation runs with that as the working directory.
- No direct colors (`bg-background`/`text-foreground`, never `bg-white`). No manual caching — React Query only. Buttons without visible text need `aria-label`.
- Bound every test run with the Bash tool's own `timeout` parameter. No hand-rolled poll loops; `timeout`/`gtimeout` do not exist on this machine.
- Migration filename must sort after `20260804100000_reviews_area.sql`. Use `20260805120000_page_areas.sql`.

---

## File Structure

**Created:**
- `src/components/AppSidebar.nav.data.ts` — leaf module: `NavItem`, `NavGroup`, `navigationGroups`, `SUPPLEMENTAL_NAV_ITEMS`. Zero imports from `@/lib/permissions`. Exists solely to break the import cycle Task 1 describes.
- `supabase/migrations/20260805120000_page_areas.sql` — catalog expansion, `role_areas` fan-out, `user_has_capability` rewrite.
- `supabase/tests/page_areas_catalog_test.sql` — catalog shape + the trigger-still-enabled assertion.

**Modified:**
- `src/components/AppSidebar.nav.ts` — nav data moves out; re-exports it so no other importer changes.
- `src/lib/permissions/areas.ts` — 33-key union, per-page capability bundles, `AREA_DEFINITIONS` derived.
- `src/lib/permissions/routeAreas.ts` — `AREA_ROUTES` derived from the catalog.
- `src/lib/permissions/preview.ts` — group by `uiGroup` instead of `band`; per-page hint copy.
- `src/components/roles/RoleEditor.tsx` — 33 rows under five headings; `AREA_HINT`/`AREA_LOCK_REASON` deleted.
- `src/components/roles/RolePreviewPanel.tsx` — ungranted pages absent, not struck through.
- `supabase/tests/roles_seed_test.sql` — `test_area_capability_at_level` fixture re-derived for 33 areas.
- `supabase/tests/user_has_capability_areas_test.sql` — new assertions for the re-pointed special case.
- `tests/unit/areas.test.ts`, `tests/unit/routeAreas.test.ts`, `tests/unit/RoleEditor.test.tsx`, `tests/unit/RolePreviewPanel.test.tsx`, `tests/e2e/roles-and-areas.spec.ts`.

**Deliberately untouched:** `src/App.tsx`'s `COLLABORATOR_ROUTES` (the four builtin collaborators keep their hand-written allow-lists — the calibration test proves the derived lists still match), `src/lib/permissions/definitions.ts`'s `ROLE_CAPABILITIES` (it is the fixed point the whole migration is proved against), and `role_flags` semantics.

---

## The 33 keys

Referenced by every task. `cap` is `max_level_collaborator`.

| ui_group | key | path | manage tier? | cap |
|---|---|---|---|---|
| Main | `dashboard` | `/` | no | view |
| Main | `integrations` | `/integrations` | yes | view |
| Main | `sales` | `/pos-sales` | no | view |
| Main | `ops_inbox` | `/ops-inbox` | no | view |
| Main | `reviews` | `/reviews` | yes | view |
| Main | `weekly_brief` | `/weekly-brief` | no | view |
| Operations | `scheduling` | `/scheduling` | yes | manage |
| Operations | `time_punches` | `/time-punches` | yes | manage |
| Operations | `tips` | `/tips` | yes | manage |
| Operations | `payroll` | `/payroll` | yes | view |
| Operations | `labor` | `/labor` | no | view |
| Inventory | `recipes` | `/recipes` | yes | manage |
| Inventory | `prep_recipes` | `/prep-recipes` | yes | manage |
| Inventory | `inventory` | `/inventory` | yes | manage |
| Inventory | `inventory_audit` | `/inventory-audit` | yes | manage |
| Inventory | `purchasing` | `/purchase-orders` | yes | manage |
| Inventory | `reports` | `/reports` | yes (= AI assistant) | view |
| Accounting | `budget` | `/budget` | no | view |
| Accounting | `customers` | `/customers` | yes | manage |
| Accounting | `invoices` | `/invoices` | yes | manage |
| Accounting | `stripe_account` | `/stripe-account` | no | view |
| Accounting | `banking` | `/banking` | yes | manage |
| Accounting | `expenses` | `/expenses` | yes | manage |
| Accounting | `print_checks` | `/print-checks` | yes | manage |
| Accounting | `assets` | `/assets` | yes | manage |
| Accounting | `financial_intelligence` | `/financial-intelligence` | no | view |
| Accounting | `transactions` | `/transactions` | yes | manage |
| Accounting | `chart_of_accounts` | `/chart-of-accounts` | yes | manage |
| Accounting | `financial_statements` | `/financial-statements` | no | view |
| Admin | `employees` | `/employees` | yes | manage |
| Admin | `team` | `/team` | yes | **NULL** |
| Admin | `collaborators` | `/team` | yes | **NULL** |
| Admin | `settings` | `/settings` | yes | view |

`sort_order` is 1-based **within** `ui_group`, in the order above (matching `navigationGroups`). `collaborators` sorts immediately after `team`. `/help` gets no row — it stays in `UNIVERSAL_PATHS`.

---

### Task 1: Break the import cycle before anything derives from the nav

`areas.ts` must read `navigationGroups`. But `AppSidebar.nav.ts` already imports `allowedPathsForAreas` from `routeAreas.ts`, which imports `areas.ts` — so `areas.ts → AppSidebar.nav.ts → routeAreas.ts → areas.ts` is a cycle with **module-level const initialization on both ends**. Under ESM that is a temporal-dead-zone crash at import time, not a warning. Extract the data first.

**Files:**
- Create: `src/components/AppSidebar.nav.data.ts`
- Modify: `src/components/AppSidebar.nav.ts`
- Test: `tests/unit/AppSidebar.nav.test.ts` (existing, must stay green untouched)

**Interfaces:**
- Consumes: nothing.
- Produces: `src/components/AppSidebar.nav.data.ts` exporting `interface NavItem { path: string; label: string; icon: LucideIcon }`, `interface NavGroup { label: string; items: NavItem[] }`, `const navigationGroups: NavGroup[]`, `const SUPPLEMENTAL_NAV_ITEMS: Record<string, NavItem[]>`.

- [ ] **Step 1: Create the leaf data module**

Move — do not copy — these declarations out of `src/components/AppSidebar.nav.ts` into a new `src/components/AppSidebar.nav.data.ts`: the `lucide-react` icon imports, `import type { LucideIcon }`, `NavItem`, `NavGroup`, `navigationGroups`, and `SUPPLEMENTAL_NAV_ITEMS`. Leave every other export (`collaboratorAccountantNav`, `collaboratorInventoryNav`, `collaboratorChefNav`, `staffNav`, `operationsManagerNav`, `collaboratorOperationsManagerNav`, `DERIVED_GROUP_LABELS`, `NAV_HIDDEN_PATHS`, `getNavigationForAreas`, `getNavigationForRole`) where it is.

The new file's header:

```ts
/**
 * Sidebar navigation data — the app's menu, as data.
 *
 * Deliberately a leaf: this module imports nothing from `@/lib/permissions`.
 * `areas.ts` derives `AREA_DEFINITIONS`' grouping, labels and order from
 * `navigationGroups`, while `AppSidebar.nav.ts` imports
 * `allowedPathsForAreas` from `routeAreas.ts` (which imports `areas.ts`).
 * Keeping the data here is what stops that from being an import cycle —
 * a cycle with module-level const initialization on both ends is a
 * temporal-dead-zone crash at import time, not a lint warning.
 *
 * Adding a page here without a matching entry in `PAGE_AREAS`
 * (src/lib/permissions/areas.ts) fails tests/unit/areas.test.ts. That is
 * the drift alarm — before it existed, five sidebar pages were silently
 * ungrantable.
 */
import { Home, Plug, /* …every icon the moved data uses… */ } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
```

The moved declarations are copied **verbatim** — same paths, labels, icons, and order. This step changes no behaviour.

Note: the remaining `AppSidebar.nav.ts` still uses several of those icons in `collaboratorAccountantNav` and friends, so it keeps its own `lucide-react` import line with only the icons it still references. Let `npm run typecheck` tell you which.

- [ ] **Step 2: Re-export from the old module so no importer changes**

At the top of `src/components/AppSidebar.nav.ts`, after its remaining imports:

```ts
import { navigationGroups, SUPPLEMENTAL_NAV_ITEMS } from '@/components/AppSidebar.nav.data';
import type { NavItem, NavGroup } from '@/components/AppSidebar.nav.data';

// Re-exported so `@/components/AppSidebar.nav` stays the single import site
// for consumers that want nav data *and* the role filters together.
export { navigationGroups, SUPPLEMENTAL_NAV_ITEMS };
export type { NavItem, NavGroup };
```

`preview.ts:32`, `AppSidebar.tsx:24`, and both existing test files keep importing from `@/components/AppSidebar.nav` unchanged.

- [ ] **Step 3: Verify nothing moved semantically**

Run: `npm run typecheck`
Expected: exit 0, no errors.

Run: `npx vitest run tests/unit/AppSidebar.nav.test.ts tests/unit/collaboratorOperationsManagerRouting.test.ts --reporter=line`
Expected: PASS, same test count as before the move. These files assert `getNavigationForRole('owner')` deep-equals `navigationGroups`; if the move dropped or reordered an item they fail here.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppSidebar.nav.data.ts src/components/AppSidebar.nav.ts
git commit -m "refactor(nav): extract navigationGroups into a leaf data module

areas.ts is about to derive AREA_DEFINITIONS from navigationGroups, but
AppSidebar.nav.ts imports routeAreas.ts which imports areas.ts. Both ends
initialize module-level consts, so that cycle would be a TDZ crash at
import time rather than a warning. Pure move plus re-export; no behaviour
change."
```

---

### Task 2: The migration

The whole re-cut in one transaction. Written before the TypeScript so the SQL stays authoritative and the client mirrors it, matching the convention `areas.ts`'s header already states.

**Files:**
- Create: `supabase/migrations/20260805120000_page_areas.sql`
- Test: Task 3 (pgTAP). This task ends at "the migration applies cleanly"; correctness is proved next task.

**Interfaces:**
- Consumes: Task 1 nothing. Reads existing `area_catalog`, `role_areas`, `user_has_capability`.
- Produces: `area_catalog` with 33 rows keyed as in *The 33 keys*; `user_has_capability(uuid, text)` with a re-pointed VALUES map.

- [ ] **Step 1: Write the migration header and the guard-disable**

Read spec §4.0 first — it explains why the naive delete-then-insert fails.

```sql
-- ============================================================================
-- Migration: re-cut area_catalog along the sidebar — one area per page
--
-- Design: docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md
--
-- Ordering is dictated by two facts verified in source, not by preference:
--
--  1. role_areas_block_builtin_mutation is BEFORE UPDATE OR DELETE ON
--     role_areas FOR EACH ROW, and raises 42501 for any row whose role is
--     builtin (20260730100000_roles_and_areas_tables.sql:419-465). There is
--     no service-role or migration exemption — this migration fires it. All
--     ten builtins are exactly what must be rewritten, so the guard comes
--     off for the duration and goes back on at the end.
--
--     Note the asymmetry that makes this tractable: the trigger does NOT
--     cover INSERT. Fanning new rows out is already permitted; only removing
--     the old `books` rows needs the guard down.
--
--  2. role_areas.area_key REFERENCES area_catalog(area_key) with no
--     ON DELETE clause (:229), therefore RESTRICT. The `books` catalog row
--     cannot go until every role_areas row pointing at it has gone.
--
-- If this migration errors between the DISABLE and the ENABLE, the
-- collaborator privilege-escalation guard is left OFF in production with no
-- other symptom. supabase/tests/page_areas_catalog_test.sql asserts
-- pg_trigger.tgenabled = 'O' for all four guards precisely because that
-- failure is silent.
-- ============================================================================

ALTER TABLE public.role_areas DISABLE TRIGGER role_areas_block_builtin_mutation;
```

- [ ] **Step 2: Expand `area_catalog`**

`band` is `NOT NULL` on the existing table and is being retired from the client. Rather than drop the column in the same migration that rewrites every row (two risky changes at once), set it equal to `ui_group` and leave the drop to a later cleanup. Say so in a comment so nobody reads it as an oversight.

```sql
-- `band` is retired on the client (five sidebar groups replace the three
-- invented bands) but the column is NOT NULL and other migrations reference
-- it. Set it equal to ui_group here; dropping the column is a separate,
-- later change.

-- Re-point the fourteen survivors onto their sidebar group and position.
UPDATE public.area_catalog SET ui_group = 'Main',       band = 'Main',       sort_order = 2, max_level_collaborator = 'view'   WHERE area_key = 'integrations';
UPDATE public.area_catalog SET ui_group = 'Main',       band = 'Main',       sort_order = 3, max_level_collaborator = 'view'   WHERE area_key = 'sales';
UPDATE public.area_catalog SET ui_group = 'Main',       band = 'Main',       sort_order = 5, max_level_collaborator = 'view'   WHERE area_key = 'reviews';
UPDATE public.area_catalog SET ui_group = 'Operations', band = 'Operations', sort_order = 1, max_level_collaborator = 'manage' WHERE area_key = 'scheduling';
UPDATE public.area_catalog SET ui_group = 'Operations', band = 'Operations', sort_order = 4, max_level_collaborator = 'view'   WHERE area_key = 'payroll';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 1, max_level_collaborator = 'manage' WHERE area_key = 'recipes';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 3, max_level_collaborator = 'manage' WHERE area_key = 'inventory';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 5, max_level_collaborator = 'manage' WHERE area_key = 'purchasing';
UPDATE public.area_catalog SET ui_group = 'Inventory',  band = 'Inventory',  sort_order = 6, max_level_collaborator = 'view'   WHERE area_key = 'reports';
UPDATE public.area_catalog SET ui_group = 'Accounting', band = 'Accounting', sort_order = 12, max_level_collaborator = 'manage' WHERE area_key = 'chart_of_accounts';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 1, max_level_collaborator = 'manage' WHERE area_key = 'employees';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 2, max_level_collaborator = NULL     WHERE area_key = 'team';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 3, max_level_collaborator = NULL     WHERE area_key = 'collaborators';
UPDATE public.area_catalog SET ui_group = 'Admin',      band = 'Admin',      sort_order = 4, max_level_collaborator = 'view'   WHERE area_key = 'settings';

-- The nineteen new page keys.
INSERT INTO public.area_catalog (area_key, ui_group, band, sort_order, max_level_collaborator) VALUES
  ('dashboard',              'Main',       'Main',       1,  'view'),
  ('ops_inbox',              'Main',       'Main',       4,  'view'),
  ('weekly_brief',           'Main',       'Main',       6,  'view'),
  ('time_punches',           'Operations', 'Operations', 2,  'manage'),
  ('tips',                   'Operations', 'Operations', 3,  'manage'),
  ('labor',                  'Operations', 'Operations', 5,  'view'),
  ('prep_recipes',           'Inventory',  'Inventory',  2,  'manage'),
  ('inventory_audit',        'Inventory',  'Inventory',  4,  'manage'),
  ('budget',                 'Accounting', 'Accounting', 1,  'view'),
  ('customers',              'Accounting', 'Accounting', 2,  'manage'),
  ('invoices',               'Accounting', 'Accounting', 3,  'manage'),
  ('stripe_account',         'Accounting', 'Accounting', 4,  'view'),
  ('banking',                'Accounting', 'Accounting', 5,  'manage'),
  ('expenses',               'Accounting', 'Accounting', 6,  'manage'),
  ('print_checks',           'Accounting', 'Accounting', 7,  'manage'),
  ('assets',                 'Accounting', 'Accounting', 8,  'manage'),
  ('financial_intelligence', 'Accounting', 'Accounting', 9,  'view'),
  ('transactions',           'Accounting', 'Accounting', 10, 'manage'),
  ('financial_statements',   'Accounting', 'Accounting', 11, 'view');
```

- [ ] **Step 3: Fan out `role_areas`, then retire `books`**

Insert before deleting — the FK is RESTRICT, and the new rows do not depend on the old ones surviving.

```sql
-- books:manage -> manage on all nine books pages.
-- books:view   -> view on eight; print_checks is SKIPPED. /print-checks is
--                 the only books path gated at manage today
--                 (routeAreas.ts:74), so fanning view out to it would hand
--                 every books-viewer a check-printing page.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, page.area_key, ra.level
FROM public.role_areas ra
CROSS JOIN LATERAL (VALUES
  ('transactions'), ('banking'), ('expenses'), ('invoices'), ('customers'),
  ('financial_statements'), ('financial_intelligence'), ('assets'), ('print_checks')
) AS page(area_key)
WHERE ra.area_key = 'books'
  AND NOT (page.area_key = 'print_checks' AND ra.level = 'view')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level
  WHERE public.role_areas.level = 'view' AND EXCLUDED.level = 'manage';

-- reports -> dashboard at view (no manage tier) + reports at its own level.
-- The `reports` row itself keeps `manage` where it had it: view:ai_assistant
-- is resolved by a hardcoded `area_key = 'reports' AND level = 'manage'`
-- check further down, so downgrading it would silently kill AI Assistant for
-- Owner, Manager, Operations Manager and Operations Manager (Collaborator).
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'dashboard', 'view'
FROM public.role_areas ra
WHERE ra.area_key = 'reports'
ON CONFLICT (role_id, area_key) DO NOTHING;

-- scheduling:manage -> manage on time_punches and tips. scheduling:view
-- fans out to nothing: today a view-level holder reaches neither page.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, page.area_key, 'manage'
FROM public.role_areas ra
CROSS JOIN LATERAL (VALUES ('time_punches'), ('tips')) AS page(area_key)
WHERE ra.area_key = 'scheduling' AND ra.level = 'manage'
ON CONFLICT (role_id, area_key) DO UPDATE SET level = 'manage';

-- inventory:manage -> inventory_audit:manage. inventory:view fans out to
-- nothing (/inventory-audit is manage-gated today).
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'inventory_audit', 'manage'
FROM public.role_areas ra
WHERE ra.area_key = 'inventory' AND ra.level = 'manage'
ON CONFLICT (role_id, area_key) DO UPDATE SET level = 'manage';

-- recipes -> prep_recipes at the same level.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'prep_recipes', ra.level
FROM public.role_areas ra
WHERE ra.area_key = 'recipes'
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level
  WHERE public.role_areas.level = 'view' AND EXCLUDED.level = 'manage';

-- The five new areas (ops_inbox, weekly_brief, budget, labor,
-- stripe_account) intentionally receive NO rows. They are grantable from
-- now on; nobody holds them on deploy day.

DELETE FROM public.role_areas  WHERE area_key = 'books';
DELETE FROM public.area_catalog WHERE area_key = 'books';
```

`ON CONFLICT … DO UPDATE … WHERE level = 'view' AND EXCLUDED.level = 'manage'` is the "higher level wins" rule. A plain `DO NOTHING` would let whichever statement ran first pin a row at `view` that another source wanted at `manage`.

- [ ] **Step 4: Rewrite `user_has_capability`'s map and the one hardcoded special case**

Copy the entire function body from `supabase/migrations/20260804100000_reviews_area.sql` as the starting point. Three edits, nothing else:

1. **The `view:financial_intelligence` special case re-points.** It currently reads `ra.area_key = 'books'` — the key being retired. Left alone it would reference a key with no catalog row and no grants, silently denying Financial Intelligence to everyone:

```sql
  IF p_capability = 'view:financial_intelligence' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.role_areas ra
      WHERE ra.role_id = v_role_id
        AND ra.area_key = 'financial_intelligence'   -- was 'books'
        AND ra.level IN ('view', 'manage')
    );
  END IF;
```

2. **`view:ai_assistant` stays byte-for-byte unchanged** (`area_key = 'reports' AND level = 'manage'` — both survive). So do `manage:subscription`, the three sensitive-flag branches, and the entire legacy `v_role_id IS NULL` CASE.

3. **The VALUES map re-points its second column.** Every row keeps its `required_level` except these four, which move down a tier because the *area* moved and the new area is held by exactly the roles that held the old bundle at the higher tier:

```sql
  ('view:tips',            'tips',            'view'),   -- was ('scheduling','manage')
  ('edit:tips',            'tips',            'manage'),
  ('view:time_punches',    'time_punches',    'view'),   -- was ('scheduling','manage')
  ('edit:time_punches',    'time_punches',    'manage'),
  ('view:inventory_audit', 'inventory_audit', 'view'),   -- was ('inventory','manage')
  ('edit:inventory_audit', 'inventory_audit', 'manage'),
  ('view:pending_outflows','print_checks',    'view'),   -- was ('books','view')
  ('edit:pending_outflows','print_checks',    'manage'),
```

The rest re-point mechanically: `('view:invoices','invoices','view')`, `('edit:invoices','invoices','manage')`, `('view:banking','banking','view')`, and so on for `transactions`, `expenses`, `customers`, `assets`, `financial_statements`, `prep_recipes`. Four capabilities keep bundle homes on purpose (spec §3.2): `view:batches`/`edit:batches` stay on `recipes`, `view:inventory_transactions`/`edit:inventory_transactions` and `view:receipt_import`/`edit:receipt_import` stay on `inventory`. `view:dashboard` moves to `('view:dashboard','dashboard','view')`; `view:reports` stays `('view:reports','reports','view')`.

Then re-enable the guard and update the column comment:

```sql
ALTER TABLE public.role_areas ENABLE TRIGGER role_areas_block_builtin_mutation;

COMMENT ON COLUMN public.area_catalog.area_key IS
  'Stable key joined by role_areas and by user_has_capability''s VALUES map. One key per gateable sidebar page: 33 keys across the 5 sidebar ui_groups.';
```

- [ ] **Step 5: Apply it**

Run: `npm run db:reset`
Expected: every migration applies, exit 0, no 42501 and no FK violation. If it fails on `role_areas_block_builtin_mutation`, the DISABLE is in the wrong place. If it fails on a FK, a `DELETE FROM area_catalog` ran before its `role_areas` rows were gone.

Then confirm the guard came back on — the failure this whole ordering exists to avoid:

```bash
npx supabase db execute --local "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%block_builtin%' OR tgname LIKE '%collaborator_cap%' ORDER BY tgname;"
```
Expected: every row `tgenabled = O`. Any `D` means the migration left a guard disabled.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805120000_page_areas.sql
git commit -m "feat(permissions): re-cut area_catalog to one area per sidebar page

33 page-shaped keys across the 5 sidebar groups replace 15 bundle-shaped
ones. role_areas rows fan out mechanically so no role gains or loses a
capability; books:view deliberately skips print_checks, the one books path
gated at manage. view:financial_intelligence's hardcoded area_key
re-points off the retiring 'books' key.

The builtin-mutation guard comes off for the rewrite and back on at the
end — see the header for why that ordering is forced."
```

---

### Task 3: pgTAP — prove nobody's capabilities moved

The load-bearing task. If this is green, the migration is behaviour-preserving; if it is not, nothing downstream matters.

**Files:**
- Create: `supabase/tests/page_areas_catalog_test.sql`
- Modify: `supabase/tests/roles_seed_test.sql`, `supabase/tests/user_has_capability_areas_test.sql`

**Interfaces:**
- Consumes: Task 2's `area_catalog`, `role_areas`, `user_has_capability`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the catalog-shape test, and run it to watch it fail**

Write `supabase/tests/page_areas_catalog_test.sql` covering, at minimum:

```sql
BEGIN;
SELECT plan(9);

SELECT is((SELECT count(*)::int FROM public.area_catalog), 33,
  'area_catalog has one row per gateable sidebar page');

SELECT is((SELECT count(DISTINCT ui_group)::int FROM public.area_catalog), 5,
  'five ui_groups, matching the sidebar');

SELECT is((SELECT array_agg(DISTINCT ui_group ORDER BY ui_group) FROM public.area_catalog),
  ARRAY['Accounting','Admin','Inventory','Main','Operations'],
  'ui_groups are the sidebar group labels verbatim');

SELECT is((SELECT count(*)::int FROM (
    SELECT ui_group, sort_order FROM public.area_catalog
    GROUP BY ui_group, sort_order HAVING count(*) > 1) dupes), 0,
  'sort_order is unique within each ui_group');

SELECT ok((SELECT bool_and(max_level_collaborator IS NULL)
           FROM public.area_catalog WHERE area_key IN ('team','collaborators')),
  'team and collaborators stay ungrantable to any collaborator role');

SELECT is((SELECT count(*)::int FROM public.area_catalog WHERE area_key = 'books'), 0,
  'the books bundle is retired');

SELECT ok((SELECT bool_and(max_level_collaborator = 'view') FROM public.area_catalog
           WHERE area_key IN ('dashboard','sales','ops_inbox','weekly_brief','labor',
                              'budget','stripe_account','financial_statements',
                              'financial_intelligence')),
  'read-only pages are capped at view');

-- The silent-failure guard. A migration that errors between DISABLE and
-- ENABLE leaves privilege-escalation protection off in production with no
-- other symptom, so it gets its own assertion rather than being folded in.
SELECT is((SELECT count(*)::int FROM pg_trigger
           WHERE tgname IN ('role_areas_block_builtin_mutation',
                            'role_flags_block_builtin_mutation',
                            'role_areas_enforce_collaborator_cap',
                            'roles_block_builtin_mutation')
             AND tgenabled = 'O'), 4,
  'all four builtin/collaborator guards are enabled after migration');

SELECT is((SELECT count(*)::int FROM public.role_areas ra
           LEFT JOIN public.area_catalog ac USING (area_key)
           WHERE ac.area_key IS NULL), 0,
  'no orphaned role_areas rows');

SELECT * FROM finish();
ROLLBACK;
```

Before writing it, confirm the four trigger names against `20260730100000_roles_and_areas_tables.sql` — if a name differs, the count assertion passes vacuously at 4 only by luck, and wrong names would make it fail loudly, which is the desired direction. Do not weaken it to `>= 1`.

Run: `npm run test:db`
Expected at this point: PASS for the new file (Task 2 already applied). If the trigger assertion fails, stop and fix Task 2's migration — do not adjust the assertion.

- [ ] **Step 2: Re-derive `roles_seed_test.sql`'s fixture**

`supabase/tests/roles_seed_test.sql` builds `test_area_capability_at_level` — an (area_key, level) → capability table — and asserts, for each of the ten builtins and in both directions, that expanding its `role_areas` reproduces `ROLE_CAPABILITIES` exactly. **`test_expected_capabilities` does not change.** It is the fixed point; changing it would defeat the entire proof.

Re-derive `test_area_capability_at_level` for the 33 areas, mirroring Task 2 Step 4's map. For example, where it had:

```sql
  ('books', 'view',   'view:invoices'),
  ('books', 'manage', 'edit:invoices'),
```

it now has:

```sql
  ('invoices', 'view',   'view:invoices'),
  ('invoices', 'manage', 'edit:invoices'),
```

and where it had `('scheduling','manage','view:tips')` it now has `('tips','view','view:tips')`. Bump `SELECT plan(N)` only if you add assertions; the ten per-role round-trips stay as they are.

Run: `npm run test:db`
Expected: PASS, all ten roles round-trip in both directions.

A failure here names the role and the direction. "Role X is missing capability Y" means Task 2's fan-out dropped a row; "Role X has unexpected capability Y" means it fanned out too far — most likely the `books:view` → `print_checks` skip, or `reports` losing its `manage` level.

- [ ] **Step 3: Extend the capability-resolution test**

In `supabase/tests/user_has_capability_areas_test.sql`, add assertions that:

- `view:financial_intelligence` resolves true for a role granted `financial_intelligence: 'view'` and false for one granted only `transactions: 'view'` — this is the re-pointed hardcoded branch, and nothing else covers it.
- `view:ai_assistant` still resolves true for `reports: 'manage'` and false for `reports: 'view'`.
- `role_areas_enforce_collaborator_cap` still raises 42501 for a collaborator-flavored role granted `team` at any level, and for one granted `manage` on a view-capped page (use `financial_statements`).
- `view:tips` resolves true for `tips: 'view'` — the tier that moved.

Bump `plan(N)` to match.

Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/page_areas_catalog_test.sql supabase/tests/roles_seed_test.sql supabase/tests/user_has_capability_areas_test.sql
git commit -m "test(permissions): prove the page-area re-cut preserves every role

Per-role, both-directions round trip against the untouched
ROLE_CAPABILITIES transcription, plus catalog shape and an explicit
assertion that all four builtin guards are enabled after the migration's
DISABLE/ENABLE window."
```

---

### Task 4: `areas.ts` — the client mirror

**Files:**
- Modify: `src/lib/permissions/areas.ts`
- Test: `tests/unit/areas.test.ts`

**Interfaces:**
- Consumes: `navigationGroups` from `@/components/AppSidebar.nav.data` (Task 1).
- Produces: `type AreaKey` (33 members); `type AreaLevel`; `interface PageArea { key: AreaKey; path: string; hasManageTier: boolean; maxLevelForCollaborator: AreaLevel | null; navLabel?: string; hint: string; manageHint?: string }`; `const PAGE_AREAS: readonly PageArea[]`; `const AREA_DEFINITIONS: readonly AreaDefinition[]` where `AreaDefinition = PageArea & { label: string; uiGroup: string; sortOrder: number; icon: LucideIcon }`; `expandAreas`, `grantMap`, `landingAreaKey`, `resolveLandingPath`, `AREA_LANDING_PATHS`, `AREA_PRIORITY`, `SENSITIVE_FLAGS` all keep their existing signatures. `Band` and `AreaGroupKey` are **deleted**.

- [ ] **Step 1: Write the failing drift-alarm test**

Add to `tests/unit/areas.test.ts`:

```ts
import { navigationGroups } from '@/components/AppSidebar.nav.data';
import { AREA_DEFINITIONS, PAGE_AREAS, UNIVERSAL_PATHS_FOR_TEST } from '@/lib/permissions/areas';

describe('areas.ts derives from the sidebar', () => {
  it('has exactly one area per gateable sidebar page — the drift alarm', () => {
    const navPaths = navigationGroups
      .flatMap((g) => g.items.map((i) => i.path))
      .filter((p) => p !== '/help');
    const areaPaths = PAGE_AREAS.map((a) => a.path);

    // Every sidebar page is grantable. A page added to AppSidebar.nav.data.ts
    // with no PAGE_AREAS entry fails here rather than becoming silently
    // ungrantable — which is how /budget, /labor, /stripe-account,
    // /ops-inbox and /weekly-brief went unreachable for a year.
    for (const path of navPaths) {
      expect(areaPaths).toContain(path);
    }

    // And nothing is grantable that is not a sidebar page. `/team` carries
    // two areas (team + collaborators), so compare as sets.
    expect(new Set(areaPaths)).toEqual(new Set(navPaths));
  });

  it('groups and orders areas exactly as the sidebar does', () => {
    const navGroupLabels = navigationGroups.map((g) => g.label);
    const defGroupLabels = [...new Set(AREA_DEFINITIONS.map((d) => d.uiGroup))];
    expect(defGroupLabels).toEqual(navGroupLabels);
  });

  it('locks manage on pages with no edit capability', () => {
    const readOnly = ['dashboard', 'sales', 'ops_inbox', 'weekly_brief', 'labor',
                      'budget', 'stripe_account', 'financial_statements',
                      'financial_intelligence'];
    for (const key of readOnly) {
      expect(PAGE_AREAS.find((a) => a.key === key)?.hasManageTier).toBe(false);
    }
  });

  it('keeps team and collaborators ungrantable to collaborator roles', () => {
    for (const key of ['team', 'collaborators'] as const) {
      expect(PAGE_AREAS.find((a) => a.key === key)?.maxLevelForCollaborator).toBeNull();
    }
  });
});
```

Run: `npx vitest run tests/unit/areas.test.ts --reporter=line`
Expected: FAIL — `PAGE_AREAS` is not exported.

- [ ] **Step 2: Rewrite `areas.ts`**

Replace the `AreaKey` union with the 33 keys from *The 33 keys*. Replace `AREA_CAPABILITIES` with one entry per page — mechanically the inverse of Task 2 Step 4's VALUES map. The four bundle-retaining entries from spec §3.2:

```ts
  recipes: {
    view: ['view:recipes', 'view:batches'],
    manageAdds: ['edit:recipes', 'edit:batches'],
  },
  prep_recipes: {
    view: ['view:prep_recipes'],
    manageAdds: ['edit:prep_recipes'],
  },
  inventory: {
    view: ['view:inventory'],
    manageAdds: [
      'edit:inventory',
      'view:receipt_import', 'edit:receipt_import',
      'view:inventory_transactions', 'edit:inventory_transactions',
    ],
  },
  inventory_audit: {
    view: ['view:inventory_audit'],
    manageAdds: ['edit:inventory_audit'],
  },
  print_checks: {
    view: ['view:pending_outflows'],
    manageAdds: ['edit:pending_outflows'],
  },
  reports: {
    view: ['view:reports'],
    manageAdds: ['view:ai_assistant'],   // manage on Reports means "and the AI assistant"
  },
  dashboard: {
    view: ['view:dashboard'],
    manageAdds: [],
  },
```

Declare `PAGE_AREAS` with permission metadata only (key, path, `hasManageTier`, `maxLevelForCollaborator`, `hint`, optional `manageHint`, optional `navLabel`). Source the per-page `hint`/`manageHint` copy from the mockup, `docs/design-reference/permissions-menu-mirror.html:415-468` — it is already authored there per page; do not re-invent it. Two entries need `navLabel` because they share `/team`:

```ts
  { key: 'team',          path: '/team', navLabel: 'Team members', … },
  { key: 'collaborators', path: '/team', navLabel: 'Collaborators', … },
```

Then derive `AREA_DEFINITIONS` by walking `navigationGroups` in order and, for each item, emitting every `PAGE_AREAS` entry whose `path` matches — taking `label` (unless `navLabel` overrides), `icon`, `uiGroup` and a 1-based `sortOrder` within the group from the nav. Skip `/help`.

Derive `AREA_LANDING_PATHS` from `PAGE_AREAS` (`key → path`) and `AREA_PRIORITY` from `AREA_DEFINITIONS`' order, rather than hand-maintaining two more 33-entry literals.

`SENSITIVE_FLAGS[].requires` keeps its existing keys — `inventory`, `recipes`, `reports`, `employees`, `scheduling` all survive the re-cut, so no change is needed there.

Delete `Band` and `AreaGroupKey`. Rewrite the file header: it currently says "fourteen", "Ten rows in the editor", and cites the superseded `20260730140000` migration at lines 10-28. Point it at `20260805120000_page_areas.sql` and describe the join-against-nav derivation.

Run: `npx vitest run tests/unit/areas.test.ts --reporter=line`
Expected: PASS.

- [ ] **Step 3: Let the compiler find the rest**

Run: `npm run typecheck`
Expected: errors in `preview.ts`, `RoleEditor.tsx`, `RolePreviewPanel.tsx` and their tests, from the deleted `Band`/`AreaGroupKey` and the changed `AreaKey` members. That list is the exact remaining work for Tasks 5–7. Record it; do not fix it here.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions/areas.ts tests/unit/areas.test.ts
git commit -m "feat(permissions): one client area per sidebar page, derived from nav

AREA_DEFINITIONS stops being a hand-kept list: permission metadata is
declared per page in PAGE_AREAS and joined against navigationGroups for
label, icon, group and order. A sidebar page with no PAGE_AREAS entry now
fails a test instead of becoming silently ungrantable."
```

Typecheck is red between here and Task 7 — expected, and the reason this plan does not run `npm run build` until Task 7.

---

### Task 5: `routeAreas.ts` — derive the route map

**Files:**
- Modify: `src/lib/permissions/routeAreas.ts`
- Test: `tests/unit/routeAreas.test.ts`

**Interfaces:**
- Consumes: `PAGE_AREAS`, `AREA_PRIORITY`, `AREA_LANDING_PATHS` from Task 4.
- Produces: `AREA_ROUTES`, `UNIVERSAL_PATHS`, `COLLABORATOR_PATH_EXCLUSIONS`, `allowedPathsForAreas`, `customCollaboratorRoutes` — all unchanged in signature.

- [ ] **Step 1: Update the calibration fixture and watch it fail**

`tests/unit/routeAreas.test.ts`'s `SEEDED_COLLABORATOR_AREAS` transcribes each builtin collaborator's seeded grants. Re-transcribe to post-migration values — these must match Task 2's fan-out exactly. Accountant, for instance, held `books: 'manage'`:

```ts
  collaborator_accountant: {
    transactions: 'manage', banking: 'manage', expenses: 'manage',
    invoices: 'manage', customers: 'manage', assets: 'manage',
    print_checks: 'manage', financial_statements: 'manage',
    financial_intelligence: 'manage',
    chart_of_accounts: 'manage', payroll: 'view', employees: 'view',
    settings: 'view',
  },
```

The assertion itself does not change: `allowedPathsForAreas(grants)` sorted must equal `COLLABORATOR_ROUTES[role].allowed` sorted, for all four builtin collaborators.

Run: `npx vitest run tests/unit/routeAreas.test.ts --reporter=line`
Expected: FAIL — the fixture references keys `AREA_ROUTES` does not yet map.

- [ ] **Step 2: Derive `AREA_ROUTES`**

```ts
/**
 * Path -> (area, level), derived from the catalog. One row per page area,
 * in sidebar order, plus the one path that has an area but no menu entry.
 *
 * Every route is `minLevel: 'view'` — the level a page needs to be *opened*.
 * Before the per-page re-cut, /tips, /time-punches, /inventory-audit and
 * /print-checks were gated at `manage` because they rode inside a coarser
 * bundle; now each is its own area, so "can open it" is exactly "holds it".
 */
export const AREA_ROUTES: readonly AreaRoute[] = [
  ...AREA_DEFINITIONS.map((d) => ({ path: d.path, area: d.key, minLevel: 'view' as const })),
  // Not a navigationGroups item — owners reach it from inside Inventory —
  // so it has no catalog row and keeps its explicit mapping (spec §3.2).
  { path: '/receipt-import', area: 'inventory' as const, minLevel: 'manage' as const },
];
```

`UNIVERSAL_PATHS` and `COLLABORATOR_PATH_EXCLUSIONS` keep their current values verbatim. `satisfies`, `allowedPathsForAreas` and `customCollaboratorRoutes` keep their current bodies unchanged.

Replace the header's "Deliberately unmapped" paragraph (lines 19-22) — it is now false, those five pages have areas. State instead that they are mapped but unheld: no role has a grant for them until an owner makes one.

- [ ] **Step 3: Run the calibration**

Run: `npx vitest run tests/unit/routeAreas.test.ts --reporter=line`
Expected: PASS for all four builtin collaborators.

A diff here is a genuine access change, not a test to adjust. Extra path → the fan-out granted too much; missing path → too little. Both are Task 2 bugs.

Note the interaction to expect on Accountant: `/print-checks` is in its hand-written allow-list and it held `books: 'manage'`, so the fan-out gives it `print_checks: 'manage'` and the path stays. Inventory Helper held `inventory: 'manage'`, so `/inventory-audit` and `/receipt-import` both stay reachable.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions/routeAreas.ts tests/unit/routeAreas.test.ts
git commit -m "feat(permissions): derive AREA_ROUTES from the page catalog

Near-identity now that areas are pages. The four builtin collaborators'
hand-written allow-lists still reproduce exactly from their seeded grants."
```

---

### Task 6: `preview.ts` and the preview panel

**Files:**
- Modify: `src/lib/permissions/preview.ts`, `src/components/roles/RolePreviewPanel.tsx`
- Test: `tests/unit/RolePreviewPanel.test.tsx`

**Interfaces:**
- Consumes: `AREA_DEFINITIONS` (Task 4).
- Produces: `buildNavPreview(grants)` returning `NavPreviewGroup[]` where `label` is now the sidebar group label; `buildSummary(grants)` unchanged in signature.

- [ ] **Step 1: Rewrite the panel test**

`tests/unit/RolePreviewPanel.test.tsx:63-68` currently asserts *"strikes through and dims a nav item whose area is not granted"*. "A literal render of the sidebar this role will get" means ungranted pages are **absent**. Replace that test — do not add alongside it:

```ts
  it('omits pages the role cannot reach, rather than decorating them', () => {
    render(<RolePreviewPanel grants={{ invoices: 'manage' }} flags={[]} flavor="platform" />);

    expect(screen.getByText('Invoices')).toBeInTheDocument();
    // Banking rode in the same `books` bundle before the re-cut. Granting
    // Invoices alone must no longer imply it — and it is absent, not struck.
    expect(screen.queryByText('Banks')).not.toBeInTheDocument();
  });

  it('groups the preview by sidebar group, not by the retired bands', () => {
    render(<RolePreviewPanel grants={{ invoices: 'manage', tips: 'view' }} flags={[]} flavor="platform" />);

    expect(screen.getByText('Accounting')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.queryByText('Money & Books')).not.toBeInTheDocument();
  });
```

Check the component's actual prop names before writing this — read `RolePreviewPanel.tsx`'s signature rather than trusting the shape above.

Run: `npx vitest run tests/unit/RolePreviewPanel.test.tsx --reporter=line`
Expected: FAIL.

- [ ] **Step 2: Regroup and drop the strike-through**

In `preview.ts`, `buildNavPreview` groups by `row.band` at lines 180-183. Change the grouping key to the definition's `uiGroup`, and iterate `AREA_DEFINITIONS` in its (now sidebar) order so groups come out in sidebar order. Drop ungranted items from `group.items` instead of emitting them with a falsy level, and drop groups that end up empty.

Delete `PHRASE` (lines 106-118 — keyed by the deleted `AreaGroupKey`) and read each page's `hint`/`manageHint` off its `AREA_DEFINITIONS` row instead. Rewrite `buildSummary`'s "can't touch" branch (lines 151-159): it hardcodes four bundle categories that no longer exist. Summarise per sidebar group — "Accounting: 3 of 12 pages" — which is also the shape PR 2's roll-up header needs.

In `RolePreviewPanel.tsx`, remove the strike-through/dim styling path for ungranted items; it now has nothing to render.

Run: `npx vitest run tests/unit/RolePreviewPanel.test.tsx --reporter=line`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions/preview.ts src/components/roles/RolePreviewPanel.tsx tests/unit/RolePreviewPanel.test.tsx
git commit -m "feat(permissions): preview renders the sidebar the role actually gets

Grouped by sidebar ui_group rather than the retired bands, and ungranted
pages are absent rather than struck through — a literal preview, not a
decorated full menu."
```

---

### Task 7: `RoleEditor` — 33 rows under five headings

Deliberately minimal. Collapsible groups and roll-up controls are PR 2; this task only keeps the editor correct and functional against the new model.

**Files:**
- Modify: `src/components/roles/RoleEditor.tsx`
- Test: `tests/unit/RoleEditor.test.tsx`

**Interfaces:**
- Consumes: `AREA_DEFINITIONS` (Task 4).
- Produces: no new exports.

- [ ] **Step 1: Rewrite the row-count assertions**

`tests/unit/RoleEditor.test.tsx:186-203` pins "ten area rows as RadioGroups". Replace with:

```ts
  it('renders one row per gateable page, grouped by sidebar group', () => {
    renderEditor();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(33);
    for (const label of ['Main', 'Operations', 'Inventory', 'Accounting', 'Admin']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('grants a single page without its former bundle-mates', async () => {
    const onChange = vi.fn();
    renderEditor({ onChange });

    await userEvent.click(within(rowFor('Invoices')).getByRole('radio', { name: /manage/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ invoices: 'manage' })
    );
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ banking: expect.anything() })
    );
  });

  it('locks Manage on a page with no edit capability', () => {
    renderEditor();
    expect(within(rowFor('Statements')).getByRole('radio', { name: /manage/i }))
      .toBeDisabled();
  });
```

Write `rowFor(label)` as a local helper resolving the row container from its visible page label. Read the existing test file's helpers first and reuse them where they fit.

Run: `npx vitest run tests/unit/RoleEditor.test.tsx --reporter=line`
Expected: FAIL.

- [ ] **Step 2: Render from `AREA_DEFINITIONS`**

Delete `AREA_HINT` and `AREA_LOCK_REASON` (both keyed by the deleted `AreaGroupKey`); read `hint`/`manageHint` off the definition row. Group rows under a heading per `uiGroup`, in `AREA_DEFINITIONS` order.

Keep `LevelControl` (`RoleEditor.tsx:284-334`) exactly as it is — a Radix `RadioGroupPrimitive.Root` per page row is correct and stays correct in PR 2. Disable the Manage segment when `!definition.hasManageTier`, and cap the whole control per `maxLevelForCollaborator` when the role's flavor is `collaborator`, exactly as the current code caps per area.

Styling per CLAUDE.md: group headings `text-[12px] font-medium text-muted-foreground uppercase tracking-wider`, row labels `text-[14px] font-medium text-foreground`, hints `text-[13px] text-muted-foreground`. Semantic tokens only. Every control keeps an accessible name — with 33 rows, a radio labelled only "Manage" is ambiguous, so the row's `RadioGroup` needs `aria-label={`${label} access level`}`.

Run: `npx vitest run tests/unit/RoleEditor.test.tsx --reporter=line`
Expected: PASS.

- [ ] **Step 3: Whole suite green, and the build compiles**

Run: `npm run typecheck`
Expected: exit 0. Every error recorded in Task 4 Step 3 should now be resolved.

Run: `npm run lint`
Expected: exit 0.

Run: `npx vitest run --reporter=line` (timeout: 600000)
Expected: PASS. Any failure outside the files this plan touched is a real regression — investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/components/roles/RoleEditor.tsx tests/unit/RoleEditor.test.tsx
git commit -m "feat(permissions): editor renders one row per page under five headings

Flat list for now — collapsible groups and roll-up controls are PR 2.
Manage locks itself from the catalog's hasManageTier rather than from a
hand-kept map."
```

---

### Task 8: The Accountant's dead `/budget` link

Spec §7.1, recommendation (b). `collaboratorAccountantNav` renders a Budget & Run Rate link that `COLLABORATOR_ROUTES.collaborator_accountant.allowed` does not permit, so `StaffRoleChecker` bounces every Accountant off it. Removing the link fixes the defect without granting anyone anything, keeping "nobody gains access on deploy day" literally true. An owner who wants it can now grant `budget` through the editor — which is the point of the change.

**Files:**
- Modify: `src/components/AppSidebar.nav.ts`
- Test: `tests/unit/AppSidebar.nav.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('does not offer the accountant a page it will bounce them off', () => {
    const paths = collaboratorAccountantNav.flatMap((g) => g.items.map((i) => i.path));
    const allowed = new Set(COLLABORATOR_ROUTES.collaborator_accountant.allowed);
    const universal = new Set(UNIVERSAL_PATHS);

    for (const path of paths) {
      expect(allowed.has(path) || universal.has(path)).toBe(true);
    }
  });
```

Import `COLLABORATOR_ROUTES` from `@/App` if it is exported; if it is not, export it (a named export beside the existing declaration at `src/App.tsx:200` — no behaviour change) rather than re-typing the list in the test. A second transcription of an allow-list is exactly the drift this plan exists to remove.

Run: `npx vitest run tests/unit/AppSidebar.nav.test.ts --reporter=line`
Expected: FAIL on `/budget`.

- [ ] **Step 2: Remove the link**

Delete `{ path: '/budget', label: 'Budget & Run Rate', icon: Target }` from `collaboratorAccountantNav` (`src/components/AppSidebar.nav.ts:120`). Drop `Target` from that file's icon import if nothing else uses it — `npm run typecheck` and `npm run lint` will say.

Run: `npx vitest run tests/unit/AppSidebar.nav.test.ts --reporter=line`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppSidebar.nav.ts src/App.tsx tests/unit/AppSidebar.nav.test.ts
git commit -m "fix(nav): stop offering the accountant a Budget link that bounces them

collaboratorAccountantNav rendered /budget; COLLABORATOR_ROUTES never
allowed it. Removes the dead link rather than granting the page, so no
existing collaborator's access changes. Owners can now grant Budget
explicitly through the role editor.

Adds a test asserting every collaborator nav path is actually reachable,
so the next such mismatch fails instead of shipping."
```

---

### Task 9: E2E — the user's own scenario, end to end

Phase 8 treats this as a hard gate: user-facing behaviour changes across a cross-layer seam, so it is Covered, not excepted.

**Files:**
- Modify: `tests/e2e/roles-and-areas.spec.ts`

- [ ] **Step 1: Write the spec**

Read the file's existing setup helpers first and reuse them — `generateTestUser()`, the `'../helpers/e2e-supabase'` imports, and whatever role-creation helper already exists. Then add:

```ts
test('an owner can grant Invoices without granting Banking', async ({ page }) => {
  // The literal complaint: "I am expecting to be able to set permissions for
  // tip pooling, invoices, and other individual pages."
  await page.goto('/team');
  await page.getByRole('button', { name: /new role/i }).click();
  await page.getByLabel(/role name/i).fill('Invoices only');

  await page.getByRole('radiogroup', { name: /invoices access level/i })
            .getByRole('radio', { name: /manage/i }).click();

  const preview = page.getByTestId('role-preview');
  await expect(preview.getByText('Invoices')).toBeVisible();
  await expect(preview.getByText('Banks')).toBeHidden();

  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText('Invoices only')).toBeVisible();

  // Reopen: the grant persisted as one page, not a bundle.
  await page.getByText('Invoices only').click();
  await expect(
    page.getByRole('radiogroup', { name: /invoices access level/i })
        .getByRole('radio', { name: /manage/i })
  ).toBeChecked();
  await expect(
    page.getByRole('radiogroup', { name: /banks access level/i })
        .getByRole('radio', { name: /no access/i })
  ).toBeChecked();
});
```

Accessible selectors only (`getByRole`, `getByLabel`) per CLAUDE.md. Adjust names to whatever the editor actually renders — run once and read the failure.

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/roles-and-areas.spec.ts --reporter=line` (timeout: 600000)
Expected: PASS.

Run it in the **foreground** and let the Bash tool's `timeout` bound it. Do not background it and poll; do not `grep -c` for a process name. If a dev server is needed underneath, trap it so it dies with the shell on the failure path too:

```bash
npm run dev & pid=$!
trap 'kill $pid 2>/dev/null' EXIT
npx playwright test tests/e2e/roles-and-areas.spec.ts --reporter=line
```

- [ ] **Step 3: Full suite, then commit**

Run: `npm run test:all` (timeout: 600000)
Expected: PASS — unit, pgTAP and E2E.

```bash
git add tests/e2e/roles-and-areas.spec.ts
git commit -m "test(e2e): grant Invoices without Banking, save, reopen

The user's literal complaint, end to end across editor, preview, RPC and
RLS."
```

---

## Self-Review

**Spec coverage.** §3.1 catalog → Tasks 2, 4. §3.2 four exceptions → Task 2 Step 4 and Task 4 Step 2 (batches/inventory_transactions/receipt_import stay bundled; pending_outflows moves to print_checks; collaborators is a second `/team` row via `navLabel`). §3.3 levels and caps → Task 2 Step 2, Task 3 Step 1, Task 4 Step 1. §3.4 five capability-less areas → Task 2 Step 3 (no rows) and Task 5 (mapped, unheld). §3.5 module changes → Tasks 4–7. §4.0 migration mechanics → Task 2. §4.1 fan-outs → Task 2 Step 3. §5 testing → Tasks 3, 4, 5, 6, 7, 9. §7.1 → Task 8. §7.2 (fully per-page) is what the whole plan implements. §7.3 sensitive flags unchanged — confirmed in Task 4 Step 2, `SENSITIVE_FLAGS.requires` keys all survive.

**§3.6 is not in this plan.** The roll-up interaction model — `role="group"` plus command buttons, mixed-group default expansion, `.ghead` wrapping at ≤640px — is PR 2 by spec §6. Task 7 deliberately ships a flat list. This is the one spec section with no task here, and that is by design, not a gap.

**Gap the spec did not cover, found while planning:** the import cycle. `areas.ts` deriving from `navigationGroups` would have crashed at import time, because `AppSidebar.nav.ts` already imports `routeAreas.ts` → `areas.ts`. Task 1 exists for that and has no spec section behind it.

**Placeholder scan.** No TBDs. Three steps say "read the existing file first and reuse its helpers" (Task 6 Step 1, Task 7 Step 1, Task 9 Step 1) — that is a real instruction with a concrete object, not a deferral, and the code to write is shown in each case.

**Type consistency.** `PAGE_AREAS` / `AreaDefinition.uiGroup` / `hasManageTier` / `maxLevelForCollaborator` / `navLabel` are named identically in Tasks 4, 5, 6 and 7. `AREA_ROUTES` keeps `{ path, area, minLevel }` from the current `AreaRoute` interface, so `allowedPathsForAreas` needs no change. `expandAreas(grants, flags)` keeps its signature, so `usePermissions.ts` and the invite picker are untouched.

---

## Risk notes for the implementer

**The migration is the whole risk.** Tasks 4–9 are recoverable by editing a file. Task 2 rewrites every builtin role's grants behind a disabled privilege guard. If Task 3's per-role round-trip is not green, do not proceed — and do not adjust `test_expected_capabilities` to make it green. That table is the fixed point the entire change is proved against; editing it converts a real regression into a passing test.

**`npm run db:reset` is destructive to local data only.** It targets the local Supabase at `127.0.0.1:54321`. Nothing in this plan touches production. The `supabase-prod` MCP server is read-only and is not used here.

**Expected-red windows.** Typecheck is red from Task 4 Step 3 through Task 7 Step 3. That is the compiler enumerating the work, not a broken build. Do not commit a green typecheck by loosening types.
