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
- The role data behind `selectedRestaurant` arrives in one query joining
  `user_restaurants` with `restaurants`
  ([useRestaurants.tsx:66-71](src/hooks/useRestaurants.tsx:66)). Precisely:
  that query returns the user's whole `UserRestaurant[]` list; the selection of
  which one is "current" happens in `RestaurantContext`. The point that matters
  here is that the role travels with the membership list, so no extra round
  trip is needed to know it.
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

Those 224 are **formulaic, not bespoke**. They span 118 distinct tables, 210 of
them inline a `user_restaurants` subquery (the other 14 reach the role by some
other join), and their role sets collapse to exactly ten shapes:

| Role set | Policies | Tables |
|---|---|---|
| `{owner, manager}` | 128 | 73 |
| `{owner, manager, operations_manager, collaborator_operations_manager}` | 46 | 16 |
| `{owner, manager, chef}` | 25 | 15 |
| `{owner, manager, operations_manager}` | 9 | 6 |
| `{owner}` | 5 | 5 |
| `{owner, manager, chef, staff}` | 5 | 3 |
| `{owner, manager, collaborator_accountant}` | 3 | 3 |
| `{owner, manager, operations_manager, collaborator_operations_manager, kiosk}` | 1 | 1 |
| `{staff, kiosk}` | 1 | 1 |
| `{kiosk}` | 1 | 1 |

The policy column sums to 224 — every role-literal policy is accounted for.
(The table column does not sum to 118: a table can carry policies of more than
one shape.)

**The fail-closed property, verified rather than assumed.** The whole design
rests on `'collaborator_custom'` never accidentally matching one of these 224.
Queried directly against production, of the 224: **0** use negation
(`!=`, `<>`, `NOT IN`, `!~`), **0** use pattern matching (`LIKE`, `SIMILAR TO`,
regex), and **0** contain the token `NOT` anywhere in their `USING` or
`WITH CHECK` expression. All 224 are positive enumeration — `role IN (…)` or
`role = ANY(ARRAY[…])`. An unrecognized role string is therefore denied, never
admitted, on every one of them.

### Storage

`user_restaurants.role` is `text`, default `'staff'`, guarded by a CHECK
enumerating exactly the 10 known roles. 156 memberships exist across 35
restaurants.

### Three real defects this design should close

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

3. **`collaborator_inventory` holds `view:reports` in SQL but not in
   TypeScript.** Found while writing Task 5's round-trip test, not by the
   original audit. The SQL `CASE` grants it
   ([20260723120000…sql:120](supabase/migrations/20260723120000_add_collaborator_operations_manager_role.sql:120)),
   sitting in the middle of the inventory block; `ROLE_CAPABILITIES.collaborator_inventory`
   ([definitions.ts:228-241](src/lib/permissions/definitions.ts:228)) is that
   same list *minus* `view:reports`.

   **Resolved: follow TypeScript — Inventory Helper gets no `reports` grant.**
   The SQL grant is inert and was never intended to take effect:

   - No RLS policy anywhere references `view:reports` (verified against
     production `pg_policies`), so the grant gates nothing server-side.
   - The capability is consumed only client-side, and the client deliberately
     withholds Reports from this role.
     [App.tsx:206-210](src/App.tsx:206) documents it: `/reports` is excluded
     because Reports defaults to P&L Trends and exposes revenue/COGS/labor/
     margin, "Mirrors `collaborator_inventory`, which also holds `view:reports`
     but is not routed to `/reports`" (Codex P1, PR #596).
   - Production has **zero** `collaborator_inventory` memberships and zero
     invitations in any state, so nobody's access changes.

   Preserving the grant would be the actively harmful option here. This design
   **derives nav and landing path from areas** — so seeding Inventory Helper a
   `reports` area at `view` would newly route it to `/reports`, re-opening the
   exact P&L exposure PR #596 closed. Dropping it makes the enforcement layer
   agree with the intent the routing layer has expressed all along.

### A fourth drift, deliberately *not* closed here: `receipt_imports`

Found while mapping Task 6's policies. Unlike the three above, this one is
left exactly as it is, because closing it either way is a product decision
this design was never asked to make.

