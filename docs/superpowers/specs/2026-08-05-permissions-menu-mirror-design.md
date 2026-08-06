# Permissions that mirror the menu — design

**Date:** 2026-08-05
**Branch:** `feature/permissions-menu-mirror`
**Status:** PR 1 implemented on `feature/permissions-menu-mirror` (see §6 for scope; §7 resolutions below reflect the shipped code, not the original proposal)

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

**Fifteen area keys onto eleven `ui_group`s**, not fourteen/ten. `reviews` was added on 2026-08-04 by `supabase/migrations/20260804100000_reviews_area.sql`, which renumbered `sort_order >= 6` upward. The SQL's own column comment is correct — *"Fifteen keys collapse onto eleven ui_groups."* — but the client mirror's doc comments still say "fourteen" at `src/lib/permissions/areas.ts:10, 20, 26, 34, 249, 359`, and say "ten editor rows" at `:144` and `:360`, while its *code* already carries fifteen `AreaKey` members and eleven `AREA_DEFINITIONS` rows. Those comments are stale and this change corrects them.

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

Four special cases sit *before* the map, and two of them **hardcode an area key in their own SQL** rather than going through the map — this is the trap that makes a naive re-cut break production:

```sql
IF p_capability = 'view:ai_assistant' THEN            -- ra.area_key = 'reports' AND ra.level = 'manage'
IF p_capability = 'view:financial_intelligence' THEN  -- ra.area_key = 'books'  AND ra.level IN ('view','manage')
```

(`supabase/migrations/20260804100000_reviews_area.sql`, the `v_role_id IS NOT NULL` block.) The other two — `manage:subscription` (direct role_id comparison against the Owner builtin) and the three sensitive flags (read `role_flags` directly) — reference no area and are genuinely untouched. §4 handles the two that are.

**Routing is a second, separate layer.** `AREA_ROUTES` (`src/lib/permissions/routeAreas.ts:40-85`) maps 28 paths to `(area, minLevel)`. It exists only for *custom* collaborator roles — the four builtin collaborators keep hand-written allow-lists in `COLLABORATOR_ROUTES` (`src/App.tsx:200`). `tests/unit/routeAreas.test.ts` is the calibration net: feeding each builtin collaborator's seeded `role_areas` through `allowedPathsForAreas` must reproduce that role's hand-written list exactly.

---

## 3. The design

**One area per page in the sidebar.** `area_catalog` grows from 15 keys to 33. `ui_group` becomes the sidebar group label; `sort_order` becomes the item's position in the sidebar. The editor then has nothing to invent — it renders the menu.

### 3.1 The catalog

33 rows. 32 of them are the 32 gateable items in `navigationGroups` (33 items minus `/help`, which stays universal — `src/lib/permissions/routeAreas.ts:88`). The 33rd is `collaborators`, explained below.

**Existing keys keep their names even where the name and the path differ** — `sales` gates `/pos-sales`, `purchasing` gates `/purchase-orders`. Renaming an `area_key` is a primary-key update on a row that builtin `role_areas` rows reference under an FK with no `ON UPDATE` clause (`supabase/migrations/20260730100000_roles_and_areas_tables.sql:229`, therefore `RESTRICT`), and those child rows cannot be updated (§4.0). Cosmetic renames are not worth that. **Exactly one key retires: `books`.** Every other existing key survives with a narrowed meaning.

**Main** — `dashboard` `/`, `integrations` `/integrations`, `sales` `/pos-sales`, `ops_inbox` `/ops-inbox`, `reviews` `/reviews`, `weekly_brief` `/weekly-brief`

**Operations** — `scheduling` `/scheduling`, `time_punches` `/time-punches`, `tips` `/tips`, `payroll` `/payroll`, `labor` `/labor`

**Inventory** — `recipes` `/recipes`, `prep_recipes` `/prep-recipes`, `inventory` `/inventory`, `inventory_audit` `/inventory-audit`, `purchasing` `/purchase-orders`, `reports` `/reports`

**Accounting** — `budget` `/budget`, `customers` `/customers`, `invoices` `/invoices`, `stripe_account` `/stripe-account`, `banking` `/banking`, `expenses` `/expenses`, `print_checks` `/print-checks`, `assets` `/assets`, `financial_intelligence` `/financial-intelligence`, `transactions` `/transactions`, `chart_of_accounts` `/chart-of-accounts`, `financial_statements` `/financial-statements`

**Admin** — `employees` `/employees`, `team` `/team`, `collaborators` `/team`, `settings` `/settings`

