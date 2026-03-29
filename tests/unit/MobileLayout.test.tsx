// tests/unit/MobileLayout.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
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
    expect(main.style.paddingBottom).toContain('5rem');
  });
});
