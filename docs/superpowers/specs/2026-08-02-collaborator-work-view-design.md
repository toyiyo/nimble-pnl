# Work view for collaborators who are also employees

**Date:** 2026-08-02
**Status:** Design
**Supersedes (in part):** [`2026-07-24-admin-work-view-mode-design.md`](2026-07-24-admin-work-view-mode-design.md) — the `canUseWorkView` rule and its collaborator bullet.

## The report

`josema92@hotmail.com` was moved from an employee-only membership to a
collaborator membership at *Wetzel's - Cold Stone - Alamo Ranch*. The
"You're viewing as" persona card no longer appears, so there is no way to
reach the My Work surface and validate the newly assigned permissions.

## Root cause

Two independent defects, both of which must be fixed for the symptom to go
away. Fixing only the first produces a *visibly broken* state, which is why
they are scoped into one change.

### Defect 1 — eligibility is keyed on the role's *name*

[`src/lib/viewModeEligibility.ts:28`](../../../src/lib/viewModeEligibility.ts) reads:

```ts
if (role.startsWith('collaborator_')) return false;
```

so `computeCanUseWorkView` returns `false`, and
[`src/components/ViewModeSwitch.tsx:75-77`](../../../src/components/ViewModeSwitch.tsx)
returns `null` — the card is suppressed, not broken.

The rule's justification is stated at
[`src/lib/viewModeEligibility.ts:9`](../../../src/lib/viewModeEligibility.ts):
*"`collaborator_*` are external scoped roles that must never see employee
self-service."* That premise held when collaborators were only
accountant / inventory / chef. It does not hold for
`collaborator_operations_manager`, which in practice is an **internal** person
who is also on the roster.

Measured in production (read-only), over **every** collaborator-flavored
membership — matched both by role name (`ur.role LIKE 'collaborator%'`) and by
`roles.flavor = 'collaborator'`, so user-minted area-derived roles are in scope
too — left-joined to `employees` on `(user_id, restaurant_id)` where
`status = 'active'`:

| role | role name | memberships | with an active employee record |
|---|---|---|---|
| `collaborator_accountant` | Accountant | 2 | **0** |
| `collaborator_operations_manager` | Operations Manager (Collaborator) | 1 | **1** |

Three collaborator memberships exist in total; no custom collaborator-flavored
role has been minted yet. The single membership holding an employee record is
the reporting user.

This is the whole argument for the fix: *"is this person on our roster?"* is
the question the rule was trying to ask, and `!!currentEmployee` already asks
it directly. External collaborators have no employee record and stay excluded
**by construction**, with no name-based allow-list to maintain as new
area-derived custom roles are minted.

`currentEmployee` is not a weak signal. [`src/hooks/useCurrentEmployee.tsx:20-27`](../../../src/hooks/useCurrentEmployee.tsx)
filters on `user_id = <the authenticated user>` **and** `restaurant_id = <the
selected restaurant>` **and** `status = 'active'` — so eligibility means "an
active employee record for this exact user at this exact restaurant".

### Defect 2 — the collaborator route gate has no `/employee/*` entry

[`src/App.tsx:273-283`](../../../src/App.tsx) redirects a collaborator off any
path outside its allow-list. `collaborator_operations_manager`'s list
([`src/App.tsx:210-233`](../../../src/App.tsx)) contains no `/employee/*` path,
and neither does the area-derived list for custom roles —
`AREA_ROUTES` in [`src/lib/permissions/routeAreas.ts:40-81`](../../../src/lib/permissions/routeAreas.ts)
maps no employee-self-service path, and `UNIVERSAL_PATHS`
([`routeAreas.ts:85`](../../../src/lib/permissions/routeAreas.ts)) is `['/help']`.

So with Defect 1 fixed alone: the card renders, the user clicks **My Work**,
`enterWorkMode` navigates to `/employee/schedule`
([`src/contexts/ViewModeContext.tsx:94`](../../../src/contexts/ViewModeContext.tsx)),
and `StaffRoleChecker` immediately bounces to `/scheduling` — while
`viewMode` stays `'work'`, so `LayoutSwitcher`
([`src/App.tsx:105-109`](../../../src/App.tsx)) renders the
"You're in your personal view" banner **on top of the admin scheduling page**.
A one-line fix ships that state.

