# Plan: Mobile sidebar closes on navigation

Design: docs/superpowers/specs/2026-07-19-mobile-sidebar-nav-close-design.md

## Tasks

### Task 1 — RED: failing test for close-on-nav (mobile)
- File: `tests/unit/AppSidebar.test.tsx` (new).
- Mock `@/hooks/useIsMobile` → `true`, plus minimal mocks for `useAuth`,
  `useRestaurantContext`, `useSubscription` (owner role so full nav renders).
- Render `<SidebarProvider><AppSidebar/></SidebarProvider>` with a
  `MemoryRouter`; programmatically open the mobile drawer (set `openMobile`)
  or assert against the rendered sheet.
- Simulate a tap on a nav item; assert the mobile sheet is dismissed
  (drawer `data-state="closed"` / content removed) AND navigation occurred.
- Expected: FAILS against current code (drawer stays open).
- Dependencies: none.

### Task 2 — GREEN: add handleNavigate helper + wire call sites
- File: `src/components/AppSidebar.tsx`.
- Pull `isMobile` and `setOpenMobile` from `useSidebar()`.
- Add `handleNavigate(path)` = `navigate(path); if (isMobile) setOpenMobile(false);`.
- Replace the three `navigate(...)` call sites (logo, collapsed nav, expanded nav)
  with `handleNavigate(...)`.
- Expected: Task 1 test passes.
- Dependencies: Task 1.

### Task 3 — Desktop regression guard
- Add a Vitest case with `useIsMobile` → `false`: tapping a nav item still
  navigates and does not throw; drawer state untouched.
- Dependencies: Task 2.

### Task 4 — Verify + commit
- `npm run test -- AppSidebar`, `npm run typecheck`, `npm run lint`.
- Commit: `fix(sidebar): close mobile drawer on navigation`.
- Dependencies: Tasks 1-3.

## Notes
- Keep mocks minimal per lesson [2026-07-06] (don't render the whole app; mock
  only the hooks `AppSidebar` directly consumes).
- Use role-based assertions where practical per lesson [2026-04-22].
