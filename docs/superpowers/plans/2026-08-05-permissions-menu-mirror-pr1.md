# Permissions menu-mirror, PR 1 (the model) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-cut `area_catalog` from 15 bundle-shaped keys to 33 page-shaped keys grouped by the app's own sidebar, so Tip Pooling and Invoices become independently grantable — with no role gaining or losing a capability on deploy.

**Architecture:** The capability vocabulary in `user_has_capability` is already page-shaped (`view:invoices`, `view:tips`); only the `area_key` column bundles. So this is a re-point of one column plus a mechanical fan-out of `role_areas` rows, not an enforcement redesign. On the client, permission metadata is declared per page in `areas.ts` and *joined* against `navigationGroups` for label/icon/group/order, so a page added to the sidebar without a permission fails a test instead of silently becoming ungrantable.

**Tech Stack:** Postgres 15 (Supabase), pgTAP, TypeScript 5, React 18, Vitest + jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md` (same branch, commit `d4659412`). Read §3.1, §3.2, §4.0 and §4.1 before Task 2.

## Global Constraints

- **Scope is PR 1 only** — the model. Collapsible groups, roll-up tri-state controls and the sidebar-literal preview panel are PR 2 (spec §6). `RoleEditor` here renders a flat list of 33 rows under five sidebar-named headings; it is kept correct, not restyled.
- **Nobody gains or loses access on deploy.** Every task that could change a role's effective capability set is proved by an exhaustive per-role, both-directions assertion.
- **`AreaKey` stays an explicit TypeScript union.** It is the contract with SQL. Never widen it to `string`.
- Work happens in the worktree `.claude/worktrees/permissions-menu-mirror` on branch `feature/permissions-menu-mirror`. Every `git` and `npm` invocation runs with that as the working directory.
- Migration filename must sort after `20260804100000_reviews_area.sql`. Use `20260805120000_page_areas.sql`.
- CLAUDE.md's repo-wide rules apply as always (semantic color tokens, React Query only, `aria-label` on textless controls, foreground test runs bounded by the Bash tool's `timeout`, explicit paths in every `git add`).

---

## File Structure

**Created:**
- `src/components/AppSidebar.nav.data.ts` — leaf module: `NavItem`, `NavGroup`, `navigationGroups`, `SUPPLEMENTAL_NAV_ITEMS`. Zero imports from `@/lib/permissions`.
- `supabase/migrations/20260805120000_page_areas.sql` — catalog expansion, `role_areas` fan-out, `user_has_capability` rewrite.
- `supabase/tests/page_areas_catalog_test.sql` — catalog shape.

**Modified:**
- `src/components/AppSidebar.nav.ts` — nav data moves out; re-exports it. Dead `/budget` link removed.
- `src/lib/permissions/areas.ts` — 33-key union, per-page capability bundles, `AREA_DEFINITIONS` derived.
- `src/lib/permissions/routeAreas.ts` — `AREA_ROUTES` derived from the catalog.
- `src/lib/permissions/preview.ts` — group by `uiGroup` instead of `band`; per-page hint copy.
- `src/components/roles/RoleEditor.tsx` — 33 rows under five headings; `AREA_HINT`/`AREA_LOCK_REASON` deleted.
- `src/components/roles/RolePreviewPanel.tsx` — ungranted pages absent, not struck through.
- `supabase/tests/roles_seed_test.sql` — `test_area_capability_at_level` fixture re-derived.
- `supabase/tests/roles_schema_test.sql` — item 14's `15 rows / 11 ui_groups` counts.
- `supabase/tests/user_has_capability_areas_test.sql` — the re-pointed special case.
- `tests/unit/areas.test.ts`, `tests/unit/routeAreas.test.ts`, `tests/unit/RoleEditor.test.tsx`, `tests/unit/RolePreviewPanel.test.tsx`, `tests/unit/AppSidebar.nav.test.ts`, `tests/e2e/roles-and-areas.spec.ts`.

**Deliberately untouched:** `src/App.tsx`'s `COLLABORATOR_ROUTES` (already exported at `:200`; the calibration test proves the derived lists still match the hand-written ones), `definitions.ts`'s `ROLE_CAPABILITIES` (the fixed point the migration is proved against), and `role_flags` semantics.

---

## The 33 keys

Referenced by every task. `cap` is `max_level_collaborator`. Grouping and paths come from spec §3.1.

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

`sort_order` is 1-based **within** `ui_group`, in the order above (matching `navigationGroups`). `/help` gets no row — it stays in `UNIVERSAL_PATHS`.

---

### Task 1: Nav housekeeping

Two changes to `AppSidebar.nav.ts`, both prerequisites for what follows and neither touching permissions logic.

**Files:**
- Create: `src/components/AppSidebar.nav.data.ts`
- Modify: `src/components/AppSidebar.nav.ts`
- Test: `tests/unit/AppSidebar.nav.test.ts`

**Interfaces:**
- Produces: `src/components/AppSidebar.nav.data.ts` exporting `interface NavItem { path: string; label: string; icon: LucideIcon }`, `interface NavGroup { label: string; items: NavItem[] }`, `const navigationGroups: NavGroup[]`, `const SUPPLEMENTAL_NAV_ITEMS: Record<string, NavItem[]>`.

- [ ] **Step 1: Create the leaf data module**

Move — do not copy — these declarations out of `src/components/AppSidebar.nav.ts` into a new `src/components/AppSidebar.nav.data.ts`: the `lucide-react` icon imports, `import type { LucideIcon }`, `NavItem`, `NavGroup`, `navigationGroups`, and `SUPPLEMENTAL_NAV_ITEMS`. Leave every other export (`collaboratorAccountantNav`, `collaboratorInventoryNav`, `collaboratorChefNav`, `staffNav`, `operationsManagerNav`, `collaboratorOperationsManagerNav`, `DERIVED_GROUP_LABELS`, `NAV_HIDDEN_PATHS`, `getNavigationForAreas`, `getNavigationForRole`) where it is.

The new file's header:

```ts
/**
 * Sidebar navigation data — the app's menu, as data.
 *
 * Deliberately a leaf: imports nothing from `@/lib/permissions`. `areas.ts`
 * derives AREA_DEFINITIONS from `navigationGroups` while `AppSidebar.nav.ts`
 * imports `allowedPathsForAreas` from `routeAreas.ts` (which imports
 * `areas.ts`). Keeping the data here is what stops that from being an import
 * cycle — and a cycle with module-level const initialization on both ends is
 * a temporal-dead-zone crash at import time, not a lint warning.
 *
 * Adding a page here without a matching entry in PAGE_AREAS
 * (src/lib/permissions/areas.ts) fails tests/unit/areas.test.ts.
 */
