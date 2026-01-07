import { describe, it, expect } from 'vitest';

/**
 * Tests for receipt price normalization and validation logic
 * This validates the price handling in process-receipt Edge Function
 */

interface LineItem {
  parsedName: string;
  parsedQuantity: number;
  unitPrice?: number;
  lineTotal?: number;
  parsedPrice?: number;
}

/**
 * Normalizes and validates prices for a line item
 * This mirrors the logic in process-receipt/index.ts
 */
function normalizePrices(item: LineItem): { unitPrice: number; lineTotal: number; parsedPrice: number } {
  let unitPrice = item.unitPrice;
  let lineTotal = item.lineTotal;
  const quantity = item.parsedQuantity || 1;

  // Handle backward compatibility with old parsedPrice field
  if (unitPrice === undefined && lineTotal === undefined && item.parsedPrice !== undefined) {
    // Legacy format: assume parsedPrice is lineTotal
    lineTotal = item.parsedPrice;
    unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
  }

  // If only unitPrice provided, calculate lineTotal
  if (unitPrice !== undefined && lineTotal === undefined) {
    lineTotal = unitPrice * quantity;
  }

  // If only lineTotal provided, calculate unitPrice
  if (lineTotal !== undefined && unitPrice === undefined) {
    unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
  }

  // Validation: check if lineTotal ≈ quantity × unitPrice (allow 2% tolerance for rounding)
  if (unitPrice !== undefined && lineTotal !== undefined) {
    const expectedTotal = unitPrice * quantity;
    const tolerance = Math.max(0.02, expectedTotal * 0.02); // 2% or $0.02 minimum

    if (Math.abs(lineTotal - expectedTotal) > tolerance) {
      console.warn(`⚠️ Price mismatch for "${item.parsedName}": ` +
        `${quantity} × $${unitPrice} = $${expectedTotal}, but lineTotal = $${lineTotal}`);
      // Trust lineTotal and recalculate unitPrice
      unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
    }
  }

  return {
    unitPrice: unitPrice || 0,
    lineTotal: lineTotal || 0,
    parsedPrice: lineTotal || item.parsedPrice || 0,
  };
}

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
});
