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
    // In this codebase's jsdom env, Radix Presence unmounts synchronously
    // (no CSS animation runs), so the dialog is gone immediately.
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

  it('navigates without throwing and leaves drawer state untouched on desktop', () => {
    // Desktop never renders the mobile Sheet, so there is no drawer to open
    // or close in the first place.
    expect(() => renderDesktopSidebar()).not.toThrow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const navLink = screen.getByRole('button', { name: /integrations/i });
    expect(() => fireEvent.click(navLink)).not.toThrow();

    expect(mocks.navigate).toHaveBeenCalledWith('/integrations');
    // No Sheet ever mounted on desktop, so there's still no dialog to find —
    // confirms handleNavigate's `setOpenMobile` branch was skipped safely.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
