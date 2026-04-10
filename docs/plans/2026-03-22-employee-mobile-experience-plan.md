# Employee Mobile Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile-optimized bottom-tab layout for staff users, replacing the sidebar on small screens with zero backend changes.

**Architecture:** Extend the existing `useIsMobile()` hook with standalone PWA detection. Add a third layout branch in `ProtectedRoute` (between `noChrome` and sidebar) that renders `MobileLayout` for staff on mobile. Three new components: `MobileLayout`, `MobileTabBar`, `EmployeeMore` page. All existing employee pages, hooks, and edge functions are reused unchanged.

**Tech Stack:** React, TypeScript, React Router 6, Tailwind CSS, Lucide icons, Vitest, Playwright

**Spec:** `docs/plans/2026-03-22-employee-mobile-experience-design.md`

---

### Task 1: Extend `useIsMobile` hook with standalone PWA detection

**Files:**
- Modify: `src/hooks/use-mobile.tsx`
- Test: `tests/unit/useIsMobile.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/useIsMobile.test.ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('useIsMobile', () => {
  let matchMediaListeners: Map<string, (e: { matches: boolean }) => void>;
  let matchMediaResults: Map<string, boolean>;

  beforeEach(() => {
    vi.resetModules(); // Ensure fresh hook import per test
    matchMediaListeners = new Map();
    matchMediaResults = new Map();
    matchMediaResults.set('(max-width: 767px)', false);
    matchMediaResults.set('(display-mode: standalone)', false);

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 });

    window.matchMedia = vi.fn((query: string) => ({
      matches: matchMediaResults.get(query) ?? false,
      media: query,
      addEventListener: vi.fn((_event: string, handler: (e: { matches: boolean }) => void) => {
        matchMediaListeners.set(query, handler);
      }),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;
  });

  it('returns false on desktop viewport', async () => {
    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true on mobile viewport (< 768px)', async () => {
    matchMediaResults.set('(max-width: 767px)', true);
    Object.defineProperty(window, 'innerWidth', { value: 375 });

    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns true in standalone PWA mode regardless of viewport width', async () => {
    matchMediaResults.set('(display-mode: standalone)', true);
    Object.defineProperty(window, 'innerWidth', { value: 1024 });

    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('reacts to viewport changes', async () => {
    const { useIsMobile } = await import('@/hooks/use-mobile');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 375 });
      const listener = matchMediaListeners.get('(max-width: 767px)');
      listener?.({ matches: true });
    });

    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/useIsMobile.test.ts`
Expected: FAIL — standalone test will fail since `use-mobile.tsx` only checks viewport width

- [ ] **Step 3: Implement standalone detection in `use-mobile.tsx`**

Replace the contents of `src/hooks/use-mobile.tsx` with:

```typescript
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const viewportMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const standaloneMql = window.matchMedia('(display-mode: standalone)');

    const update = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT || standaloneMql.matches);
    };

    viewportMql.addEventListener("change", update);
    standaloneMql.addEventListener("change", update);
    update();

    return () => {
      viewportMql.removeEventListener("change", update);
      standaloneMql.removeEventListener("change", update);
    };
  }, []);

  return !!isMobile;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/useIsMobile.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-mobile.tsx tests/unit/useIsMobile.test.ts
git commit -m "feat: extend useIsMobile with standalone PWA detection"
```

---

### Task 2: Create `MobileTabBar` component

