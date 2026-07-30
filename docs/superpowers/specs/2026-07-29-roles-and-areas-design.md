# Design: Data-driven roles built from areas

**Date:** 2026-07-29
**Branch:** `feature/roles-and-areas`
**Status:** Design — pending Phase 2.5 review

## Problem

Adding a role today requires a migration, a TypeScript union change, a
capability array, a hand-written nav array, and a pgTAP test. Restaurants
cannot name their own roles, and the four collaborator presets are the only
external-specialist shapes on offer.

The user's ask, verbatim in intent:

> I need the permissions to work by assigning an area to a role. I like that
> we already define named roles as "collaborators". I want to keep this
> experience, but I want the ability to create more "collaborator" names and
> the ability to assign the areas each collaborator role has access to.
> Users continue to be assigned a role and that drives the permissions they get.

## What the code does today (verified claims)

Every claim below carries a `file:line`. Production figures come from
read-only `pg_policies` / `information_schema` queries against
`ncdujvdgqtaunuyigflp` on 2026-07-29.

### The TypeScript side is a static table

- `Role` is a closed union of 10 string literals —
  [types.ts:27-37](src/lib/permissions/types.ts:27).
- `Capability` is a closed union of ~60 `action:resource` literals —
  [types.ts:45-110](src/lib/permissions/types.ts:45).
- `ROLE_CAPABILITIES: Record<Role, readonly Capability[]>` is the client-side
  source of truth — [definitions.ts:17](src/lib/permissions/definitions.ts:17).
  The collaborator block runs
  [definitions.ts:205-287](src/lib/permissions/definitions.ts:205).
- `usePermissions()` resolves **synchronously** off that static table: it reads
  `selectedRestaurant?.role` ([usePermissions.ts:79](src/hooks/usePermissions.ts:79))
  and indexes `ROLE_CAPABILITIES[role]`
  ([usePermissions.ts:102-103](src/hooks/usePermissions.ts:102)). There is no
  network call in the permission path.
- `selectedRestaurant` originates from one query joining `user_restaurants`
  with `restaurants` — [useRestaurants.tsx:66-71](src/hooks/useRestaurants.tsx:66).
- `isCollaboratorRole()` is a **naming-convention check**,
  `role.startsWith('collaborator_')` —
  [definitions.ts:446-448](src/lib/permissions/definitions.ts:446). It is
  consumed for `isCollaborator` / `isInternalTeam`
  ([usePermissions.ts:118-119](src/hooks/usePermissions.ts:118)).
- `landingPath` is a hardcoded string per role, 10 of them —
  [definitions.ts:300-385](src/lib/permissions/definitions.ts:300).
- Sidebar nav is a hand-authored array per role selected by a `switch (role)` —
  [AppSidebar.nav.ts:265-283](src/components/AppSidebar.nav.ts:265).

### The SQL side has two tiers, and the capability funnel is the *smaller* one

`user_has_capability(p_restaurant_id, p_capability)` is a `SECURITY DEFINER`
`CASE` over the role string — current definition at
[20260723120000_add_collaborator_operations_manager_role.sql](supabase/migrations/20260723120000_add_collaborator_operations_manager_role.sql).

Measured against **live production policies** (`pg_policies`, schema `public`):

| Measure | Count |
|---|---|
| Total RLS policies | 500 |
| Policies that call `user_has_capability` | **43** |
| Policies that name a role literal and do **not** call it | **224** |
| Distinct tables carrying policies | 158 |
| Tables reachable by any `collaborator_*` role | **20** |
| Tables behind the capability function | 17 |
| Union of the two (the collaborator-reachable surface) | **37** |

So the capability function is not the funnel — it governs 8.6% of policies.
This is the single most important constraint on the design: a role that exists
only as a row in a new table is invisible to 224 policies.

Those 224 are **formulaic, not bespoke**. 210 of them inline a
`user_restaurants` subquery, and their role sets collapse to ten shapes:

| Role set | Policies | Tables |
|---|---|---|
| `{owner, manager}` | 104 | 56 |
| `{owner, manager, operations_manager, collaborator_operations_manager}` | 46 | 16 |
| `{owner, manager, chef}` | 21 | 13 |
| `{owner, manager, operations_manager}` | 8 | 5 |
| `{owner, manager, chef, staff}` | 4 | 2 |
| `{owner, manager, collaborator_accountant}` | 3 | 3 |
| `{owner}` | 3 | 3 |
| `{owner, manager, operations_manager, collaborator_operations_manager, kiosk}` | 1 | 1 |
| `{owner, manager, staff, chef}` | 1 | 1 |
| `{kiosk}` | 1 | 1 |

