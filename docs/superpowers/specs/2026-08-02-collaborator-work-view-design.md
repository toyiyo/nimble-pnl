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

Measured in production (read-only), joining `user_restaurants` to `employees`
on `(user_id, restaurant_id)` where `employees.is_active`:

| role | memberships | with an active employee record |
|---|---|---|
| `collaborator_accountant` | 2 | **0** |
| `collaborator_operations_manager` | 1 | **1** |

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
([`routeAreas.ts:84`](../../../src/lib/permissions/routeAreas.ts)) is `['/help']`.

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

## Security

The change widens the surface a collaborator membership can reach, so:

- **It cannot widen data access.** `viewMode` is a display lens only; it never
  mutates `role` and no RLS policy or capability check consults it
  ([`ViewModeContext.tsx:26-27`](../../../src/contexts/ViewModeContext.tsx)).
  The gate added here is a *client-side route* gate on top of unchanged RLS.
- **The widened paths are self-scoped.** Every `/employee/*` page is employee
  self-service, keyed to the caller's own employee record. Phase 7 review must
  confirm each page's queries filter on the caller's own `employee_id` /
  `user_id` and that RLS enforces the same, independent of the route gate.
- **An external collaborator gains nothing.** With no active employee record,
  `canUseWorkView` is `false`, the card stays suppressed, and the
  `/employee/*` grant never applies. Production has zero external
  collaborators with an employee record.
- **Revocation is immediate-ish.** Deactivating the employee record flips
  `status` away from `'active'`, so `useCurrentEmployee` returns `null` and
  eligibility drops — bounded by that query's `staleTime: 60000`
  ([`useCurrentEmployee.tsx:36`](../../../src/hooks/useCurrentEmployee.tsx)).

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
4. `routeAreas.test.ts` — the existing builtin-calibration assertions must
   still hold; the `/employee/*` grant is deliberately *not* area-derived.

Vacuity check: revert `src/` and confirm the new tests go red
(lesson 2026-07-30).

## Out of scope

- The `/employee/*` pages' own data scoping is *audited* in Phase 7, not
  changed here.
- No migration, no RLS change, no edge function change.
- `COLLABORATOR_ROUTES`' existing per-role lists are untouched apart from the
  shared employee-path grant.
