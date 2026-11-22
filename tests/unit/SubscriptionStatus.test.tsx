import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubscriptionStatus } from '@/components/subscription/SubscriptionStatus';

const mockUseSubscription = vi.fn();
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

const base = {
  subscription: { status: 'trialing', period: 'monthly', stripeSubscriptionId: null },
  effectiveTier: null,
  effectiveStatus: 'trial_expired',
  isTrialing: false,
  isTrialExpired: true,
  isGrandfathered: false,
  isPastDue: false,
  isActive: false,
  isCanceled: false,
  trialDaysRemaining: null,
  grandfatheredDaysRemaining: null,
  openPortal: vi.fn(),
  isOpeningPortal: false,
};

describe('SubscriptionStatus', () => {
  beforeEach(() => mockUseSubscription.mockReset());

  it('shows the expired card when the trial ended', () => {
    mockUseSubscription.mockReturnValue(base);
    render(<SubscriptionStatus />);
    expect(screen.getByText('Trial ended')).toBeTruthy();
    expect(screen.getByText('Your trial ended — choose a plan')).toBeTruthy();
  });

  it('prints the effective status in the status line', () => {
    mockUseSubscription.mockReturnValue({
      ...base,
      effectiveTier: 'growth',
      isTrialExpired: true,
    });
    render(<SubscriptionStatus />);
    expect(screen.getAllByText(/trial expired/i).length).toBeGreaterThan(0);
  });
});
