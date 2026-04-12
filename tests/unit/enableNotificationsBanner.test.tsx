/**
 * Unit Tests: EnableNotificationsBanner component
 *
 * Tests the banner component by mocking useWebPushSubscription entirely.
 * Covers rendering, button interactions, and disabled state.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────
const mockSubscribe = vi.hoisted(() => vi.fn());
const mockDismiss = vi.hoisted(() => vi.fn());
const mockHookReturn = vi.hoisted(() => ({
  shouldShowBanner: true,
  subscribe: mockSubscribe,
  dismiss: mockDismiss,
  isLoading: false,
  isSupported: true,
  isSubscribed: false,
  permission: 'default' as NotificationPermission | null,
  unsubscribe: vi.fn(),
}));

vi.mock('@/hooks/useWebPushSubscription', () => ({
  useWebPushSubscription: () => mockHookReturn,
}));

// Import AFTER mock setup
import { EnableNotificationsBanner } from '@/components/EnableNotificationsBanner';

// ── Tests ──────────────────────────────────────────────────────────
describe('EnableNotificationsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookReturn.shouldShowBanner = true;
    mockHookReturn.isLoading = false;
    mockHookReturn.subscribe = mockSubscribe;
    mockHookReturn.dismiss = mockDismiss;
  });

  it('renders nothing when shouldShowBanner is false', () => {
    mockHookReturn.shouldShowBanner = false;
    const { container } = render(<EnableNotificationsBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('renders banner content when shouldShowBanner is true', () => {
    render(<EnableNotificationsBanner />);

    expect(screen.getByText('Get instant shift updates')).toBeInTheDocument();
    expect(
      screen.getByText('Enable notifications to know immediately when your shifts change')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument();
  });

  it('"Enable" button calls subscribe', () => {
    render(<EnableNotificationsBanner />);

    const enableButton = screen.getByRole('button', { name: /enable/i });
    fireEvent.click(enableButton);

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('"Not now" button calls dismiss', () => {
    render(<EnableNotificationsBanner />);

    const notNowButton = screen.getByRole('button', { name: /not now/i });
    fireEvent.click(notNowButton);

    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('both buttons are disabled when isLoading is true', () => {
    mockHookReturn.isLoading = true;
    render(<EnableNotificationsBanner />);

    const enableButton = screen.getByRole('button', { name: /enabling/i });
    const notNowButton = screen.getByRole('button', { name: /not now/i });

    expect(enableButton).toBeDisabled();
    expect(notNowButton).toBeDisabled();
  });

  it('shows "Enabling..." text when loading', () => {
    mockHookReturn.isLoading = true;
    render(<EnableNotificationsBanner />);

    expect(screen.getByText('Enabling...')).toBeInTheDocument();
  });
});
