/**
 * Subscription Plan Definitions
 *
 * Defines the three tiers of EasyShiftHQ subscriptions:
 * - Starter: Basic P&L and inventory ($99/mo)
 * - Growth: AI-powered automation & intelligence ($199/mo)
 * - Pro: Full suite with Stripe integrations ($299/mo)
 *
 * Gating Philosophy:
 * - Growth = Features that use AI (OCR, categorization, alerts, intelligence)
 * - Pro = Features that use Stripe (invoicing, banking, expenses, payroll)
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
      'POS Integration (Square, Toast, Clover)',
      'Recipe Management',
      'Multi-User Access',
      'Email Support',
    ],
    highlights: [
      'Know if you made money today',
      'Track your biggest expenses',
      'Connect your POS system',
    ],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'AI-powered automation and intelligence for growing restaurants',
    price: {
      monthly: 199,
      annual: 1990,
    },
    features: [
      'Everything in Starter',
      'Financial Intelligence Dashboard',
      'Inventory Automation (OCR)',
      'Recipe & Menu Profitability Analytics',
      'Employee Scheduling',
      'AI Alerts & Anomaly Detection',
      'AI Transaction Categorization',
      'Priority Support',
    ],
    highlights: [
      'Scan invoices with AI',
      'Get predictive alerts',
      'Schedule your team efficiently',
    ],
    recommended: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Complete financial operations with Stripe-powered integrations',
    price: {
      monthly: 299,
      annual: 2990,
    },
    features: [
      'Everything in Growth',
      'AI Assistant',
      'Bank Account Connections',
      'Automated Transaction Sync',
      'Customer Invoicing',
      'Expense Management',
      'Asset & Equipment Tracking',
      'Payroll Reports & Export',
      'VIP Support',
    ],
    highlights: [
      'Connect your bank accounts',
      'Send professional invoices',
      'Track all your assets',
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
 *
 * Gating Rules:
 * - Growth tier: Features powered by AI (OCR, categorization, intelligence, alerts)
 * - Pro tier: Features powered by Stripe (banking, invoicing, expenses, payroll)
 */
export const SUBSCRIPTION_FEATURES = {
  // ============================================
  // GROWTH TIER - AI-Powered Features
  // ============================================
  financial_intelligence: {
    key: 'financial_intelligence',
    name: 'Financial Intelligence Dashboard',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'AI-powered P&L analysis, cash flow forecasting, and break-even insights',
    benefits: [
      'Cash flow predictions and forecasting',
      'AI-powered spending analysis',
      'Break-even analysis and profit forecasting',
    ],
  },
  inventory_automation: {
    key: 'inventory_automation',
    name: 'Inventory Automation (OCR)',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'AI-powered invoice scanning and automated inventory updates',
    benefits: [
      'Scan receipts and invoices with AI',
      'Auto-extract items, quantities, and prices',
      'Reduce manual data entry by 90%',
    ],
  },
  scheduling: {
    key: 'scheduling',
    name: 'Employee Scheduling',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'Visual scheduling with conflict detection and labor forecasting',
    benefits: [
      'Drag-and-drop schedule builder',
      'Automatic conflict detection',
      'Labor cost forecasting by shift',
    ],
  },
  ai_alerts: {
    key: 'ai_alerts',
    name: 'AI Alerts & Anomaly Detection',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'Smart alerts for inventory, spending, and operational anomalies',
    benefits: [
      'Predictive stockout warnings',
      'Anomaly detection for unusual spending',
      'Supplier reliability tracking',
    ],
  },
  recipe_profitability: {
    key: 'recipe_profitability',
    name: 'Recipe & Menu Profitability',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'AI-driven analytics on recipe costs and menu performance',
    benefits: [
      'Profit margin analysis for every menu item',
      'Identify most and least profitable dishes',
      'Pricing optimization recommendations',
    ],
  },
  ai_categorization: {
    key: 'ai_categorization',
    name: 'AI Transaction Categorization',
    requiredTier: 'growth' as SubscriptionTier,
    description: 'Automatic categorization of transactions using AI',
    benefits: [
      'One-click categorization with AI suggestions',
      'Learn from your categorization patterns',
      'Bulk categorize transactions instantly',
    ],
  },

  // ============================================
  // PRO TIER - Stripe-Powered Features
  // ============================================
  ai_assistant: {
    key: 'ai_assistant',
    name: 'AI Assistant',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'Conversational AI assistant for your restaurant data',
    benefits: [
      'Ask questions about your restaurant data',
      'Get instant insights and recommendations',
      'Natural language queries for reports',
    ],
  },
  banking: {
    key: 'banking',
    name: 'Bank Account Connections',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'Connect your bank accounts for automatic transaction sync',
    benefits: [
      'Securely connect bank accounts via Stripe',
      'Automatic daily transaction sync',
      'Real-time balance tracking',
    ],
  },
  invoicing: {
    key: 'invoicing',
    name: 'Customer Invoicing',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'Create and send professional invoices to customers',
    benefits: [
      'Professional invoice templates',
      'Online payment collection',
      'Automatic payment reminders',
    ],
  },
  expenses: {
    key: 'expenses',
    name: 'Expense Management',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'Track bills, pending payments, and manage cash outflows',
    benefits: [
      'Track pending bills and payments',
      'Match expenses to bank transactions',
      'Payment status tracking',
    ],
  },
  assets: {
    key: 'assets',
    name: 'Asset & Equipment Tracking',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'Track equipment, furniture, and other business assets',
    benefits: [
      'Equipment and asset inventory',
      'Automatic depreciation calculations',
      'Maintenance and disposal tracking',
    ],
  },
  payroll: {
    key: 'payroll',
    name: 'Payroll Reports',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'Calculate wages, overtime, and tips from time punches',
    benefits: [
      'Automatic overtime calculations (1.5× over 40 hrs)',
      'Tip aggregation by employee',
      'Export to CSV for ADP, Gusto, etc.',
    ],
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
