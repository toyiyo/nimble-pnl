# Design: Admin ↔ My Work dual-mode view switching

**Date:** 2026-07-24
**Branch:** `claude/heuristic-leakey-2802d4`
**Status:** Approved (visual design signed off via `/frontend-design` prototype; this doc is the engineering design)

## Problem

Owner/manager/chef/operations_manager users can also hold a linked `employees`
record (they pick up shifts, clock in, get paid). Today the `/employee/*` pages
are reachable only by typing the URL: there is no UI entry point, the chrome is
wrong (they keep the admin sidebar), and there is no way back. We want these
users to switch into the staff/employee experience ("My Work") and return to
their admin experience seamlessly.

## Non-negotiable constraint

**View mode is a display *lens*, not a role change.** We NEVER mutate
`selectedRestaurant.role`. Role is permission-bearing and RLS-relevant; changing
it would be a privilege/RLS hazard. Instead we add an orthogonal, ephemeral
`viewMode: 'admin' | 'work'` that drives *chrome and navigation only*. Every RLS
policy, every permission check, and every data query is untouched. The employee
pages already resolve identity via `useCurrentEmployee` (`user_id` +
`restaurant_id` + `status='active'`), so they work unchanged for a linked owner.

## Eligibility

`canUseWorkView = !!currentEmployee && role ∉ { staff, kiosk, collaborator_* }`

- `staff`/`kiosk` already live in the employee/kiosk experience — no switch needed.
- `collaborator_*` are external scoped roles that must never see employee self-service.
- `currentEmployee` comes from `useCurrentEmployee(restaurantId)`. Note (lesson
  2026-07-xx, PR #641): a **duplicate** `employees` row for the same
  `(user_id, restaurant_id)` makes `.single()` return `PGRST116`, which the hook
  maps to `null`. That fails **closed** here — the persona card simply won't
  render — which is the safe direction. No behavior change required from this feature.

## State model — module-level store, not sessionStorage

**Critical architectural fact:** `RestaurantProvider` is mounted *inside*
`ProtectedRoute` (`App.tsx:133`), so it **remounts on every route navigation**.
That is why `selectedRestaurant` is re-hydrated from `localStorage` on each mount.
Consequently, any React state we hold for `viewMode` inside that provider would
reset on every navigation — including the navigation to `/employee/schedule` that
*entering* work mode triggers.

Therefore `viewMode` and the stashed return-route live in a **module-level
singleton store** (`src/contexts/viewModeStore.ts`), read via
`useSyncExternalStore`:

```
state = { restaurantId: string | null, mode: 'admin' | 'work', returnPath: string }
```

This gives us exactly the desired lifecycle for free:

| Event | Module store behavior | Result |
|---|---|---|
| In-app navigation | Module persists (ES module singleton) | viewMode survives ✅ |
| Full page reload / new tab | Module re-evaluates → `mode: 'admin'` | resets to admin ✅ |
| Restaurant switch | `restaurantId` mismatch → effective mode = admin | per-restaurant ✅ |

> **Design note / deviation from brief:** the brief suggested `sessionStorage`.
> Plain `sessionStorage` survives a full reload, which contradicts "reset to
> admin on fresh load." The module singleton honors the *intent* (per-restaurant,
> survive in-app nav, reset on reload) without a storage round-trip, and it is
> the natural fit for the remount-driven provider. No secrets or PII are stored.

The provider derives the **effective** mode so a stale entry can never leak
across restaurants or past eligibility:

```
effectiveViewMode =
  (canUseWorkView && store.mode === 'work' && store.restaurantId === currentRestaurantId)
    ? 'work' : 'admin'
```

`enterWorkMode()` / `exitWorkMode()` own navigation (they run where `useNavigate`
is available):

- **enter:** stash `location.pathname` → store; set `mode='work'`,
  `restaurantId=current`; `navigate('/employee/schedule')`.
- **exit:** set `mode='admin'`; `navigate(store.returnPath || '/')`.

## Components & touch points