import { Home, Plug, /* …every icon the moved data uses… */ } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
```

Declarations move **verbatim** — same paths, labels, icons, order. No behaviour change. The remaining `AppSidebar.nav.ts` still uses several of those icons in `collaboratorAccountantNav` and friends, so it keeps its own `lucide-react` import with only what it still references; `npm run typecheck` will say which.

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

Run: `npm run typecheck` → exit 0.
Run: `npx vitest run tests/unit/AppSidebar.nav.test.ts tests/unit/collaboratorOperationsManagerRouting.test.ts --reporter=dot` → PASS, same test count as before. These assert `getNavigationForRole('owner')` deep-equals `navigationGroups`; a dropped or reordered item fails here.

- [ ] **Step 3: Commit the move**

```bash
git add src/components/AppSidebar.nav.data.ts src/components/AppSidebar.nav.ts
git commit -m "refactor(nav): extract navigationGroups into a leaf data module

areas.ts is about to derive AREA_DEFINITIONS from navigationGroups, but
AppSidebar.nav.ts imports routeAreas.ts which imports areas.ts. Both ends
initialize module-level consts, so that cycle would be a TDZ crash at
import time. Pure move plus re-export; no behaviour change."
```

- [ ] **Step 4: Write the failing test for the Accountant's dead `/budget` link**

Spec §7.1, recommendation (b). `collaboratorAccountantNav` renders a Budget & Run Rate link that `COLLABORATOR_ROUTES.collaborator_accountant.allowed` does not permit, so `StaffRoleChecker` bounces every Accountant off it. Removing the link fixes the defect without granting anyone anything; an owner can grant `budget` through the editor once this PR lands.

In `tests/unit/AppSidebar.nav.test.ts`:

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

Import `COLLABORATOR_ROUTES` from `@/App` — it is already a named export at `src/App.tsx:200`. Do not re-type the allow-list in the test; a second transcription is exactly the drift this plan exists to remove.

Run: `npx vitest run tests/unit/AppSidebar.nav.test.ts --reporter=dot` → FAIL on `/budget`.

- [ ] **Step 5: Remove the link and commit**

Delete `{ path: '/budget', label: 'Budget & Run Rate', icon: Target }` from `collaboratorAccountantNav` (`src/components/AppSidebar.nav.ts:120`). Drop `Target` from the icon import if nothing else uses it.

Run: `npx vitest run tests/unit/AppSidebar.nav.test.ts --reporter=dot` → PASS.

```bash
git add src/components/AppSidebar.nav.ts tests/unit/AppSidebar.nav.test.ts
git commit -m "fix(nav): stop offering the accountant a Budget link that bounces them

