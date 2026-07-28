/**
 * AppSidebar view-mode wiring (Phase 4 task 9):
 *  1. `viewMode` from `useViewMode()` is threaded into `getNavigationForRole`,
 *     so the sidebar nav collapses to `staffNav` while in work mode.
 *  2. `<ViewModeSwitch />` renders in the expanded `SidebarFooter` (directly
 *     under the account email chip) and is omitted in the collapsed icon-rail
 *     (design doc: "Insert `<ViewModeSwitch />` in `SidebarFooter`, only in
 *     the expanded (`!collapsed`) branch").
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  viewMode: 'admin' as 'admin' | 'work',
  canUseWorkView: true,
  enterWorkMode: vi.fn(),
  exitWorkMode: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
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

vi.mock('@/contexts/ViewModeContext', () => ({
  useViewMode: () => ({
    viewMode: mocks.viewMode,
    canUseWorkView: mocks.canUseWorkView,
    enterWorkMode: mocks.enterWorkMode,
    exitWorkMode: mocks.exitWorkMode,
  }),
}));

/** Forces the sidebar into the collapsed icon-rail state on mount. */
function CollapseSidebarOnMount() {
  const { setOpen } = useSidebar();

  React.useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function renderSidebar({ collapsed = false }: { collapsed?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SidebarProvider>
        {collapsed && <CollapseSidebarOnMount />}
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('AppSidebar – view-mode wiring', () => {
  beforeEach(() => {
    mocks.viewMode = 'admin';
    mocks.canUseWorkView = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders role-based nav (not staffNav) when viewMode is admin', () => {
    mocks.viewMode = 'admin';
    renderSidebar();

    // Owner's full nav has an "Operations" group (Payroll lives there);
    // staffNav has no such group — it uses "Employee" instead. Group-label
    // triggers always render regardless of collapsed/expanded content state.
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.queryByText('Employee')).not.toBeInTheDocument();
  });

  it('collapses nav to staffNav when viewMode is work, regardless of role', () => {
    mocks.viewMode = 'work';
    renderSidebar();

    // staffNav's groups ("Employee", "Settings") are shown; the owner's
    // role-based groups (e.g. "Operations", "Accounting") are gone entirely.
    expect(screen.getByText('Employee')).toBeInTheDocument();
    expect(screen.queryByText('Operations')).not.toBeInTheDocument();
    expect(screen.queryByText('Accounting')).not.toBeInTheDocument();
  });

  it('renders ViewModeSwitch in the expanded SidebarFooter when eligible', () => {
    mocks.canUseWorkView = true;
    renderSidebar();

    const group = screen.getByRole('group', { name: /view mode/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^admin$/i, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my work/i })).toBeInTheDocument();
  });

  it('omits ViewModeSwitch entirely when ineligible', () => {
    mocks.canUseWorkView = false;
    renderSidebar();

    expect(screen.queryByRole('group', { name: /view mode/i })).not.toBeInTheDocument();
  });

  it('omits ViewModeSwitch in the collapsed icon-rail even when eligible', () => {
    mocks.canUseWorkView = true;
    renderSidebar({ collapsed: true });

    expect(screen.queryByRole('group', { name: /view mode/i })).not.toBeInTheDocument();
  });
});
