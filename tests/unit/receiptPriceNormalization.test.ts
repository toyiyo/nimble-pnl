import { describe, it, expect } from 'vitest';
import { normalizePrices, hasValidPriceData, normalizeConfidenceScore } from '@/lib/priceNormalization';

/**
 * Tests for receipt price normalization and validation logic
 * Uses the shared utility that is also used by the Edge Function
 */

describe('Receipt Price Normalization', () => {
  describe('normalizePrices', () => {
    it('should handle both unitPrice and lineTotal when provided correctly', () => {
      const item: LineItem = {
        parsedName: 'Avocados',
        parsedQuantity: 2,
        unitPrice: 1.00,
        lineTotal: 2.00,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(1.00);
      expect(result.lineTotal).toBe(2.00);
      expect(result.parsedPrice).toBe(2.00);
    });

    it('CRITICAL: should calculate lineTotal from unitPrice when lineTotal missing', () => {
      // AI extracted unit price only (e.g., "$1.00/ea")
      const item: LineItem = {
        parsedName: 'Avocados',
        parsedQuantity: 2,
        unitPrice: 1.00,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(1.00);
      expect(result.lineTotal).toBe(2.00);
      expect(result.parsedPrice).toBe(2.00);
    });

    it('CRITICAL: should calculate unitPrice from lineTotal when unitPrice missing', () => {
      // AI extracted line total only (e.g., "CHICKEN 5LB $15.00")
      const item: LineItem = {
        parsedName: 'Chicken Breast',
        parsedQuantity: 5,
        lineTotal: 15.00,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(3.00);
      expect(result.lineTotal).toBe(15.00);
      expect(result.parsedPrice).toBe(15.00);
    });

    it('should handle backward compatibility with old parsedPrice field', () => {
      // Legacy format: parsedPrice is treated as lineTotal
      const item: LineItem = {
        parsedName: 'Tomatoes',
        parsedQuantity: 3,
        parsedPrice: 6.00,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(2.00);
      expect(result.lineTotal).toBe(6.00);
      expect(result.parsedPrice).toBe(6.00);
    });

    it('should trust lineTotal when prices mismatch (outside tolerance)', () => {
      // AI made a mistake: unitPrice doesn't match lineTotal
      const item: LineItem = {
        parsedName: 'Onions',
        parsedQuantity: 10,
        unitPrice: 1.00,  // Wrong
        lineTotal: 5.00,  // Correct
      };

      const result = normalizePrices(item);

      // Should recalculate unitPrice based on lineTotal
      expect(result.unitPrice).toBe(0.50);
      expect(result.lineTotal).toBe(5.00);
      expect(result.parsedPrice).toBe(5.00);
    });

    it('should allow small rounding differences within 2% tolerance', () => {
      // Small rounding difference: $0.33 × 3 = $0.99 vs $1.00
      const item: LineItem = {
        parsedName: 'Garlic',
        parsedQuantity: 3,
        unitPrice: 0.33,
        lineTotal: 1.00,
      };

      const result = normalizePrices(item);

      // Should keep both values as they're within tolerance (1 cent on $1 = 1%)
      expect(result.unitPrice).toBe(0.33);
      expect(result.lineTotal).toBe(1.00);
      expect(result.parsedPrice).toBe(1.00);
    });

    it('should handle edge case: zero quantity', () => {
      const item: LineItem = {
        parsedName: 'Free Sample',
        parsedQuantity: 0,
        lineTotal: 0,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(0);
      expect(result.lineTotal).toBe(0);
      expect(result.parsedPrice).toBe(0);
    });

    it('should handle edge case: single quantity', () => {
      const item: LineItem = {
        parsedName: 'Watermelon',
        parsedQuantity: 1,
        unitPrice: 5.99,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(5.99);
      expect(result.lineTotal).toBe(5.99);
      expect(result.parsedPrice).toBe(5.99);
    });

    it('should handle edge case: large quantity with small unit price', () => {
      const item: LineItem = {
        parsedName: 'Straws',
        parsedQuantity: 500,
        unitPrice: 0.01,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(0.01);
      expect(result.lineTotal).toBe(5.00);
      expect(result.parsedPrice).toBe(5.00);
    });

    it('should handle edge case: high-value item', () => {
      const item: LineItem = {
        parsedName: 'Wagyu Beef',
        parsedQuantity: 2,
        lineTotal: 200.00,
      };

      const result = normalizePrices(item);

      expect(result.unitPrice).toBe(100.00);
      expect(result.lineTotal).toBe(200.00);
      expect(result.parsedPrice).toBe(200.00);
    });

    it('CRITICAL: should prevent the bug case from problem statement', () => {
      // The original bug: AI extracts unit price, code divides again
      // Receipt shows: "2 Avocados @ $1.00 ea = $2.00"
      // AI extracts unitPrice=1.00 and lineTotal=2.00
      // Old code would do: parsedPrice / quantity = wrong!
      const item: LineItem = {
        parsedName: 'Avocados',
        parsedQuantity: 2,
        unitPrice: 1.00,
        lineTotal: 2.00,
      };

      const result = normalizePrices(item);

      // With the fix, we use unitPrice directly
      expect(result.unitPrice).toBe(1.00); // NOT 0.50
      expect(result.lineTotal).toBe(2.00);
      expect(result.parsedPrice).toBe(2.00);
    });
  });

  describe('hasValidPriceData', () => {
    it('should return true for item with legacy parsedPrice', () => {
      const item = {
        parsedName: 'Test Item',
        parsedQuantity: 1,
        parsedPrice: 5.00,
      };
      expect(hasValidPriceData(item)).toBe(true);
    });

    it('should return true for item with unitPrice', () => {
      const item = {
        parsedName: 'Test Item',
        parsedQuantity: 1,
        unitPrice: 5.00,
      };
      expect(hasValidPriceData(item)).toBe(true);
    });

    it('should return true for item with lineTotal', () => {
      const item = {
        parsedName: 'Test Item',
        parsedQuantity: 1,
        lineTotal: 5.00,
      };
      expect(hasValidPriceData(item)).toBe(true);
    });

    it('should return false for item missing price data', () => {
      const item = {
        parsedName: 'Test Item',
        parsedQuantity: 1,
      };
      expect(hasValidPriceData(item)).toBe(false);
    });

    it('should return false for item missing parsedName', () => {
      const item = {
        parsedQuantity: 1,
        parsedPrice: 5.00,
      };
      expect(hasValidPriceData(item)).toBe(false);
    });

    it('should return false for item missing parsedQuantity', () => {
      const item = {
        parsedName: 'Test Item',
        parsedPrice: 5.00,
      };
      expect(hasValidPriceData(item)).toBe(false);
    });
  });

  describe('normalizeConfidenceScore', () => {
    it('should return score as-is when within valid range', () => {
      expect(normalizeConfidenceScore(0.5)).toBe(0.5);
      expect(normalizeConfidenceScore(0.0)).toBe(0.0);
      expect(normalizeConfidenceScore(1.0)).toBe(1.0);
    });

    it('should clamp score above 1.0 to 1.0', () => {
      expect(normalizeConfidenceScore(1.5)).toBe(1.0);
      expect(normalizeConfidenceScore(2.0)).toBe(1.0);
    });

    it('should clamp score below 0.0 to 0.0', () => {
      expect(normalizeConfidenceScore(-0.5)).toBe(0.0);
      expect(normalizeConfidenceScore(-1.0)).toBe(0.0);
    });

    it('should return 0 for undefined score', () => {
      expect(normalizeConfidenceScore(undefined)).toBe(0.0);
    });
  });
});