collaboratorAccountantNav rendered /budget; COLLABORATOR_ROUTES never
allowed it. Removes the dead link rather than granting the page, so no
existing collaborator's access changes. Adds a test asserting every
collaborator nav path is actually reachable."
```

---

### Task 2: The migration and its proof

The load-bearing task, and the whole risk of the change. Tasks 3–7 are recoverable by editing a file; this one rewrites every builtin role's grants behind a temporarily disabled privilege guard. Written before the TypeScript so the SQL stays authoritative and the client mirrors it, per the convention `areas.ts`'s header already states.

**Files:**
- Create: `supabase/migrations/20260805120000_page_areas.sql`, `supabase/tests/page_areas_catalog_test.sql`
- Modify: `supabase/tests/roles_seed_test.sql`, `supabase/tests/roles_schema_test.sql`, `supabase/tests/user_has_capability_areas_test.sql`, `supabase/tests/25_check_printing_capabilities.sql`, `supabase/tests/reviews_area_catalog_test.sql`

The last two are easy to miss: they never mention `area_catalog` in their titles, but both hardcode bundle-era facts. `25_check_printing_capabilities` builds a custom role and escalates it through `books` at view then manage — and check printing is gated by two capability pairs (`view`/`edit:banking` and `view`/`edit:pending_outflows`) that this re-cut splits across `banking` and `print_checks`, so each stage must grant the pair. `reviews_area_catalog_test` asserts `reviews` sits in the invented `Operations` band at sort_order 6; mirroring the sidebar puts it in `Main` at 5. Grep for `'books'` and for `area_catalog` across `supabase/tests/` before assuming the list is complete.

**Interfaces:**
- Produces: `area_catalog` with 33 rows keyed as in *The 33 keys*; `user_has_capability(uuid, text)` with a re-pointed VALUES map.

- [ ] **Step 1: Write the migration header and the guard-disable**

Read spec §4.0 first — it explains why the naive delete-then-insert fails.

```sql
-- ============================================================================
-- Migration: re-cut area_catalog along the sidebar — one area per page
--
-- Design: docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md
--
-- The ordering below is forced, not preferred — see spec §4.0. Two facts:
--   1. role_areas_block_builtin_mutation is BEFORE UPDATE OR DELETE with no
--      migration exemption (20260730100000_roles_and_areas_tables.sql:419-465).
--      It does NOT cover INSERT, so only removing the old `books` rows needs
--      the guard down.
--   2. role_areas.area_key REFERENCES area_catalog(area_key) with no
--      ON DELETE clause (:229), therefore RESTRICT.
-- ============================================================================

ALTER TABLE public.role_areas DISABLE TRIGGER role_areas_block_builtin_mutation;
```

- [ ] **Step 2: Expand `area_catalog`**

```sql
-- `band` is retired on the client (five sidebar groups replace the three
-- invented bands) but the column is NOT NULL and other migrations reference
-- it. Set it equal to ui_group here; dropping it is a separate later change.

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

Insert before deleting — the FK is RESTRICT and the new rows do not depend on the old ones surviving. Every fan-out below targets keys that were only just inserted in Step 2, and no two fan-outs share a target key, so a plain `INSERT` cannot conflict. Leave them unqualified: if that premise is ever wrong, a loud unique-violation is the right outcome.