The three `receipt_imports` policies admit exactly
`{owner, manager, operations_manager, collaborator_operations_manager}`. The
capability named for the feature, `view:receipt_import` / `edit:receipt_import`,
resolves through `inventory` at `manage` and covers a **wider** set — it also
includes `chef` and `collaborator_inventory`. So the app layer believes Chef
can import receipts and the database refuses. Chef is not route-restricted at
all ([App.tsx](src/App.tsx) gates only kiosk, staff and collaborators), and
`collaborator_inventory` is explicitly routed to `/receipt-import`
([App.tsx:183](src/App.tsx:183)) — both reach the page and both are denied by
RLS today.

The narrowness is not an oversight. It was introduced by a migration titled
"SECURITY FIX … Restrict receipt imports to owners and managers"
([20251006212711…sql:79](supabase/migrations/20251006212711_4eb82642-2d43-473f-bcbb-143901533a61.sql:79)),
which replaced an any-member policy with `{owner, manager}`; the two later
widenings added only the operations-manager roles. Chef was never re-admitted.

Neither available move is acceptable inside a no-behavior-change refactor:

- Mapping to `edit:receipt_import` — the semantically correct name — would
  silently grant every Chef in every restaurant access they do not have
  today, reversing an explicit security fix as a side effect of a refactor.
  Chef is a heavily-used builtin and Task 3's backfill already gave every
  such membership a `role_id`, so this would take effect immediately.
- Mapping to one of the five capabilities whose legacy role list happens to
  match exactly (`edit:scheduling`, `view:tips`, `edit:tips`,
  `view:time_punches`, `edit:time_punches`) preserves behavior but is
  precisely what the [2026-07-09] lesson and this plan forbid: "each WRITE
  grant maps to a capability the role actually holds — never to wherever a
  sibling role happened to appear in the old policy."

**Resolution: leave the three `receipt_imports` policies on role literals.**
Task 6 rewrites the other 47 policies and skips these, with a comment on each
naming this section. Consequences, all acceptable: behavior is unchanged;
no comment in the diff claims a capability the policy does not check; and
custom roles cannot reach receipt imports, which is fail-closed and matches
the posture the rest of the design takes toward the 224 untouched policies.
Task 6's test asserts these three policies still carry literals, so a later
"cleanup" cannot quietly convert them to `edit:receipt_import` and widen
access without revisiting this.

**Open question for the operator**, deferred rather than answered: *should*
Chef be able to import receipts? If yes, the fix is to widen these policies
deliberately, in its own migration, reviewed as an access-control change. If
no, the fix is to drop `receipt_import` from Chef in `ROLE_CAPABILITIES` and
the capability `CASE` so the app stops offering a feature the database will
refuse. Either is a small change; neither belongs inside this refactor.

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

#### Ten rows in the editor, fourteen areas underneath

The ten areas above are what the **editor renders**. The `area_catalog` stores
**fourteen**, with a `ui_group` column collapsing them onto those ten rows.
Four areas are split:

| UI row | area_keys underneath |
|---|---|
| Inventory & Purchasing | `inventory`, `purchasing` |
| Money & Books | `books`, `chart_of_accounts` |
| Team & Access | `team`, `collaborators` |
| Settings & Integrations | `settings`, `integrations` |

The split is forced by the byte-identical promise below. Derived at ten coarse
areas, the six builtins do **not** round-trip: 12 capability mismatches across
11 role/area pairs. Seven are the same one — every non-owner role holds
`view:settings` but not `view:integrations`, so a single "Settings &
Integrations = view" grant hands each of them `view:integrations` they do not
have today. The rest are the same shape: `collaborator_chef` holds
`view:inventory` without `view:purchase_orders`; `manager` holds
`view:chart_of_accounts` without `edit:chart_of_accounts`;
`operations_manager` holds `view:team` without `view:collaborators`.

At fourteen areas the mismatch count is **zero** — every builtin derives
exactly from its current `ROLE_CAPABILITIES` entry. The alternatives
considered and rejected were: granting `manager` the missing capabilities
(a silent production privilege change, which this design promises not to
make), and special-casing the affected roles inside `user_has_capability`
(re-introduces exactly the hardcoding this work removes).

The cost is that a builtin can be **mixed** within one UI row —
`operations_manager` is `settings=view` but `integrations=none`. Builtins
render read-only, so the row shows the higher level with a "partial" marker
rather than a level control. Custom roles cannot be mixed: the editor's single
control per row writes every `area_key` in the group, which is why the schema
test asserts all members of a `ui_group` share one `max_level_collaborator`,
`band`, and `sort_order`.