## Design

### 1. Eligibility

```
canUseWorkView = !!currentEmployee && role ∉ { staff, kiosk }
```

Delete the prefix rule at [`viewModeEligibility.ts:28`](../../../src/lib/viewModeEligibility.ts).
`staff` and `kiosk` stay excluded for the original reason — they already *live*
in the employee/kiosk experience, so a switch into it is meaningless
([`viewModeEligibility.ts:8-9`](../../../src/lib/viewModeEligibility.ts)).

Update the doc comment there, and the two lines it mirrors in the original
spec (`2026-07-24-admin-work-view-mode-design.md:28` and its collaborator
bullet at `:31`), so spec and code agree.

### 2. Route gating

`StaffRoleChecker` grants the employee self-service paths to a collaborator
**iff that collaborator is work-view eligible** — i.e. gated on the same
`currentEmployee` fact, not on the role name. Custom area-derived collaborator
roles therefore get the identical behaviour with no extra wiring.

**The new check is scoped to `/employee/*` paths only.** This is the single
easiest thing to get wrong, in two different directions:

- *Do not* wrap or precede the existing collaborator branch
  ([`App.tsx:273-283`](../../../src/App.tsx)) with the `isWorkViewResolved`
  hold. That branch does not consult `useCurrentEmployee` today and resolves
  instantly; gating all of it on the employee query would make **every**
  collaborator navigation — `/scheduling`, `/inventory`, `/payroll` — block on
  a query it never needed, a latency regression across the majority of
  collaborator traffic to fix a slice of it. The hold applies only when
  `currentPath` is under `EMPLOYEE_SELF_SERVICE_PATHS`.
- *Do not* append the employee paths into each `COLLABORATOR_ROUTES[role].allowed`
  array. That is the shortest-looking edit and it breaks
  `tests/unit/routeAreas.test.ts:64-72`, which asserts
  `allowedPathsForAreas(seededAreas)` equals each builtin's `allowed` list
  **exactly** — a real regression, not the fix working. The grant is a separate
  branch checked before the allow-list, precisely because it is deliberately
  *not* area-derived.

The path list is **extracted to a shared constant** rather than duplicated.
`staffAllowedPaths` at [`src/App.tsx:286`](../../../src/App.tsx) already
enumerates exactly the nine `/employee/*` routes plus `/settings`; the
collaborator branch must not grow a second, drifting copy. New constant
`EMPLOYEE_SELF_SERVICE_PATHS` holds the nine `/employee/*` entries, and
`staffAllowedPaths` becomes that constant plus `/settings`.

`StaffRoleChecker` renders inside `ViewModeProvider`
([`src/App.tsx:154-160`](../../../src/App.tsx): `RestaurantProvider` >
`ViewModeProvider` > `AiChatProvider` > `StaffRoleChecker`), so `useViewMode()`
in its body reads the provider above it. This is deliberately called out
because the inverse mistake is a recorded lesson — *"A hook called in a
component's own body reads the parent's context, not the provider that
component renders"* (`memory/lessons.md`, 2026-07-29). Here the provider is an
ancestor, not something `StaffRoleChecker` renders, so the read is valid. The
test asserts the **behavioural consequence** (no redirect), not the presence
of the hook call.

### 3. The loading window (the subtle part)

`canUseWorkView` is derived from a React Query
([`ViewModeContext.tsx:58`](../../../src/contexts/ViewModeContext.tsx)) and is
`false` while that query is in flight. If `StaffRoleChecker` redirected on a
bare `!canUseWorkView`, an eligible collaborator landing on
`/employee/schedule` would be bounced *before* eligibility resolved — a race
that would look exactly like the bug we are fixing, only intermittently.

`ViewModeContext` already reasons about this window
([`ViewModeContext.tsx:70-82`](../../../src/contexts/ViewModeContext.tsx)):
it downgrades to `'admin'` only on a **confirmed** mismatch or ineligibility,
never on "not yet loaded", and `:73-78` documents why `employeeLoading` alone
is insufficient (a disabled React Query reports `isLoading === false`).

Rather than re-deriving that guard, the context **exposes** it:

