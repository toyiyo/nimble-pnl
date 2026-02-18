import { describe, it, expect } from 'vitest';
import {
  getVolumeDiscountPercent,
  calculatePrice,
  formatPrice,
  tierHasFeature,
  getRequiredTier,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_FEATURES,
} from '@/lib/subscriptionPlans';

describe('subscriptionPlans utilities', () => {
  // ============================================================
  // getVolumeDiscountPercent
  // ============================================================
  describe('getVolumeDiscountPercent', () => {
    it('returns 0% for 0 locations', () => {
      expect(getVolumeDiscountPercent(0)).toBe(0);
    });

    it('returns 0% for 1 location', () => {
      expect(getVolumeDiscountPercent(1)).toBe(0);
    });

    it('returns 0% for 2 locations', () => {
      expect(getVolumeDiscountPercent(2)).toBe(0);
    });

    it('returns 5% for exactly 3 locations (threshold)', () => {
      expect(getVolumeDiscountPercent(3)).toBe(5);
    });

    it('returns 5% for 4 locations', () => {
      expect(getVolumeDiscountPercent(4)).toBe(5);
    });

    it('returns 5% for 5 locations (upper boundary of 3-5 tier)', () => {
      expect(getVolumeDiscountPercent(5)).toBe(5);
    });

    it('returns 10% for exactly 6 locations (threshold)', () => {
      expect(getVolumeDiscountPercent(6)).toBe(10);
    });

    it('returns 10% for 8 locations', () => {
      expect(getVolumeDiscountPercent(8)).toBe(10);
    });

    it('returns 10% for 10 locations (upper boundary of 6-10 tier)', () => {
      expect(getVolumeDiscountPercent(10)).toBe(10);
    });

    it('returns 15% for exactly 11 locations (threshold)', () => {
      expect(getVolumeDiscountPercent(11)).toBe(15);
    });

    it('returns 15% for 50 locations', () => {
      expect(getVolumeDiscountPercent(50)).toBe(15);
    });

    it('returns 15% for 100 locations', () => {
      expect(getVolumeDiscountPercent(100)).toBe(15);
    });
  });

  // ============================================================
  // calculatePrice
  // ============================================================
  describe('calculatePrice', () => {
    describe('Starter tier', () => {
      it('calculates monthly price for 1 location (no discount)', () => {
        const result = calculatePrice('starter', 'monthly', 1);
        expect(result).toEqual({
          basePrice: 99,
          totalBeforeDiscount: 99,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 99,
          pricePerLocation: 99,
        });
      });

      it('calculates annual price for 1 location (no discount)', () => {
        const result = calculatePrice('starter', 'annual', 1);
        expect(result).toEqual({
          basePrice: 990,
          totalBeforeDiscount: 990,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 990,
          pricePerLocation: 990,
        });
      });

      it('calculates monthly price for 3 locations (5% discount)', () => {
        const result = calculatePrice('starter', 'monthly', 3);
        // 99 * 3 = 297, 5% discount = 14.85 rounded to 15
        expect(result).toEqual({
          basePrice: 99,
          totalBeforeDiscount: 297,
          discountPercent: 5,
          discountAmount: 15, // Math.round(297 * 0.05) = 15
          totalPrice: 282,
          pricePerLocation: 94, // Math.round(282 / 3) = 94
        });
      });

      it('calculates monthly price for 6 locations (10% discount)', () => {
        const result = calculatePrice('starter', 'monthly', 6);
        // 99 * 6 = 594, 10% discount = 59.4 rounded to 59
        expect(result).toEqual({
          basePrice: 99,
          totalBeforeDiscount: 594,
          discountPercent: 10,
          discountAmount: 59, // Math.round(594 * 0.10) = 59
          totalPrice: 535,
          pricePerLocation: 89, // Math.round(535 / 6) = 89
        });
      });

      it('calculates monthly price for 11 locations (15% discount)', () => {
        const result = calculatePrice('starter', 'monthly', 11);
        // 99 * 11 = 1089, 15% discount = 163.35 rounded to 163
        expect(result).toEqual({
          basePrice: 99,
          totalBeforeDiscount: 1089,
          discountPercent: 15,
          discountAmount: 163, // Math.round(1089 * 0.15) = 163
          totalPrice: 926,
          pricePerLocation: 84, // Math.round(926 / 11) = 84
        });
      });
    });

    describe('Growth tier', () => {
      it('calculates monthly price for 1 location', () => {
        const result = calculatePrice('growth', 'monthly', 1);
        expect(result).toEqual({
          basePrice: 199,
          totalBeforeDiscount: 199,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 199,
          pricePerLocation: 199,
        });
      });

      it('calculates annual price for 1 location', () => {
        const result = calculatePrice('growth', 'annual', 1);
        expect(result).toEqual({
          basePrice: 1990,
          totalBeforeDiscount: 1990,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 1990,
          pricePerLocation: 1990,
        });
      });

      it('calculates monthly price for 5 locations (5% discount)', () => {
        const result = calculatePrice('growth', 'monthly', 5);
        // 199 * 5 = 995, 5% discount = 49.75 rounded to 50
        expect(result).toEqual({
          basePrice: 199,
          totalBeforeDiscount: 995,
          discountPercent: 5,
          discountAmount: 50,
          totalPrice: 945,
          pricePerLocation: 189, // Math.round(945 / 5) = 189
        });
      });
    });

    describe('Pro tier', () => {
      it('calculates monthly price for 1 location', () => {
        const result = calculatePrice('pro', 'monthly', 1);
        expect(result).toEqual({
          basePrice: 299,
          totalBeforeDiscount: 299,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 299,
          pricePerLocation: 299,
        });
      });

      it('calculates annual price for 1 location', () => {
        const result = calculatePrice('pro', 'annual', 1);
        expect(result).toEqual({
          basePrice: 2990,
          totalBeforeDiscount: 2990,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 2990,
          pricePerLocation: 2990,
        });
      });

      it('calculates monthly price for 10 locations (10% discount)', () => {
        const result = calculatePrice('pro', 'monthly', 10);
        // 299 * 10 = 2990, 10% discount = 299
        expect(result).toEqual({
          basePrice: 299,
          totalBeforeDiscount: 2990,
          discountPercent: 10,
          discountAmount: 299,
          totalPrice: 2691,
          pricePerLocation: 269, // Math.round(2691 / 10) = 269
        });
      });
    });

    describe('edge cases', () => {
      it('handles 0 locations (returns basePrice for pricePerLocation)', () => {
        const result = calculatePrice('starter', 'monthly', 0);
        expect(result).toEqual({
          basePrice: 99,
          totalBeforeDiscount: 0,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 0,
          pricePerLocation: 99, // Falls back to basePrice when locationCount is 0
        });
      });

      it('defaults to 1 location when locationCount is not provided', () => {
        const result = calculatePrice('starter', 'monthly');
        expect(result).toEqual({
          basePrice: 99,
          totalBeforeDiscount: 99,
          discountPercent: 0,
          discountAmount: 0,
          totalPrice: 99,
          pricePerLocation: 99,
        });
      });
    });
  });

  // ============================================================
  // formatPrice
  // ============================================================
  describe('formatPrice', () => {
    it('formats 0 as $0', () => {
      expect(formatPrice(0)).toBe('$0');
    });

    it('formats 99 as $99 (no decimals)', () => {
      expect(formatPrice(99)).toBe('$99');
    });

    it('formats 199 as $199', () => {
      expect(formatPrice(199)).toBe('$199');
    });

    it('formats 990 as $990', () => {
      expect(formatPrice(990)).toBe('$990');
    });

    it('formats 1990 as $1,990 (with thousand separator)', () => {
      expect(formatPrice(1990)).toBe('$1,990');
    });

    it('formats 2990 as $2,990', () => {
      expect(formatPrice(2990)).toBe('$2,990');
    });

    it('formats 10000 as $10,000', () => {
      expect(formatPrice(10000)).toBe('$10,000');
    });

    it('rounds down decimal values (formatPrice receives whole numbers)', () => {
      // The function is designed for whole numbers but should handle decimals
      expect(formatPrice(99.49)).toBe('$99');
    });

    it('rounds up decimal values when >= 0.5', () => {
      expect(formatPrice(99.5)).toBe('$100');
    });
  });

  // ============================================================
  // tierHasFeature
  // ============================================================
  describe('tierHasFeature', () => {
    describe('null tier', () => {
      it('returns false for any feature when tier is null', () => {
        expect(tierHasFeature(null, 'financial_intelligence')).toBe(false);
        expect(tierHasFeature(null, 'banking')).toBe(false);
        expect(tierHasFeature(null, 'scheduling')).toBe(false);
      });
    });

    describe('starter tier', () => {
      it('does NOT have access to growth features', () => {
        expect(tierHasFeature('starter', 'financial_intelligence')).toBe(false);
        expect(tierHasFeature('starter', 'inventory_automation')).toBe(false);
        expect(tierHasFeature('starter', 'scheduling')).toBe(false);
        expect(tierHasFeature('starter', 'ai_alerts')).toBe(false);
        expect(tierHasFeature('starter', 'recipe_profitability')).toBe(false);
        expect(tierHasFeature('starter', 'ai_categorization')).toBe(false);
      });

      it('does NOT have access to pro features', () => {
        expect(tierHasFeature('starter', 'ai_assistant')).toBe(false);
        expect(tierHasFeature('starter', 'ops_inbox')).toBe(false);
        expect(tierHasFeature('starter', 'weekly_brief')).toBe(false);
        expect(tierHasFeature('starter', 'banking')).toBe(false);
        expect(tierHasFeature('starter', 'invoicing')).toBe(false);
        expect(tierHasFeature('starter', 'expenses')).toBe(false);
        expect(tierHasFeature('starter', 'assets')).toBe(false);
        expect(tierHasFeature('starter', 'payroll')).toBe(false);
      });
    });

    describe('growth tier', () => {
      it('HAS access to growth features', () => {
        expect(tierHasFeature('growth', 'financial_intelligence')).toBe(true);
        expect(tierHasFeature('growth', 'inventory_automation')).toBe(true);
        expect(tierHasFeature('growth', 'scheduling')).toBe(true);
        expect(tierHasFeature('growth', 'ai_alerts')).toBe(true);
        expect(tierHasFeature('growth', 'recipe_profitability')).toBe(true);
        expect(tierHasFeature('growth', 'ai_categorization')).toBe(true);
      });

      it('does NOT have access to pro features', () => {
        expect(tierHasFeature('growth', 'ai_assistant')).toBe(false);
        expect(tierHasFeature('growth', 'ops_inbox')).toBe(false);
        expect(tierHasFeature('growth', 'weekly_brief')).toBe(false);
        expect(tierHasFeature('growth', 'banking')).toBe(false);
        expect(tierHasFeature('growth', 'invoicing')).toBe(false);
        expect(tierHasFeature('growth', 'expenses')).toBe(false);
        expect(tierHasFeature('growth', 'assets')).toBe(false);
        expect(tierHasFeature('growth', 'payroll')).toBe(false);
      });
    });

    describe('pro tier', () => {
      it('HAS access to growth features (inherited)', () => {
        expect(tierHasFeature('pro', 'financial_intelligence')).toBe(true);
        expect(tierHasFeature('pro', 'inventory_automation')).toBe(true);
        expect(tierHasFeature('pro', 'scheduling')).toBe(true);
        expect(tierHasFeature('pro', 'ai_alerts')).toBe(true);
        expect(tierHasFeature('pro', 'recipe_profitability')).toBe(true);
        expect(tierHasFeature('pro', 'ai_categorization')).toBe(true);
      });

      it('HAS access to pro features', () => {
        expect(tierHasFeature('pro', 'ai_assistant')).toBe(true);
        expect(tierHasFeature('pro', 'ops_inbox')).toBe(true);
        expect(tierHasFeature('pro', 'weekly_brief')).toBe(true);
        expect(tierHasFeature('pro', 'banking')).toBe(true);
        expect(tierHasFeature('pro', 'invoicing')).toBe(true);
        expect(tierHasFeature('pro', 'expenses')).toBe(true);
        expect(tierHasFeature('pro', 'assets')).toBe(true);
        expect(tierHasFeature('pro', 'payroll')).toBe(true);
      });
    });
  });

  // ============================================================
  // getRequiredTier
  // ============================================================
  describe('getRequiredTier', () => {
    describe('growth tier features', () => {
      it('returns growth for financial_intelligence', () => {
        expect(getRequiredTier('financial_intelligence')).toBe('growth');
      });

      it('returns growth for inventory_automation', () => {
        expect(getRequiredTier('inventory_automation')).toBe('growth');
      });

      it('returns growth for scheduling', () => {
        expect(getRequiredTier('scheduling')).toBe('growth');
      });

      it('returns growth for ai_alerts', () => {
        expect(getRequiredTier('ai_alerts')).toBe('growth');
      });

      it('returns growth for recipe_profitability', () => {
        expect(getRequiredTier('recipe_profitability')).toBe('growth');
      });

      it('returns growth for ai_categorization', () => {
        expect(getRequiredTier('ai_categorization')).toBe('growth');
      });
    });

    describe('pro tier features', () => {
      it('returns pro for ai_assistant', () => {
        expect(getRequiredTier('ai_assistant')).toBe('pro');
      });

      it('returns pro for banking', () => {
        expect(getRequiredTier('banking')).toBe('pro');
      });

      it('returns pro for invoicing', () => {
        expect(getRequiredTier('invoicing')).toBe('pro');
      });

      it('returns pro for expenses', () => {
        expect(getRequiredTier('expenses')).toBe('pro');
      });

      it('returns pro for assets', () => {
        expect(getRequiredTier('assets')).toBe('pro');
      });

      it('returns pro for payroll', () => {
        expect(getRequiredTier('payroll')).toBe('pro');
      });

      it('returns pro for ops_inbox', () => {
        expect(getRequiredTier('ops_inbox')).toBe('pro');
      });

      it('returns pro for weekly_brief', () => {
        expect(getRequiredTier('weekly_brief')).toBe('pro');
      });
    });
  });

  // ============================================================
  // SUBSCRIPTION_PLANS constant validation
  // ============================================================
  describe('SUBSCRIPTION_PLANS', () => {
    it('has all three tiers defined', () => {
      expect(SUBSCRIPTION_PLANS).toHaveProperty('starter');
      expect(SUBSCRIPTION_PLANS).toHaveProperty('growth');
      expect(SUBSCRIPTION_PLANS).toHaveProperty('pro');
    });

    it('starter has correct base prices', () => {
      expect(SUBSCRIPTION_PLANS.starter.price.monthly).toBe(99);
      expect(SUBSCRIPTION_PLANS.starter.price.annual).toBe(990);
    });

    it('growth has correct base prices', () => {
      expect(SUBSCRIPTION_PLANS.growth.price.monthly).toBe(199);
      expect(SUBSCRIPTION_PLANS.growth.price.annual).toBe(1990);
    });

    it('pro has correct base prices', () => {
      expect(SUBSCRIPTION_PLANS.pro.price.monthly).toBe(299);
      expect(SUBSCRIPTION_PLANS.pro.price.annual).toBe(2990);
    });

    it('growth is marked as recommended', () => {
      expect(SUBSCRIPTION_PLANS.growth.recommended).toBe(true);
      expect(SUBSCRIPTION_PLANS.starter.recommended).toBeUndefined();
      expect(SUBSCRIPTION_PLANS.pro.recommended).toBeUndefined();
    });
  });
});
