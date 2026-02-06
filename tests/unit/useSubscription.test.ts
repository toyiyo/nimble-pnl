import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock RestaurantContext
const mockSelectedRestaurant = {
  restaurant_id: 'test-restaurant-id',
  role: 'owner',
  restaurant: {
    id: 'test-restaurant-id',
    name: 'Test Restaurant',
    subscription_tier: 'starter',
    subscription_status: 'active',
    subscription_period: 'monthly',
    trial_ends_at: null,
    subscription_ends_at: null,
    grandfathered_until: null,
    stripe_subscription_customer_id: 'cus_test123',
    stripe_subscription_id: 'sub_test123',
  },
};

const mockRestaurants = [
  { restaurant_id: 'r1', role: 'owner', restaurant: { id: 'r1', name: 'Restaurant 1' } },
  { restaurant_id: 'r2', role: 'owner', restaurant: { id: 'r2', name: 'Restaurant 2' } },
  { restaurant_id: 'r3', role: 'manager', restaurant: { id: 'r3', name: 'Restaurant 3' } },
];

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: vi.fn(() => ({
    selectedRestaurant: mockSelectedRestaurant,
    restaurants: mockRestaurants,
  })),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// Import after mocking
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { SUBSCRIPTION_FEATURES } from '@/lib/subscriptionPlans';

// Test wrapper component
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

const mockInvoke = vi.mocked(supabase.functions.invoke);
const mockUseRestaurantContext = vi.mocked(useRestaurantContext);