`restaurant_id IS NULL` means a **global builtin**: one set of 10 seeded rows
shared by every restaurant, rather than 350 per-restaurant copies plus a
trigger for new signups. Custom roles carry a real `restaurant_id`.

`flavor` is `'platform' | 'collaborator'`. This is a **subset** of the existing
`AccessGroup` union, which is four-way
([types.ts:130](src/lib/permissions/types.ts:130)) — the column reuses two of
its members, it does not reuse the type. Naming them identically is
deliberate, but the design must not imply the two are interchangeable.

`created_at` — and any timestamp column added to `role_areas` / `role_flags` —
is **`timestamptz`, not `timestamp`**. Called out explicitly because two
recent incidents in this repo (`c675d566`, `34172f80`) were timezone
off-by-ones, and a new table is exactly where that mistake gets made once and
lived with.

**Uniqueness must cover builtin-vs-custom collisions.** A partial unique index
on `(restaurant_id, lower(name))` for custom rows, plus a second for the global
rows, does *not* stop a restaurant from creating a custom role named "Owner" —
the two rows differ in `restaurant_id`, so no index is violated, yet the role
picker would show two entries called Owner meaning entirely different things.
Since this design already invokes the [2026-07-09] label-collision lesson for
the copy feature, it applies here too: role creation rejects any name that
case-insensitively matches a builtin's name. Enforced in a `BEFORE INSERT OR
UPDATE` trigger, not in the UI, since the UI is not the only writer.

**Builtin immutability needs a trigger, not an RLS policy.** The invariant
"builtin rows reject UPDATE/DELETE" cannot be carried by RLS alone: RLS is
bypassed entirely by the service-role key, and this codebase's edge functions
routinely use it (CLAUDE.md: *"Edge functions use service role key"*), as well
as by any `SECURITY DEFINER` function owned by the table owner — which
includes `user_has_capability` and the copy-role RPC below. A future edge
function touching `roles` would silently mutate a builtin with no error. So the
enforcement is a `BEFORE UPDATE OR DELETE` trigger on `roles` that raises when
`OLD.builtin = true`, plus equivalent guards on `role_areas` / `role_flags` for
rows whose parent is builtin. The RLS write policy stays as defense in depth,
but it is not the invariant.

**Indexes.** `user_has_capability` today is one indexed lookup on
`user_restaurants(restaurant_id, user_id)`. The rewrite adds joins to
`role_areas` and `role_flags`, both keyed by `role_id`, so both need a
composite index with `role_id` leading: `role_areas(role_id, area_key)` and
`role_flags(role_id, flag)`. Without them each capability check degrades to a
sequential scan over tables that grow with every custom role created. Note
also that `STABLE` does **not** memoize across the per-row invocations of an
RLS-evaluated query — it permits reuse within a single evaluation context
only. The indexes are doing the work here, not the volatility class.

**RLS on the child tables.** `role_areas` and `role_flags` carry no
`restaurant_id` of their own, so their policies must join back through the
parent to establish tenant scope — `EXISTS (SELECT 1 FROM roles r WHERE
r.id = role_areas.role_id AND (r.restaurant_id IS NULL OR <caller is a member
of r.restaurant_id>))`. Stated explicitly rather than left implied by the
parent table's policy, because "the parent is protected" is not a property
Postgres propagates.

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

**Two caveats found in Phase 2.5 review:**

*`useRestaurants` is not a React Query hook.* It is raw `useState` +
`useEffect` with a manual `fetchRestaurants` callback and no cache, key, or
`staleTime` ([useRestaurants.tsx:56-61](src/hooks/useRestaurants.tsx:56)) —
which is already at odds with CLAUDE.md's "No Manual Caching / ONLY React
Query" rule. Extending it as-is would widen an existing violation and, more
concretely, would mean a role's grants are refetched only on mount: an owner
revoking an area would not reach a signed-in collaborator's UI until reload.
RLS remains authoritative so this is not a security hole, but it is a real
consistency gap. This design converts `useRestaurants` to React Query with a
30s `staleTime` as a prerequisite step, and the role-editor mutations
invalidate that key.

*The pre-resolution render window changes meaning.* Today `selectedRestaurant`
is `null` until the fetch resolves, and a `null` role yields "no capabilities"
— a benign false-negative, since nothing renders sensitive content on the
strength of an absent role. Under this design the same window also covers
`role_areas`/`role_flags`, and the sensitive flags (`view:costs`,
`view:pay_rates`, `view:employee_pii`) are exactly where a
`false`-then-flips-`true` transition is user-visible. `usePermissions`
therefore exposes an explicit `isResolved` flag, and consumers of the three
sensitive flags must render a skeleton rather than the un-flagged view while
it is false. Fail-closed, but distinguishably so.

The raw material for this already exists and is simply not wired up:
`RestaurantContext` exposes a `loading` boolean
([RestaurantContext.tsx:10](src/contexts/RestaurantContext.tsx:10),
[:91](src/contexts/RestaurantContext.tsx:91)) sourced from `useRestaurants`.
But the two role-gating sites in `App.tsx` destructure only
`selectedRestaurant` and never consult it —
[App.tsx:83-85](src/App.tsx:83) and [App.tsx:234-236](src/App.tsx:234). (The
`loading` guard at [App.tsx:126](src/App.tsx:126) is `useAuth`'s, a different
flag.) So `usePermissions` should surface the context's existing `loading` as
`isResolved` rather than inventing a new async state.

`Role` stays a *union of builtin ids* for the six internal roles that continue
to be referenced by name, and gains a `string` custom-role branch. This is
deliberately narrower than "make `Role` an opaque id", which would ripple
through every `role === 'owner'` comparison in the app for no benefit in this
phase.

`isCollaboratorRole`'s `startsWith('collaborator_')` check
([definitions.ts:446](src/lib/permissions/definitions.ts:446)) cannot survive
user-named roles and is replaced by reading `flavor` off the resolved role.

### Nav: areas decide eligibility, they do not decide the sidebar

**Corrected after Phase 2.5 review.** An earlier draft of this design claimed
the hand-written nav arrays could be replaced by a filter over granted areas,
producing byte-identical output. That claim was false, and the file it
concerns already documents why. `AppSidebar.nav.ts` encodes four classes of
decision that an `(area, level)` grant cannot express:

1. **Route-reachable but nav-hidden.** `/employees` "stays in the route
   allow-list for scheduling context, but is not surfaced in the sidebar"
   ([AppSidebar.nav.ts:223-225](src/components/AppSidebar.nav.ts:223)). An
   areas→nav filter uses the *same* signal for both reachability and
   visibility, so it structurally cannot represent this split.
2. **Cross-area suppression.** `/reports` is removed from
   `collaboratorOperationsManagerNav`'s Inventory group because the Reports
   page defaults to P&L — "Codex P1, PR #596"
   ([AppSidebar.nav.ts:227-229](src/components/AppSidebar.nav.ts:227),
   implemented at [:236-238](src/components/AppSidebar.nav.ts:236)). The role
   holds the Inventory area; one page inside it must still be hidden because
   of what that page defaults to.
3. **Group relabelling and trimming.** The Admin group is relabelled
   "Settings" and trimmed ([:239-243](src/components/AppSidebar.nav.ts:239)),
   with `/team` excluded as an explicit "fail-open risk flagged in Phase 2.5
   design review" ([:218-220](src/components/AppSidebar.nav.ts:218)).
4. **`viewMode === 'work'` is not a permission at all.** It collapses any role
   to `staffNav` *before* the role check, deliberately, to stop the sidebar
   flashing empty during a remount window
   ([:255-261](src/components/AppSidebar.nav.ts:255)).

Items 1–3 are scar tissue from real incidents. Deriving nav from areas would
silently reintroduce every one of them.

**So the model is:** areas determine *capability and route eligibility*. The
sidebar keeps its explicit per-role composition. For builtin roles the existing
arrays are retained verbatim — not regenerated. For a custom role, nav is
derived from granted areas as a *starting point*, then passed through the same
exclusion list that encodes decisions (1)–(3), expressed as data rather than
hand-written `.filter()` calls so a custom role cannot route around them.

The route allow-list and the sidebar stay two separate artifacts, because
`/employees` proves they genuinely are.

Landing path does become derived — the first granted area in a fixed priority
order, replacing ten hardcoded strings
([definitions.ts:300-385](src/lib/permissions/definitions.ts:300)). Note that
`usePermissions` currently falls back to `metadata?.landingPath ?? '/'`
([usePermissions.ts:126](src/hooks/usePermissions.ts:126)), and a custom role
has no `ROLE_METADATA` entry: the fallback must become "first granted area",
never `/`, or a custom role lands on a page it cannot see.

The regression test is that the six builtin roles' nav and landing paths are
unchanged — which is now a statement about code that is *retained*, not code
that is *reproduced*.

### The UI this replaces

`CollaboratorInvitations.tsx` is the screen in the user's screenshot, and it
is bound to the static preset table at every level — not just in its data
source. Four separate bindings have to change, and the migration sequence must
carry a step for them:

- The preset grid maps `COLLABORATOR_PRESETS` directly
  ([CollaboratorInvitations.tsx:159-196](src/components/CollaboratorInvitations.tsx:159)),
  so it renders exactly four immutable cards.
- Selection state is typed `Role | null`
  ([:38](src/components/CollaboratorInvitations.tsx:38)) — a closed union that
  a user-created role has no member of.
- The per-card capability bullets render `preset.features`
  ([:201](src/components/CollaboratorInvitations.tsx:201)), a hardcoded string
  array with no equivalent on a custom role. For custom roles this becomes a
  summary derived from granted areas ("Inventory · manage, Recipes · view").
- The invite mutation sends `role: selectedRole` and no role id
  ([:97](src/components/CollaboratorInvitations.tsx:97)); it must send both the
  `'collaborator_custom'` literal and `role_id`.

One thing that is *not* a problem: `roleIcons` already falls back to
`Calculator` for any unknown key at all six of its call sites
([:160](src/components/CollaboratorInvitations.tsx:160),
[:204](src/components/CollaboratorInvitations.tsx:204),
[:341](src/components/CollaboratorInvitations.tsx:341),
[:427](src/components/CollaboratorInvitations.tsx:427),
[:493](src/components/CollaboratorInvitations.tsx:493)), so custom roles get a
sane icon with no change. Confirmed explicitly because an earlier draft listed
it as work.

### The roles list

A third tab beside Team members and Invite, using the existing Apple-style
underline tab pattern from CLAUDE.md. A responsive grid of role cards, each
showing: icon box, name, description, the granted areas as chips — accent-
tinted with a `· manage` suffix at manage level, muted at view level, absent
when ungranted — a member count (`1 person` / `0 people`), and a `BUILT-IN`
or `CUSTOM` badge. A dashed-border "New role" card closes the grid.

The chips are the list's whole point: today's four preset cards show a
hardcoded feature list, so two roles that differ subtly look identical. Chips
derived from actual grants mean the difference between two roles is visible
without opening either.

Built-in cards open the editor read-only rather than not opening — seeing how
Accountant is composed is how an owner learns what to put in a custom role.

### The role editor

**Corrected against the approved prototype.** An earlier draft of this section
described the editor as a `max-w-2xl` dialog. The prototype the user approved
is a **full-page, two-column editor**, and three of its features are load
bearing rather than decorative. Building the dialog version would have shipped
something materially different from what was signed off.

**Layout.** A full page reached from the roles list, with a `← All roles`
back link. Left column (roughly 2/3): an identity card (role name, "what this
person does"), then the ten areas grouped into their three bands. Right column
(1/3, sticky): the live preview described below. Below `lg`, the preview drops
beneath the form in normal flow rather than being hidden — it is the thing
that tells the user what they just built, so it must survive mobile.

The identity card carries a warning banner when the role has members —
*"2 people have this role. Saving changes what they can reach the next time
they load a page."* — with the count from the role's membership query. This is
the only place the blast radius of an edit is visible.

Each band is a section with an uppercase `text-[12px] tracking-wider` header
row, and the Operations header additionally carries the column legend
(`NO ACCESS · VIEW · MANAGE`). Each area row is a name, a
`text-[13px] text-muted-foreground` description, and the three-state control.

**That control is a `RadioGroup`, not a `ToggleGroup`.** No access / View /
Manage are mutually exclusive values of one setting, which is radio semantics;
`ToggleGroup` is styled to look right but announces as a set of independent
pressed/unpressed buttons, which misdescribes a three-way choice. It is
rendered as a segmented control visually — `RadioGroup` with
`role="radiogroup"`, an `aria-label` naming the area, and the three
`RadioGroupItem`s styled as segments. This gets correct arrow-key navigation
within the group and tab-stops *between* groups for free, which is what makes
ten of these usable by keyboard rather than a 30-stop gauntlet.

**Per-area level caps — a model requirement the prototype revealed.** The
prototype disables specific levels with a lock icon, and this is not cosmetic:

| Area | Cap for a collaborator role | Why |
|---|---|---|
| Dashboard & Reports | view | nothing there is editable |
| Sales | view | *"Sales come from your POS — nobody edits them here."* |
| Payroll | view | Owners and Managers only |
| Settings & Integrations | view | Owners and Managers only |
| **Team & Access** | **none — no level grantable** | see below |

Team & Access being ungrantable is a **privilege-escalation guard**, and the
prototype states the reason in the UI: *"Owners and Managers only — a
collaborator can never grant access."* Without it, a collaborator role could
be granted `manage:collaborators`, and its holder could then mint themselves a
new role with every area — trivially escalating to owner. Any collaborator
role that could edit roles defeats the entire model.

Therefore the cap is **enforced in SQL, not in the UI**. A greyed-out control
is a hint; the guard is a `BEFORE INSERT OR UPDATE` trigger on `role_areas`
that rejects a grant exceeding the area's cap for the parent role's `flavor`.
The area catalog carries `max_level_collaborator` alongside its capability
mapping, and the same table drives both the trigger and the disabled state, so
the two cannot drift. Builtin roles are seeded before the trigger applies and
are exempt by `builtin = true` — `owner` legitimately holds Team & Access at
manage.

The three sensitive flags are `Switch`es
(`data-[state=checked]:bg-foreground`), each with a visible label and a
`text-[13px] text-muted-foreground` explanation of what it exposes — these are
the controls where a mis-set value leaks pay rates, so they get prose, not
just a name. They sit in their own section below the areas, since they cut
across all of them rather than belonging to any one.

Accessibility beyond the above: every switch has an `id` with a matching
`<Label htmlFor>`; the save button is disabled with an `aria-describedby`
pointing at the validation message when the name is empty or collides; capped
levels use `disabled` + `aria-disabled` with the reason text as their
accessible description, so a screen-reader user learns *why* Manage is
unavailable rather than just finding it inert; and the "copy to other
restaurants" multi-select is a labelled listbox, not a bare div of checkboxes.

### The live preview

The right column answers the question the old preset cards answered with a
hardcoded bullet list — *what does this role actually get?* — except computed
from the grants as they are toggled. Three parts:

1. **A prose summary.** *"Weekend Supervisor can read the dashboard and
   reports; see POS sales; build schedules, fix punches, and run tips; and see
   the roster. Can't touch the books, payroll, team settings, or costs and
   margins."* Generated from granted areas and, importantly, from the
   *ungranted* ones — the "can't" half is what makes an over-grant obvious.
2. **The rendered sidebar.** The actual nav groups, with reachable items
   normal, unreachable items struck through and dimmed, a `READ ONLY` marker
   on view-level items, and `OPENS HERE` on the landing path. This is the
   single most valuable element in the prototype: it makes the abstract
   area→nav derivation concrete before saving, and it is why the nav
   derivation logic must be a pure function usable outside the sidebar.
3. **A grant counter** — `Permissions this grants · 11 GRANTED`.

The preview is pure: `(grants, flags) → summary | navPreview | count`, with no
queries of its own, so it is straightforward to unit test and cannot drift
from what the sidebar renders because both call the same derivation.

## Migration sequence

Each step is independently deployable and leaves the app working.

1. **Create `roles` / `role_areas` / `role_flags`** with RLS, the immutability
   and name-collision triggers, and the two composite indexes. Read: any member
   of the restaurant (plus global builtins); child tables join back through
   `roles` for tenant scope. Write: `manage:collaborators` holders only, with
   `builtin = true` rows blocked by trigger rather than by policy.
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
   is verified. It **keeps its current signature exactly**: `STABLE SECURITY
   DEFINER SET search_path = public`. That combination has survived five
   rewrites of this function (`20260120100000`, `20260120100200`,
   `20260129000000`, `20260702170000`, `20260723120000`) and is verified live
   in `pg_proc`, but nothing in the codebase forces the next author to notice
   it — dropping `SET search_path` on a `SECURITY DEFINER` function is a
   privilege-escalation vector, so it is restated here as a requirement, not an
   inherited accident.
6. **Rewrite the 37-table collaborator-reachable policy set** to call
   `user_has_capability`. Per the [2026-07-09] lesson, each WRITE grant maps to
   a capability the role actually holds — not to wherever a sibling role
   appeared.
7. **Add `view:assets` / `edit:assets` to the TypeScript union**, closing the
   drift found above.
8. **Convert `useRestaurants` to React Query** (30s `staleTime`), then extend
   its select to embed `role_areas` / `role_flags`, and surface `isResolved`
   from `usePermissions`. Sequenced here because steps 1–7 leave the app
   working on the legacy path, and this is the first step that changes how the
   client reads permissions.
9. **Rebuild `CollaboratorInvitations.tsx`** against the roles table — the four
   bindings listed above — and add the role editor dialog. This is the step the
   E2E test below exercises; it cannot be folded into step 8 because it
   depends on the role-list query that step 8 introduces.

Steps 1–4 are additive and reversible. Step 6 is the only one that changes an
existing policy's meaning, and it is confined to tables collaborators already
reach. Steps 8–9 are client-only and ship behind the server work being live.

**Migration prefix:** must sort after `main`'s newest migration at the time of
merge, and be re-verified on every `main` merge — the [2026-07-23] collision
lesson has now fired twice.

## Testing

- **pgTAP:** for each of the 10 builtin roles, assert the new
  `user_has_capability` returns exactly the same answer as the old one for
  every capability. This is the regression net for steps 2 and 5.
- **pgTAP:** a custom role is denied on a representative sample of the 121
  untouched tables (the fail-closed property).
- **pgTAP:** builtin rows reject UPDATE/DELETE — and specifically that they do
  so *when RLS is not in force*, i.e. the test asserts the trigger fires, not
  the policy. A test that only proves the RLS path is passing on the easy case.
- **pgTAP:** a custom role cannot be named after a builtin (case-insensitively)
  within a restaurant.
- **pgTAP:** the copy-role RPC raises when the caller lacks
  `manage:collaborators` **in the target restaurant**, and inserts nothing.
- **Performance:** an `EXPLAIN ANALYZE` assertion comparing old vs. new
  `user_has_capability` cost on a representative row count, for a table on the
  rewritten policy set. `user_has_capability` sits on the RLS hot path for 43
  policies across 17 tables and the rewrite adds two joins to it; a regression
  here is a site-wide slowdown, and it should be caught by a test rather than
  in production.
- **Unit:** nav and landing path derived from areas match the current
  hardcoded output for all 10 builtins.
- **Unit:** custom-role name uniqueness per restaurant (the [2026-07-09]
  label-collision lesson).
- **Unit:** `usePermissions` reports `isResolved: false` while the context is
  loading, and every sensitive flag reads `false` in that window.
- **E2E:** owner creates a custom collaborator role, grants two areas, invites
  a user to it, and that user sees exactly those areas — this is the
  cross-layer seam the Phase 8 gate requires. Selectors are `getByRole`
  (`radiogroup` / `radio` / `switch`), which doubles as the accessibility
  assertion: if the segmented controls are built as toggle buttons, the test
  cannot find them.

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

`SECURITY DEFINER` here has a consequence worth naming rather than discovering:
it **bypasses the RLS write policy on `roles` / `role_areas` / `role_flags`
entirely** for this code path. The in-body `IF NOT
user_has_capability(p_target_restaurant_id, 'manage:collaborators') THEN RAISE
EXCEPTION` is therefore not defense in depth — it is the *only* gate, and it
must run before any INSERT, not interleaved with them. (The function also
carries `SET search_path = public`, for the same reason as step 5.) The
alternative — `SECURITY INVOKER`, letting RLS do the gating — was considered
and rejected because the caller legitimately needs to write into a restaurant
whose rows they are reading from another; the explicit per-target capability
check expresses that better than a policy would. The pgTAP test above exists
precisely because this gate is load-bearing and alone.

Name collisions are resolved by rejecting the copy for restaurants that
already have a role of that name and reporting them back, rather than silently
suffixing — per the [2026-07-09] label-collision lesson, an ambiguous role name
is worse than a failed copy.

## Out of scope

Role deletion/merge tooling, per-restaurant overrides of builtin roles, and any
change to internal role behavior.
