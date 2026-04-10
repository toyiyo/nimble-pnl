# Employee Mobile Experience — Design Spec

## Summary

Mobile-optimized layout for staff users that activates automatically on small screens. Same app, same routes, same hooks — just a better UI for phones. No service workers, no caching, no app store.

## Problem

Employees are used to mobile apps but the current experience serves a desktop sidebar layout on phones. The sidebar is unusable on small screens and doesn't feel native. A previous attempt with service workers broke the app due to aggressive caching serving stale content.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Distribution | PWA (Add to Home Screen) | Zero friction, no app store, instant updates |
| Caching strategy | None — no service worker | Avoids the stale-cache bug entirely |
| Code approach | Same app, responsive layout | Maximum reuse of existing routes, hooks, types |
| Navigation | Bottom tab bar (4 tabs) | Thumb-friendly, familiar mobile pattern |
| Default tab | Schedule | Employee's #1 concern |
| "More" tab style | iOS Settings-style list | Clean, simple, familiar |

## Architecture

### Detection Logic

```
useIsMobile() — existing hook at src/hooks/use-mobile.tsx, extended to also
                detect standalone PWA mode (display-mode: standalone)

isStaff — derived from useRestaurantContext() → selectedRestaurant?.role === 'staff'
           (NOT from useAuth — useAuth doesn't expose roles)

Layout switching lives inside ProtectedRoute in App.tsx:
  if (noChrome) → bare div (kiosk mode, unchanged)
  if (isStaff && isMobile) → MobileLayout (bottom tabs, no sidebar, no AppHeader)
  else → existing SidebarProvider layout (unchanged)
```

### Navigation Mapping

| Tab | Route | Existing Page |
|-----|-------|---------------|
| Schedule (default) | `/employee/schedule` | `EmployeeSchedule.tsx` |
| Pay | `/employee/pay` | `EmployeePay.tsx` |
| Clock | `/employee/clock` | `EmployeeClock.tsx` |
| More | `/employee/more` | **New: `EmployeeMore.tsx`** |
| ↳ Timecard | `/employee/timecard` | `EmployeeTimecard.tsx` |
| ↳ Requests | `/employee/portal` | `EmployeePortal.tsx` |
| ↳ Shift Marketplace | `/employee/shifts` | `EmployeeShiftMarketplace.tsx` |
| ↳ Tips | `/employee/tips` | `EmployeeTips.tsx` |
| ↳ Settings | `/settings` | Existing settings page |
| ↳ Sign Out | (action) | Existing `signOut()` from `useAuth()` |

### New Components

1. **`src/components/employee/MobileTabBar.tsx`** — Fixed bottom nav bar with 4 tabs (Schedule, Pay, Clock, More). Uses Lucide icons. Highlights active tab based on current route. Handles safe area inset via `padding-bottom: env(safe-area-inset-bottom)` in inline style (no extra Tailwind plugin needed).

2. **`src/components/employee/MobileLayout.tsx`** — Layout wrapper that renders: page content area (scrollable, with bottom padding to clear tab bar) + MobileTabBar. Replaces the `SidebarProvider` + `AppSidebar` + `AppHeader` layout for staff on mobile. Employee pages already have `EmployeePageHeader` so no app-level header is needed.

3. **`src/pages/EmployeeMore.tsx`** — iOS Settings-style list page. Sections:
   - Main: Timecard, Requests, Shift Marketplace, Tips (each with icon, label, description, chevron)
   - Bottom: Settings, Sign Out (red text)
   - Each item is a `Link` to the existing route

### Modified Files

1. **`src/hooks/use-mobile.tsx`** — Extend the existing `useIsMobile()` hook to also return `true` when `window.matchMedia('(display-mode: standalone)')` matches. This ensures PWA standalone mode activates the mobile layout regardless of viewport width. The hook already handles viewport < 768px.

