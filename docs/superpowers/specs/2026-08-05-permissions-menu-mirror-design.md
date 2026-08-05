# Permissions that mirror the menu — design

**Date:** 2026-08-05
**Branch:** `feature/permissions-menu-mirror`
**Status:** design, awaiting approval

---

## 1. The complaint

> "I am expecting to be able to set permissions for tip pooling, invoices, and other individual pages. Basically, the same way our menu is structured, we should be able to set permissions for the entire area — so we see 'Main' and under Main, all the links with the ability to set the permissions for dashboard, integrations, pos sales… currently, I have some control but not enough control and it is also not intuitive to what permissions are being set."

Two separate defects, both real, both reproducible in the current code.

### Defect 1 — the grant unit is coarser than the page

`role_areas` stores one row per *bundle*, not per page. The bundle boundaries were chosen in July to reproduce the ten builtin roles' capability sets exactly (`supabase/migrations/20260730110000_seed_builtin_roles.sql:18-25` describes the derivation), not to be a control surface an owner would recognise. Three bundles do most of the damage:

| The one switch | What it actually turns on |
|---|---|
| `books` | `/transactions`, `/banking`, `/expenses`, `/invoices`, `/customers`, `/financial-statements`, `/financial-intelligence`, `/assets`, `/print-checks` — nine pages (`src/lib/permissions/routeAreas.ts:65-74`) |
| `scheduling` at `manage` | `/scheduling`, `/time-punches`, **and** `/tips` (`src/lib/permissions/routeAreas.ts:57-59`) |
| `inventory` at `manage` | `/inventory`, `/inventory-audit`, `/receipt-import` (`src/lib/permissions/routeAreas.ts:47-49`) |

So the two pages the user named by hand are the two clearest instances. "Invoices" cannot be granted without also granting banking and print-checks. "Tip Pooling" cannot be granted without also granting the time clock, and cannot be granted at all below `manage`.

Five sidebar pages have no permission at all and are deliberately unreachable by any collaborator role, custom or builtin: `/budget`, `/labor`, `/stripe-account`, `/ops-inbox`, `/weekly-brief` (`src/lib/permissions/routeAreas.ts:19-22`). They are not ungrantable by accident — the comment says leaving them out of the map is what keeps them unreachable. But it also means an owner cannot delegate them, ever.

### Defect 2 — the editor's vocabulary is not the app's vocabulary

The editor groups rows into three invented bands — `Operations | Money | People & admin` (`src/lib/permissions/areas.ts`, `Band` type). The sidebar groups pages into five — `Main | Operations | Inventory | Accounting | Admin` (`src/components/AppSidebar.nav.ts:54-113`). The two share one label (`Operations`) and even that covers different pages. A row labelled "Money & Books" corresponds to no menu the owner has ever seen.

### Defect 3 (found while reading, in scope to fix)

`collaboratorAccountantNav` renders a `/budget` link (`src/components/AppSidebar.nav.ts:120`), but `COLLABORATOR_ROUTES.collaborator_accountant.allowed` does not contain `/budget` (`src/App.tsx:203-218`). Today an Accountant sees a Budget & Run Rate link in their sidebar and `StaffRoleChecker` bounces them off it. This is a live dead link. See §7 for the decision it forces.

---

## 2. What the model actually is today

Read before asserting, per the workflow's citation rule. Everything in this section is transcribed from source.

**Storage.** `area_catalog(area_key PK, ui_group, band, sort_order, max_level_collaborator)`; `role_areas(role_id, area_key, level CHECK IN ('view','manage'), PK(role_id, area_key))`; `role_flags(role_id, flag)` for the three sensitive flags (`supabase/migrations/20260730100000_roles_and_areas_tables.sql`).

