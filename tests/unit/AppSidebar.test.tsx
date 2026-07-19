/**
 * Regression test: on mobile, tapping a sidebar nav item must close the
 * Radix Sheet drawer (not just navigate). See design doc:
 * docs/superpowers/specs/2026-07-19-mobile-sidebar-nav-close-design.md
 *
 * Root cause: AppSidebar's nav buttons call `navigate(...)` directly without
 * ever calling `setOpenMobile(false)`, so the mobile drawer (a Radix Sheet)
 * stays open on top of the newly-navigated page.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  isMobile: true,
  // Spies every `setOpenMobile` call made through AppSidebar's `useSidebar()`
  // import (see the '@/components/ui/sidebar' mock below). This lets tests
  // assert *whether the call happened at all*, not just its downstream
  // effect on `openMobile` state — a plain state/DOM assertion can't tell
  // the difference between "isMobile guard skipped the call" and "guard
  // called setOpenMobile(false) while it was already false".
  setOpenMobileSpy: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile,
}));

vi.mock('@/components/ui/sidebar', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/sidebar')>('@/components/ui/sidebar');
  return {
    ...actual,
    // Wrap (not replace) `setOpenMobile` so real Sheet open/close behaviour
    // is unaffected — we just record every call AppSidebar/test helpers make
    // through this import.
    useSidebar: () => {
      const ctx = actual.useSidebar();
      return {
        ...ctx,
        setOpenMobile: (open: boolean) => {
          mocks.setOpenMobileSpy(open);
          ctx.setOpenMobile(open);
        },
      };
    },
  };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'owner@example.com' },
    signOut: vi.fn(),
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      role: 'owner',
      restaurant: { id: 'r1', name: 'Test Restaurant' },
    },
  }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    hasFeature: () => true,
  }),
}));

/** Opens the mobile Sheet on mount, mirroring the AppHeader hamburger toggle. */
function OpenMobileSidebarOnMount() {
  const { setOpenMobile } = useSidebar();

  React.useEffect(() => {
    setOpenMobile(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function renderMobileSidebar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SidebarProvider>
        <OpenMobileSidebarOnMount />
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function renderDesktopSidebar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('AppSidebar – mobile close-on-nav', () => {
  beforeEach(() => {
    mocks.isMobile = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('closes the mobile drawer and navigates when a nav item is tapped', () => {
    renderMobileSidebar();

    // Drawer is open: the Sheet renders as an accessible dialog.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // "Integrations" lives in the "Main" group, which is expanded by default
    // because the current path ("/") belongs to that group.
    const navLink = screen.getByRole('button', { name: /integrations/i });
    fireEvent.click(navLink);

    expect(mocks.navigate).toHaveBeenCalledWith('/integrations');
    expect(mocks.setOpenMobileSpy).toHaveBeenCalledWith(false);
    // In this codebase's jsdom env, Radix Presence unmounts synchronously
    // (no CSS animation runs), so the dialog is gone immediately.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the mobile drawer when tapping the link for the current route (same-route tap)', () => {
    // "/" doesn't map to a nav item, so use the header logo button, whose
    // handleNavigate('/') target equals the initial route. A pathname-effect
    // alternative (rejected in the design doc) would miss this case because
    // the path never changes; the central handleNavigate helper must still
    // close the drawer.
    renderMobileSidebar();

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const logoButton = screen.getByRole('button', { name: /easyshifthq/i });
    fireEvent.click(logoButton);

    expect(mocks.navigate).toHaveBeenCalledWith('/');
    expect(mocks.setOpenMobileSpy).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AppSidebar – desktop regression guard', () => {
  beforeEach(() => {
    mocks.isMobile = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('navigates without throwing and skips the setOpenMobile call on desktop', () => {
    // Desktop never renders the mobile Sheet, so there is no drawer to open
    // or close in the first place. NOTE: because of that, `queryByRole
    // ('dialog')` is absent from this test's assertions on principle — the
    // Sheet is never mounted on desktop regardless of what `handleNavigate`
    // does, so that check can't distinguish "isMobile guard worked" from
    // "isMobile guard was removed" (see mocks.setOpenMobileSpy below for the
    // assertion that actually pins the guarded branch).
    expect(() => renderDesktopSidebar()).not.toThrow();

    const navLink = screen.getByRole('button', { name: /integrations/i });
    expect(() => fireEvent.click(navLink)).not.toThrow();

    expect(mocks.navigate).toHaveBeenCalledWith('/integrations');
    // The real regression guard: handleNavigate's `if (isMobile)` branch
    // must skip calling `setOpenMobile` entirely on desktop. If that guard
    // were ever removed, this assertion (unlike a dialog-role check) would
    // fail, because AppSidebar's `useSidebar()` import is wrapped above to
    // record every call.
    expect(mocks.setOpenMobileSpy).not.toHaveBeenCalled();
  });
});