```sql
-- books:manage -> manage on all nine books pages.
-- books:view   -> view on eight; print_checks is SKIPPED (spec §4.1) —
--                 /print-checks is the only books path gated at manage today.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, page.area_key, ra.level
FROM public.role_areas ra
CROSS JOIN LATERAL (VALUES
  ('transactions'), ('banking'), ('expenses'), ('invoices'), ('customers'),
  ('financial_statements'), ('financial_intelligence'), ('assets'), ('print_checks')
) AS page(area_key)
WHERE ra.area_key = 'books'
  AND NOT (page.area_key = 'print_checks' AND ra.level = 'view');

-- reports -> dashboard at view. The `reports` row keeps its own level:
-- view:ai_assistant is resolved by a hardcoded `area_key = 'reports' AND
-- level = 'manage'` check below, so downgrading it would silently kill AI
-- Assistant for Owner, Manager and both Operations Manager roles.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'dashboard', 'view'
FROM public.role_areas ra
WHERE ra.area_key = 'reports';

-- scheduling:manage -> manage on time_punches and tips. scheduling:view fans
-- out to nothing: a view-level holder reaches neither page today.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, page.area_key, 'manage'
FROM public.role_areas ra
CROSS JOIN LATERAL (VALUES ('time_punches'), ('tips')) AS page(area_key)
WHERE ra.area_key = 'scheduling' AND ra.level = 'manage';

-- inventory:manage -> inventory_audit:manage. inventory:view fans out to
-- nothing (/inventory-audit is manage-gated today).
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'inventory_audit', 'manage'
FROM public.role_areas ra
WHERE ra.area_key = 'inventory' AND ra.level = 'manage';

-- recipes -> prep_recipes at the same level.
INSERT INTO public.role_areas (role_id, area_key, level)
SELECT ra.role_id, 'prep_recipes', ra.level
FROM public.role_areas ra
WHERE ra.area_key = 'recipes';

-- The five new areas (ops_inbox, weekly_brief, budget, labor,
-- stripe_account) intentionally receive NO rows. Grantable from now on;
-- nobody holds them on deploy day.

DELETE FROM public.role_areas   WHERE area_key = 'books';
DELETE FROM public.area_catalog WHERE area_key = 'books';
```

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

The rest re-point mechanically: `('view:invoices','invoices','view')`, `('edit:invoices','invoices','manage')`, `('view:banking','banking','view')`, and so on for `transactions`, `expenses`, `customers`, `assets`, `financial_statements`, `prep_recipes`. Four capabilities keep bundle homes on purpose (spec §3.2): `view:batches`/`edit:batches` stay on `recipes`; `view:inventory_transactions`/`edit:inventory_transactions` and `view:receipt_import`/`edit:receipt_import` stay on `inventory`. `view:dashboard` moves to `('view:dashboard','dashboard','view')`; `view:reports` stays `('view:reports','reports','view')`.

Then re-enable the guard and update the column comment:

```sql
ALTER TABLE public.role_areas ENABLE TRIGGER role_areas_block_builtin_mutation;

COMMENT ON COLUMN public.area_catalog.area_key IS
  'Stable key joined by role_areas and by user_has_capability''s VALUES map. One key per gateable sidebar page: 33 keys across the 5 sidebar ui_groups.';
```

- [ ] **Step 5: Apply it**

Run: `npm run db:reset`
Expected: every migration applies, exit 0, no 42501 and no FK violation. A 42501 means the DISABLE is in the wrong place; an FK violation means a `DELETE FROM area_catalog` ran before its `role_areas` rows were gone.

- [ ] **Step 6: Write the catalog-shape test**

Create `supabase/tests/page_areas_catalog_test.sql`:

```sql
BEGIN;
SELECT plan(7);

SELECT is((SELECT count(*)::int FROM public.area_catalog), 33,
  'area_catalog has one row per gateable sidebar page');

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

-- Cheap insurance on the DISABLE/ENABLE window. Supabase runs each migration
-- in a transaction, so a mid-file failure should roll the DISABLE back — but
-- a guard left off is silent, and this assertion costs one line.
SELECT is((SELECT count(*)::int FROM pg_trigger
           WHERE tgname IN ('role_areas_block_builtin_mutation',
                            'role_flags_block_builtin_mutation',
                            'role_areas_enforce_collaborator_cap',
                            'roles_block_builtin_mutation')
             AND tgenabled = 'O'), 4,
  'all four builtin/collaborator guards are enabled after migration');

SELECT * FROM finish();
ROLLBACK;
```

