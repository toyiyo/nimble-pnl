/**
 * Tests for src/types/assets.ts
 *
 * Covers helper functions for asset display and calculations,
 * including the quantity-related formatQuantityWithCost helper.
 */

import { describe, it, expect } from 'vitest';
import {
  formatQuantityWithCost,
  formatAssetCurrency,
  calculateNetBookValue,
  calculateMonthlyDepreciation,
  getDefaultUsefulLife,
  type Asset,
} from '@/types/assets';

describe('Asset type helpers', () => {
  describe('formatQuantityWithCost', () => {
    it('returns just the cost for quantity of 1', () => {
      const result = formatQuantityWithCost(1, 20000);
      expect(result).toBe('$20,000.00');
    });

    it('returns "quantity × cost" format for quantity > 1', () => {
      const result = formatQuantityWithCost(2, 20000);
      expect(result).toBe('2 × $20,000.00');
    });

    it('handles large quantities', () => {
      const result = formatQuantityWithCost(100, 50);
      expect(result).toBe('100 × $50.00');
    });

    it('handles decimal unit costs', () => {
      const result = formatQuantityWithCost(3, 1234.56);
      expect(result).toBe('3 × $1,234.56');
    });

    it('handles zero unit cost', () => {
      const result = formatQuantityWithCost(5, 0);
      expect(result).toBe('5 × $0.00');
    });
  });

  describe('formatAssetCurrency', () => {
    it('formats positive amounts correctly', () => {
      expect(formatAssetCurrency(1000)).toBe('$1,000.00');
      expect(formatAssetCurrency(50000)).toBe('$50,000.00');
      expect(formatAssetCurrency(0.99)).toBe('$0.99');
    });

    it('formats zero correctly', () => {
      expect(formatAssetCurrency(0)).toBe('$0.00');
    });

    it('handles large numbers', () => {
      expect(formatAssetCurrency(1000000)).toBe('$1,000,000.00');
    });
  });

  describe('calculateNetBookValue', () => {
    it('calculates net book value correctly', () => {
      const asset = {
        purchase_cost: 10000,
        accumulated_depreciation: 2000,
      } as Asset;

      expect(calculateNetBookValue(asset)).toBe(8000);
    });

    it('returns full purchase cost when no depreciation', () => {
      const asset = {
        purchase_cost: 5000,
        accumulated_depreciation: 0,
      } as Asset;

      expect(calculateNetBookValue(asset)).toBe(5000);
    });

    it('returns zero when fully depreciated', () => {
      const asset = {
        purchase_cost: 3000,
        accumulated_depreciation: 3000,
      } as Asset;

      expect(calculateNetBookValue(asset)).toBe(0);
    });

    it('handles multi-quantity assets (purchase_cost is total)', () => {
      const asset = {
        quantity: 2,
        unit_cost: 20000,
        purchase_cost: 40000, // 2 × $20,000
        accumulated_depreciation: 4000,
      } as Asset;

      // Net book value is based on total purchase_cost
      expect(calculateNetBookValue(asset)).toBe(36000);
    });
  });

  describe('calculateMonthlyDepreciation', () => {
    it('calculates monthly depreciation correctly', () => {
      const asset = {
        purchase_cost: 12000,
        salvage_value: 0,
        useful_life_months: 60,
      } as Asset;

      expect(calculateMonthlyDepreciation(asset)).toBe(200);
    });

    it('accounts for salvage value', () => {
      const asset = {
        purchase_cost: 10000,
        salvage_value: 1000,
        useful_life_months: 60,
      } as Asset;

      // Depreciable amount = 10000 - 1000 = 9000
      // Monthly depreciation = 9000 / 60 = 150
      expect(calculateMonthlyDepreciation(asset)).toBe(150);
    });

    it('returns zero when salvage equals purchase cost', () => {
      const asset = {
        purchase_cost: 5000,
        salvage_value: 5000,
        useful_life_months: 60,
      } as Asset;

      expect(calculateMonthlyDepreciation(asset)).toBe(0);
    });

    it('handles multi-quantity assets (uses total purchase_cost)', () => {
      const asset = {
        quantity: 5,
        unit_cost: 2000,
        purchase_cost: 10000, // 5 × $2,000
        salvage_value: 500, // Total salvage for all units
        useful_life_months: 60,
      } as Asset;

      // Depreciable amount = 10000 - 500 = 9500
      // Monthly depreciation = 9500 / 60 = 158.33...
      expect(calculateMonthlyDepreciation(asset)).toBeCloseTo(158.33, 1);
    });
  });

  describe('getDefaultUsefulLife', () => {
    it('returns default for Kitchen Equipment', () => {
      expect(getDefaultUsefulLife('Kitchen Equipment')).toBe(84); // 7 years
    });

    it('returns default for Electronics', () => {
      expect(getDefaultUsefulLife('Electronics')).toBe(60); // 5 years
    });

    it('returns default for HVAC Systems', () => {
      expect(getDefaultUsefulLife('HVAC Systems')).toBe(180); // 15 years
    });

    it('is case-insensitive', () => {
      expect(getDefaultUsefulLife('kitchen equipment')).toBe(84);
      expect(getDefaultUsefulLife('KITCHEN EQUIPMENT')).toBe(84);
    });

    it('returns 60 months for unknown categories', () => {
      expect(getDefaultUsefulLife('Unknown Category')).toBe(60);
      expect(getDefaultUsefulLife('')).toBe(60);
    });
  });
});