```ts
interface ViewModeContextValue {
  viewMode: ViewMode;
  canUseWorkView: boolean;
  /** False while restaurant/employee resolution is still in flight. */
  isWorkViewResolved: boolean;
  enterWorkMode: () => void;
  exitWorkMode: () => void;
}
```

with `isWorkViewResolved = !!selectedRestaurant && !employeeLoading` — the
exact predicate `confirmedIneligible` at `:79` already uses.

`StaffRoleChecker`, for a collaborator on an `/employee/*` path:

| `isWorkViewResolved` | `canUseWorkView` | behaviour |
|---|---|---|
| `false` | — | hold on `<RouteLoadingScreen />` |
| `true` | `true` | allow |
| `true` | `false` | redirect to the role's landing page |

Holding on `RouteLoadingScreen` is the established idiom in this component —
[`src/App.tsx:253-255`](../../../src/App.tsx) already does exactly this while
the membership role is in flight, for the same fail-closed reason.

#### What happens if the employee query *errors*

`useCurrentEmployee` maps `PGRST116` (no row) to `null`
([`useCurrentEmployee.tsx:30`](../../../src/hooks/useCurrentEmployee.tsx)) but
rethrows anything else, and a settled error leaves `data === undefined` with
`isLoading === false`. Row 3 of the table therefore treats a hard query failure
identically to confirmed ineligibility, and **redirects**. Today the same state
merely hides a card; here it moves someone off the page they were on. That is a
deliberate choice, not an oversight:

- Neither hook sets `retry`, so React Query's default of three retries with
  backoff applies, and `isLoading` stays `true` throughout. A transient blip is
  absorbed by `isWorkViewResolved === false` — it never reaches row 3.
- Only a *persistent* failure settles into error. In that state seven of the
  nine `/employee/*` pages could not render anyway: they call the same hook on
  the same `['current-employee', restaurantId]` key, so they share the failure
  and would show their own empty state.
- Redirecting to a working admin page is recoverable by reload. The alternative
  — treating error as "unresolved" and holding — turns a persistent failure
  into a permanent spinner, which is not.

The redirect is fail-closed and recoverable; a hold would be fail-open on
liveness. Called out here so Phase 7 review sees it as a decision with a
rationale rather than an unconsidered path.

## Security

The change widens the surface a collaborator membership can reach, so:

- **It cannot widen data access.** `viewMode` is a display lens only; it never
  mutates `role` and no RLS policy or capability check consults it
  ([`ViewModeContext.tsx:25-26`](../../../src/contexts/ViewModeContext.tsx)).
  The gate added here is a *client-side route* gate on top of unchanged RLS.
- **The widened paths are self-scoped.** Every `/employee/*` page is employee
  self-service, keyed to the caller's own employee record. Phase 7 review must
  confirm each page's queries filter on the caller's own `employee_id` /
  `user_id` and that RLS enforces the same, independent of the route gate.
- **An external collaborator gains nothing.** With no active employee record,
  `canUseWorkView` is `false`, the card stays suppressed, and the
  `/employee/*` grant never applies. This is a property of the *mechanism*, so
  it holds regardless of what the data looks like. The measurement above
  additionally bounds today's blast radius: of three collaborator memberships
  in production, the only one with an active employee record is the internal
  user this change is for. That is a point-in-time fact about the tenant set,
  not load-bearing for the argument.
- **RLS permits the read this depends on, and grants nothing beyond it.**
  Confirmed in review: `useCurrentEmployee`'s SELECT succeeds for any
  collaborator flavor via the membership-scoped
  `"Team members can view coworkers in their restaurant"` policy
  (`20260411100000_staff_can_view_coworkers.sql`), and every write path behind
  an `/employee/*` action is scoped to the caller's own `employee_id` /
  `user_id = auth.uid()` — `time_punches`, `time_off_requests`,
  `employee_availability`, `employee_pins`, `shift_trades`,
  `open_shift_claims`. No `role IN (...)` policy widens that.
- **The new surface is strictly narrower than what this role already has.**
  `collaborator_operations_manager`'s seeded areas grant `scheduling: manage`
  and `employees: view` (`20260730110000_seed_builtin_roles.sql:164-172`) —
  restaurant-wide access to *every* employee's schedule, tips and punches via
  `/scheduling` and `/employees`. The `/employee/*` grant is own-record-only.