### 3.2 Four deliberate exceptions to "one row per menu item"

Naming them here so nobody later reads them as sloppiness.

1. **`collaborators` is a second Admin row on the same page.** The Team page hosts two tabs and they are separately gated: `view:team`/`manage:team` vs `view:collaborators`/`manage:collaborators`. Fusing them would grant `manage:collaborators` to the internal Operations Manager builtin, which holds `team:manage` and no `collaborators` row at all (`supabase/migrations/20260730110000_seed_builtin_roles.sql`, Operations Manager block). That is a real privilege grant, so the two stay separate. The editor shows them as *Team members* and *Collaborators* under a single "Team" heading.

2. **`/receipt-import` folds into `inventory` at `manage`.** It is reachable by a collaborator (`src/App.tsx:226`) and declared in `collaboratorInventoryNav` (`src/components/AppSidebar.nav.ts:156`), but it is *not* a `navigationGroups` item — an owner reaches it from inside Inventory. Giving it a catalog row would invent a menu entry that does not exist. It keeps its current home: `inventory:manage`.

3. **`view:batches` / `edit:batches` and `view:inventory_transactions` / `edit:inventory_transactions` stay on `recipes` and `inventory`.** Neither has a page of its own anywhere in the app.

4. **`view:pending_outflows` / `edit:pending_outflows` move to `print_checks`.** The capability is named after the data, the page is named after the action, and `/print-checks` is the only page that reads it.

### 3.3 Levels and caps

For every page-area: `view` = that page's `view:X` capability; `manage` = `view:X` plus `edit:X`.

Pages with no edit capability get **no manage tier**, so the editor locks the Manage segment and `max_level_collaborator` is `'view'`: `dashboard`, `sales`, `financial_statements`, `financial_intelligence`, plus the five new areas. This is the "read-only surfaces lock Manage" guard, and it now falls out of the catalog instead of being hand-asserted.

**`reports` keeps a manage tier, and it is not cosmetic.** `view:ai_assistant` is resolved by a hardcoded `ra.area_key = 'reports' AND ra.level = 'manage'` check (§2), so `reports:manage` is a live grant that four builtins hold today (Owner, Manager, Operations Manager, Operations Manager (Collaborator) — `supabase/migrations/20260730110000_seed_builtin_roles.sql`). Manage on the Reports row means "and the AI assistant"; the editor carries that as the row's manage-tier note. Modelling `reports` as view-only would have silently killed AI Assistant for those four roles — the failure mode this section exists to prevent.

`team` and `collaborators` keep `max_level_collaborator = NULL` — ungrantable to any collaborator-flavored role at any level. The SQL trigger `role_areas_enforce_collaborator_cap` is the real guard; `COLLABORATOR_PATH_EXCLUSIONS` (`src/lib/permissions/routeAreas.ts:101`) stays as the second lock.

`print_checks` keeps a row note in the editor — writing a check moves money — and, because it is now its own area, "no access to Print Checks while keeping the rest of the books" becomes expressible for the first time.

### 3.4 The five new areas carry no capability

`ops_inbox`, `weekly_brief`, `budget`, `labor`, `stripe_account` get catalog rows and `routeAreas` entries but **no rows in `user_has_capability`'s map**. They have no capability today, and inventing five would mean inventing five legacy-CASE branches whose only correct value is "whatever the page does now" — i.e. nothing. They are gated purely by routing, which is exactly how they are gated today; the change is that the gate becomes *grantable* instead of a hardcoded exclusion.

Consequence, stated plainly: **this makes P&L-adjacent pages delegable to an external collaborator for the first time.** `/budget` and `/labor` surface run-rate and labor cost; `/stripe-account` surfaces financial-account controls. Nobody gains them on deploy day (§4), but an owner can grant them afterwards. That is the feature the user asked for. If it is not wanted for a specific page, the lever is `max_level_collaborator = NULL` on that row.

### 3.5 What each module becomes

