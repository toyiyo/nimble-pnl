/**
 * Shared utility for normalizing and validating receipt line item prices
 * Used by both Edge Functions and frontend code for consistency
 * 
 * This is a copy of the logic in supabase/functions/_shared/priceNormalization.ts
 * We keep both versions to support different runtime environments (Node.js vs Deno)
 */

export interface LineItemPrices {
  parsedName: string;
  parsedQuantity: number;
  unitPrice?: number;
  lineTotal?: number;
  parsedPrice?: number;
}

export interface NormalizedPrices {
  unitPrice: number;
  lineTotal: number;
  parsedPrice: number;
}

/**
 * Normalizes and validates prices for a line item
 * Handles all scenarios:
 * - Both unitPrice and lineTotal provided
 * - Only unitPrice provided (calculates lineTotal)
 * - Only lineTotal provided (calculates unitPrice)
 * - Legacy parsedPrice format (backward compatibility)
 * - Price mismatch (trusts lineTotal and recalculates unitPrice)
 * 
 * @param item Line item with price information
 * @returns Normalized prices with unitPrice, lineTotal, and parsedPrice
 */
export function normalizePrices(item: LineItemPrices): NormalizedPrices {
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
      // Log warning (will work in both Node and Deno environments)
      if (typeof console !== 'undefined') {
        console.warn(`⚠️ Price mismatch for "${item.parsedName}": ` +
          `${quantity} × $${unitPrice} = $${expectedTotal}, but lineTotal = $${lineTotal}`);
      }
      // Trust lineTotal and recalculate unitPrice
      unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
    }
  }

  return {
    unitPrice: unitPrice || 0,
    lineTotal: lineTotal || 0,
    // Keep parsedPrice for backward compatibility (set to lineTotal)
    parsedPrice: lineTotal || item.parsedPrice || 0,
  };
}

/**
 * Validates that a line item has required price fields
 * @param item Line item to validate
 * @returns true if item has valid price data
 */
export function hasValidPriceData(item: any): boolean {
  const hasLegacyPrice = typeof item.parsedPrice === "number";
  const hasNewPrices = typeof item.unitPrice === "number" || typeof item.lineTotal === "number";
  
  return !!(item.parsedName && 
    typeof item.parsedQuantity === "number" && 
    (hasLegacyPrice || hasNewPrices));
}

/**
 * Ensures confidence score is within valid range [0, 1]
 * @param score Confidence score to normalize
 * @returns Normalized confidence score
 */
export function normalizeConfidenceScore(score: number | undefined): number {
  if (score === undefined) return 0;
  if (score > 1.0) return 1.0;
  if (score < 0.0) return 0.0;
  return score;
}
