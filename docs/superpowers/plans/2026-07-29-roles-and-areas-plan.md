# Implementation plan — data-driven roles built from areas

**Date:** 2026-07-29
**Branch:** `feature/roles-and-areas`
**Design:** `docs/superpowers/specs/2026-07-29-roles-and-areas-design.md`
**Status:** Plan — awaiting approval

No real tenant, person, restaurant or email enters any file, fixture, commit
message or the PR body. All test data is fictional.

## Shape of the change

| Layer | Files | Steps |
|---|---|---|
| Schema | 4 new migrations, 4 new pgTAP tests | 1–4 |
| Capability fn | 1 migration, 1 pgTAP test | 5 |
| RLS rewrite | 1 migration, 1 pgTAP test | 6 |
| TS permissions | `types.ts`, `definitions.ts`, new `areas.ts` | 7 |
| Data layer | `useRestaurants.tsx`, `usePermissions.ts`, new `useRoles.ts` | 8 |
| UI | `CollaboratorInvitations.tsx`, new `RoleEditorDialog.tsx` | 9 |
| Nav | `AppSidebar.nav.ts` | 9 |

Nine tasks, ordered so the tree is green and the app works after each. Tasks
1–7 are server-side and invisible to users; the app runs on the legacy path
throughout. Task 8 switches the client to the new resolution. Task 9 is the
first user-visible change.

**Migration prefixes** start at `20260730100000` and step by `010000`. Main's
newest is `20260729120000`. Per the [2026-07-23] lesson — which has now fired
twice — these get re-verified on every `main` merge, not just at authoring
time.

---

## Task 1 — the three tables

**Test first.** `supabase/tests/roles_schema_test.sql`, pgTAP,
`BEGIN/plan(N)/finish()/ROLLBACK`. Seed two fictional restaurants and three
principals (an owner, a manager, a non-member). Assert:

1. `roles.created_at` is `timestamptz` — `has_column`/`col_type_is`. Per the
   design's TZ note; this test is why the mistake cannot ship.
2. A `manage:collaborators` holder can INSERT a custom role in their own
   restaurant.
3. **Denied baseline first:** a non-member gets 0 rows selecting `roles` for
   that restaurant, *then* the owner gets rows — so the test cannot pass
   vacuously ([2026-07-13] lesson).
4. A manager without `manage:collaborators` cannot INSERT.
5. Global builtins (`restaurant_id IS NULL`) are readable by any member of any
   restaurant.
6. `role_areas` / `role_flags` inherit tenant scope through the parent join: a
   non-member of restaurant A cannot read A's custom role's areas.
7. `role_areas.level` rejects a value outside `{'view','manage'}`.
8. **Builtin immutability survives RLS being off.** `SET LOCAL row_security =
   off`, then `throws_ok` on UPDATE and on DELETE of a builtin row. This is the
   test that distinguishes the trigger from the policy — with only the RLS
   policy it fails.
9. Same, for `role_areas` / `role_flags` rows whose parent is builtin.
10. A custom role named `'owner'` (any casing) is rejected — the
    builtin-shadowing trigger.
11. Two custom roles with the same name in one restaurant collide; the same
    name in two different restaurants does not.
12. **Per-area level caps are enforced server-side.** `throws_ok` on granting
    a collaborator-flavored role `manage` on Dashboard & Reports, Sales,
    Payroll, or Settings & Integrations; `throws_ok` on granting it *any*
    level of Team & Access. Then assert the builtin `owner` row legitimately
    holds Team & Access at manage, so the guard is not simply blanket-denying.
13. The cap guard survives `SET LOCAL row_security = off`, like the
    immutability guard — it is an escalation boundary, not a policy.

**Then** `supabase/migrations/20260730100000_roles_and_areas_tables.sql`:

- `roles(id uuid pk default gen_random_uuid(), restaurant_id uuid null
  references restaurants(id) on delete cascade, name text not null,
  description text, flavor text not null check (flavor in
  ('platform','collaborator')), builtin boolean not null default false,
  created_at timestamptz not null default now())`
