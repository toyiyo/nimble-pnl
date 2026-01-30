import { useMemo, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  SubscriptionTier,
  SubscriptionPeriod,
  SubscriptionStatus,
  SUBSCRIPTION_FEATURES,
  tierHasFeature,
  calculatePrice,
  getVolumeDiscountPercent,
} from '@/lib/subscriptionPlans';

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  period: SubscriptionPeriod;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  grandfatheredUntil: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export function useSubscription() {
  const { selectedRestaurant, restaurants } = useRestaurantContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Extract subscription info from selected restaurant
  const subscription: SubscriptionInfo | null = useMemo(() => {
    if (!selectedRestaurant?.restaurant) return null;

    const r = selectedRestaurant.restaurant;
    return {
      tier: (r.subscription_tier || 'starter') as SubscriptionTier,
      status: (r.subscription_status || 'trialing') as SubscriptionStatus,
      period: (r.subscription_period || 'monthly') as SubscriptionPeriod,
      trialEndsAt: r.trial_ends_at || null,
      subscriptionEndsAt: r.subscription_ends_at || null,
      grandfatheredUntil: r.grandfathered_until || null,
      stripeCustomerId: r.stripe_subscription_customer_id || null,
      stripeSubscriptionId: r.stripe_subscription_id || null,
    };
  }, [selectedRestaurant]);

  // Calculate effective tier (accounting for grandfathering and trials)
  const effectiveTier: SubscriptionTier | null = useMemo(() => {
    if (!subscription) return null;

    const { tier, status, grandfatheredUntil, trialEndsAt } = subscription;

    // Grandfathered = Pro until expiry
    if (status === 'grandfathered') {
      if (!grandfatheredUntil || new Date(grandfatheredUntil) > new Date()) {
        return 'pro';
      }
      return 'starter'; // Grace period expired
    }

    // Trialing = Pro until expiry (users get full access during trial)
    if (status === 'trialing') {
      if (!trialEndsAt || new Date(trialEndsAt) > new Date()) {
        return 'pro';
      }
      return null; // Trial expired
    }

    // Active or past_due = actual tier
    if (status === 'active' || status === 'past_due') {
      return tier;
    }

    // Canceled = starter (basic access)
    if (status === 'canceled') {
      return 'starter';
    }

    return tier;
  }, [subscription]);

  // Status checks
  const isTrialing = subscription?.status === 'trialing';
  const isGrandfathered = subscription?.status === 'grandfathered';
  const isPastDue = subscription?.status === 'past_due';
  const isCanceled = subscription?.status === 'canceled';
  const isActive = subscription?.status === 'active';

  // Trial days remaining
  const trialDaysRemaining = useMemo(() => {
    if (!isTrialing || !subscription?.trialEndsAt) return null;
    const diff = new Date(subscription.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [isTrialing, subscription?.trialEndsAt]);

  // Grandfathered days remaining
  const grandfatheredDaysRemaining = useMemo(() => {
    if (!isGrandfathered || !subscription?.grandfatheredUntil) return null;
    const diff = new Date(subscription.grandfatheredUntil).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [isGrandfathered, subscription?.grandfatheredUntil]);

  // Feature access check
  const hasFeature = useCallback(
    (featureKey: keyof typeof SUBSCRIPTION_FEATURES): boolean => {
      return tierHasFeature(effectiveTier, featureKey);
    },
    [effectiveTier]
  );

  // Check if upgrade is needed for a feature
  const needsUpgrade = useCallback(
    (featureKey: keyof typeof SUBSCRIPTION_FEATURES): boolean => {
      return !hasFeature(featureKey);
    },
    [hasFeature]
  );

  // Count restaurants owned by user (for volume discount)
  const ownedRestaurantCount = useMemo(() => {
    return restaurants.filter((r) => r.role === 'owner').length;
  }, [restaurants]);

  // Volume discount info
  const volumeDiscount = useMemo(() => {
    const percent = getVolumeDiscountPercent(ownedRestaurantCount);
    return {
      percent,
      locationCount: ownedRestaurantCount,
      qualifies: percent > 0,
    };
  }, [ownedRestaurantCount]);

  // Create checkout session mutation
  const createCheckoutMutation = useMutation({
    mutationFn: async ({
      tier,
      period,
    }: {
      tier: SubscriptionTier;
      period: SubscriptionPeriod;
    }) => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error('No restaurant selected');
      }

      const { data, error } = await supabase.functions.invoke(
        'stripe-subscription-checkout',
        {
          body: {
            restaurantId: selectedRestaurant.restaurant_id,
            tier,
            period,
          },
        }
      );

      if (error) {
        throw new Error(error.message || 'Failed to create checkout session');
      }

      return data as { success: boolean; sessionId: string; url: string };
    },
    onSuccess: (data) => {
      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Checkout Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Open customer portal mutation
  const openPortalMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error('No restaurant selected');
      }

      const { data, error } = await supabase.functions.invoke(
        'stripe-customer-portal',
        {
          body: {
            restaurantId: selectedRestaurant.restaurant_id,
          },
        }
      );

      if (error) {
        throw new Error(error.message || 'Failed to open billing portal');
      }

      return data as { success: boolean; url: string };
    },
    onSuccess: (data) => {
      if (data.url) {
        // Open Stripe Customer Portal in new tab with security features
        const newWindow = window.open(data.url, '_blank', 'noopener,noreferrer');
        if (newWindow) newWindow.opener = null;
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Portal Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Calculate price for a plan
  const getPriceInfo = useCallback(
    (tier: SubscriptionTier, period: SubscriptionPeriod) => {
      return calculatePrice(tier, period, ownedRestaurantCount);
    },
    [ownedRestaurantCount]
  );

  return {
    // Subscription info
    subscription,
    effectiveTier,

    // Status checks
    isTrialing,
    isGrandfathered,
    isPastDue,
    isCanceled,
    isActive,

    // Time remaining
    trialDaysRemaining,
    grandfatheredDaysRemaining,

    // Feature access
    hasFeature,
    needsUpgrade,

    // Volume discount
    volumeDiscount,
    ownedRestaurantCount,

    // Pricing
    getPriceInfo,

    // Actions
    createCheckout: createCheckoutMutation.mutate,
    isCreatingCheckout: createCheckoutMutation.isPending,
    openPortal: openPortalMutation.mutate,
    isOpeningPortal: openPortalMutation.isPending,
  };
}