Confirm the four trigger names against `20260730100000_roles_and_areas_tables.sql` before running. Do not weaken the assertion to `>= 1`.

Also update `supabase/tests/roles_schema_test.sql` item 14, which pins `area_catalog` at 15 rows / 11 distinct `ui_group`s — it goes stale here. New values: 33 and 5.

Run: `npm run test:db`
Expected: PASS. If the trigger assertion fails, fix the migration — do not adjust the assertion.

- [ ] **Step 7: Re-derive `roles_seed_test.sql`'s fixture — the actual proof**

`roles_seed_test.sql` builds `test_area_capability_at_level`, an (area_key, level) → capability table, and asserts for each of the ten builtins, in both directions, that expanding its `role_areas` reproduces `ROLE_CAPABILITIES` exactly.

**`test_expected_capabilities` does not change.** It is the fixed point the whole migration is proved against; editing it to make a test pass converts a real regression into a green build.

Re-derive `test_area_capability_at_level` for the 33 areas, mirroring Step 4's map. Where it had:

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

A failure names the role and the direction. "Role X is missing capability Y" → the fan-out dropped a row. "Role X has unexpected capability Y" → it fanned out too far, most likely the `books:view` → `print_checks` skip or `reports` losing its `manage` level. Either way it is a Step 3 bug, not a test to adjust.

- [ ] **Step 8: Cover the re-pointed special case**

In `supabase/tests/user_has_capability_areas_test.sql`, add assertions that:

- `view:financial_intelligence` resolves true for a role granted `financial_intelligence: 'view'` and false for one granted only `transactions: 'view'` — this is the re-pointed hardcoded branch, and nothing else covers it.
- `view:ai_assistant` still resolves true for `reports: 'manage'` and false for `reports: 'view'`.
- `view:tips` resolves true for `tips: 'view'` — the tier that moved.

The collaborator-cap trigger needs no new assertions here: `roles_schema_test.sql` items 12–13 already exercise it generically (NULL cap via `team`, view cap via `sales`/`reports`/`payroll`/`settings`), and all of those keys survive the re-cut with their caps unchanged.

Bump `plan(N)` to match.

Run: `npm run test:db` → PASS.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260805120000_page_areas.sql \
        supabase/tests/page_areas_catalog_test.sql \
        supabase/tests/roles_seed_test.sql \
        supabase/tests/roles_schema_test.sql \
        supabase/tests/user_has_capability_areas_test.sql
git commit -m "feat(permissions): re-cut area_catalog to one area per sidebar page

33 page-shaped keys across the 5 sidebar groups replace 15 bundle-shaped
ones. role_areas rows fan out mechanically so no role gains or loses a
capability; books:view deliberately skips print_checks, the one books path
gated at manage. view:financial_intelligence's hardcoded area_key re-points
off the retiring 'books' key.

Proved by a per-role, both-directions round trip against the untouched
ROLE_CAPABILITIES transcription."
```

---

### Task 3: `areas.ts` — the client mirror

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
import { AREA_DEFINITIONS, PAGE_AREAS } from '@/lib/permissions/areas';

describe('areas.ts derives from the sidebar', () => {
  it('has exactly one area per gateable sidebar page — the drift alarm', () => {
    const navPaths = navigationGroups
      .flatMap((g) => g.items.map((i) => i.path))
      .filter((p) => p !== '/help');
    const areaPaths = PAGE_AREAS.map((a) => a.path);

    // `/team` carries two areas (team + collaborators), so compare as sets.
    // A page added to AppSidebar.nav.data.ts with no PAGE_AREAS entry fails
    // here rather than becoming silently ungrantable — which is how /budget,
    // /labor, /stripe-account, /ops-inbox and /weekly-brief went unreachable.
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

Run: `npx vitest run tests/unit/areas.test.ts --reporter=dot` → FAIL, `PAGE_AREAS` is not exported.

- [ ] **Step 2: Rewrite `areas.ts`**

Replace the `AreaKey` union with the 33 keys from *The 33 keys*. Replace `AREA_CAPABILITIES` with one entry per page — mechanically the inverse of Task 2 Step 4's VALUES map. The entries that are not a pure one-to-one re-point (spec §3.2):

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

Declare `PAGE_AREAS` with permission metadata only (key, path, `hasManageTier`, `maxLevelForCollaborator`, `hint`, optional `manageHint`, optional `navLabel`). Source the per-page `hint`/`manageHint` copy from the mockup, `docs/design-reference/permissions-menu-mirror.html:415-468` — already authored there per page; do not re-invent it. Two entries need `navLabel` because they share `/team`:

```ts
  { key: 'team',          path: '/team', navLabel: 'Team members', … },
  { key: 'collaborators', path: '/team', navLabel: 'Collaborators', … },
