# Plan: Admin ↔ My Work dual-mode view switching

Design: `docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md`

TDD, dependency-ordered. Each task is a RED→GREEN→REFACTOR→COMMIT unit unless noted.
Pure/logic tasks (2–4) are fully unit-tested; component tasks (5–7) get RTL tests;
wiring tasks (8–11) are covered by the Phase-8 E2E (task 12).

## Foundations (no deps)

**Task 1 — Personal-view semantic token trio** *(no test; CSS)*
- `src/index.css`: add `--personal-view`, `--personal-view-foreground`,
  `--personal-view-border` to `:root` (light) and `.dark` (dark) with the HSL
  values from the design doc.
- `tailwind.config.ts`: add a `personal-view` color entry
  (`DEFAULT`/`foreground`/`border`) wired like the existing `sidebar` trio.
- Verify: `npm run build` compiles; quick manual class check.

**Task 2 — `computeCanUseWorkView` pure helper**
- RED: `tests/unit/viewModeEligibility.test.ts` — truth table:
  eligible only when `currentEmployee` truthy AND role ∈ {owner, manager, chef,
  operations_manager}; false for staff/kiosk/every `collaborator_*`; false when
  `currentEmployee` null; false when role undefined.
- GREEN: `src/lib/viewModeEligibility.ts` — `computeCanUseWorkView({ currentEmployee, role })`.

**Task 3 — `viewModeStore` module singleton**
- RED: `tests/unit/viewModeStore.test.ts` — `getSnapshot()` returns a stable
  reference across calls with no mutation; `enterWorkMode(id, path)` sets
  mode/restaurantId/returnPath and notifies subscribers; `exitWorkMode()` resets
  mode to admin, preserves returnPath; `subscribe` returns a working unsubscribe;
  `__resetStore()` restores defaults. Assert getSnapshot ref changes only after a
  mutation+emit (so `useSyncExternalStore` won't loop).
- GREEN: `src/contexts/viewModeStore.ts`.

**Task 4 — `getNavigationForRole(role, viewMode?)`**
- RED: extend `tests/unit/AppSidebar.nav.test.ts` (or create): with
  `viewMode==='work'`, returns `staffNav` for owner/manager/chef/operations_manager;
  with `viewMode` omitted/`'admin'`, unchanged existing behavior for every role.
- GREEN: add optional 2nd param to `getNavigationForRole` in `AppSidebar.nav.ts`.

## Context + components (dep: 2,3)

**Task 5 — `ViewModeProvider` + `useViewMode`**
- RED: `tests/unit/ViewModeContext.test.tsx` — provider exposes
  `{ viewMode, canUseWorkView, enterWorkMode, exitWorkMode }`; effective mode is
  `work` only under the optimistic rule (work when store says work + not confirmed
  wrong-restaurant + not confirmed-ineligible); downgrades to admin on confirmed
  restaurant mismatch and on confirmed ineligibility; stays `work` while loading.
  Mock `useCurrentEmployee` + `useRestaurantContext` + `react-router` `useNavigate`.
- GREEN: `src/contexts/ViewModeContext.tsx` (reads store via `useSyncExternalStore`,
  computes eligibility via task 2, owns navigation).

**Task 6 — `ViewModeSwitch` persona card** *(dep: 5)*
- RED: `tests/unit/ViewModeSwitch.test.tsx` — renders `null` when
  `!canUseWorkView`; when eligible shows "You're viewing as" + two toggle buttons
  in `role="group"` `aria-label="View mode"` with correct `aria-pressed`; clicking
  "My Work" calls `enterWorkMode`, "Admin" calls `exitWorkMode`.
- GREEN: `src/components/ViewModeSwitch.tsx` (CLAUDE.md tokens; compact layout).

**Task 7 — `PersonalViewBanner`** *(dep: 5)*
- RED: `tests/unit/PersonalViewBanner.test.tsx` — `role="status"`; renders text +
  "Back to admin" which calls `exitWorkMode`; `variant="desktop"` vs `"mobile"`
  markup differences; uses `personal-view` tokens; honors reduced-motion (no
  animation class when `prefers-reduced-motion`).
- GREEN: `src/components/PersonalViewBanner.tsx`.

## Wiring (dep: 5,6,7; covered by E2E task 12)

**Task 8 — Mount provider + `LayoutSwitcher`** — `src/App.tsx`
- Wrap tree in `<ViewModeProvider>` inside `RestaurantProvider`.
- `LayoutSwitcher`: read `viewMode`; `(isStaff || viewMode==='work') && isMobile`
  → `MobileLayout`; desktop work mode → sidebar shell + `<PersonalViewBanner variant="desktop" />` above `{children}`.

**Task 9 — `AppSidebar`** — pass `viewMode` into `getNavigationForRole`; render
`<ViewModeSwitch />` in the expanded (`!collapsed`) `SidebarFooter`.

**Task 10 — `UserProfileDropdown`** — insert `<ViewModeSwitch />` at top of the
dropdown content (desktop entry point).

**Task 11 — `MobileLayout`** — render `<PersonalViewBanner variant="mobile" />`
above `<MobileTabBar />` only when `viewMode==='work'`.

## Verify (Phase 8)

**Task 12 — E2E** — `tests/e2e/view-mode-switching.spec.ts`
- Seed (via `tests/helpers/` patterns) an owner WITH a linked active employee record.
- Assert: persona card visible; clicking "My Work" lands on `/employee/schedule`
  with employee chrome (staff nav / tab bar) + personal-view banner; "Back to admin"
  returns to the stashed route with admin chrome.
- Seed a plain owner (no employee record); assert the persona card never renders.
- Full suite: `npm run test && npm run typecheck && npm run lint && npm run build`
  (+ `test:e2e` for the new spec).

## Dependency graph
```
1 ─┐
2 ─┼─→ 5 ─→ 6 ─┐
3 ─┘        7 ─┼─→ 8,9,10,11 ─→ 12
4 ──────────────┘
```
Tasks 1–4 are independent and can land in any order; 5 depends on 2+3; 6+7 depend
on 5; 8–11 depend on 5–7 (and 9 on 4); 12 last.