**Fifteen area keys onto eleven `ui_group`s**, not fourteen/ten. `reviews` was added on 2026-08-04 by `supabase/migrations/20260804100000_reviews_area.sql`, which renumbered `sort_order >= 6` upward. The SQL's own column comment is correct — *"Fifteen keys collapse onto eleven ui_groups."* — but the client mirror's doc comments still say "fourteen" in six places (`src/lib/permissions/areas.ts:9, 20, 34, 144, 249, 358`) while its *code* already carries fifteen `AreaKey` members and eleven `AREA_DEFINITIONS` rows. Those comments are stale and this change corrects them.

**Enforcement is capability-based, not path-based.** `user_has_capability(p_restaurant_id, p_capability)` is what RLS policies and edge functions call. Its area path is a pure two-column lookup:

```sql
SELECT m.area_key, m.required_level INTO v_area_key, v_required_level
FROM (VALUES
  ('view:invoices',  'books', 'view'),
  ('edit:invoices',  'books', 'manage'),
  …58 rows…
) AS m(capability, area_key, required_level)
WHERE m.capability = p_capability;
```

then `EXISTS (SELECT 1 FROM role_areas WHERE role_id = … AND area_key = v_area_key AND level = …)`, with `manage` satisfying a `view` requirement (`supabase/migrations/20260804100000_reviews_area.sql`, the `CREATE OR REPLACE` block).

**This is the pivotal observation for the whole design:** the capability vocabulary is *already page-shaped*. `view:invoices`, `view:tips`, `view:banking`, `view:inventory_audit` — every one of the 58 capabilities names a page or a page's edit action. The `area_key` column is the only place the bundling happens. Re-cutting areas per page is therefore a **re-point of one column**, not a redesign of the enforcement layer.

Four special cases sit *before* the map and are unaffected by re-pointing: `manage:subscription` (direct role_id comparison against the Owner builtin), `view:ai_assistant` and `view:financial_intelligence` (area check **and** `has_subscription_feature`), and the three sensitive flags (read `role_flags` directly, independent of areas).

**Routing is a second, separate layer.** `AREA_ROUTES` (`src/lib/permissions/routeAreas.ts:40-85`) maps 29 paths to `(area, minLevel)`. It exists only for *custom* collaborator roles — the four builtin collaborators keep hand-written allow-lists in `COLLABORATOR_ROUTES` (`src/App.tsx:200`). `tests/unit/routeAreas.test.ts` is the calibration net: feeding each builtin collaborator's seeded `role_areas` through `allowedPathsForAreas` must reproduce that role's hand-written list exactly.

---

## 3. The design

**One area per page in the sidebar.** `area_catalog` grows from 15 keys to 33. `ui_group` becomes the sidebar group label; `sort_order` becomes the item's position in the sidebar. The editor then has nothing to invent — it renders the menu.

### 3.1 The catalog

33 rows. 32 of them are the 32 gateable items in `navigationGroups` (33 items minus `/help`, which stays universal — `src/lib/permissions/routeAreas.ts:88`). The 33rd is `collaborators`, explained below.

**Main** — `dashboard` `/`, `integrations` `/integrations`, `pos_sales` `/pos-sales`, `ops_inbox` `/ops-inbox`, `reviews` `/reviews`, `weekly_brief` `/weekly-brief`

**Operations** — `scheduling` `/scheduling`, `time_punches` `/time-punches`, `tips` `/tips`, `payroll` `/payroll`, `labor` `/labor`

**Inventory** — `recipes` `/recipes`, `prep_recipes` `/prep-recipes`, `inventory` `/inventory`, `inventory_audit` `/inventory-audit`, `purchasing` `/purchase-orders`, `reports` `/reports`

**Accounting** — `budget` `/budget`, `customers` `/customers`, `invoices` `/invoices`, `stripe_account` `/stripe-account`, `banking` `/banking`, `expenses` `/expenses`, `print_checks` `/print-checks`, `assets` `/assets`, `financial_intelligence` `/financial-intelligence`, `transactions` `/transactions`, `chart_of_accounts` `/chart-of-accounts`, `financial_statements` `/financial-statements`