```

Derive `AREA_DEFINITIONS` by walking `navigationGroups` in order and, for each item, emitting every `PAGE_AREAS` entry whose `path` matches — taking `label` (unless `navLabel` overrides), `icon`, `uiGroup` and a 1-based `sortOrder` within the group from the nav. Skip `/help`.

Derive `AREA_LANDING_PATHS` from `PAGE_AREAS` (`key → path`) and `AREA_PRIORITY` from `AREA_DEFINITIONS`' order, rather than hand-maintaining two more 33-entry literals.

`SENSITIVE_FLAGS[].requires` needs no change — `inventory`, `recipes`, `reports`, `employees`, `scheduling` all survive the re-cut.

Delete `Band` and `AreaGroupKey`. Rewrite the file header: it says "fourteen", "Ten rows in the editor", and cites the superseded `20260730140000` migration at lines 10-28. Point it at `20260805120000_page_areas.sql` and describe the join-against-nav derivation.

Run: `npx vitest run tests/unit/areas.test.ts --reporter=dot` → PASS.

- [ ] **Step 3: Let the compiler find the rest, then commit**

Run: `npm run typecheck`
Expected: errors in `preview.ts`, `RoleEditor.tsx`, `RolePreviewPanel.tsx` and their tests, from the deleted `Band`/`AreaGroupKey` and the changed `AreaKey` members. That list is the exact remaining work for Tasks 4–6. Record it; do not fix it here. Typecheck stays red until Task 6 — that is the compiler enumerating the work, and it is why this plan does not run `npm run build` before then. Do not resolve it by loosening types.

```bash
git add src/lib/permissions/areas.ts tests/unit/areas.test.ts
git commit -m "feat(permissions): one client area per sidebar page, derived from nav

AREA_DEFINITIONS stops being a hand-kept list: permission metadata is
declared per page in PAGE_AREAS and joined against navigationGroups for
label, icon, group and order. A sidebar page with no PAGE_AREAS entry now
fails a test instead of becoming silently ungrantable."
```

---

### Task 4: `routeAreas.ts` — derive the route map

**Files:**
- Modify: `src/lib/permissions/routeAreas.ts`
- Test: `tests/unit/routeAreas.test.ts`

**Interfaces:**
- Consumes: `AREA_DEFINITIONS`, `AREA_PRIORITY`, `AREA_LANDING_PATHS` from Task 3.
- Produces: `AREA_ROUTES`, `UNIVERSAL_PATHS`, `COLLABORATOR_PATH_EXCLUSIONS`, `allowedPathsForAreas`, `customCollaboratorRoutes` — all unchanged in signature.

- [ ] **Step 1: Update the calibration fixture and watch it fail**

`tests/unit/routeAreas.test.ts`'s `SEEDED_COLLABORATOR_AREAS` transcribes each builtin collaborator's seeded grants. Re-transcribe to post-migration values, matching Task 2 Step 3's fan-out exactly. Accountant, for instance, held `books: 'manage'`:

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

Run: `npx vitest run tests/unit/routeAreas.test.ts --reporter=dot` → FAIL, the fixture references keys `AREA_ROUTES` does not yet map.

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

`UNIVERSAL_PATHS` and `COLLABORATOR_PATH_EXCLUSIONS` keep their current values verbatim. `satisfies`, `allowedPathsForAreas` and `customCollaboratorRoutes` keep their current bodies.

Replace the header's "Deliberately unmapped" paragraph (lines 19-22) — now false, those five pages have areas. State instead that they are mapped but unheld: no role has a grant for them until an owner makes one.

- [ ] **Step 3: Run the calibration and commit**

Run: `npx vitest run tests/unit/routeAreas.test.ts --reporter=dot` → PASS for all four builtin collaborators.

A diff here is a genuine access change, not a test to adjust. Extra path → the fan-out granted too much; missing path → too little. Both are Task 2 bugs. Expect `/print-checks` to stay on Accountant (it held `books: 'manage'`, so the fan-out gives it `print_checks: 'manage'`) and `/inventory-audit` plus `/receipt-import` to stay on Inventory Helper.

```bash
git add src/lib/permissions/routeAreas.ts tests/unit/routeAreas.test.ts
git commit -m "feat(permissions): derive AREA_ROUTES from the page catalog