**Files:**
- Create: `src/components/employee/MobileTabBar.tsx`
- Test: `tests/unit/MobileTabBar.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/MobileTabBar.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { MobileTabBar } from '@/components/employee/MobileTabBar';

const renderWithRouter = (currentPath: string) => {
  return render(
    <MemoryRouter initialEntries={[currentPath]}>
      <MobileTabBar />
    </MemoryRouter>
  );
};

describe('MobileTabBar', () => {
  it('renders all 4 tabs', () => {
    renderWithRouter('/employee/schedule');
    expect(screen.getByRole('link', { name: /schedule/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pay/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /clock/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /more/i })).toBeInTheDocument();
  });

  it('highlights Schedule tab when on /employee/schedule', () => {
    renderWithRouter('/employee/schedule');
    const scheduleTab = screen.getByRole('link', { name: /schedule/i });
    expect(scheduleTab).toHaveAttribute('aria-current', 'page');
  });

  it('highlights Pay tab when on /employee/pay', () => {
    renderWithRouter('/employee/pay');
    const payTab = screen.getByRole('link', { name: /pay/i });
    expect(payTab).toHaveAttribute('aria-current', 'page');
  });

  it('highlights More tab when on a sub-page like /employee/timecard', () => {
    renderWithRouter('/employee/timecard');
    const moreTab = screen.getByRole('link', { name: /more/i });
    expect(moreTab).toHaveAttribute('aria-current', 'page');
  });

  it('links to correct routes', () => {
    renderWithRouter('/employee/schedule');
    expect(screen.getByRole('link', { name: /schedule/i })).toHaveAttribute('href', '/employee/schedule');
    expect(screen.getByRole('link', { name: /pay/i })).toHaveAttribute('href', '/employee/pay');
    expect(screen.getByRole('link', { name: /clock/i })).toHaveAttribute('href', '/employee/clock');
    expect(screen.getByRole('link', { name: /more/i })).toHaveAttribute('href', '/employee/more');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/MobileTabBar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `MobileTabBar`**

```typescript
// src/components/employee/MobileTabBar.tsx
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Wallet, Clock, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { path: '/employee/schedule', label: 'Schedule', icon: CalendarDays },
  { path: '/employee/pay', label: 'Pay', icon: Wallet },
  { path: '/employee/clock', label: 'Clock', icon: Clock },
  { path: '/employee/more', label: 'More', icon: MoreHorizontal },
] as const;

// Routes that fall under the "More" tab
const moreRoutes = ['/employee/timecard', '/employee/portal', '/employee/shifts', '/employee/tips', '/settings'];

