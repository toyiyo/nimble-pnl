/**
 * MobileLayout view-mode wiring (Phase 4 task 11):
 * renders `<PersonalViewBanner variant="mobile" />` directly above
 * `<MobileTabBar />` only when `viewMode === 'work'`.
 *
 * See docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md
 * ("Component surfaces" table, `MobileLayout.tsx` row) and
 * docs/superpowers/plans/2026-07-24-admin-work-view-mode-plan.md (Task 11).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MobileLayout } from '@/components/employee/MobileLayout';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn(), user: null, loading: false }),
}));

vi.mock('@/hooks/useDeviceToken', () => ({
  useDeviceToken: () => undefined,
}));

vi.mock('@/hooks/useBiometricAuth', () => ({
  useBiometricAuth: () => ({
    isAvailable: false,
    isEnabled: false,
    isLocked: false,
    shouldSignOut: false,
    failedAttempts: 0,
    enable: vi.fn(),
    disable: vi.fn(),
    authenticate: vi.fn(),
    lock: vi.fn(),
  }),
}));

const mocks = vi.hoisted(() => ({
  viewMode: 'admin' as 'admin' | 'work',
  exitWorkMode: vi.fn(),
}));

vi.mock('@/contexts/ViewModeContext', () => ({
  useViewMode: () => ({
    viewMode: mocks.viewMode,
    canUseWorkView: true,
    enterWorkMode: vi.fn(),
    exitWorkMode: mocks.exitWorkMode,
  }),
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/employee/schedule']}>
      <MobileLayout>
        <div data-testid="page-content">Hello</div>
      </MobileLayout>
    </MemoryRouter>
  );
}

describe('MobileLayout – view-mode wiring', () => {
  beforeEach(() => {
    mocks.viewMode = 'admin';
    mocks.exitWorkMode.mockClear();
  });

  it('omits the personal-view banner in admin mode', () => {
    mocks.viewMode = 'admin';
    renderLayout();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the mobile personal-view banner above the tab bar in work mode', () => {
    mocks.viewMode = 'work';
    renderLayout();

    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(screen.getByText('Personal view')).toBeInTheDocument();

    const tabBar = screen.getByRole('navigation', { name: /employee navigation/i });

    // Banner must precede the tab bar in DOM order (slim strip directly
    // above <MobileTabBar />).
     
    expect(banner.compareDocumentPosition(tabBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('calls exitWorkMode when "Back to admin" is tapped in work mode', () => {
    mocks.viewMode = 'work';
    renderLayout();

    screen.getByRole('button', { name: 'Back to admin' }).click();

    expect(mocks.exitWorkMode).toHaveBeenCalledTimes(1);
  });
});