- `role_areas(role_id uuid references roles(id) on delete cascade, area_key
  text not null, level text not null check (level in ('view','manage')),
  primary key (role_id, area_key))`
- `role_flags(role_id uuid references roles(id) on delete cascade, flag text
  not null, primary key (role_id, flag))`
- Indexes: `role_areas(role_id, area_key)` is the PK, so it serves; add
  `role_flags(role_id, flag)` likewise as PK. Both have `role_id` leading, per
  the design. Plus `roles(restaurant_id)` for the list query.
- Unique: partial unique on `(restaurant_id, lower(name)) WHERE restaurant_id
  IS NOT NULL`, and `(lower(name)) WHERE restaurant_id IS NULL`.
- `area_catalog(area_key pk, band text, sort_order int, max_level_collaborator
  text null)` — `null` meaning ungrantable to collaborators (Team & Access).
  A table rather than a CHECK constraint so the trigger and the UI read the
  same source and cannot drift.
- Triggers: `BEFORE UPDATE OR DELETE ON roles` raising when `OLD.builtin`;
  equivalents on the two child tables checking the parent; `BEFORE INSERT OR
  UPDATE ON roles` rejecting a name that case-insensitively matches a builtin;
  and `BEFORE INSERT OR UPDATE ON role_areas` rejecting a level above the
  area's `max_level_collaborator` when the parent role is
  `flavor='collaborator' AND builtin = false`. That last one is the
  privilege-escalation boundary — see the design's per-area caps table.
- RLS enabled on all three, policies per design (read: members + globals;
  write: `manage:collaborators`; children join through `roles`).

## Task 2 — seed the ten builtins

**Test first.** `supabase/tests/roles_seed_test.sql`. For each of the 10
builtin roles, assert the seeded `role_areas` + `role_flags` reproduce exactly
the capability set the current `CASE` grants — iterate every capability and
compare. This is the regression net for the whole design: if the derivation is
wrong, the seed is wrong, and every downstream step inherits it.

**Then** `20260730110000_seed_builtin_roles.sql` — 10 `roles` rows with
`restaurant_id IS NULL, builtin = true`, `flavor='platform'` for the six
internal roles and `'collaborator'` for the four collaborator presets, plus
their derived `role_areas` / `role_flags`.

The derivation is mechanical from `ROLE_CAPABILITIES`
([definitions.ts:17](src/lib/permissions/definitions.ts:17)) and must be
written out literally in the migration, not computed — a migration that
computes its own seed from a table that later changes is not reproducible.

## Task 3 — `user_restaurants.role_id`

**Test first.** `supabase/tests/user_restaurants_role_id_test.sql`: after
backfill, every one of the existing memberships has a non-null `role_id`
pointing at the builtin matching its `role` string; the FK rejects a dangling
id.

**Then** `20260730120000_add_user_restaurants_role_id.sql`: nullable
`role_id uuid references roles(id)`, backfill by joining on the legacy string,
index on `(user_id, restaurant_id, role_id)`. No CHECK change.

## Task 4 — admit `collaborator_custom`

**Then** `20260730130000_allow_collaborator_custom_role.sql` — drop and
recreate the CHECK on `user_restaurants.role` with the 11th literal. Covered
by task 5's tests; no separate test file.

## Task 5 — rewrite `user_has_capability`

**Test first.** `supabase/tests/user_has_capability_areas_test.sql`:

1. For all 10 builtins × every capability, the new function returns exactly
   what the old one did. The old definition is inlined into the test as a
   fixture function so the comparison is real rather than self-referential.
2. `role_id IS NULL` falls back to the legacy `CASE`.
3. A custom role with `{inventory: manage}` gets `edit:inventory` and not
   `edit:recipes`.
4. Sensitive flags gate inside a granted area: a role with `{inventory:
   manage}` and no `view:costs` flag gets `edit:inventory` but not
   `view:costs`.
5. **Denied baseline first** on each of the above.

**Then** `20260730140000_user_has_capability_from_areas.sql`. `STABLE SECURITY
DEFINER SET search_path = public` — restated per the design, not inherited.