2. **`src/App.tsx`** — Three changes:
   - **ProtectedRoute layout branch**: Add a third branch between `noChrome` and the default sidebar layout. When `isStaff && isMobile`, render inside `MobileLayout` instead of `SidebarProvider`. The branch order: `noChrome` → `isStaff && isMobile` → default sidebar. This requires `useIsMobile()` and `useRestaurantContext()` inside `ProtectedRoute` (both providers are already ancestors at this point).
   - **New route**: Add `/employee/more` → `EmployeeMore` with `allowStaff={true}`.
   - **`staffAllowedPaths`**: Add `/employee/more` and `/employee/tips` (tips was missing — pre-existing bug). Update the default staff redirect from `/employee/clock` to `/employee/schedule`.

3. **`src/components/InstallBanner.tsx`** — Move inside `BrowserRouter` so it has access to routing context. Use `useIsMobile()` to detect when the tab bar is present, and add `bottom: calc(1rem + 72px)` (tab bar height + spacing) when on mobile. This prevents the banner from being hidden behind the tab bar.

4. **Employee pages (responsive tweaks)** — Add/adjust responsive classes on existing pages for better mobile rendering:
   - Larger touch targets (min 44px tap areas)
   - Full-width buttons on mobile
   - Simplified padding (`px-4` instead of larger desktop padding)
   - Stack horizontal layouts vertically on small screens

### Scope Exclusions

- **Managers on mobile** — Managers still see the sidebar layout on all screen sizes. Mobile optimization for managers is a separate future task.
- **Offline support** — No service workers. Every page load fetches fresh data.
- **Push notifications** — Not in this iteration.
- **Capacitor/native app** — PWA "Add to Home Screen" only.

## Install Flow

1. Manager texts employee a link to the app
2. Employee opens link in mobile browser, logs in (Supabase auth, persistent session)
3. Employee sees their schedule with an "Add to Home Screen" banner (existing `InstallBanner.tsx`)
4. Once added, app launches in standalone mode (no browser chrome) via existing `manifest.json`

Note: `manifest.json` `start_url` is `/` which redirects to `/employee/schedule` via `StaffRoleChecker` (after the default redirect is updated from `/employee/clock`).

## What's NOT Changing

- No service workers — no caching, no stale data risk
- No new backend/edge functions — all existing APIs reused
- No new hooks — only extending existing `use-mobile.tsx`
- No changes to desktop layout — sidebar stays for desktop users
- No changes to manager experience on any screen size
- No Capacitor/native app changes — PWA only
- No new auth flows — existing Supabase auth with persistent sessions

## Testing Strategy

- **Unit tests**: `useIsMobile` hook (viewport detection, standalone detection)
- **Unit tests**: `MobileTabBar` (active tab highlighting, route mapping)
- **Unit tests**: `MobileMorePage` (renders all nav items, sign out action)
- **E2E tests**: Staff user on mobile viewport → sees bottom tabs, not sidebar
- **E2E tests**: Tab navigation between Schedule, Pay, Clock, More
- **E2E tests**: More page → navigate to Timecard, back to More

## File Inventory

| File | Type | Purpose |
|------|------|---------|
| `src/components/employee/MobileTabBar.tsx` | New | Bottom tab bar |
| `src/components/employee/MobileLayout.tsx` | New | Layout wrapper |
| `src/pages/EmployeeMore.tsx` | New | More page with settings-style list |
| `src/hooks/use-mobile.tsx` | Modified | Add standalone PWA detection |
| `src/App.tsx` | Modified | Layout switching, `/employee/more` route, fix `staffAllowedPaths` |
| `src/components/InstallBanner.tsx` | Modified | Move inside router, position above tab bar |
| `src/pages/EmployeeSchedule.tsx` | Modified | Responsive tweaks |
| `src/pages/EmployeePay.tsx` | Modified | Responsive tweaks |
| `src/pages/EmployeeClock.tsx` | Modified | Responsive tweaks |
| `src/pages/EmployeeTimecard.tsx` | Modified | Responsive tweaks |
| `src/pages/EmployeePortal.tsx` | Modified | Responsive tweaks |
| `src/pages/EmployeeShiftMarketplace.tsx` | Modified | Responsive tweaks |
| `src/pages/EmployeeTips.tsx` | Modified | Responsive tweaks |