**Admin** — `employees` `/employees`, `team` `/team`, `collaborators` `/team`, `settings` `/settings`

### 3.2 Three deliberate exceptions to "one row per menu item"

Naming them here so nobody later reads them as sloppiness.

1. **`collaborators` is a second Admin row on the same page.** The Team page hosts two tabs and they are separately gated: `view:team`/`manage:team` vs `view:collaborators`/`manage:collaborators`. Fusing them would grant `manage:collaborators` to the internal Operations Manager builtin, which holds `team:manage` and no `collaborators` row at all (`supabase/migrations/20260730110000_seed_builtin_roles.sql`, Operations Manager block). That is a real privilege grant, so the two stay separate. The editor shows them as *Team members* and *Collaborators* under a single "Team" heading.

2. **`/receipt-import` folds into `inventory` at `manage`.** It is reachable by a collaborator (`src/App.tsx:226`) and declared in `collaboratorInventoryNav` (`src/components/AppSidebar.nav.ts:156`), but it is *not* a `navigationGroups` item — an owner reaches it from inside Inventory. Giving it a catalog row would invent a menu entry that does not exist. It keeps its current home: `inventory:manage`.

3. **`view:batches` / `edit:batches` and `view:inventory_transactions` / `edit:inventory_transactions` stay on `recipes` and `inventory`.** Neither has a page of its own anywhere in the app.

### 3.3 Levels and caps

For every page-area: `view` = that page's `view:X` capability; `manage` = `view:X` plus `edit:X`.

Pages with no edit capability get **no manage tier**, so the editor locks the Manage segment and `max_level_collaborator` is `'view'`: `dashboard`, `pos_sales`, `reports`, `financial_statements`, `financial_intelligence`, plus the five new areas. This is the "read-only surfaces lock Manage" guard, and it now falls out of the catalog instead of being hand-asserted.

`team` and `collaborators` keep `max_level_collaborator = NULL` — ungrantable to any collaborator-flavored role at any level. The SQL trigger `role_areas_enforce_collaborator_cap` is the real guard; `COLLABORATOR_PATH_EXCLUSIONS` (`src/lib/permissions/routeAreas.ts:101`) stays as the second lock.

`print_checks` keeps a row note in the editor — writing a check moves money — and, because it is now its own area, "no access to Print Checks while keeping the rest of the books" becomes expressible for the first time.

### 3.4 The five new areas carry no capability

`ops_inbox`, `weekly_brief`, `budget`, `labor`, `stripe_account` get catalog rows and `routeAreas` entries but **no rows in `user_has_capability`'s map**. They have no capability today, and inventing five would mean inventing five legacy-CASE branches whose only correct value is "whatever the page does now" — i.e. nothing. They are gated purely by routing, which is exactly how they are gated today; the change is that the gate becomes *grantable* instead of a hardcoded exclusion.

Consequence, stated plainly: **this makes P&L-adjacent pages delegable to an external collaborator for the first time.** `/budget` and `/labor` surface run-rate and labor cost; `/stripe-account` surfaces financial-account controls. Nobody gains them on deploy day (§4), but an owner can grant them afterwards. That is the feature the user asked for. If it is not wanted for a specific page, the lever is `max_level_collaborator = NULL` on that row.

### 3.5 What each module becomes