**Performance gate.** Same file as the test: an `EXPLAIN ANALYZE` on a
representative query against a rewritten-policy table, asserting no sequential
scan on `role_areas`/`role_flags` and that cost is within 2× of the legacy
path. This runs in `npm run test:db`.

## Task 6 — rewrite the 37-table policy set

**Test first.** `supabase/tests/collaborator_custom_rls_test.sql`:

1. A custom role granted `{inventory: view}` can SELECT inventory rows in its
   own restaurant and cannot UPDATE them.
2. Granted `{inventory: manage}`, it can UPDATE.
3. **The fail-closed property, tested rather than trusted:** the same custom
   role is denied on a sample of untouched tables drawn from each of the ten
   role-set shapes in the design's table.
4. Cross-tenant: the custom role sees nothing in a second restaurant.
5. Denied baseline first throughout.

**Then** `20260730150000_rewrite_collaborator_policies.sql`. Per the
[2026-07-09] lesson each WRITE grant maps to a capability the role actually
holds — never to wherever a sibling role happened to appear in the old policy.
Each rewritten policy gets a one-line comment naming the capability it now
requires, so the mapping is reviewable in the diff rather than inferred.

## Task 7 — the TypeScript area model

**Test first.** `tests/unit/areas.test.ts`: the ten area definitions expand to
capability sets; expanding all areas at `manage` plus all three flags yields
exactly the owner capability set; `view:assets`/`edit:assets` are present in
the union.

**Then:**
- `src/lib/permissions/types.ts` — add `view:assets`/`edit:assets` to
  `Capability` (closing the drift), add `view:costs`/`view:pay_rates`/
  `view:employee_pii`, widen `Role` with a custom-role branch.
- `src/lib/permissions/areas.ts` (new) — the ten `AreaDefinition`s, their band
  grouping, and `expandAreas(grants, flags): Capability[]`. Single source of
  truth mirroring the SQL seed.
- `definitions.ts` — `ROLE_CAPABILITIES` unchanged in this task; it stays as
  the fallback until task 8.

## Task 8 — client resolution

**Test first.** `tests/unit/usePermissions.test.ts`:

1. `isResolved` is false while the context is loading, and every sensitive
   flag reads false in that window.
2. A custom role's capabilities come from its embedded areas, not from
   `ROLE_CAPABILITIES`.
3. A builtin role's capabilities are unchanged.
4. `isCollaborator` reads `flavor`, not `startsWith('collaborator_')`.
5. `landingPath` resolves for a custom role rather than falling through to
   `'/'` ([usePermissions.ts:126](src/hooks/usePermissions.ts:126)).

**Then:**
- `useRestaurants.tsx` — convert to React Query, `staleTime: 30000`,
  `refetchOnWindowFocus: true`, key `['restaurants', user.id]`. This removes an
  existing CLAUDE.md violation (raw `useState`/`useEffect` at
  [:56-61](src/hooks/useRestaurants.tsx:56)) as a prerequisite, and is the
  reason a role change now reaches a signed-in user without a reload. Extend
  the select to embed `role:roles(...)` with its areas and flags.
- `usePermissions.ts` — derive from embedded grants; surface `isResolved` from
  the context's existing `loading`
  ([RestaurantContext.tsx:91](src/contexts/RestaurantContext.tsx:91)); keep the
  synchronous `Set` signature so no call site changes.