| File | Change |
|---|---|
| `src/contexts/viewModeStore.ts` *(new)* | Module singleton: `subscribe`/`getSnapshot`/`enterWorkMode`/`exitWorkMode`, plus `__resetStore` test helper. Pure, unit-tested. |
| `src/contexts/ViewModeContext.tsx` *(new)* | `ViewModeProvider` (reads store via `useSyncExternalStore`, computes `canUseWorkView` from `useCurrentEmployee` + role, exposes `{ viewMode, canUseWorkView, enterWorkMode, exitWorkMode }`) + `useViewMode()` hook. Mounted inside `RestaurantProvider`. |
| `src/lib/viewModeEligibility.ts` *(new)* | `computeCanUseWorkView({ currentEmployee, role })` pure helper. Unit-tested. |
| `src/components/ViewModeSwitch.tsx` *(new)* | Shared "You're viewing as" persona card: Admin / My Work segmented control + hint. Renders `null` when `!canUseWorkView`. |
| `src/components/PersonalViewBanner.tsx` *(new)* | Persistent slate banner shown in work mode. `variant="desktop"` (full bar in main content) and `variant="mobile"` (slim strip above the tab bar). "Back to admin" calls `exitWorkMode`. |
| `src/components/UserProfileDropdown.tsx` | Insert `<ViewModeSwitch />` at top of the dropdown (desktop entry point — matches prototype). |
| `src/components/AppSidebar.tsx` | Insert `<ViewModeSwitch />` in `SidebarFooter` — the **mobile-reachable** entry point (the account dropdown is `hidden md:flex`; a non-staff owner on mobile gets the desktop shell whose dropdown is hidden, but the sidebar renders as a sheet). |
| `src/App.tsx` `LayoutSwitcher` | `if ((isStaff || viewMode === 'work') && isMobile) return <MobileLayout>`. On desktop work mode: keep the sidebar shell but render `<PersonalViewBanner variant="desktop" />` above `{children}`. |
| `src/App.tsx` mount | Wrap the tree in `<ViewModeProvider>` inside `RestaurantProvider` (so `LayoutSwitcher`, `AppSidebar`, `UserProfileDropdown`, `StaffRoleChecker` can all read it). |
| `src/components/AppSidebar.nav.ts` `getNavigationForRole` | Add optional `viewMode` param: when `viewMode === 'work'`, return `staffNav` regardless of role. Default preserves current behavior. Unit-tested. |
| `src/components/AppSidebar.tsx` | Pass `viewMode` into `getNavigationForRole`. |
| `src/components/employee/MobileLayout.tsx` | Render `<PersonalViewBanner variant="mobile" />` (only in work mode) — the slim return strip above `<MobileTabBar />`. Staff (`role==='staff'`) never see it because they have no `viewMode==='work'` (their eligibility is false); gate on `viewMode==='work'`. |

## Routing / StaffRoleChecker

`StaffRoleChecker` (`App.tsx:215`) already lets non-staff through to `/employee/*`
(it only redirects kiosk/collaborator/staff). **No route-gating is added for work
mode** — an owner-in-work-mode retains full permissions, so trapping them inside
`/employee/*` has no security value and risks a redirect loop. The banner + nav
guide them; entering navigates to `/employee/schedule`, exiting restores the
stashed route. This is a **decided trade-off**: chrome follows `viewMode`, route
access follows `role` (unchanged).

## Visual language (from approved prototype)

- Work-mode signal is **slate** (`slate-*` tokens), deliberately distinct from the
  emerald brand chrome, so "personal view" never reads as the admin brand.
- Segmented control, banner, and mobile strip follow CLAUDE.md Apple/Notion tokens
  (`border-border/40`, `bg-muted/30`, `rounded-lg`/`rounded-xl`, `transition-colors`,
  the typography scale). Semantic tokens only — no raw colors beyond the slate
  accent, which uses Tailwind's `slate` scale with dark-mode variants.
- Transition respects `prefers-reduced-motion` (fade fallback, no sweep).

## Three-state / a11y

- `ViewModeSwitch` renders `null` when ineligible (no empty shell).
- Segmented control is a real `role="radiogroup"` / buttons with `aria-pressed`,
  keyboard operable; "Back to admin" is a labeled `<button>`.
- Banner has `role="status"` so the mode change is announced.

## Testing strategy

- **Unit (pure):** `computeCanUseWorkView` truth table; `viewModeStore`
  enter/exit/effective + restaurant-mismatch reset; `getNavigationForRole(role,'work')`
  returns `staffNav` for every non-staff role.
- **Component:** `ViewModeSwitch` hides when ineligible / shows + toggles when
  eligible; `PersonalViewBanner` "Back to admin" calls exit.
- **E2E (Playwright):** seed an owner with a linked active employee record; assert
  the persona card appears, switching enters `/employee/schedule` with employee
  chrome, "Back to admin" returns to the stashed route with admin chrome; assert a
  plain owner (no employee record) never sees the card. This covers the cross-layer
  seam per the Phase 8 E2E gate.

## Out of scope

- No DB/RLS/edge-function/migration changes (this is a pure client chrome feature).
- No change to how employee pages fetch data.
- Multi-restaurant "work mode in restaurant A while viewing B" is resolved to admin
  (effective-mode guard), not preserved per-restaurant simultaneously.
