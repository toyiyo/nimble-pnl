import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnboardingDrawer } from '@/components/dashboard/OnboardingDrawer';
import { useOnboardingStatus, OnboardingStep } from '@/hooks/useOnboardingStatus';

vi.mock('@/hooks/useOnboardingStatus');

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'test-restaurant',
      restaurant: {
        subscription_tier: 'pro',
        subscription_status: 'active',
      },
    },
    restaurants: [],
  }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: { tier: 'pro', status: 'active' },
    effectiveTier: 'pro',
    hasFeature: () => true,
    needsUpgrade: () => false,
    isTrialing: false,
    isGrandfathered: false,
    isPastDue: false,
    isCanceled: false,
    isActive: true,
    trialDaysRemaining: null,
    grandfatheredDaysRemaining: null,
    volumeDiscount: { percent: 0, locationCount: 1, qualifies: false },
    ownedRestaurantCount: 1,
    getPriceInfo: vi.fn(),
    createCheckout: vi.fn(),
    isCreatingCheckout: false,
    openPortal: vi.fn(),
    isOpeningPortal: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

const baseSteps: OnboardingStep[] = [
  {
    id: 'pos',
    label: 'Connect a POS',
    description: 'See real sales, tips, and labor accuracy.',
    path: '/integrations',
    category: 'operations',
    isCompleted: false,
    ctaText: 'Connect POS',
  },
  {
    id: 'receipt',
    label: 'Upload a Receipt',
    description: 'Digitize expenses and update prices.',
    path: '/receipts',
    category: 'inventory',
    isCompleted: false,
    ctaText: 'Upload Receipt',
  },
  {
    id: 'bank',
    label: 'Connect Bank',
    description: 'Automate P&L and expense tracking.',
    path: '/banking',
    category: 'finance',
    isCompleted: false,
    ctaText: 'Connect Bank',
  },
];

const mockedUseOnboardingStatus = vi.mocked(useOnboardingStatus);

describe('OnboardingDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockedUseOnboardingStatus.mockReturnValue({
      steps: baseSteps,
      completedCount: 0,
      totalCount: baseSteps.length,
      percentage: 0,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it('renders a loading skeleton while loading', () => {
    mockedUseOnboardingStatus.mockReturnValue({
      steps: [],
      completedCount: 0,
      totalCount: 0,
      percentage: 0,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    render(<OnboardingDrawer />);

    expect(screen.getByLabelText('Loading onboarding status')).toBeInTheDocument();
  });

  it('shows an error callout and allows retrying', () => {
    const refetch = vi.fn();
    mockedUseOnboardingStatus.mockReturnValue({
      steps: [],
      completedCount: 0,
      totalCount: 0,
      percentage: 0,
      isLoading: false,
      error: new Error('failed'),
      refetch,
    });

    render(<OnboardingDrawer />);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders steps as accessible buttons', () => {
    render(<OnboardingDrawer />);

    expect(screen.getByRole('button', { name: /connect a pos/i })).toBeInTheDocument();
  });

  it('hides the drawer when onboarding is complete', async () => {
    mockedUseOnboardingStatus.mockReturnValue({
      steps: baseSteps.map((step) => ({ ...step, isCompleted: true })),
      completedCount: baseSteps.length,
      totalCount: baseSteps.length,
      percentage: 100,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<OnboardingDrawer />);

    await waitFor(() => {
      expect(screen.queryByText(/getting started/i)).not.toBeInTheDocument();
    });
  });
});
