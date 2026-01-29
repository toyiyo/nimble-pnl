/**
 * Subscription Plan Definitions
 *
 * Defines the three tiers of EasyShiftHQ subscriptions:
 * - Starter: Basic P&L and inventory ($99/mo)
 * - Growth: Advanced operations & automation ($199/mo)
 * - Pro: Full suite with AI ($299/mo)
 */

export type SubscriptionTier = 'starter' | 'growth' | 'pro';
export type SubscriptionPeriod = 'monthly' | 'annual';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'grandfathered';

export interface SubscriptionPlan {
  id: SubscriptionTier;
  name: string;
  description: string;
  price: {
    monthly: number;
    annual: number;
  };
  features: string[];
  highlights: string[];
  recommended?: boolean;
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionTier, SubscriptionPlan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Daily P&L and basic inventory tools for single-location restaurants',
    price: {
      monthly: 99,
      annual: 990, // ~17% discount (2 months free)
    },
    features: [
      'Daily P&L Dashboard',
      'Basic Inventory Tracking',
      'Labor Cost Tracking',
      'POS Integration',
      'Bank Transaction Sync',
      'Multi-User Access',
      'Email Support',
    ],
    highlights: [
      'Know if you made money today',
      'Track your biggest expenses',
      'Connect your POS and bank',
    ],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'Advanced operations and automation for expanding restaurants',
    price: {
      monthly: 199,
      annual: 1990,
    },
    features: [
      'Everything in Starter',
      'Financial Intelligence Dashboard',
      'Inventory Automation (OCR)',
      'Recipe & Menu Profitability',
      'Employee Scheduling',
      'AI Alerts & Anomaly Detection',
      'Multi-Location Dashboard',
      'Accounting Integrations',
      'Priority Support',
    ],
    highlights: [
      'Automate invoice processing',
      'Schedule your team efficiently',
      'Get AI-powered insights',
    ],
    recommended: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Full suite for restaurant enterprises with AI-powered insights',
    price: {
      monthly: 299,
      annual: 2990,
    },
    features: [
      'Everything in Growth',
      'AI Assistant',
      'Custom Analytics & Reporting',
      'Unlimited Locations',
      'Full Payroll Integration',
      'AP Automation',
      'API Access',
      'Dedicated Account Manager',
      'VIP Support',
    ],
    highlights: [
      'AI-powered virtual analyst',
      'Unlimited scale',
      'White-glove support',
    ],
  },
};

/**
 * Volume discount tiers
 */
export const VOLUME_DISCOUNTS = {
  '3-5': { min: 3, max: 5, percent: 5 },
  '6-10': { min: 6, max: 10, percent: 10 },
  '11+': { min: 11, max: Infinity, percent: 15 },
} as const;

/**
 * Get volume discount percentage based on location count
 */
export function getVolumeDiscountPercent(locationCount: number): number {
  if (locationCount >= 11) return 15;
  if (locationCount >= 6) return 10;
  if (locationCount >= 3) return 5;
  return 0;
}

/**
 * Calculate subscription price with volume discount
 */
export function calculatePrice(
  tier: SubscriptionTier,
  period: SubscriptionPeriod,
  locationCount: number = 1
): {
  basePrice: number;
  totalBeforeDiscount: number;
  discountPercent: number;
  discountAmount: number;
  totalPrice: number;
  pricePerLocation: number;
} {
  const plan = SUBSCRIPTION_PLANS[tier];
  const basePrice = plan.price[period];
  const totalBeforeDiscount = basePrice * locationCount;
  const discountPercent = getVolumeDiscountPercent(locationCount);
  const discountAmount = Math.round(totalBeforeDiscount * (discountPercent / 100));
  const totalPrice = totalBeforeDiscount - discountAmount;

  return {
    basePrice,
    totalBeforeDiscount,
    discountPercent,
    discountAmount,
    totalPrice,
    pricePerLocation: locationCount > 0 ? Math.round(totalPrice / locationCount) : basePrice,
  };
}

/**
 * Format price for display
 */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents);
}

/**
 * Feature keys that are subscription-gated
 */
export const SUBSCRIPTION_FEATURES = {
  ai_assistant: {
    key: 'ai_assistant',
    name: 'AI Assistant',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'AI-powered insights and recommendations',
  },
  financial_intelligence: {
    key: 'financial_intelligence',
    name: 'Financial Intelligence',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'Advanced P&L analysis and break-even insights',
  },
  inventory_automation: {
    key: 'inventory_automation',
    name: 'Inventory Automation',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'OCR invoice scanning and automated updates',
  },
  scheduling: {
    key: 'scheduling',
    name: 'Employee Scheduling',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'Drag-and-drop scheduling and labor forecasting',
  },
  ai_alerts: {
    key: 'ai_alerts',
    name: 'AI Alerts',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'Smart alerts for variances and anomalies',
  },
  multi_location_dashboard: {
    key: 'multi_location_dashboard',
    name: 'Multi-Location Dashboard',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'Consolidated view across all locations',
  },
} as const;

/**
 * Check if a tier has access to a feature
 */
export function tierHasFeature(
  tier: SubscriptionTier | null,
  featureKey: keyof typeof SUBSCRIPTION_FEATURES
): boolean {
  if (!tier) return false;

  const feature = SUBSCRIPTION_FEATURES[featureKey];
  const tierLevel = { starter: 1, growth: 2, pro: 3 };
  const requiredLevel = tierLevel[feature.requiredTier];
  const currentLevel = tierLevel[tier];

  return currentLevel >= requiredLevel;
}

/**
 * Get the required tier for a feature
 */
export function getRequiredTier(
  featureKey: keyof typeof SUBSCRIPTION_FEATURES
): SubscriptionTier {
  return SUBSCRIPTION_FEATURES[featureKey].requiredTier;
}

/**
 * Stripe Price IDs (live mode)
 */
export const STRIPE_PRICE_IDS = {
  starter: {
    monthly: 'price_1SuxQuD9w6YUNUOUNUnCmY30',
    annual: 'price_1SuxQuD9w6YUNUOUbTEYjtba',
  },
  growth: {
    monthly: 'price_1SuxQvD9w6YUNUOUpgwOabhZ',
    annual: 'price_1SuxQvD9w6YUNUOUvdeYY3LS',
  },
  pro: {
    monthly: 'price_1SuxQwD9w6YUNUOU68X5KKWV',
    annual: 'price_1SuxQwD9w6YUNUOUQU80UHw2',
  },
} as const;