- **`src/lib/permissions/areas.ts`** — `AREA_DEFINITIONS` stops being a hand-kept list and is *derived* from `navigationGroups`, so a page added to the sidebar can never again be silently ungrantable. `AreaKey` stays an explicit union (33 members) because it is the contract with SQL; a unit test asserts the union and the derived definitions agree, which is the drift alarm. `Band` and `AreaGroupKey` are deleted — `ui_group` is now the sidebar group label and there are only five.
- **`src/lib/permissions/routeAreas.ts`** — collapses to near-identity: one row per area, `path` from the catalog. `UNIVERSAL_PATHS`, `COLLABORATOR_PATH_EXCLUSIONS`, `satisfies`, `allowedPathsForAreas`, `customCollaboratorRoutes` keep their signatures. `/receipt-import` keeps its explicit `inventory:manage` row.
- **`src/components/roles/RoleEditor.tsx`** — five collapsible groups, each with a roll-up tri-state (No access / View / Manage) and an "N/M pages" summary; the header goes MIXED as soon as one page differs. Expanded, one row per page with the page's real sidebar label and icon.
- **`src/components/roles/RolePreviewPanel.tsx`** / **`preview.ts`** — the preview becomes a literal render of the sidebar this role will get, with a marker on the pages they can change. `preview.ts`'s `NavPreviewGroup.label` already comes from `navigationGroups`; with `ui_group` now equal to the sidebar group label, preview and editor share one grouping.
- **`src/components/AppSidebar.nav.ts`** — unchanged. It is the source the other modules derive from.

---

## 4. Migration: nobody gains or loses access

Two mechanical fan-outs, both in one migration.

**(a) `role_areas` rows.** Each existing `(role, area, level)` row expands to the per-page rows that area covered *at that level*. `books:manage` → `manage` on all nine books pages. `scheduling:view` → `scheduling:view` only; `scheduling:manage` → `manage` on scheduling, time_punches and tips.

**The one asymmetric case:** `books:view` must **skip** `print_checks`. Today `/print-checks` is the only books path gated at `manage` (`src/lib/permissions/routeAreas.ts:74`), so a role holding `books:view` cannot open it. Fanning `books:view` out to `print_checks:view` would hand every books-viewer a check-printing page. `books:view` → view on the other eight; `books:manage` → manage on all nine.

`reports:view` → `dashboard:view` + `reports:view`. `inventory:view` → `inventory:view` only; `inventory:manage` → `inventory:manage` + `inventory_audit:manage`. `recipes:*` → same level on `recipes` and `prep_recipes`. `team` and `collaborators` are already separate and stay as-is. The five new areas get **no** rows — no role gains them.

**(b) `user_has_capability`'s VALUES map.** Second column re-points; third column preserves today's tier. `('view:invoices','books','view')` → `('view:invoices','invoices','view')`. `('view:tips','scheduling','manage')` → `('view:tips','tips','view')` — the level moves down because the *area* moved: `tips:view` after the fan-out is held by exactly the roles that held `scheduling:manage` before. `('view:pending_outflows','books','view')` → `('view:pending_outflows','print_checks','view')`, likewise. The legacy `role_id IS NULL` CASE branch and the four pre-map special cases are copied verbatim and untouched.

**The proof this preserved behavior.** `supabase/tests/roles_seed_test.sql` already asserts, for each of the ten builtin roles and in both directions, that the capability set derived from its `role_areas` equals the untouched `ROLE_CAPABILITIES` transcription from `src/lib/permissions/definitions.ts`. That transcription does **not** change here. Re-deriving the test's `test_area_capability_at_level` fixture for 33 areas and getting a green run is the round-trip proof. Per the "underline the noun" lesson, the assertion is per-role and exhaustive, not a spot check.

`tests/unit/routeAreas.test.ts` is the second net: its `SEEDED_COLLABORATOR_AREAS` fixture is re-transcribed to the post-migration grants, and `allowedPathsForAreas` must still reproduce each builtin collaborator's hand-written `COLLABORATOR_ROUTES` list byte-for-byte.

**Grant posture.** No new tables, so no `pg_default_acl` exposure — but the migration re-seeds `area_catalog`, and per the 2026-08-02 lesson (confirmed three times) any table touched here gets its grants re-read rather than assumed.

---

## 5. Testing

