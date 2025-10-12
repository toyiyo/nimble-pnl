import { Product } from '@/hooks/useProducts';
import { calculateInventoryImpact, getProductUnitInfo } from '@/lib/enhancedUnitConversion';

interface RecipeIngredient {
  product_id: string;
  quantity: number;
  unit: string;
}

interface ConversionIssue {
  ingredientIndex: number;
  productName: string;
  issue: 'missing_size' | 'incompatible_units' | 'fallback_1to1';
  message: string;
}

export interface ConversionValidation {
  hasIssues: boolean;
  issues: ConversionIssue[];
  issueCount: number;
}

export function validateRecipeConversions(
  ingredients: RecipeIngredient[],
  products: Product[]
): ConversionValidation {
  const issues: ConversionIssue[] = [];

  ingredients.forEach((ingredient, index) => {
    const product = products.find(p => p.id === ingredient.product_id);
    if (!product || !ingredient.quantity || !ingredient.unit) {
      return;
    }

    const { purchaseUnit, sizeValue, sizeUnit, quantityPerPurchaseUnit } = 
      getProductUnitInfo(product);

    // Check if units match (1:1 scenario)
    if (ingredient.unit.toLowerCase() === purchaseUnit.toLowerCase()) {
      return; // No conversion needed, this is fine
    }

    // Try to calculate conversion
    try {
      calculateInventoryImpact(
        ingredient.quantity,
        ingredient.unit,
        quantityPerPurchaseUnit,
        purchaseUnit,
        product.name || '',
        product.cost_per_unit || 0,
        sizeValue,
        sizeUnit
      );
      // Conversion succeeded
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage.includes('size information') || 
          errorMessage.includes('size_value and size_unit')) {
        issues.push({
          ingredientIndex: index,
          productName: product.name,
          issue: 'missing_size',
          message: `Missing size information for ${purchaseUnit}`
        });
      } else if (errorMessage.includes('not compatible with the recipe unit')) {
        issues.push({
          ingredientIndex: index,
          productName: product.name,
          issue: 'incompatible_units',
          message: `Cannot convert ${ingredient.unit} to ${sizeUnit || purchaseUnit}`
        });
      } else {
        issues.push({
          ingredientIndex: index,
          productName: product.name,
          issue: 'fallback_1to1',
          message: 'Will use 1:1 deduction ratio'
        });
      }
    }
  });

  return {
    hasIssues: issues.length > 0,
    issues,
    issueCount: issues.length
  };
}