describe('useSubscription Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default mock
    mockUseRestaurantContext.mockReturnValue({
      selectedRestaurant: mockSelectedRestaurant,
      restaurants: mockRestaurants,
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ============================================================
  // Subscription Info Extraction
  // ============================================================

  describe('subscription info extraction', () => {
    it('extracts subscription info from selected restaurant', () => {
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.subscription).toEqual({
        tier: 'starter',
        status: 'active',
        period: 'monthly',
        trialEndsAt: null,
        subscriptionEndsAt: null,
        cancelAt: null,
        grandfatheredUntil: null,
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test123',
      });
    });

    it('returns null subscription when no restaurant selected', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: null,
        restaurants: [],
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.subscription).toBeNull();
    });
  });

  // ============================================================
  // Effective Tier Logic
  // ============================================================

  describe('effectiveTier logic', () => {
    it('returns actual tier for active subscriptions', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'growth',
            subscription_status: 'active',
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.effectiveTier).toBe('growth');
    });

    it('returns pro tier for trialing users with valid trial', () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'starter',
            subscription_status: 'trialing',
            trial_ends_at: futureDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.effectiveTier).toBe('pro');
      expect(result.current.isTrialing).toBe(true);
    });

    it('returns null for trialing users with expired trial', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'starter',
            subscription_status: 'trialing',
            trial_ends_at: pastDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.effectiveTier).toBeNull();
    });

    it('returns pro tier for grandfathered users with valid period', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'starter',
            subscription_status: 'grandfathered',
            grandfathered_until: futureDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.effectiveTier).toBe('pro');
      expect(result.current.isGrandfathered).toBe(true);
    });

    it('returns starter for grandfathered users with expired period', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'starter',
            subscription_status: 'grandfathered',
            grandfathered_until: pastDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.effectiveTier).toBe('starter');
    });

    it('returns actual tier for past_due subscriptions', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'pro',
            subscription_status: 'past_due',
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.effectiveTier).toBe('pro');
      expect(result.current.isPastDue).toBe(true);
    });

    it('returns starter tier for canceled subscriptions', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'pro',
            subscription_status: 'canceled',
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.effectiveTier).toBe('starter');
      expect(result.current.isCanceled).toBe(true);
    });
  });

  // ============================================================
  // Days Remaining Calculations
  // ============================================================

  describe('days remaining calculations', () => {
    it('calculates trial days remaining correctly', () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days from now
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_status: 'trialing',
            trial_ends_at: futureDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      // Should be 7 or 8 days depending on exact timing
      expect(result.current.trialDaysRemaining).toBeGreaterThanOrEqual(7);
      expect(result.current.trialDaysRemaining).toBeLessThanOrEqual(8);
    });

    it('returns 0 for expired trial', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_status: 'trialing',
            trial_ends_at: pastDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.trialDaysRemaining).toBe(0);
    });

    it('returns null for non-trialing users', () => {
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.trialDaysRemaining).toBeNull();
    });

    it('calculates grandfathered days remaining correctly', () => {
      const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days from now
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_status: 'grandfathered',
            grandfathered_until: futureDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.grandfatheredDaysRemaining).toBeGreaterThanOrEqual(14);
      expect(result.current.grandfatheredDaysRemaining).toBeLessThanOrEqual(15);
    });
  });

  // ============================================================
  // Volume Discount Calculations
  // ============================================================

  describe('volume discount calculations', () => {
    it('returns 0% discount for 1-2 locations', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: mockSelectedRestaurant,
        restaurants: [
          { restaurant_id: 'r1', role: 'owner' },
          { restaurant_id: 'r2', role: 'owner' },
        ],
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.volumeDiscount.percent).toBe(0);
      expect(result.current.volumeDiscount.qualifies).toBe(false);
      expect(result.current.ownedRestaurantCount).toBe(2);
    });

    it('returns 5% discount for 3-5 locations', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: mockSelectedRestaurant,
        restaurants: [
          { restaurant_id: 'r1', role: 'owner' },
          { restaurant_id: 'r2', role: 'owner' },
          { restaurant_id: 'r3', role: 'owner' },
        ],
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.volumeDiscount.percent).toBe(5);
      expect(result.current.volumeDiscount.qualifies).toBe(true);
      expect(result.current.volumeDiscount.locationCount).toBe(3);
    });

    it('returns 10% discount for 6-10 locations', () => {
      const sixOwnerRestaurants = Array.from({ length: 6 }, (_, i) => ({
        restaurant_id: `r${i}`,
        role: 'owner',
      }));
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: mockSelectedRestaurant,
        restaurants: sixOwnerRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.volumeDiscount.percent).toBe(10);
    });

    it('returns 15% discount for 11+ locations', () => {
      const elevenOwnerRestaurants = Array.from({ length: 11 }, (_, i) => ({
        restaurant_id: `r${i}`,
        role: 'owner',
      }));
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: mockSelectedRestaurant,
        restaurants: elevenOwnerRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.volumeDiscount.percent).toBe(15);
    });

    it('only counts owner role for discount calculations', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: mockSelectedRestaurant,
        restaurants: [
          { restaurant_id: 'r1', role: 'owner' },
          { restaurant_id: 'r2', role: 'manager' },
          { restaurant_id: 'r3', role: 'chef' },
          { restaurant_id: 'r4', role: 'staff' },
        ],
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.ownedRestaurantCount).toBe(1);
      expect(result.current.volumeDiscount.percent).toBe(0);
    });
  });

  // ============================================================
  // Feature Gating
  // ============================================================

  describe('feature gating', () => {
    it('starter tier does not have growth features', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'starter',
            subscription_status: 'active',
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasFeature('inventory_automation')).toBe(false);
      expect(result.current.hasFeature('scheduling')).toBe(false);
      expect(result.current.hasFeature('ai_alerts')).toBe(false);
      expect(result.current.needsUpgrade('inventory_automation')).toBe(true);
    });

    it('growth tier has growth features but not pro features', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'growth',
            subscription_status: 'active',
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasFeature('inventory_automation')).toBe(true);
      expect(result.current.hasFeature('scheduling')).toBe(true);
      expect(result.current.hasFeature('banking')).toBe(false);
      expect(result.current.hasFeature('invoicing')).toBe(false);
      expect(result.current.needsUpgrade('banking')).toBe(true);
    });

    it('pro tier has all features', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'pro',
            subscription_status: 'active',
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasFeature('inventory_automation')).toBe(true);
      expect(result.current.hasFeature('banking')).toBe(true);
      expect(result.current.hasFeature('invoicing')).toBe(true);
      expect(result.current.hasFeature('payroll')).toBe(true);
      expect(result.current.needsUpgrade('payroll')).toBe(false);
    });

    it('trialing users have pro features', () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_tier: 'starter',
            subscription_status: 'trialing',
            trial_ends_at: futureDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasFeature('banking')).toBe(true);
      expect(result.current.hasFeature('invoicing')).toBe(true);
    });
  });

  // ============================================================
  // Price Info
  // ============================================================

  describe('getPriceInfo', () => {
    it('calculates prices with volume discount', () => {
      const threeOwnerRestaurants = [
        { restaurant_id: 'r1', role: 'owner' },
        { restaurant_id: 'r2', role: 'owner' },
        { restaurant_id: 'r3', role: 'owner' },
      ];
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: mockSelectedRestaurant,
        restaurants: threeOwnerRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      const priceInfo = result.current.getPriceInfo('growth', 'monthly');

      // Base price is 199, with 3 locations = 597, minus 5% = 567.15 rounded
      expect(priceInfo.basePrice).toBe(199);
      expect(priceInfo.totalBeforeDiscount).toBe(597);
      expect(priceInfo.discountPercent).toBe(5);
      expect(priceInfo.discountAmount).toBe(30); // 597 * 0.05 = 29.85 rounded to 30
      expect(priceInfo.totalPrice).toBe(567);
    });

    it('calculates annual prices correctly', () => {
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: mockSelectedRestaurant,
        restaurants: [{ restaurant_id: 'r1', role: 'owner' }],
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      const priceInfo = result.current.getPriceInfo('starter', 'annual');

      expect(priceInfo.basePrice).toBe(990); // 990 annual price
      expect(priceInfo.totalPrice).toBe(990); // No discount for 1 location
    });
  });

  // ============================================================
  // Mutations
  // ============================================================

  describe('createCheckout mutation', () => {
    it('redirects to checkout URL on success', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: { success: true, url: 'https://checkout.stripe.com/test', sessionId: 'sess_123' },
        error: null,
      });

      // Mock window.location
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = { href: '' } as any;

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createCheckout({ tier: 'growth', period: 'monthly' });
      });

      await waitFor(() => {
        expect(window.location.href).toBe('https://checkout.stripe.com/test');
      });

      // Restore window.location
      window.location = originalLocation;
    });

    it('shows error toast on checkout failure', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: null,
        error: { message: 'Checkout failed' },
      });

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.createCheckout({ tier: 'growth', period: 'monthly' });
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Checkout Failed',
          description: expect.any(String),
          variant: 'destructive',
        });
      });
    });
  });

  describe('openPortal mutation', () => {
    it('opens portal URL in new tab with security features', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: { success: true, url: 'https://billing.stripe.com/portal' },
        error: null,
      });

      // Mock window.open
      const mockWindow = { opener: {} };
      const mockOpen = vi.fn().mockReturnValue(mockWindow);
      const originalOpen = window.open;
      window.open = mockOpen;

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.openPortal();
      });

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalledWith(
          'https://billing.stripe.com/portal',
          '_blank',
          'noopener,noreferrer'
        );
        expect(mockWindow.opener).toBeNull();
      });

      // Restore window.open
      window.open = originalOpen;
    });

    it('shows error toast on portal failure', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: null,
        error: { message: 'Portal error' },
      });

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.openPortal();
      });

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: 'Portal Error',
          description: expect.any(String),
          variant: 'destructive',
        });
      });
    });
  });

  // ============================================================
  // Status Flags
  // ============================================================

  describe('status flags', () => {
    it('correctly identifies active status', () => {
      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isActive).toBe(true);
      expect(result.current.isTrialing).toBe(false);
      expect(result.current.isGrandfathered).toBe(false);
      expect(result.current.isPastDue).toBe(false);
      expect(result.current.isCanceled).toBe(false);
    });

    it('correctly identifies trialing status', () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      mockUseRestaurantContext.mockReturnValue({
        selectedRestaurant: {
          ...mockSelectedRestaurant,
          restaurant: {
            ...mockSelectedRestaurant.restaurant,
            subscription_status: 'trialing',
            trial_ends_at: futureDate,
          },
        },
        restaurants: mockRestaurants,
      } as any);

      const { result } = renderHook(() => useSubscription(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isTrialing).toBe(true);
      expect(result.current.isActive).toBe(false);
    });
  });
});