- **Revocation is immediate-ish.** Deactivating the employee record flips
  `status` away from `'active'`, so `useCurrentEmployee` returns `null` and
  eligibility drops — bounded by that query's `staleTime: 60000`
  ([`useCurrentEmployee.tsx:37`](../../../src/hooks/useCurrentEmployee.tsx)).

## Test plan (TDD — RED first)

`tests/unit/viewModeEligibility.test.ts:31` currently asserts
`collaborator_operations_manager` ⇒ `false`. That assertion encodes the
defect; it is **updated, not routed around** (lesson 2026-07-31: "a test that
breaks *because* the fix landed is the fix working").

1. `viewModeEligibility.test.ts` — every `collaborator_*` role **with** an
   employee record ⇒ eligible; every role **without** one ⇒ ineligible;
   `staff` / `kiosk` ⇒ ineligible even with a record.
2. `ViewModeSwitch.test.tsx` — card renders for an eligible collaborator
   (assert by **role**, per lesson 2026-04-22, not by text).
3. New route-gating test — an eligible collaborator is **not** redirected off
   `/employee/schedule`; an employee-less collaborator **is**; an unresolved
   one gets the loading screen, not a redirect.
4. `routeAreas.test.ts` — the existing builtin-calibration assertions
   (`:64-72`) must still pass **unchanged**. They are the tripwire for the
   "don't append to `COLLABORATOR_ROUTES[role].allowed`" mistake: the
   `/employee/*` grant is deliberately not area-derived.
5. A collaborator on a **non**-employee allowed path (`/scheduling`) renders
   immediately and is **not** held on `RouteLoadingScreen` while the employee
   query is in flight — the guard against scoping the new hold too widely.

Vacuity check: revert `src/` and confirm the new tests go red
(lesson 2026-07-30).

## Out of scope

- The `/employee/*` pages' own data scoping is *audited* in Phase 7, not
  changed here.
- No migration, no RLS change, no edge function change.
- `COLLABORATOR_ROUTES`' per-role `allowed` lists are **not modified at all**
  — see the two "do not" bullets in *2. Route gating*. The employee-path grant
  is a separate branch.

## Pre-existing issues surfaced by review (not fixed here)

Design review turned these up. None is introduced by this change and none
blocks it, but each is now on the record rather than rediscovered later.

1. **Two divergent `useCurrentEmployee` hooks.** `EmployeeClock.tsx` and
   `EmployeePin.tsx` import a *different* hook from
   [`src/hooks/useTimePunches.tsx:579-608`](../../../src/hooks/useTimePunches.tsx)
   — different query key (`'currentEmployee'` vs `'current-employee'`) and, more
   importantly, **no `.eq('status', 'active')` filter**. So those two pages can
   resolve an employee record the canonical hook excludes. The route gate added
   here uses the canonical hook, making the gate *stricter* than those pages —
   safe, but the divergence should be collapsed. Worth its own task.
2. **`is_current_user_employee()` does not check `status = 'active'`**
   (`20251123100100_add_employee_self_service_rls.sql`), unlike
   `get_current_employee_id()` and the `employee_pins` policies. A deactivated
   employee's row still passes RLS on `time_off_requests`,
   `employee_availability` and `availability_exceptions`. Defense-in-depth gap,
   not reachable through this change's route gate.
3. **`src/pages/EmployeeShiftMarketplace.tsx` is unrouted dead code** —
   `/employee/shifts` renders `AvailableShiftsPage` instead
   ([`App.tsx:331`](../../../src/App.tsx)). Not part of the audited surface.
4. **Work-mode chrome can paint over an admin page.** A user in
   `viewMode === 'work'` who navigates by URL or back-button to an admin page
   they can otherwise reach sees it wrapped in `MobileLayout`'s employee chrome
   ([`App.tsx:93`](../../../src/App.tsx)), because collaborator routing does not
   reset `viewMode`. This is inherited behaviour from the original work-view
   design and already reachable by owner/manager; this change makes it reachable
   by collaborators for the first time. Not fixed here — fixing it means
   deciding when navigation should exit work mode, which is a separate design.