- **`src/lib/permissions/areas.ts`** — `AREA_DEFINITIONS` stops being a hand-kept list and is *derived* from `navigationGroups`, so a page added to the sidebar can never again be silently ungrantable. `AreaKey` stays an explicit union (33 members) because it is the contract with SQL; a unit test asserts the union and the derived definitions agree, which is the drift alarm. `Band` and `AreaGroupKey` are deleted — `ui_group` is now the sidebar group label and there are only five.
- **`src/lib/permissions/routeAreas.ts`** — collapses to near-identity: one row per area, `path` from the catalog. `UNIVERSAL_PATHS`, `COLLABORATOR_PATH_EXCLUSIONS`, `satisfies`, `allowedPathsForAreas`, `customCollaboratorRoutes` keep their signatures. `/receipt-import` keeps its explicit `inventory:manage` row.
- **`src/components/roles/RoleEditor.tsx`** — five collapsible groups, each with a roll-up control and an "N/M pages" summary. Expanded, one row per page with the page's real sidebar label and icon. Interaction model in §3.6.
- **`src/components/roles/RolePreviewPanel.tsx`** / **`preview.ts`** — the preview becomes a literal render of the sidebar this role will get, with a marker on the pages they can change. Two real rewrites here, not the near-no-ops an earlier draft of this doc implied:
  - `buildNavPreview` groups by `row.band` today (`src/lib/permissions/preview.ts:180-183`), not by anything from `navigationGroups` — only individual *item* labels come from the sidebar, via `findNavLabel` (`:77-83`). The grouping key changes from `band` to the catalog's `ui_group`.
  - The panel currently renders unreachable pages struck through and dimmed, and a passing test pins that by name (`tests/unit/RolePreviewPanel.test.tsx:63-68`, *"strikes through and dims a nav item whose area is not granted"*). "A literal render of the sidebar" means unreachable pages are **absent**, not decorated. That test is rewritten, not extended.
- **`src/lib/permissions/preview.ts`'s copy tables** — `PHRASE` (`:106-118`, 11 entries keyed by the deleted `AreaGroupKey`), `AREA_HINT` and `AREA_LOCK_REASON` all key off bundles that no longer exist. Per-page hint copy is authored once on the generated catalog row (`hint`, `manageHint`), which is where the mockup already put it (`docs/design-reference/permissions-menu-mirror.html:415-468`). `buildSummary`'s "can't touch" logic hardcodes four bundle categories (`preview.ts:151-159`) and is rewritten to read group roll-up state.
- **`src/components/AppSidebar.nav.ts`** — unchanged. It is the source the other modules derive from.

### 3.6 The group roll-up is a command, not a fourth radio

The per-page rows keep today's control unchanged: a Radix `RadioGroupPrimitive.Root` with three segments (`src/components/roles/RoleEditor.tsx:284-334`, `LevelControl`).

The **group** control must not be one. A roll-up over 6–12 pages has a fourth state — mixed — and ARIA's `radio` role has no `aria-checked="mixed"`; only `checkbox` does. The mockup gets this wrong: `segHTML` emits `aria-checked="${!mixed && level===v}"` (`docs/design-reference/permissions-menu-mirror.html:481-492`), so a mixed group reports `aria-checked="false"` on all three segments — indistinguishable from "nothing chosen" — and the "Mixed" label is a CSS-only overlay with no `aria-live` and no `aria-describedby` wiring. A screen-reader user cannot tell a mixed group from an empty one.

Worse, a true radiogroup commits on arrow-key focus movement alone. Tabbing through a collapsed editor and brushing an arrow key would flatten every page in the group — silently destroying a hand-tuned split like "Manage Invoices, View-only Customers."

So the group control is:

```
role="group"  aria-label="Accounting — set all pages"  aria-describedby="accounting-rollup-state"
  ├── <button>No access</button>   ← one-shot command, commits on activation only
  ├── <button>View</button>
  └── <button>Manage</button>
<span id="accounting-rollup-state">9 of 12 pages · mixed</span>   ← visible text, the accessible state
```

Three plain buttons, no fabricated `aria-checked`, no commit-on-focus. The segmented *visual* is unchanged; only the semantics are. The disclosure toggle and the roll-up stay **siblings** inside the header — the mockup's zero-nested-interactive-elements property (`permissions-menu-mirror.html:106`, `.ghead`) is a hard constraint for PR 2, and wrapping the header in a single Radix `Collapsible.Trigger` would break it.

Two more behaviours the roll-up needs:

- **Mixed groups default to expanded**, uniform and empty groups to collapsed. A collapsed "9/12 · mixed" header cannot tell you *which* page differs, and the one differing page is the entire subject of the user's complaint. Collapsed groups must be `display:none` (as the mockup does at `:132`) so their rows leave both the tab order and the accessibility tree.
- **The roll-up skips pages the role is capped out of** rather than failing. Setting Accounting to Manage on a collaborator role leaves `financial_statements` at View, because that page has no manage tier — the resulting state is legitimately mixed, and the summary says so.