(16 further matches are membership-only subqueries with no role filter; one is
a false positive on a `{draft, in_progress}` status column.)

### Storage

`user_restaurants.role` is `text`, default `'staff'`, guarded by a CHECK
enumerating exactly the 10 known roles. 156 memberships exist across 35
restaurants.

### Two real defects this design should close

1. **`view:assets` / `edit:assets` exist in SQL but not in TypeScript.** The
   SQL `CASE` answers them
   ([20260723120000…sql](supabase/migrations/20260723120000_add_collaborator_operations_manager_role.sql)),
   but neither appears in the `Capability` union
   ([types.ts:45-110](src/lib/permissions/types.ts:45)) nor in
   `ROLE_CAPABILITIES` ([definitions.ts:17](src/lib/permissions/definitions.ts:17)).
   The two sources of truth have already drifted.

2. **Cost-visibility is an intent the model cannot express.** Comments state
   "Inventory management without cost visibility"
   ([definitions.ts:229](src/lib/permissions/definitions.ts:229)) and "Recipe
   development without cost/margin visibility"
   ([definitions.ts:244](src/lib/permissions/definitions.ts:244)). No capability
   enforces either. Note the precise scope: these are **code comments, not
   user-facing copy** — the preset `features` arrays
   ([definitions.ts:393-441](src/lib/permissions/definitions.ts:393)) make no
   such promise to users. So this is an unenforceable design intent, not a
   broken promise shown in the UI.

## Approach

### The model

An **area** is a named bundle of existing `view:*`/`edit:*` capability pairs,
granted at one of three levels: no access, view, or manage. Ten areas across
three bands (Operations, Money, People & admin). Three cross-cutting
**sensitive-data flags** (`view:costs`, `view:pay_rates`, `view:employee_pii`)
apply *inside* granted areas — these are the new capabilities that make defect
(2) expressible.

Schema:

```
roles(id, restaurant_id NULL, name, description, flavor, builtin, created_at)
role_areas(role_id, area_key, level)        -- level: 'view' | 'manage'
role_flags(role_id, flag)                   -- the sensitive switches
```

`restaurant_id IS NULL` means a **global builtin**: one set of 10 seeded rows
shared by every restaurant, rather than 350 per-restaurant copies plus a
trigger for new signups. Custom roles carry a real `restaurant_id`. Uniqueness
is a partial unique index on `(restaurant_id, lower(name))` plus a second one
for the global rows.

`flavor` is `'platform' | 'collaborator'`, reusing the existing `AccessGroup`
distinction ([types.ts:130](src/lib/permissions/types.ts:130)).

### Why custom roles are fail-closed by construction

`user_restaurants` gains a nullable `role_id uuid` referencing `roles(id)`.
The existing `role text` column **stays and keeps its meaning**:

- A membership on a builtin role keeps its legacy string (`'owner'`,
  `'collaborator_accountant'`, …) and additionally points `role_id` at the
  seeded builtin row.
- A membership on a custom role stores the new literal
  `role = 'collaborator_custom'` and points `role_id` at the custom row.

The consequence is the safety property that makes this shippable: all 224
legacy policies compare `role` against literals that `'collaborator_custom'`
never matches, so a custom role is **denied by default on every table this
design does not explicitly touch**. No existing membership changes, and no
existing policy's meaning changes.

Custom roles therefore work on exactly the 37-table collaborator-reachable
surface, which is rewritten to funnel through `user_has_capability`. That is
not a compromise — it is precisely the surface a collaborator can reach today.

**Rejected alternative:** a `builtin_equivalent` column letting a custom role
inherit a builtin's whole legacy footprint. This is the exact shape of the
[2026-07-09] "parity with an internal role over-grants" lesson — it would grant
a "Bookkeeper" the accountant's full 224-policy footprint regardless of which
areas were actually ticked. Rejected on that precedent.

### Keeping `usePermissions` synchronous

Making capabilities data-driven must not turn every permission check into a
network waterfall, which would produce a flash-of-no-access on every page.
`useRestaurants` already fetches memberships in one query
([useRestaurants.tsx:66-71](src/hooks/useRestaurants.tsx:66)); it is extended
to embed the role's areas and flags in the same round trip. `usePermissions`
keeps its synchronous `Set`-based signature
([usePermissions.ts:110-116](src/hooks/usePermissions.ts:110)) and derives
capabilities from the embedded grants instead of indexing a static table. No
call site changes.

`Role` stays a *union of builtin ids* for the six internal roles that continue
to be referenced by name, and gains a `string` custom-role branch. This is
deliberately narrower than "make `Role` an opaque id", which would ripple
through every `role === 'owner'` comparison in the app for no benefit in this
phase.