Near-identity now that areas are pages. The four builtin collaborators'
hand-written allow-lists still reproduce exactly from their seeded grants."
```

---

### Task 5: `preview.ts` and the preview panel

**Files:**
- Modify: `src/lib/permissions/preview.ts`, `src/components/roles/RolePreviewPanel.tsx`
- Test: `tests/unit/RolePreviewPanel.test.tsx`

**Interfaces:**
- Consumes: `AREA_DEFINITIONS` (Task 3).
- Produces: `buildNavPreview(grants)` returning `NavPreviewGroup[]` where `label` is now the sidebar group label; `buildSummary(grants)` unchanged in signature.

- [ ] **Step 1: Rewrite the panel test**

`tests/unit/RolePreviewPanel.test.tsx:63-68` asserts *"strikes through and dims a nav item whose area is not granted"*. "A literal render of the sidebar this role will get" means ungranted pages are **absent**. Replace that test — do not add alongside it:

```ts
  it('omits pages the role cannot reach, rather than decorating them', () => {
    render(<RolePreviewPanel grants={{ invoices: 'manage' }} flags={[]} flavor="platform" />);

    expect(screen.getByText('Invoices')).toBeInTheDocument();
    // Banking rode in the same `books` bundle before the re-cut.
    expect(screen.queryByText('Banks')).not.toBeInTheDocument();
  });

  it('groups the preview by sidebar group, not by the retired bands', () => {
    render(<RolePreviewPanel grants={{ invoices: 'manage', tips: 'view' }} flags={[]} flavor="platform" />);

    expect(screen.getByText('Accounting')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.queryByText('Money & Books')).not.toBeInTheDocument();
  });
```

Read `RolePreviewPanel.tsx`'s actual prop signature before writing this rather than trusting the shape above.

Run: `npx vitest run tests/unit/RolePreviewPanel.test.tsx --reporter=dot` → FAIL.

- [ ] **Step 2: Regroup and drop the strike-through**

In `preview.ts`, `buildNavPreview` groups by `row.band` at lines 180-183. Change the grouping key to the definition's `uiGroup`, and iterate `AREA_DEFINITIONS` in its (now sidebar) order so groups come out in sidebar order. Drop ungranted items from `group.items` instead of emitting them with a falsy level, and drop groups that end up empty.

Delete `PHRASE` (lines 106-118 — keyed by the deleted `AreaGroupKey`) and read each page's `hint`/`manageHint` off its `AREA_DEFINITIONS` row instead. Rewrite `buildSummary`'s "can't touch" branch (lines 151-159): it hardcodes four bundle categories that no longer exist. Summarise per sidebar group — "Accounting: 3 of 12 pages" — which is also the shape PR 2's roll-up header needs.

In `RolePreviewPanel.tsx`, remove the strike-through/dim styling path for ungranted items; it now has nothing to render.

Run: `npx vitest run tests/unit/RolePreviewPanel.test.tsx --reporter=dot` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions/preview.ts src/components/roles/RolePreviewPanel.tsx tests/unit/RolePreviewPanel.test.tsx
git commit -m "feat(permissions): preview renders the sidebar the role actually gets

Grouped by sidebar ui_group rather than the retired bands, and ungranted
pages are absent rather than struck through — a literal preview, not a
decorated full menu."
```

---

### Task 6: `RoleEditor` — 33 rows under five headings