One layout note carried over from the mockup: `.ghead` has no `flex-wrap` (`permissions-menu-mirror.html:106`) while the ≤640px rule forces `.seg{width:100%}` (`:169-172`). A 100%-wide roll-up inside a non-wrapping header overflows on a phone. The header wraps at that breakpoint; the group title and the "N/M pages" summary take the first line, the roll-up the second.

---

## 4. Migration: nobody gains or loses access

### 4.0 Mechanics — the triggers and the FK dictate the order

The obvious migration (delete the old rows, insert the new) **fails**, twice over. Both facts were verified in source before writing this section.

1. `role_areas_block_builtin_mutation` is `BEFORE UPDATE OR DELETE ON public.role_areas FOR EACH ROW`, and its function raises `ERRCODE 42501` whenever the row's `role_id` belongs to a builtin role (`supabase/migrations/20260730100000_roles_and_areas_tables.sql:419-465`). There is **no service-role or migration exemption** — a migration running as superuser still fires it. Every builtin's `books` row is therefore undeletable in the normal path, and all ten builtins are exactly what this migration must rewrite.
2. `role_areas.area_key` references `area_catalog(area_key)` with no `ON DELETE` clause (`:229`), so it is `RESTRICT`. The `books` catalog row cannot go until every `role_areas` row pointing at it is gone.

Note the asymmetry that makes this tractable: the trigger is `BEFORE UPDATE OR DELETE` only. **Inserting** new `role_areas` rows for a builtin role is already permitted — that is how `20260730110000_seed_builtin_roles.sql` seeded them in the first place. Only the removal of the `books` rows needs the trigger out of the way.

Fixed order, one transaction:

```sql
ALTER TABLE public.role_areas DISABLE TRIGGER role_areas_block_builtin_mutation;

-- 1. new catalog rows; re-point ui_group/sort_order on survivors
INSERT INTO public.area_catalog (...) VALUES ...;
UPDATE public.area_catalog SET ui_group = ..., sort_order = ..., band = ... WHERE ...;

-- 2. fan out: insert the per-page rows (§4a) before removing anything
INSERT INTO public.role_areas (role_id, area_key, level) SELECT ... FROM public.role_areas WHERE area_key = 'books' ...;
INSERT INTO public.role_areas (role_id, area_key, level) SELECT ... FROM public.role_areas WHERE area_key = 'reports' ...;
-- (scheduling, inventory, recipes fan-outs follow the same plain-INSERT shape)

-- 3. now the old rows can go, then the catalog row they pin
DELETE FROM public.role_areas  WHERE area_key = 'books';
DELETE FROM public.area_catalog WHERE area_key = 'books';

ALTER TABLE public.role_areas ENABLE TRIGGER role_areas_block_builtin_mutation;
```

Each fan-out is a plain `INSERT`, not an upsert. No `ON CONFLICT` is needed: every fan-out targets keys that were only just inserted in step 1 (§4.1), no two fan-outs share a target key, and `role_areas.area_key` is `RESTRICT`-FK'd to `area_catalog`, so no pre-existing `role_areas` row can already reference a key this migration just created. A plain `INSERT` therefore cannot conflict — and if that premise is ever wrong, a loud unique-violation is the correct failure mode, not a silent overwrite.

**The trigger must come back on, and a test must prove it.** `DISABLE TRIGGER` is durable schema state: a migration that errors between the disable and the enable leaves the collaborator-escalation guard **off in production**, silently, with no other symptom. `supabase/tests/page_areas_catalog_test.sql` asserts `tgenabled = 'O'` for all four guards after migration (§5). This is the single highest-risk step in the change and it gets its own assertion rather than being folded into a broader one.

`role_flags` is not touched, so `role_flags_block_builtin_mutation` stays enabled throughout.

### 4.1 The fan-outs

Two mechanical fan-outs, both in the migration above.

**(a) `role_areas` rows.** Each existing `(role, area, level)` row expands to the per-page rows that area covered *at that level*. `books:manage` → `manage` on all nine books pages. `scheduling:view` → `scheduling:view` only; `scheduling:manage` → `manage` on scheduling, time_punches and tips.

**The one asymmetric case:** `books:view` must **skip** `print_checks`. Today `/print-checks` is the only books path gated at `manage` (`src/lib/permissions/routeAreas.ts:74`), so a role holding `books:view` cannot open it. Fanning `books:view` out to `print_checks:view` would hand every books-viewer a check-printing page. `books:view` → view on the other eight; `books:manage` → manage on all nine.