| Layer | What it proves | Where |
|---|---|---|
| pgTAP | Every builtin role's derived capability set still equals `ROLE_CAPABILITIES`, both directions, per role | `supabase/tests/roles_seed_test.sql` (fixture re-derived) |
| pgTAP | `area_catalog` has exactly 33 rows, five distinct `ui_group`s, `sort_order` unique within group; `team`/`collaborators` cap NULL; every no-edit page capped at `view` | new `supabase/tests/page_areas_catalog_test.sql` |
| pgTAP | `role_areas_enforce_collaborator_cap` still raises 42501 for `team` and for `manage` on a view-capped page | extend `user_has_capability_areas_test.sql` |
| Vitest | `AREA_DEFINITIONS` derived from `navigationGroups` covers every `AreaKey` and every nav path — the drift alarm | `tests/unit/areas.test.ts` |
| Vitest | Calibration: seeded collaborator areas → hand-written allow-lists | `tests/unit/routeAreas.test.ts` |
| Vitest | Editor roll-up: group goes MIXED on one differing page; group control writes every page in the group | `tests/unit/RoleEditor.test.tsx` |
| Playwright | Create a custom role, grant Invoices only, confirm the preview sidebar shows Invoices and not Banking; save and reopen | `tests/e2e/roles-and-areas.spec.ts` (extend) |

The E2E is a hard gate under the workflow's Phase 8 — this change alters user-facing behavior across a cross-layer seam, so it is Covered, not excepted.

---

## 6. Scope: two PRs

This is one subsystem but two independently shippable deliverables.

**PR 1 — the model.** Migration, `areas.ts`, `routeAreas.ts`, `preview.ts` regrouping, all tests re-calibrated. The editor keeps working throughout: it renders `AREA_DEFINITIONS`, which is now 33 rows in five sidebar-named groups. Un-polished but already correct, and already delivers the granularity ask — Tip Pooling and Invoices become independently grantable the moment this lands.

**PR 2 — the editor.** Collapsible groups, roll-up tri-state controls, "N/M pages" summaries, the sidebar-literal preview panel. Pure UI on top of PR 1's model. Delivers the intuitiveness ask.

Splitting the other way (UI first) is not possible — the UI has nothing to render until the catalog is per-page.

---

## 7. Decisions needed before implementation

**7.1 The Accountant's dead `/budget` link (§1, defect 3).** `collaboratorAccountantNav` shows it (`src/components/AppSidebar.nav.ts:120`); `COLLABORATOR_ROUTES.collaborator_accountant.allowed` omits it (`src/App.tsx:203-218`). Two ways to end the mismatch:

- *(a) Grant it.* Seed `budget:view` on the Accountant builtin and add `/budget` to its hand-written allow-list. The link starts working. This is a **new grant to an existing external role** — every current Accountant collaborator gains the Budget & Run Rate page on deploy.
- *(b) Remove the link.* Drop `/budget` from `collaboratorAccountantNav`. Nobody gains anything; the dead link stops being offered.

Recommendation: **(b)**. It fixes the defect without changing anyone's access, and §4's "nobody gains or loses on deploy day" stays literally true. An owner who *wants* their accountant to see the budget can grant it afterwards through the new editor — which is the whole point of the change.

**7.2 Fully per-page, or keep some pairs fused?** Recipes/Prep Recipes and Inventory/Audit are the candidates. Recommendation: **fully per-page**. Fusing reintroduces exactly the defect being fixed, and the roll-up control in PR 2 makes granting a whole group one click anyway.

**7.3 The sensitive-data flags band.** `view:costs`, `view:pay_rates`, `view:employee_pii` are cross-cutting — they are not pages and are read from `role_flags` independently of areas. They stay exactly as they are, in their own band below the five groups. No change proposed.

**7.4 The editor mirrors the full internal menu**, not the viewer's own role-filtered sidebar. An owner editing a role must see every page they could delegate, including ones their own role filters out. Stated so it is not later mistaken for a bug.

---

## 8. Out of scope

- Per-restaurant custom menu ordering. `navigationGroups` stays a static module.
- Row- or field-level permissions inside a page.
- Changing the four builtin collaborators' hand-written `COLLABORATOR_ROUTES` lists, except as §7.1 decides.
- Anything touching `role_flags` semantics.