Deliberately minimal. Collapsible groups and roll-up controls are PR 2; this task only keeps the editor correct against the new model.

**Files:**
- Modify: `src/components/roles/RoleEditor.tsx`
- Test: `tests/unit/RoleEditor.test.tsx`

**Interfaces:**
- Consumes: `AREA_DEFINITIONS` (Task 3). Produces no new exports.

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

Run: `npx vitest run tests/unit/RoleEditor.test.tsx --reporter=dot` → FAIL.

- [ ] **Step 2: Render from `AREA_DEFINITIONS`**

Delete `AREA_HINT` and `AREA_LOCK_REASON` (both keyed by the deleted `AreaGroupKey`); read `hint`/`manageHint` off the definition row. Group rows under a heading per `uiGroup`, in `AREA_DEFINITIONS` order.

Keep `LevelControl` (`RoleEditor.tsx:284-334`) exactly as it is — a Radix `RadioGroupPrimitive.Root` per page row is correct and stays correct in PR 2. Disable the Manage segment when `!definition.hasManageTier`, and cap the whole control per `maxLevelForCollaborator` when the role's flavor is `collaborator`, exactly as the current code caps per area.

Styling per CLAUDE.md's Typography Scale (form-label tier for group headings, body tier for row labels, secondary tier for hints). With 33 rows a radio labelled only "Manage" is ambiguous, so each row's `RadioGroup` needs `aria-label={`${label} access level`}`.

Run: `npx vitest run tests/unit/RoleEditor.test.tsx --reporter=dot` → PASS.

- [ ] **Step 3: Whole suite green, and the build compiles**

Run: `npm run typecheck` → exit 0. Every error recorded in Task 3 Step 3 should now be resolved.
Run: `npm run lint` → exit 0.
Run: `npx vitest run --reporter=dot` (timeout: 600000) → PASS. Any failure outside the files this plan touched is a real regression; investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/components/roles/RoleEditor.tsx tests/unit/RoleEditor.test.tsx
git commit -m "feat(permissions): editor renders one row per page under five headings

Flat list for now — collapsible groups and roll-up controls are PR 2.
Manage locks itself from the catalog's hasManageTier rather than from a
hand-kept map."
```

---

### Task 7: E2E — the user's own scenario, end to end

Phase 8 treats this as a hard gate: user-facing behaviour changes across a cross-layer seam.

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

Accessible selectors only. Adjust names to whatever the editor actually renders — run once and read the failure.

- [ ] **Step 2: Run it**

Run in the foreground per CLAUDE.md's No Unbounded Waits rule, with a dev server trapped so it dies with the shell:

```bash
npm run dev & pid=$!
trap 'kill $pid 2>/dev/null' EXIT
npx playwright test tests/e2e/roles-and-areas.spec.ts --reporter=line
```

(timeout: 600000) Expected: PASS.

- [ ] **Step 3: Full suite, then commit**

Run: `npm run test:all` (timeout: 600000) → PASS across unit, pgTAP and E2E.

```bash
git add tests/e2e/roles-and-areas.spec.ts
git commit -m "test(e2e): grant Invoices without Banking, save, reopen

The user's literal complaint, end to end across editor, preview, RPC and
RLS."
```

---

## Spec coverage

§3.1 catalog → Tasks 2, 3. §3.2 four exceptions → Task 2 Step 4, Task 3 Step 2, Task 4 Step 2. §3.3 levels and caps → Task 2 Steps 2 and 6, Task 3 Step 1. §3.4 five capability-less areas → Task 2 Step 3 (no rows) and Task 4 (mapped, unheld). §3.5 module changes → Tasks 3–6. §4.0/§4.1 migration → Task 2. §5 testing → every task. §7.1 dead `/budget` link → Task 1. §7.2 (fully per-page) is what the plan implements. §7.3 sensitive flags unchanged.

**§3.6 has no task here, by design.** The roll-up interaction model — `role="group"` plus command buttons, mixed-group default expansion, `.ghead` wrapping at ≤640px — is PR 2 per spec §6. Task 6 ships a flat list.

**Not in the spec:** the import cycle Task 1 Step 1 breaks. `areas.ts` deriving from `navigationGroups` would have crashed at import time.