`isCollaboratorRole`'s `startsWith('collaborator_')` check
([definitions.ts:446](src/lib/permissions/definitions.ts:446)) cannot survive
user-named roles and is replaced by reading `flavor` off the resolved role.

### Derived nav and landing path

`AppSidebar.nav.ts`'s `switch (role)`
([AppSidebar.nav.ts:265-283](src/components/AppSidebar.nav.ts:265)) is replaced
by a filter over the full nav tree keyed on granted areas. Landing path becomes
the first granted area in a fixed priority order, replacing the ten hardcoded
strings ([definitions.ts:300-385](src/lib/permissions/definitions.ts:300)).
Builtin roles must produce byte-identical nav and landing paths after this
change — that is a test, not an aspiration.

## Migration sequence

Each step is independently deployable and leaves the app working.

1. **Create `roles` / `role_areas` / `role_flags`** with RLS. Read: any member
   of the restaurant (plus global builtins). Write: `manage:collaborators`
   holders only, and never against `builtin = true` rows.
2. **Seed the 10 builtin roles** as global rows, with area grants derived
   mechanically from `ROLE_CAPABILITIES`
   ([definitions.ts:17](src/lib/permissions/definitions.ts:17)) so day-one
   capability output is byte-identical.
3. **Add `user_restaurants.role_id`** (nullable, FK) and backfill it from the
   existing `role` string. No CHECK change yet.
4. **Extend the CHECK** to admit `'collaborator_custom'`.
5. **Rewrite `user_has_capability`** to resolve `role_id` → areas → flags →
   capabilities, falling back to the existing `CASE` when `role_id IS NULL`.
   The fallback is what makes step 5 safe to deploy before step 3's backfill
   is verified.
6. **Rewrite the 37-table collaborator-reachable policy set** to call
   `user_has_capability`. Per the [2026-07-09] lesson, each WRITE grant maps to
   a capability the role actually holds — not to wherever a sibling role
   appeared.
7. **Add `view:assets` / `edit:assets` to the TypeScript union**, closing the
   drift found above.

Steps 1–4 are additive and reversible. Step 6 is the only one that changes an
existing policy's meaning, and it is confined to tables collaborators already
reach.

**Migration prefix:** must sort after `main`'s newest migration at the time of
merge, and be re-verified on every `main` merge — the [2026-07-23] collision
lesson has now fired twice.

## Testing

- **pgTAP:** for each of the 10 builtin roles, assert the new
  `user_has_capability` returns exactly the same answer as the old one for
  every capability. This is the regression net for steps 2 and 5.
- **pgTAP:** a custom role is denied on a representative sample of the 121
  untouched tables (the fail-closed property).
- **pgTAP:** builtin rows reject UPDATE/DELETE.
- **Unit:** nav and landing path derived from areas match the current
  hardcoded output for all 10 builtins.
- **Unit:** custom-role name uniqueness per restaurant (the [2026-07-09]
  label-collision lesson).
- **E2E:** owner creates a custom collaborator role, grants two areas, invites
  a user to it, and that user sees exactly those areas — this is the
  cross-layer seam the Phase 8 gate requires.

## Decided trade-offs

- **Custom roles are collaborator-flavored in this phase.** `flavor` exists in
  the schema and builtins are seeded with `'platform'`, but the creation UI
  offers collaborator only. Widening to platform custom roles requires
  classifying the remaining 121 tables into areas — 121 judgment calls, each a
  chance to over-grant. Deferred deliberately.
- **`role text` is not dropped.** It stays as the fail-closed backstop for the
  224 untouched policies. Dropping it is a follow-up, gated on step 6 being
  extended to all 158 tables.
- **`Role` does not become an opaque id.** Narrower change, same user outcome.
- **`operations_manager` (0 users) and `chef` (1 user) are not removed.**
  Tempting given the usage data, but role deletion is orthogonal to this
  feature and would widen the blast radius.

### Copy role to other restaurants

Multi-unit operators need this: 9 users hold memberships in more than one
restaurant, one of them across 19. Because a custom role is a `roles` row plus
its `role_areas` / `role_flags` children, copying is an insert, not a
migration — a single `SECURITY DEFINER` RPC that clones the three rows into a
target restaurant after checking the caller holds `manage:collaborators` **in
that target**. The UI is a multi-select of the caller's other restaurants on
the role editor.

Name collisions are resolved by rejecting the copy for restaurants that
already have a role of that name and reporting them back, rather than silently
suffixing — per the [2026-07-09] label-collision lesson, an ambiguous role name
is worse than a failed copy.

## Out of scope

Role deletion/merge tooling, per-restaurant overrides of builtin roles, and any
change to internal role behavior.
