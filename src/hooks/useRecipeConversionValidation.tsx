import { useMemo } from 'react';
import { Product } from './useProducts';
import { validateRecipeConversions, ConversionValidation } from '@/utils/recipeConversionValidation';

interface RecipeIngredient {
  product_id: string;
  quantity: number;
  unit: string;
}

export function useRecipeConversionValidation(
  ingredients: RecipeIngredient[],
  products: Product[]
): ConversionValidation {
  return useMemo(() => {
    return validateRecipeConversions(ingredients, products);
  }, [ingredients, products]);
}
