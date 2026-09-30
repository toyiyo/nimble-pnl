/**
 * Shared TS helper for recipe yield percent (waste allowance).
 *
 * The SQL function `process_unified_inventory_deduction` is authoritative
 * for the server-side deduction. This module mirrors the same math for the
 * client-side preview, so `RecipeDialog` and the cost hooks show the same
 * numbers a sale will later deduct.
 *
 * See docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md, section 5.1.
 */
import { calculateInventoryImpact, getProductUnitInfo } from './enhancedUnitConversion';

export const YIELD_MIN = 50;
export const YIELD_MAX = 100;
export const YIELD_REVIEW_BELOW = 80;

export interface ResolvedYield {
  yieldPct: number;
  source: 'product' | 'override';
}

/**
 * Pick the effective yield percent for one recipe line.
 *
 * The line override wins over the product yield. A missing value on both
 * sides defaults to 100 (no waste). Every value clamps to
 * [YIELD_MIN, YIELD_MAX], the same range the CHECK constraints enforce.
 */
export function resolveYieldPct(
  productYield?: number | null,
  override?: number | null
): ResolvedYield {
  const hasOverride = override !== null && override !== undefined;
  const source: ResolvedYield['source'] = hasOverride ? 'override' : 'product';
  const rawValue = hasOverride
    ? override
    : productYield !== null && productYield !== undefined
      ? productYield
      : 100;
  const yieldPct = Math.min(YIELD_MAX, Math.max(YIELD_MIN, rawValue as number));
  return { yieldPct, source };
}

/**
 * Convert a portion quantity into the loaded (pre-waste) quantity to pull
 * from inventory. A 90% yield needs more raw quantity than the portion
 * that reaches the plate.
 */
export function loadedQuantity(portionQty: number, yieldPct: number): number {
  return portionQty / (yieldPct / 100);
}

export interface LineCostIngredient {
  quantity: number;
  unit: string;
  yield_pct_override?: number | null;
}

export interface LineCostProduct {
  name?: string | null;
  cost_per_unit?: number | null;
  uom_purchase?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  yield_pct?: number | null;
}

export interface LineCostResult {
  portionCost: number;
  loadedCost: number;
  wasteCost: number;
  yieldPct: number;
  source: ResolvedYield['source'];
  loadedQty: number;
}

/**
 * Compute the cost of one recipe line, with the waste allowance applied.
 *
 * Calls `calculateInventoryImpact` once with the portion quantity, then
 * scales the result by 100 / yieldPct. Unit conversion is linear, so this
 * gives the same cost as a call with the pre-computed loaded quantity.
 */
export function computeLineCost(
  ingredient: LineCostIngredient,
  product: LineCostProduct | null | undefined
): LineCostResult {
  const { yieldPct, source } = resolveYieldPct(product?.yield_pct, ingredient.yield_pct_override);
  const loadedQty = loadedQuantity(ingredient.quantity, yieldPct);

  if (!product || !product.cost_per_unit) {
    return { portionCost: 0, loadedCost: 0, wasteCost: 0, yieldPct, source, loadedQty };
  }

  const { purchaseUnit, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);
  const portionResult = calculateInventoryImpact(
    ingredient.quantity,
    ingredient.unit,
    quantityPerPurchaseUnit,
    purchaseUnit,
    product.name || '',
    product.cost_per_unit,
    sizeValue,
    sizeUnit
  );

  const portionCost = portionResult.costImpact;
  const loadedCost = portionCost * (100 / yieldPct);
  const wasteCost = loadedCost - portionCost;

  return { portionCost, loadedCost, wasteCost, yieldPct, source, loadedQty };
}
