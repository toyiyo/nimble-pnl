import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/hooks/useProducts';
import { useInventorySettings } from '@/hooks/useInventorySettings';

interface ProductMetrics {
  inventoryCost: number;
  inventoryValue: number;
  calculationMethod: 'recipe-based' | 'estimated' | 'mixed';
  markupUsed?: number;
}

interface InventoryMetrics {
  productMetrics: Record<string, ProductMetrics>;
  totalInventoryCost: number;
  totalInventoryValue: number;
  loading: boolean;
  calculationSummary: {
    recipeBasedCount: number;
    estimatedCount: number;
    mixedCount: number;
  };
}

interface Recipe {
  id: string;
  name: string;
  pos_item_name: string | null;
  estimated_cost: number | null;
}

interface RecipeIngredient {
  id: string;
  recipe_id: string;
  product_id: string;
  quantity: number;
  recipe: Recipe;
}

interface UnifiedSale {
  item_name: string;
  pos_item_name: string | null;
  unit_price: number;
  total_price: number;
  quantity: number;
}

export const useInventoryMetrics = (restaurantId: string | null, products: Product[]) => {
  const { getMarkupForCategory } = useInventorySettings(restaurantId);
  const [metrics, setMetrics] = useState<InventoryMetrics>({
    productMetrics: {},
    totalInventoryCost: 0,
    totalInventoryValue: 0,
    loading: true,
    calculationSummary: {
      recipeBasedCount: 0,
      estimatedCount: 0,
      mixedCount: 0
    }
  });

  const calculateMetrics = async () => {
    if (!restaurantId || !products.length) {
      setMetrics(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      // Get all recipes that use these products as ingredients
      const { data: recipeIngredients, error: recipeError } = await supabase
        .from('recipe_ingredients')
        .select(`
          id,
          recipe_id,
          product_id,
          quantity,
          recipes!inner(
            id,
            name,
            pos_item_name,
            estimated_cost,
            restaurant_id
          )
        `)
        .eq('recipes.restaurant_id', restaurantId)
        .in('product_id', products.map(p => p.id));

      if (recipeError) {
        console.error('Error fetching recipe ingredients:', recipeError);
        return;
      }

      // Get average selling prices from unified sales for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: salesData, error: salesError } = await supabase
        .from('unified_sales')
        .select('item_name, unit_price, total_price, quantity')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', thirtyDaysAgo.toISOString().split('T')[0]);

      if (salesError) {
        console.error('Error fetching sales data:', salesError);
      }

      const productMetrics: Record<string, ProductMetrics> = {};

      // Calculate metrics for each product
      for (const product of products) {
        const currentStock = product.current_stock || 0;
        const costPerUnit = product.cost_per_unit || 0;
        
        // Inventory Cost = calculate based on package quantity if available
        // If we have package info, cost should be per package, not per base unit
        let inventoryCost = 0;
        if (product.package_qty && product.package_qty > 1) {
          // Calculate number of complete packages
          const packageCount = Math.floor(currentStock / product.package_qty);
          inventoryCost = packageCount * costPerUnit;
        } else {
          // No package info or single unit packages
          inventoryCost = currentStock * costPerUnit;
        }

        // Calculate Inventory Value
        let inventoryValue = 0;
        let hasRecipeData = false;

        // Find recipes that use this product
        const productRecipes = (recipeIngredients || []).filter(
          ri => ri.product_id === product.id
        );

        if (productRecipes.length > 0) {
          hasRecipeData = true;
          // Calculate potential value from recipes
          let totalPotentialValue = 0;
          let totalUsageRatio = 0;

          for (const recipeIngredient of productRecipes) {
            const recipe = recipeIngredient.recipes;
            let recipePrice = 0;

            // Try to find selling price from sales data
            const recipeSales = (salesData || []).filter(sale => 
              sale.item_name.toLowerCase() === recipe.name.toLowerCase() ||
              (recipe.pos_item_name && sale.item_name.toLowerCase() === recipe.pos_item_name.toLowerCase())
            );

            if (recipeSales.length > 0) {
              // Calculate average price from recent sales
              const totalRevenue = recipeSales.reduce((sum, sale) => sum + (sale.total_price || 0), 0);
              const totalQuantity = recipeSales.reduce((sum, sale) => sum + (sale.quantity || 1), 0);
              recipePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
            } else if (recipe.estimated_cost) {
              // Fallback to estimated cost with markup (assuming 3x markup)
              recipePrice = recipe.estimated_cost * 3;
            }

            if (recipePrice > 0) {
              // Calculate how much of this product is used per recipe serving
              const quantityPerServing = recipeIngredient.quantity || 0;
              
              // Use enhanced unit conversion instead of conversion_factor
              // This will require accessing recipe unit information
              const purchaseUnitsPerServing = quantityPerServing; // Simplified for now - enhanced conversion will be implemented when we have recipe unit data
              
              if (purchaseUnitsPerServing > 0) {
                // Value per purchase unit = recipe price / purchase units used per serving
                const valuePerPurchaseUnit = recipePrice / purchaseUnitsPerServing;
                totalPotentialValue += valuePerPurchaseUnit;
                totalUsageRatio += 1;
              }
            }
          }

          if (totalUsageRatio > 0) {
            // Average value per unit across all recipes that use this product
            const averageValuePerUnit = totalPotentialValue / totalUsageRatio;
            inventoryValue = currentStock * averageValuePerUnit;
          }
        }

        // Determine calculation method and final value
        if (hasRecipeData && inventoryValue > 0) {
          // Has recipes with pricing data
          productMetrics[product.id] = {
            inventoryCost,
            inventoryValue,
            calculationMethod: 'recipe-based'
          };
        } else if (hasRecipeData && inventoryValue === 0 && costPerUnit > 0) {
          // Has recipes but no pricing data, use markup as fallback
          const markup = getMarkupForCategory(product.category);
          inventoryValue = currentStock * costPerUnit * markup;
          productMetrics[product.id] = {
            inventoryCost,
            inventoryValue,
            calculationMethod: 'mixed',
            markupUsed: markup
          };
        } else if (!hasRecipeData && costPerUnit > 0) {
          // No recipes, pure markup estimation
          const markup = getMarkupForCategory(product.category);
          inventoryValue = currentStock * costPerUnit * markup;
          productMetrics[product.id] = {
            inventoryCost,
            inventoryValue,
            calculationMethod: 'estimated',
            markupUsed: markup
          };
        } else {
          // No recipes and no cost data
          productMetrics[product.id] = {
            inventoryCost,
            inventoryValue: 0,
            calculationMethod: 'estimated',
            markupUsed: 0
          };
        }
      }

      // Calculate totals and summary
      const totalInventoryCost = Object.values(productMetrics).reduce(
        (sum, metrics) => sum + metrics.inventoryCost, 0
      );
      const totalInventoryValue = Object.values(productMetrics).reduce(
        (sum, metrics) => sum + metrics.inventoryValue, 0
      );

      const calculationSummary = Object.values(productMetrics).reduce(
        (summary, metrics) => {
          const method = metrics.calculationMethod;
          if (method === 'recipe-based') {
            summary.recipeBasedCount++;
          } else if (method === 'estimated') {
            summary.estimatedCount++;
          } else if (method === 'mixed') {
            summary.mixedCount++;
          }
          return summary;
        },
        { recipeBasedCount: 0, estimatedCount: 0, mixedCount: 0 }
      );

      setMetrics({
        productMetrics,
        totalInventoryCost,
        totalInventoryValue,
        loading: false,
        calculationSummary
      });

    } catch (error) {
      console.error('Error calculating inventory metrics:', error);
      setMetrics(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    setMetrics(prev => ({ ...prev, loading: true }));
    calculateMetrics();
  }, [restaurantId, products]);

  return metrics;
};