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

/**
 * Product lookup index, cached per `products` array identity.
 *
 * Every caller validates a whole list of recipes against the same array from
 * `useProducts`, so a linear `.find()` per ingredient made this O(recipes x
 * ingredients x products) — the dominant render cost on /recipes for tenants
 * with a large catalogue. Keying the index off the array identity keeps the
 * signature unchanged while every caller in that loop gets O(1) lookups.
 *
 * Products arrays here come from React state and are replaced rather than
 * mutated, so identity is a sound cache key. A `WeakMap` means an index is
 * collected as soon as its array is.
 */
const productIndexCache = new WeakMap<Product[], Map<string, Product>>();

function getProductIndex(products: Product[]): Map<string, Product> {
  let index = productIndexCache.get(products);
  if (!index) {
    index = new Map(products.map((product) => [product.id, product]));
    productIndexCache.set(products, index);
  }
  return index;
}

export function validateRecipeConversions(
  ingredients: RecipeIngredient[],
  products: Product[]
): ConversionValidation {
  const issues: ConversionIssue[] = [];
  const productsById = getProductIndex(products);

  ingredients.forEach((ingredient, index) => {
    const product = productsById.get(ingredient.product_id);
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
