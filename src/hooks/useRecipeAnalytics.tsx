import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface RecipeProfitability {
  id: string;
  name: string;
  estimated_cost: number;
  selling_price: number;
  margin: number;
  food_cost_percentage: number;
  total_sales: number;
  total_quantity_sold: number;
}

export interface ConsumptionTrend {
  ingredient_name: string;
  date: string;
  quantity_used: number;
  cost: number;
}

export interface ProfitabilityData {
  recipes: RecipeProfitability[];
  highestMargin?: RecipeProfitability;
  lowestMargin?: RecipeProfitability;
  averageFoodCost: number;
}

export const useRecipeAnalytics = (restaurantId: string | null) => {
  const [profitabilityData, setProfitabilityData] = useState<ProfitabilityData | null>(null);
  const [consumptionData, setConsumptionData] = useState<ConsumptionTrend[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchProfitabilityData = async () => {
    if (!restaurantId) return;

    try {
      setLoading(true);

      // Get recipes with their costs and sales data
      const { data: recipes, error: recipesError } = await supabase
        .from('recipes')
        .select(`
          id,
          name,
          estimated_cost,
          pos_item_name
        `)
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true);

      if (recipesError) throw recipesError;

      // Get sales data for each recipe from unified_sales
      const recipeProfitability: RecipeProfitability[] = [];
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      for (const recipe of recipes || []) {
        // Match by pos_item_name or recipe name
        const { data: salesData, error: salesError } = await supabase
          .from('unified_sales')
          .select('quantity, total_price, unit_price')
          .eq('restaurant_id', restaurantId)
          .or(`item_name.eq.${recipe.pos_item_name || recipe.name}`)
          .gte('sale_date', thirtyDaysAgo);

        if (salesError) {
          console.error('Error fetching sales data for recipe:', recipe.name, salesError);
          continue;
        }

        if (!salesData || salesData.length === 0) continue;

        const totalQuantitySold = salesData.reduce((sum, sale) => sum + (sale.quantity || 0), 0);
        const totalSales = salesData.reduce((sum, sale) => sum + (sale.total_price || 0), 0);
        const averageSellingPrice = totalQuantitySold > 0 ? totalSales / totalQuantitySold : 0;

        if (totalQuantitySold > 0 && averageSellingPrice > 0 && recipe.estimated_cost > 0) {
          const foodCostPercentage = (recipe.estimated_cost / averageSellingPrice) * 100;
          const margin = ((averageSellingPrice - recipe.estimated_cost) / averageSellingPrice) * 100;

          recipeProfitability.push({
            id: recipe.id,
            name: recipe.name,
            estimated_cost: recipe.estimated_cost || 0,
            selling_price: averageSellingPrice,
            margin: margin,
            food_cost_percentage: foodCostPercentage,
            total_sales: totalSales,
            total_quantity_sold: totalQuantitySold
          });
        }
      }

      // Calculate summary metrics
      const averageFoodCost = recipeProfitability.length > 0
        ? recipeProfitability.reduce((sum, recipe) => sum + recipe.food_cost_percentage, 0) / recipeProfitability.length
        : 0;

      const highestMargin = recipeProfitability.length > 0
        ? recipeProfitability.reduce((max, recipe) => 
            recipe.margin > (max?.margin || -Infinity) ? recipe : max, recipeProfitability[0])
        : undefined;

      const lowestMargin = recipeProfitability.length > 0
        ? recipeProfitability.reduce((min, recipe) => 
            recipe.margin < (min?.margin || Infinity) ? recipe : min, recipeProfitability[0])
        : undefined;

      setProfitabilityData({
        recipes: recipeProfitability,
        highestMargin,
        lowestMargin,
        averageFoodCost
      });

    } catch (error: any) {
      console.error('Error fetching recipe analytics:', error);
      toast({
        title: "Error loading analytics",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchConsumptionData = async () => {
    if (!restaurantId) return;

    try {
      // Get consumption trends from inventory transactions
      const { data: transactions, error } = await supabase
        .from('inventory_transactions')
        .select(`
          created_at,
          quantity,
          total_cost,
          product:products(name)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'usage')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      const trends: ConsumptionTrend[] = (transactions || []).map(transaction => ({
        ingredient_name: transaction.product?.name || 'Unknown',
        date: transaction.created_at.split('T')[0],
        quantity_used: Math.abs(transaction.quantity),
        cost: Math.abs(transaction.total_cost || 0)
      }));

      setConsumptionData(trends);

    } catch (error: any) {
      console.error('Error fetching consumption data:', error);
    }
  };

  useEffect(() => {
    if (restaurantId) {
      fetchProfitabilityData();
      fetchConsumptionData();
    }
  }, [restaurantId]);

  return {
    profitabilityData,
    consumptionData,
    loading,
    refetch: () => {
      fetchProfitabilityData();
      fetchConsumptionData();
    }
  };
};