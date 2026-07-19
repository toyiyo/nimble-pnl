# Design: Mobile sidebar closes on navigation

**Date:** 2026-07-19
**Branch:** `fix/mobile-sidebar-nav-close`
**Type:** Bug fix (UI / mobile navigation)

## Problem

On mobile, tapping a link in the app sidebar navigates to the target page but
leaves the navigation drawer open on top of it. The user must tap the backdrop
(or elsewhere) to dismiss the menu before they can use the page.

### Root cause

On mobile the `Sidebar` renders inside a Radix `Sheet`
(`src/components/ui/sidebar.tsx:155`, `<Sheet open={openMobile} onOpenChange={setOpenMobile}>`).

In `src/components/AppSidebar.tsx` every navigable control calls
`navigate(...)` without ever closing the mobile drawer:

- Header logo button — `onClick={() => navigate('/')}` (line ~82)
- Collapsed icon nav — `onClick={() => navigate(item.path)}` (line ~117)
- Expanded group nav — `onClick={() => navigate(item.path)}` (line ~173)

A React Router route change does **not** trigger the Radix `Sheet`'s own dismiss
logic, so the sheet stays open after navigation. The only reason it *sometimes*
appears to close is incidental: `SidebarProvider` is mounted **inside** the
per-route `ProtectedRoute` wrapper (`src/App.tsx:93`), so some route transitions
remount the provider and reset `openMobile` to `false` by accident. This makes
the behaviour inconsistent between pages — the defect the user reported.

### Evidence (PostHog, project 233023)

Two real mobile web sessions (`$device_type = Mobile`, `snapshot_source = web`):

- `019f75c3-0e27-7026-b4f3-56ca42bef8c6`: `Toggle Sidebar → Operations →
  Scheduling` (captured while `$pathname` was still `/`), then an **18s gap**
  before the first interaction on `/scheduling` — user facing a still-open
  drawer over the new page.
- `019f72cd-b8ea-70e7-a593-998fafd7c5be`: repeated `Toggle Sidebar → nav link →
  Toggle Sidebar → nav link` cadence across `/weekly-brief`, `/ops-inbox`,
  `/time-punches`, `/employees`, `/settings` — evidence of the inconsistent
  close behaviour caused by incidental provider remounts.

## Scope

- **In scope:** `src/components/AppSidebar.tsx` only. All in-drawer navigation
  (logo + both nav renderings) must deterministically close the mobile drawer.
- **Out of scope:** `src/components/employee/MobileLayout.tsx` (staff layout) —
  it uses a bottom-nav pattern, not the `Sheet`, and is unaffected. The
  `SidebarProvider` placement in `App.tsx` is left as-is (moving it is a larger
  refactor and unnecessary once close-on-nav is explicit).

## Approach (chosen: central nav helper)

Add a single `handleNavigate(path: string)` in `AppSidebar` that navigates and
then closes the mobile drawer, and route every navigable control through it:

```tsx
const { state: sidebarState, isMobile, setOpenMobile } = useSidebar();

const handleNavigate = (path: string) => {
  navigate(path);
  if (isMobile) setOpenMobile(false);
};
```

- Header logo → `onClick={() => handleNavigate('/')}`
- Collapsed nav button → `onClick={() => handleNavigate(item.path)}`
- Expanded nav button → `onClick={() => handleNavigate(item.path)}`

### Why this approach

- **Deterministic:** closes on every page regardless of whether the per-route
  provider happens to remount.
- **Covers same-route taps:** tapping the current page's link still closes the
  drawer (a `pathname`-effect approach would not, since the path doesn't change).
- **Idiomatic + minimal:** uses the `useSidebar()` context the component already
  consumes; no new provider, no route-effect, no change to `App.tsx`.
- **`isMobile` guard:** avoids a redundant state update on desktop where the
  `Sheet`/`openMobile` is not rendered.

### Rejected alternatives

- **`useEffect` on `location.pathname`:** DRY but misses same-route taps and
  fires on mount; less explicit.
- **Convert buttons to `<Link>` + `SidebarMenuButton asChild`:** larger refactor
  touching active-state styling and feature-gate badges; not warranted for a
  close-on-nav fix.

## Testing

- **Unit (Vitest + Testing Library):** render `AppSidebar` inside
  `SidebarProvider` with `useIsMobile` mocked to `true`; simulate a nav-item tap
  and assert the mobile sheet is dismissed (drawer content no longer present /
  `data-state` closed). Add a desktop case (`useIsMobile` → `false`) asserting
  navigation still occurs and no error. Keep mocks minimal (auth, restaurant
  context, subscription) per the existing test patterns.
- **Manual/preview:** mobile viewport — open drawer, tap a link, confirm the
  drawer closes and the target page is interactive without a second tap.

## Accessibility / motion

No new UI. The existing `Sheet` close animation (slide-out + overlay fade) and
focus return are reused; Radix restores focus to the trigger on close. Respects
`prefers-reduced-motion` via the existing sheet styles.
