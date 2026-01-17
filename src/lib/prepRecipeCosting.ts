import { calculateInventoryImpact, COUNT_UNITS, getProductUnitInfo } from '@/lib/enhancedUnitConversion';
import type { IngredientUnit } from '@/lib/recipeUnits';

export type PrepCostStatus =
  | 'ok'
  | 'missing_product'
  | 'missing_cost'
  | 'missing_size'
  | 'incompatible_units'
  | 'fallback';

export type PrepCostResult = {
  status: PrepCostStatus;
  cost: number | null;
  message?: string;
  conversionDetails?: ReturnType<typeof calculateInventoryImpact>['conversionDetails'];
  inventoryDeduction?: number;
  inventoryDeductionUnit?: string;
};

export type PrepCostProduct = {
  id?: string;
  name?: string | null;
  cost_per_unit?: number | null;
  uom_purchase?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
};

export function calculatePrepIngredientCost(params: {
  product?: PrepCostProduct | null;
  quantity: number;
  unit: IngredientUnit;
}): PrepCostResult {
  const { product, quantity, unit } = params;

  if (!product) {
    return { status: 'missing_product', cost: null };
  }

  if (!product.cost_per_unit) {
    return { status: 'missing_cost', cost: null };
  }

  const purchaseUnit = (product.uom_purchase || 'unit').toLowerCase();
  const isContainerUnit = COUNT_UNITS.includes(purchaseUnit);

  if (isContainerUnit && (!product.size_value || !product.size_unit)) {
    return { status: 'missing_size', cost: null };
  }

  try {
    const { purchaseUnit: normalizedPurchase, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);
    const impact = calculateInventoryImpact(
      quantity,
      unit,
      quantityPerPurchaseUnit,
      normalizedPurchase,
      product.name || '',
      product.cost_per_unit || 0,
      sizeValue,
      sizeUnit
    );

    return {
      status: 'ok',
      cost: impact.costImpact,
      conversionDetails: impact.conversionDetails,
      inventoryDeduction: impact.inventoryDeduction,
      inventoryDeductionUnit: impact.inventoryDeductionUnit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversion failed';
    if (message.includes('size information') || message.includes('size_value and size_unit')) {
      return { status: 'missing_size', cost: null, message };
    }
    if (message.includes('not compatible')) {
      return { status: 'incompatible_units', cost: null, message };
    }
    return { status: 'fallback', cost: null, message };
  }
}

export function summarizePrepRecipeCosts(
  ingredients: Array<{ product_id: string; quantity: number; unit: IngredientUnit }>,
  productMap: Map<string, PrepCostProduct>
) {
  let estimatedTotal = 0;
  let missingCount = 0;

  ingredients.forEach((ing) => {
    const product = productMap.get(ing.product_id);
    const result = calculatePrepIngredientCost({
      product,
      quantity: ing.quantity,
      unit: ing.unit,
    });

    if (result.status === 'ok' && result.cost != null) {
      estimatedTotal += result.cost;
    } else if (result.status !== 'missing_product') {
      missingCount += 1;
    }
  });

  return { estimatedTotal, missingCount };
}

export function calculateOutputUnitCost(totalCost: number, outputYield: number) {
  if (outputYield > 0) {
    return totalCost / outputYield;
  }
  return totalCost;
}