export function MobileTabBar() {
  const { pathname } = useLocation();

  const isActive = (tab: typeof tabs[number]) => {
    if (tab.path === '/employee/more') {
      return pathname === '/employee/more' || moreRoutes.some(r => pathname.startsWith(r));
    }
    return pathname.startsWith(tab.path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/40 bg-background"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      role="navigation"
      aria-label="Employee navigation"
    >
      <div className="flex justify-around py-2">
        {tabs.map((tab) => {
          const active = isActive(tab);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium transition-colors min-w-[64px]',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <tab.icon className="h-5 w-5" aria-hidden="true" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/MobileTabBar.test.tsx`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/employee/MobileTabBar.tsx tests/unit/MobileTabBar.test.tsx
git commit -m "feat: add MobileTabBar component with 4 tabs"
```

---

### Task 3: Create `MobileLayout` wrapper

**Files:**
- Create: `src/components/employee/MobileLayout.tsx`
- Test: `tests/unit/MobileLayout.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/MobileLayout.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { MobileLayout } from '@/components/employee/MobileLayout';

describe('MobileLayout', () => {
  it('renders children and the tab bar', () => {
    render(
      <MemoryRouter initialEntries={['/employee/schedule']}>
        <MobileLayout>
          <div data-testid="page-content">Hello</div>
        </MobileLayout>
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /employee navigation/i })).toBeInTheDocument();
  });

  it('has bottom padding to clear the tab bar', () => {
    render(
      <MemoryRouter initialEntries={['/employee/schedule']}>
        <MobileLayout>
          <div>Content</div>
        </MobileLayout>
      </MemoryRouter>
    );

    const main = screen.getByRole('main');
    expect(main.className).toContain('pb-20');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/MobileLayout.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `MobileLayout`**

```typescript
// src/components/employee/MobileLayout.tsx
import { ReactNode } from 'react';
import { MobileTabBar } from './MobileTabBar';

interface MobileLayoutProps {
  children: ReactNode;
}

export function MobileLayout({ children }: MobileLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <main className="flex-1 px-4 py-4 pb-20 max-w-full overflow-x-hidden" role="main">
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/MobileLayout.test.tsx`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/employee/MobileLayout.tsx tests/unit/MobileLayout.test.tsx
git commit -m "feat: add MobileLayout wrapper with bottom tab padding"
```

---

### Task 4: Create `EmployeeMore` page

**Files:**
- Create: `src/pages/EmployeeMore.tsx`
- Test: `tests/unit/EmployeeMore.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/EmployeeMore.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import EmployeeMore from '@/pages/EmployeeMore';

// Mock useAuth for sign out
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));

describe('EmployeeMore', () => {
  const renderPage = () => render(
    <MemoryRouter>
      <EmployeeMore />
    </MemoryRouter>
  );

  it('renders all navigation items', () => {
    renderPage();
    expect(screen.getByText('Timecard')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Shift Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Tips')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders sign out button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('links to correct routes', () => {
    renderPage();
    expect(screen.getByText('Timecard').closest('a')).toHaveAttribute('href', '/employee/timecard');
    expect(screen.getByText('Requests').closest('a')).toHaveAttribute('href', '/employee/portal');
    expect(screen.getByText('Shift Marketplace').closest('a')).toHaveAttribute('href', '/employee/shifts');
    expect(screen.getByText('Tips').closest('a')).toHaveAttribute('href', '/employee/tips');
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('href', '/settings');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/EmployeeMore.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `EmployeeMore`**

```typescript
// src/pages/EmployeeMore.tsx
import { Link } from 'react-router-dom';
import { Clock, CalendarCheck, ShoppingBag, Coins, Settings, LogOut, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { LucideIcon } from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const mainItems: NavItem[] = [
  { path: '/employee/timecard', label: 'Timecard', description: 'Hours worked this period', icon: Clock },
  { path: '/employee/portal', label: 'Requests', description: 'Time off & availability', icon: CalendarCheck },
  { path: '/employee/shifts', label: 'Shift Marketplace', description: 'Pick up available shifts', icon: ShoppingBag },
  { path: '/employee/tips', label: 'Tips', description: 'Tip history & breakdown', icon: Coins },
];

const EmployeeMore = () => {
  const { signOut } = useAuth();

  return (
    <div className="space-y-3">
      <div className="pt-2 pb-1">
        <h1 className="text-[20px] font-bold text-foreground">More</h1>
      </div>

      {/* Main navigation */}
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        {mainItems.map((item, index) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center justify-between p-4 hover:bg-muted/50 transition-colors ${
              index < mainItems.length - 1 ? 'border-b border-border/40' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <div className="text-[14px] font-medium text-foreground">{item.label}</div>
                <div className="text-[11px] text-muted-foreground">{item.description}</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
          </Link>
        ))}
      </div>

      {/* Settings */}
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <Link
          to="/settings"
          className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-[14px] font-medium text-foreground">Settings</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
        </Link>
      </div>

      {/* Sign out */}
      <div className="pt-2 text-center">
        <button
          onClick={() => signOut()}
          aria-label="Sign out"
          className="text-[13px] font-medium text-destructive hover:text-destructive/80 transition-colors py-3 px-6"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};

export default EmployeeMore;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/EmployeeMore.test.tsx`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/EmployeeMore.tsx tests/unit/EmployeeMore.test.tsx
git commit -m "feat: add EmployeeMore page with iOS Settings-style navigation"
```

---

### Task 5: Wire up layout switching in `App.tsx`

This is the core integration task. It modifies `ProtectedRoute` to render `MobileLayout` for staff on mobile, adds the `/employee/more` route, fixes `staffAllowedPaths`, and updates the default staff redirect.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/employee/index.ts` (export MobileLayout if barrel exists)

- [ ] **Step 1: Add imports to `App.tsx`**

At the top of `src/App.tsx`, add:

```typescript
import { useIsMobile } from '@/hooks/use-mobile';
import { MobileLayout } from '@/components/employee/MobileLayout';
```

Add the lazy import for the new page alongside the other employee page imports:

```typescript
const EmployeeMore = lazy(() => import('./pages/EmployeeMore'));
```

If `EmployeeMore` is not lazy-loaded (check the existing pattern for other employee pages), import it directly instead.

- [ ] **Step 2: Create `LayoutSwitcher` component and restructure `ProtectedRoute`**

The challenge: `isStaff` is computed inside `StaffRoleChecker` (which uses `useRestaurantContext()`), but the layout ternary lives in `ProtectedRoute` (which renders `RestaurantProvider`). Solution: create a `LayoutSwitcher` component that lives inside `RestaurantProvider` and owns the `noChrome / isStaffMobile / sidebar` decision.

**Add `LayoutSwitcher` as an inline component in `App.tsx`:**

```typescript
const LayoutSwitcher = ({ children, noChrome, isMobile }: { children: ReactNode; noChrome: boolean; isMobile: boolean }) => {
  const { selectedRestaurant } = useRestaurantContext();
  const isStaff = selectedRestaurant?.role === 'staff';

  if (noChrome) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  if (isStaff && isMobile) {
    return <MobileLayout>{children}</MobileLayout>;
  }

  return (
    <>
      <SidebarProvider defaultOpen={true}>
        <div className="min-h-screen flex w-full bg-background overflow-x-hidden">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
            <AppHeader />
            <main className="flex-1 container px-4 py-4 md:py-6 max-w-full overflow-x-hidden">
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
      <AiChatBubble />
      <AiChatPanel />
    </>
  );
};
```

**Modify `ProtectedRoute`'s return block** (lines 93-121). Call `useIsMobile()` at the top of `ProtectedRoute` (before `RestaurantProvider` — fine, it only needs `window`). Then replace the existing `noChrome` ternary + sidebar layout with `LayoutSwitcher`:

```tsx
const ProtectedRoute = ({ children, allowStaff = false, noChrome = false }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile(); // Add this line

  // ... existing auth loading/redirect logic (unchanged) ...

  return (
    <RestaurantProvider>
      <AiChatProvider>
        <StaffRoleChecker allowStaff={allowStaff} currentPath={location.pathname}>
          <LayoutSwitcher noChrome={noChrome} isMobile={isMobile}>
            {children}
          </LayoutSwitcher>
        </StaffRoleChecker>
      </AiChatProvider>
    </RestaurantProvider>
  );
};
```

**CRITICAL:** Remove the old layout ternary and `<AiChatBubble />`/`<AiChatPanel />` from the old location (lines 97-115). These now live exclusively inside `LayoutSwitcher`'s sidebar branch. If left in the old location, AI chat will render twice on desktop. The `noChrome` check also moves into `LayoutSwitcher`.

- [ ] **Step 3: Fix `staffAllowedPaths` and default redirect**

In `StaffRoleChecker` (around line 202), update:

```typescript
// Before:
const staffAllowedPaths = ['/employee/clock', '/employee/portal', '/employee/timecard', '/employee/pay', '/employee/schedule', '/employee/shifts', '/settings'];
// ...
return <Navigate to="/employee/clock" replace />;

// After (add /employee/tips and /employee/more for completeness):
const staffAllowedPaths = ['/employee/clock', '/employee/portal', '/employee/timecard', '/employee/pay', '/employee/schedule', '/employee/shifts', '/employee/tips', '/employee/more', '/settings'];
// ...
return <Navigate to="/employee/schedule" replace />;
```

- [ ] **Step 4: Add `/employee/more` route**

Add the route alongside the other employee routes (around line 247):

```tsx
<Route path="/employee/more" element={<ProtectedRoute allowStaff={true}><EmployeeMore /></ProtectedRoute>} />
```

- [ ] **Step 5: Export from barrel file (if exists)**

Check if `src/components/employee/index.ts` exists. If it does, add:

```typescript
export { MobileLayout } from './MobileLayout';
export { MobileTabBar } from './MobileTabBar';
```

- [ ] **Step 6: Manually test the layout switching**

Run: `npm run dev`
1. Log in as a staff user
2. Open browser dev tools → toggle mobile viewport (e.g., iPhone 14)
3. Verify: bottom tab bar appears, sidebar is hidden, no AppHeader
4. Navigate between tabs: Schedule, Pay, Clock, More
5. Open More → verify all links work (Timecard, Requests, etc.)
6. Switch back to desktop viewport → verify sidebar returns

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire mobile layout switching for staff users

- Add LayoutSwitcher with noChrome/mobile/sidebar branches
- Add /employee/more route
- Fix staffAllowedPaths (add /employee/tips, /employee/more)
- Default staff redirect changed to /employee/schedule"
```

---

### Task 6: Adjust `InstallBanner` positioning for mobile tab bar

**Files:**
- Modify: `src/components/InstallBanner.tsx`
- Modify: `src/App.tsx` (move `<InstallBanner />` inside `BrowserRouter`)

- [ ] **Step 1: Move `InstallBanner` inside `BrowserRouter` in `App.tsx`**

Currently at line 219, `InstallBanner` is rendered outside `BrowserRouter`. Move it inside `BrowserRouter` but outside `Routes`, so it renders on every page:

```tsx
// Before (line 219, outside BrowserRouter):
<InstallBanner />

// After (inside BrowserRouter, before <Routes>):
<BrowserRouter>
  <InstallBanner />
  <Routes>
    ...
  </Routes>
</BrowserRouter>
```

- [ ] **Step 2: Add mobile-aware bottom positioning to `InstallBanner`**

In `src/components/InstallBanner.tsx`, add two imports at the top:

```typescript
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
```

Note: `cn` is NOT currently imported in this file — you must add it.

Inside the component, add:

```typescript
const isMobile = useIsMobile();
```

Update the `Card` className (line 83) to use conditional bottom position:

```tsx
<Card className={cn(
  "fixed left-4 right-4 z-50 border-primary/20 bg-card/95 backdrop-blur-sm shadow-lg md:left-auto md:right-4 md:max-w-md",
  isMobile ? "bottom-20" : "bottom-4"
)}>
```

Import `cn` from `@/lib/utils` if not already imported.

- [ ] **Step 3: Verify banner positioning**

Run: `npm run dev`
1. On mobile viewport, verify banner appears above the tab bar (not behind it)
2. On desktop, verify banner appears at bottom-right as before
3. Dismiss the banner, reload, verify it stays dismissed

- [ ] **Step 4: Commit**

```bash
git add src/components/InstallBanner.tsx src/App.tsx
git commit -m "fix: position InstallBanner above mobile tab bar"
```

---

### Task 7: Responsive tweaks for employee pages

Apply mobile-friendly adjustments to existing employee pages. These are CSS-only changes — no logic changes.

**Files:**
- Modify: `src/pages/EmployeeSchedule.tsx`
- Modify: `src/pages/EmployeePay.tsx`
- Modify: `src/pages/EmployeeClock.tsx`
- Modify: `src/pages/EmployeeTimecard.tsx`
- Modify: `src/pages/EmployeePortal.tsx`
- Modify: `src/pages/EmployeeShiftMarketplace.tsx`
- Modify: `src/pages/EmployeeTips.tsx`

- [ ] **Step 1: Read each employee page and identify responsive issues**

For each page, look for:
- Horizontal layouts that should stack on mobile (`flex-row` → `flex-col sm:flex-row`)
- Buttons that should be full-width on mobile (`w-full sm:w-auto`)
- Touch targets smaller than 44px (buttons, links)
- Excessive padding on mobile
- The `EmployeePageHeader` card — on mobile it can be simplified

Run: `npm run dev` with mobile viewport and visually inspect each page.

- [ ] **Step 2: Apply responsive tweaks to each page**

Common patterns to apply:
- Navigation buttons (prev/next week): ensure `min-h-[44px] min-w-[44px]` for touch
- `flex-row` containers: add `flex-col sm:flex-row` for mobile stacking
- Button groups: add `w-full sm:w-auto` for full-width on mobile
- Period selectors: stack label and controls vertically on mobile
- Grid layouts: `grid-cols-1 sm:grid-cols-2` for mobile single column

Apply changes incrementally, testing each page in the browser.

- [ ] **Step 3: Test all pages on mobile viewport**

Run: `npm run dev`
For each of the 7 pages, in mobile viewport:
1. Verify content is readable and not overflowing
2. Verify touch targets are at least 44px
3. Verify no horizontal scroll
4. Verify the bottom tab bar doesn't overlap content

- [ ] **Step 4: Commit**

```bash
git add src/pages/EmployeeSchedule.tsx src/pages/EmployeePay.tsx src/pages/EmployeeClock.tsx src/pages/EmployeeTimecard.tsx src/pages/EmployeePortal.tsx src/pages/EmployeeShiftMarketplace.tsx src/pages/EmployeeTips.tsx
git commit -m "style: responsive tweaks for employee pages on mobile"
```

---

### Task 8: E2E tests for mobile employee experience

**Files:**
- Create: `tests/e2e/employee-mobile.spec.ts`

- [ ] **Step 1: Write E2E tests**

```typescript
// tests/e2e/employee-mobile.spec.ts
import { test, expect, Page } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

// Mobile viewport
const mobileViewport = { width: 375, height: 812 };

// Helper to set user role to staff (same pattern as permissions-roles.spec.ts)
async function setUserRole(page: Page, role: string): Promise<void> {
  await exposeSupabaseHelpers(page);
  await page.evaluate(
    async ({ role }) => {
      const user = await (window as any).__getAuthUser();
      if (!user?.id) throw new Error('No user session');
      const restaurantId = await (window as any).__getRestaurantId(user.id);
      if (!restaurantId) throw new Error('No restaurant');
      const { error } = await (window as any).__supabase
        .from('user_restaurants')
        .update({ role })
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId);
      if (error) throw new Error(`Failed to update role: ${error.message}`);
    },
    { role }
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test.describe('Employee Mobile Experience', () => {
  test.use({ viewport: mobileViewport });

  test('staff user sees bottom tab bar on mobile, not sidebar', async ({ page }) => {
    const user = generateTestUser('staff-mobile');
    await signUpAndCreateRestaurant(page, user);
    await setUserRole(page, 'staff');

    // Should be redirected to /employee/schedule
    await expect(page).toHaveURL('/employee/schedule', { timeout: 10000 });

    // Should see tab bar
    await expect(page.getByRole('navigation', { name: /employee navigation/i })).toBeVisible();
    // Should NOT see sidebar
    await expect(page.locator('[data-sidebar]')).not.toBeVisible();
  });

  test('default landing page is Schedule', async ({ page }) => {
    const user = generateTestUser('staff-landing');
    await signUpAndCreateRestaurant(page, user);
    await setUserRole(page, 'staff');

    // Staff should be redirected to /employee/schedule
    await expect(page).toHaveURL('/employee/schedule', { timeout: 10000 });
  });

  test('can navigate between tabs', async ({ page }) => {
    const user = generateTestUser('staff-tabs');
    await signUpAndCreateRestaurant(page, user);
    await setUserRole(page, 'staff');
    await expect(page).toHaveURL('/employee/schedule', { timeout: 10000 });

    // Navigate to Pay
    await page.getByRole('link', { name: /pay/i }).click();
    await expect(page).toHaveURL(/\/employee\/pay/);

    // Navigate to Clock
    await page.getByRole('link', { name: /clock/i }).click();
    await expect(page).toHaveURL(/\/employee\/clock/);

    // Navigate to More
    await page.getByRole('link', { name: /more/i }).click();
    await expect(page).toHaveURL(/\/employee\/more/);
  });

  test('More page shows all sub-navigation items', async ({ page }) => {
    const user = generateTestUser('staff-more');
    await signUpAndCreateRestaurant(page, user);
    await setUserRole(page, 'staff');
    await page.goto('/employee/more', { waitUntil: 'networkidle' });

    await expect(page.getByText('Timecard')).toBeVisible();
    await expect(page.getByText('Requests')).toBeVisible();
    await expect(page.getByText('Shift Marketplace')).toBeVisible();
    await expect(page.getByText('Tips')).toBeVisible();
    await expect(page.getByText('Settings')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('More page links navigate to correct pages', async ({ page }) => {
    const user = generateTestUser('staff-more-nav');
    await signUpAndCreateRestaurant(page, user);
    await setUserRole(page, 'staff');
    await page.goto('/employee/more', { waitUntil: 'networkidle' });

    await page.getByText('Timecard').click();
    await expect(page).toHaveURL(/\/employee\/timecard/);

    // More tab should still be highlighted
    const moreTab = page.getByRole('link', { name: /more/i });
    await expect(moreTab).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run E2E tests**

Run: `npx playwright test tests/e2e/employee-mobile.spec.ts`
Expected: All tests PASS (adjust after running against real app)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/employee-mobile.spec.ts
git commit -m "test: add E2E tests for employee mobile experience"
```

---

## Task Dependency Graph

```
Task 1 (useIsMobile) ──┐
                        ├── Task 5 (App.tsx wiring) ── Task 6 (InstallBanner) ── Task 7 (responsive tweaks) ── Task 8 (E2E)
Task 2 (MobileTabBar) ─┤
Task 3 (MobileLayout) ─┤
Task 4 (EmployeeMore) ─┘
```

**Parallelizable:** Tasks 1-4 are independent and can be built concurrently.
**Sequential:** Task 5 depends on all of 1-4. Tasks 6-8 are sequential after 5.