- `src/hooks/useRoles.ts` (new) — list/create/update/delete/copy, React Query,
  key `['roles', restaurantId]`, mutations invalidating both that key and
  `['restaurants']` (a role edit changes the current user's own capabilities).

**Verification gate:** run the full existing unit suite. Task 8 is where a
regression would be silent and wide, so a green suite here is the checkpoint
before any UI work.

## Task 9 — the UI

**Test first.** `tests/e2e/roles-and-areas.spec.ts`: an owner opens Team
Management, creates a collaborator role, grants two areas, saves, invites a
fictional user to it, and that user signs in and sees exactly those areas.
Selectors are `getByRole('radiogroup' | 'radio' | 'switch')` — which doubles
as the accessibility assertion, since a `ToggleGroup` implementation would not
be findable. The spec also asserts the capped levels are disabled and that the
preview's grant counter moves when an area is toggled.

**Visual verification.** After the UI is built, run the app and screenshot the
roles list and the editor at desktop and mobile, light and dark, and compare
against `list.png` / `editor.png` / `editor-dark.png` / `mobile.png`.
Discrepancies in layout, chip treatment, band grouping, or the preview panel
get fixed before the PR — the user's instruction was that the shipped
experience match the approved design as closely as possible.

**Then**, matching the approved prototype
(`scratchpad/roles-and-areas.html`, screenshots `list.png` / `editor.png` /
`editor-dark.png` / `mobile.png`) — these are the visual reference and the
build is checked against them, not just against prose:

- `src/lib/permissions/preview.ts` (new) — the pure derivation
  `(grants, flags) → { summary, navPreview, grantCount }`. Written first
  because both the editor preview and the sidebar consume it, which is what
  keeps them from drifting. Unit tested directly.
- `src/components/roles/RolesList.tsx` (new) — the card grid: area chips
  (accent + `· manage` at manage level, muted at view), member counts,
  `BUILT-IN`/`CUSTOM` badges, dashed "New role" card. Built-in cards open the
  editor read-only.
- `src/components/roles/RoleEditor.tsx` (new) — **a full page, not a dialog.**
  Two columns at `lg`, single column below with the preview in normal flow
  beneath the form. Identity card with the member-count warning banner, then
  ten areas in three bands, each a `RadioGroup` styled as a segmented control
  with an `aria-label`; capped levels `disabled` + `aria-disabled` with the
  reason as accessible description; three `Switch`es with prose explanations;
  the copy-to-restaurants multi-select.
- `src/components/roles/RolePreviewPanel.tsx` (new) — sticky preview: prose
  summary including the "can't" half, the rendered sidebar with struck-through
  unreachable items / `READ ONLY` / `OPENS HERE`, and the grant counter.
- `CollaboratorInvitations.tsx` — replace all four static bindings: the preset
  grid ([:159-196](src/components/CollaboratorInvitations.tsx:159)), the
  `Role | null` selection state ([:38](src/components/CollaboratorInvitations.tsx:38)),
  the `preset.features` bullets ([:201](src/components/CollaboratorInvitations.tsx:201))
  → a summary derived from granted areas, and the invite mutation
  ([:97](src/components/CollaboratorInvitations.tsx:97)) → send both the
  literal and `role_id`. `roleIcons` needs no change; it already falls back.
- `AppSidebar.nav.ts` — the builtin arrays are **retained verbatim**. Add only
  the custom-role branch: derive from areas, then apply the exclusion list.
  Loading/error/empty states handled per CLAUDE.md; semantic tokens only.
- `20260730160000_copy_role_to_restaurants.sql` — the copy RPC. `SECURITY
  DEFINER SET search_path = public`, with the target-restaurant
  `manage:collaborators` check running **before any INSERT** as the sole gate,
  and name collisions reported back rather than suffixed. pgTAP alongside:
  the check raises and inserts nothing when unauthorized.

---

## Risks

**The seed derivation (task 2) is the single point of failure.** Everything
downstream assumes the ten builtins reproduce today's behavior exactly. Task
2's test compares against the live `CASE` for every role × capability pair,
which is the only way to make that assumption checkable rather than hoped-for.

**Task 6 is the only irreversible-feeling step.** It changes the meaning of
existing policies. It is confined to the 37 tables collaborators already
reach, and its test asserts the denied baseline first, but this is the task to
review most carefully.

**Scope note.** Custom roles are collaborator-flavored only in this phase, per
the design's decided trade-offs. The schema supports platform custom roles;
the UI does not offer them, because that needs 121 further tables classified
into areas.

## Out of scope

Role deletion/merge tooling, per-restaurant overrides of builtin roles, any
change to internal role behavior, and dropping the legacy `role text` column.