`reports:view` → `dashboard:view` + `reports:view`; `reports:manage` → `dashboard:view` + `reports:**manage**` — the manage level must survive on the `reports` row itself, because `view:ai_assistant` reads it directly (§3.3). `dashboard` has no manage tier, so it takes `view` from either. `inventory:view` → `inventory:view` only; `inventory:manage` → `inventory:manage` + `inventory_audit:manage`. `recipes:*` → same level on `recipes` and `prep_recipes`. `team` and `collaborators` are already separate and stay as-is. The five new areas get **no** rows — no role gains them.

Only `books` produces rows that must then be deleted; every other source key survives as one of its own targets (§3.1), so the fan-out is additive for them.

**(b) `user_has_capability`'s VALUES map.** Second column re-points; third column preserves *the set of roles that satisfy the capability*, which is not always the same as preserving the literal tier. Four rows move down a tier for that reason:

| Row today | Row after | Why the tier moves |
|---|---|---|
| `('view:tips','scheduling','manage')` | `('view:tips','tips','view')` | `tips:view` post-fan-out is held by exactly the roles that held `scheduling:manage` |
| `('view:time_punches','scheduling','manage')` | `('view:time_punches','time_punches','view')` | same |
| `('view:inventory_audit','inventory','manage')` | `('view:inventory_audit','inventory_audit','view')` | same, via `inventory:manage` |
| `('view:pending_outflows','books','view')` | `('view:pending_outflows','print_checks','view')` | area moves (§3.2 exception 4); `books:view` skipped `print_checks` in the fan-out, so the holder set is unchanged |

Every other row keeps its tier and only re-points its area — `('view:invoices','books','view')` → `('view:invoices','invoices','view')`.

**The pre-map special cases are not all untouched.** `view:financial_intelligence` hardcodes `ra.area_key = 'books'` (§2), and `books` is the one key that retires — leaving it would make the check reference a key with no catalog row and no grants, silently denying Financial Intelligence to everyone. It re-points to `'financial_intelligence'`, keeping `level IN ('view','manage')`. `view:ai_assistant` genuinely does stay verbatim: it reads `reports` at `manage`, and both survive. `manage:subscription` and the three sensitive flags reference no area and are copied unchanged, as is the whole legacy `role_id IS NULL` CASE branch.

**The proof this preserved behavior.** `supabase/tests/roles_seed_test.sql` already asserts, for each of the ten builtin roles and in both directions, that the capability set derived from its `role_areas` equals the untouched `ROLE_CAPABILITIES` transcription from `src/lib/permissions/definitions.ts`. That transcription does **not** change here. Re-deriving the test's `test_area_capability_at_level` fixture for 33 areas and getting a green run is the round-trip proof. Per the "underline the noun" lesson, the assertion is per-role and exhaustive, not a spot check.

`tests/unit/routeAreas.test.ts` is the second net: its `SEEDED_COLLABORATOR_AREAS` fixture is re-transcribed to the post-migration grants, and `allowedPathsForAreas` must still reproduce each builtin collaborator's hand-written `COLLABORATOR_ROUTES` list byte-for-byte.

**Grant posture.** No new tables, so no `pg_default_acl` exposure — but the migration re-seeds `area_catalog`, and per the 2026-08-02 lesson (confirmed three times) any table touched here gets its grants re-read rather than assumed.

---

## 5. Testing

| Layer | What it proves | Where |
|---|---|---|
| pgTAP | Every builtin role's derived capability set still equals `ROLE_CAPABILITIES`, both directions, per role | `supabase/tests/roles_seed_test.sql` (fixture re-derived) |
| pgTAP | `area_catalog` has exactly 33 rows, five distinct `ui_group`s, `sort_order` unique within group; `team`/`collaborators` cap NULL; every no-edit page capped at `view` | new `supabase/tests/page_areas_catalog_test.sql` |
| pgTAP | **All four builtin-guard triggers are still enabled after migration** (`pg_trigger.tgenabled = 'O'`) — §4.0's disable/enable window left nothing off | new `supabase/tests/page_areas_catalog_test.sql` |
| pgTAP | `role_areas_enforce_collaborator_cap` still raises 42501 for `team` and for `manage` on a view-capped page | extend `user_has_capability_areas_test.sql` |
| pgTAP | `view:financial_intelligence` still resolves for every role that holds it today, after the hardcoded `books` → `financial_intelligence` re-point (§4b) | extend `user_has_capability_areas_test.sql` |
| Vitest | `AREA_DEFINITIONS` derived from `navigationGroups` covers every `AreaKey` and every nav path — the drift alarm | `tests/unit/areas.test.ts` |
| Vitest | Calibration: seeded collaborator areas → hand-written allow-lists | `tests/unit/routeAreas.test.ts` |
| Vitest | Preview groups by sidebar `ui_group`, not `band`; ungranted pages are **absent** rather than struck through (rewrites `:63-68`) | `tests/unit/RolePreviewPanel.test.tsx` |
| Vitest | Editor renders 33 rows across 5 groups (replaces the "ten area rows as RadioGroups" assertion at `:186-203`); roll-up is a `role="group"` of buttons, not a radiogroup | `tests/unit/RoleEditor.test.tsx` |
| Vitest | Editor roll-up: group goes MIXED on one differing page; group control writes every page in the group, skipping capped ones | `tests/unit/RoleEditor.test.tsx` |
| Playwright | Create a custom role, grant Invoices only, confirm the preview sidebar shows Invoices and not Banking; save and reopen | `tests/e2e/roles-and-areas.spec.ts` (extend) |

The E2E is a hard gate under the workflow's Phase 8 — this change alters user-facing behavior across a cross-layer seam, so it is Covered, not excepted.

---

## 6. Scope: two PRs

This is one subsystem but two independently shippable deliverables.

**PR 1 — the model.** Migration, `areas.ts`, `routeAreas.ts`, `preview.ts` regrouping, all tests re-calibrated. The editor keeps working throughout: it renders `AREA_DEFINITIONS`, which is now 33 rows in five sidebar-named groups. Un-polished but already correct, and already delivers the granularity ask — Tip Pooling and Invoices become independently grantable the moment this lands.

**PR 2 — the editor.** Collapsible groups, roll-up tri-state controls, "N/M pages" summaries, the sidebar-literal preview panel. Pure UI on top of PR 1's model. Delivers the intuitiveness ask.

Splitting the other way (UI first) is not possible — the UI has nothing to render until the catalog is per-page.

---

## 7. Decisions (resolved — see progress.md "Decisions locked by the user" for the record of when/how)

**7.1 The Accountant's dead `/budget` link (§1, defect 3).** Resolved as **(b) remove the link**, not grant it. `/budget` is dropped from `collaboratorAccountantNav` (`src/components/AppSidebar.nav.ts`, commit `f092bbc4`); `COLLABORATOR_ROUTES.collaborator_accountant.allowed` was already omitting it, so the two are consistent again. Verified in the shipped code: `collaboratorAccountantNav`'s `Financial` group has no `/budget` entry. The general (non-collaborator) `navigationGroups` Accounting group in `AppSidebar.nav.data.ts` still lists `/budget` — that is a *different* array (the main app sidebar, not the Accountant collaborator's hand-written nav) and is unaffected by this decision; `budget` is grantable through the new editor like any other area, per §7.2/§4.1, and nobody holds it on deploy day.

**7.2 Fully per-page, or keep some pairs fused?** Resolved as **fully per-page**, with two intentional exceptions kept fused per §3.2: `batches` stays absorbed into `recipes`, and `inventory_transactions`/`receipt_import` stay absorbed into `inventory` (both are sub-flows of their parent page, not independent sidebar entries, so they have no page of their own to split into). Recipes/Prep Recipes and Inventory/Audit — the two pairs this decision was actually about — did split into independent `prep_recipes` and `inventory_audit` catalog keys, exactly as recommended.

**7.3 The sensitive-data flags band.** Resolved as **no change** — `view:costs`, `view:pay_rates`, `view:employee_pii` remain in `SENSITIVE_FLAGS`, read from `role_flags` independently of `AREA_DEFINITIONS`/areas, unchanged by this migration.

**7.4 The editor mirrors the full internal menu**, not the viewer's own role-filtered sidebar. Confirmed in `RoleEditor.tsx`: rows are built by walking all 33 `AREA_DEFINITIONS`, not a role-filtered subset — an owner editing a role sees every delegable page regardless of what their own role's sidebar shows.

---

## 8. Out of scope

- Per-restaurant custom menu ordering. `navigationGroups` stays a static module.
- Row- or field-level permissions inside a page.
- Changing the four builtin collaborators' hand-written `COLLABORATOR_ROUTES` lists, except as §7.1 decides.
- Anything touching `role_flags` semantics.
