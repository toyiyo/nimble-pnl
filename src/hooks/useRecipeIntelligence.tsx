import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, subDays, startOfWeek, endOfWeek } from 'date-fns';

export interface RecipePerformance {
  id: string;
  name: string;
  estimated_cost: number;
  selling_price: number;
  margin: number;
  food_cost_percentage: number;
  total_sales: number;
  total_quantity_sold: number;
  revenue_contribution: number;
  profit_contribution: number;
  efficiency_score: number;
  trend: 'up' | 'down' | 'stable';
  velocity: number; // sales per day
}

export interface CostTrend {
  recipe_name: string;
  date: string;
  cost: number;
  selling_price: number;
  margin: number;
}

export interface IngredientImpact {
  ingredient_name: string;
  total_cost: number;
  usage_frequency: number;
  recipes_used_in: number;
  cost_per_recipe: number;
  optimization_potential: number;
}

export interface RecipeInsight {
  id: string;
  type: 'critical' | 'warning' | 'success' | 'info';
  title: string;
  description: string;
  affected_recipes: string[];
  estimated_impact: number;
  recommendation: string;
  priority: number;
}

export interface RecipeBenchmark {
  metric: string;
  restaurant_value: number;
  industry_standard: number;
  performance: 'above' | 'below' | 'at';
  gap: number;
}

export interface RecipeIntelligenceData {
  summary: {
    total_recipes: number;
    active_recipes: number;
    average_margin: number;
    total_revenue: number;
    average_efficiency_score: number;
    high_performers: number;
    low_performers: number;
  };
  performance: RecipePerformance[];
  cost_trends: CostTrend[];
  ingredient_impact: IngredientImpact[];
  insights: RecipeInsight[];
  benchmarks: RecipeBenchmark[];
  predictions: {
    next_week_revenue: number;
    confidence: number;
    top_recipes: string[];
  };
}

export const useRecipeIntelligence = (
  restaurantId: string | null,
  dateFrom?: Date,
  dateTo?: Date
) => {
  const [data, setData] = useState<RecipeIntelligenceData | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchIntelligence = async () => {
    if (!restaurantId) return;

    try {
      setLoading(true);

      // Use provided dates or default to 30/60 days
      const endDate = dateTo || new Date();
      const startDate = dateFrom || subDays(endDate, 30);
      const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const previousPeriodStart = subDays(startDate, periodDays);

      const thirtyDaysAgo = format(startDate, 'yyyy-MM-dd');
      const sixtyDaysAgo = format(previousPeriodStart, 'yyyy-MM-dd');

      // Fetch recipes with ingredients
      const { data: recipes, error: recipesError } = await supabase
        .from('recipes')
        .select(`
          id,
          name,
          estimated_cost,
          pos_item_name,
          is_active,
          recipe_ingredients(
            quantity,
            product:products(name, cost_per_unit, category)
          )
        `)
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true);

      if (recipesError) throw recipesError;

      // Fetch current period sales
      const { data: currentSales, error: currentSalesError } = await supabase
        .from('unified_sales')
        .select('item_name, quantity, total_price, unit_price, sale_date')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', thirtyDaysAgo);

      if (currentSalesError) throw currentSalesError;

      // Fetch previous period sales for trend analysis
      const { data: previousSales, error: previousSalesError } = await supabase
        .from('unified_sales')
        .select('item_name, quantity, total_price')
        .eq('restaurant_id', restaurantId)
        .gte('sale_date', sixtyDaysAgo)
        .lt('sale_date', thirtyDaysAgo);

      if (previousSalesError) throw previousSalesError;

      // Fetch inventory transactions for ingredient analysis
      const { data: transactions, error: transactionsError } = await supabase
        .from('inventory_transactions')
        .select(`
          product_id,
          quantity,
          total_cost,
          created_at,
          product:products(name, category)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'usage')
        .gte('created_at', subDays(new Date(), 30).toISOString());

      if (transactionsError) throw transactionsError;

      // Calculate performance metrics
      const performance: RecipePerformance[] = [];
      const costTrends: CostTrend[] = [];
      let totalRevenue = 0;

      for (const recipe of recipes || []) {
        const recipeItemName = recipe.pos_item_name || recipe.name;
        
        const recipeSales = currentSales?.filter(s => s.item_name === recipeItemName) || [];
        const previousRecipeSales = previousSales?.filter(s => s.item_name === recipeItemName) || [];

        if (recipeSales.length === 0) continue;

        const totalQuantitySold = recipeSales.reduce((sum, s) => sum + (s.quantity || 0), 0);
        const totalSales = recipeSales.reduce((sum, s) => sum + (s.total_price || 0), 0);
        const avgSellingPrice = totalQuantitySold > 0 ? totalSales / totalQuantitySold : 0;

        const previousQuantity = previousRecipeSales.reduce((sum, s) => sum + (s.quantity || 0), 0);
        
        if (avgSellingPrice > 0 && recipe.estimated_cost > 0) {
          const margin = ((avgSellingPrice - recipe.estimated_cost) / avgSellingPrice) * 100;
          const foodCostPct = (recipe.estimated_cost / avgSellingPrice) * 100;
          const profitPerUnit = avgSellingPrice - recipe.estimated_cost;
          const totalProfit = profitPerUnit * totalQuantitySold;

          // Calculate trend
          let trend: 'up' | 'down' | 'stable' = 'stable';
          if (previousQuantity > 0) {
            const change = ((totalQuantitySold - previousQuantity) / previousQuantity) * 100;
            if (change > 10) trend = 'up';
            else if (change < -10) trend = 'down';
          }

          // Calculate efficiency score (0-100) with proper clamping
          const marginScore = Math.max(0, Math.min((margin / 70) * 40, 40));
          const velocityScore = Math.max(0, Math.min((totalQuantitySold / 30) * 30, 30));
          const costScore = Math.max(0, Math.min((1 - (foodCostPct / 35)) * 30, 30));
          const efficiencyScore = marginScore + velocityScore + costScore;

          performance.push({
            id: recipe.id,
            name: recipe.name,
            estimated_cost: recipe.estimated_cost || 0,
            selling_price: avgSellingPrice,
            margin,
            food_cost_percentage: foodCostPct,
            total_sales: totalSales,
            total_quantity_sold: totalQuantitySold,
            revenue_contribution: (totalSales / (totalRevenue || 1)) * 100,
            profit_contribution: totalProfit,
            efficiency_score: efficiencyScore,
            trend,
            velocity: totalQuantitySold / 30
          });

          totalRevenue += totalSales;

          // Add daily cost trends
          const salesByDate = recipeSales.reduce((acc, s) => {
            const date = s.sale_date;
            if (!acc[date]) acc[date] = { quantity: 0, total: 0 };
            acc[date].quantity += s.quantity || 0;
            acc[date].total += s.total_price || 0;
            return acc;
          }, {} as Record<string, { quantity: number; total: number }>);

          Object.entries(salesByDate).forEach(([date, data]) => {
            const avgPrice = data.quantity > 0 ? data.total / data.quantity : 0;
            const margin = avgPrice > 0 ? ((avgPrice - recipe.estimated_cost) / avgPrice) * 100 : 0;
            costTrends.push({
              recipe_name: recipe.name,
              date,
              cost: recipe.estimated_cost || 0,
              selling_price: avgPrice,
              margin
            });
          });
        }
      }

      // Update revenue contribution
      performance.forEach(p => {
        p.revenue_contribution = (p.total_sales / totalRevenue) * 100;
      });

      // Analyze ingredient impact
      const ingredientMap = new Map<string, IngredientImpact>();
      
      for (const recipe of recipes || []) {
        for (const ingredient of recipe.recipe_ingredients || []) {
          const name = ingredient.product?.name || 'Unknown';
          if (!ingredientMap.has(name)) {
            ingredientMap.set(name, {
              ingredient_name: name,
              total_cost: 0,
              usage_frequency: 0,
              recipes_used_in: 0,
              cost_per_recipe: 0,
              optimization_potential: 0
            });
          }
          const impact = ingredientMap.get(name)!;
          impact.recipes_used_in++;
          impact.total_cost += (ingredient.quantity || 0) * (ingredient.product?.cost_per_unit || 0);
        }
      }

      transactions?.forEach(t => {
        const name = t.product?.name || 'Unknown';
        if (ingredientMap.has(name)) {
          const impact = ingredientMap.get(name)!;
          impact.usage_frequency++;
          impact.total_cost += Math.abs(t.total_cost || 0);
        }
      });

      ingredientMap.forEach(impact => {
        impact.cost_per_recipe = impact.recipes_used_in > 0 ? impact.total_cost / impact.recipes_used_in : 0;
        impact.optimization_potential = impact.total_cost * 0.15; // Assume 15% potential savings
      });

      const ingredientImpact = Array.from(ingredientMap.values())
        .sort((a, b) => b.total_cost - a.total_cost)
        .slice(0, 20);

      // Generate insights
      const insights: RecipeInsight[] = [];
      let insightId = 1;

      const lowMarginRecipes = performance.filter(r => r.margin < 50);
      if (lowMarginRecipes.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'critical',
          title: 'Low Margin Recipes Detected',
          description: `${lowMarginRecipes.length} recipes have margins below 50%, which may impact profitability.`,
          affected_recipes: lowMarginRecipes.map(r => r.name),
          estimated_impact: lowMarginRecipes.reduce((sum, r) => sum + r.total_sales, 0) * 0.2,
          recommendation: 'Consider increasing prices by 10-15% or reducing portion sizes to improve margins without sacrificing quality.',
          priority: 1
        });
      }

      const highCostRecipes = performance.filter(r => r.food_cost_percentage > 35);
      if (highCostRecipes.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'warning',
          title: 'High Food Cost Recipes',
          description: `${highCostRecipes.length} recipes exceed 35% food cost benchmark.`,
          affected_recipes: highCostRecipes.map(r => r.name),
          estimated_impact: highCostRecipes.reduce((sum, r) => sum + (r.total_sales * 0.1), 0),
          recommendation: 'Review ingredient costs, negotiate with suppliers, or substitute with more cost-effective alternatives.',
          priority: 2
        });
      }

      const topPerformers = performance.filter(r => r.efficiency_score > 80);
      if (topPerformers.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'success',
          title: 'Star Performers Identified',
          description: `${topPerformers.length} recipes are high-efficiency performers with excellent margins and velocity.`,
          affected_recipes: topPerformers.map(r => r.name),
          estimated_impact: topPerformers.reduce((sum, r) => sum + r.profit_contribution, 0),
          recommendation: 'Promote these items through menu placement, upselling, and marketing to maximize profitability.',
          priority: 3
        });
      }

      const decliningRecipes = performance.filter(r => r.trend === 'down' && r.total_sales > 100);
      if (decliningRecipes.length > 0) {
        insights.push({
          id: `insight-${insightId++}`,
          type: 'warning',
          title: 'Declining Sales Trend',
          description: `${decliningRecipes.length} previously popular recipes showing declining sales.`,
          affected_recipes: decliningRecipes.map(r => r.name),
          estimated_impact: decliningRecipes.reduce((sum, r) => sum + r.total_sales, 0) * 0.15,
          recommendation: 'Refresh recipes, adjust pricing, or create seasonal variations to reignite interest.',
          priority: 2
        });
      }

      // Generate benchmarks
      const avgMargin = performance.length > 0 ? performance.reduce((sum, r) => sum + r.margin, 0) / performance.length : 0;
      const avgFoodCost = performance.length > 0 ? performance.reduce((sum, r) => sum + r.food_cost_percentage, 0) / performance.length : 0;
      const avgEfficiency = performance.length > 0 ? performance.reduce((sum, r) => sum + r.efficiency_score, 0) / performance.length : 0;

      const benchmarks: RecipeBenchmark[] = [
        {
          metric: 'Average Margin',
          restaurant_value: avgMargin,
          industry_standard: 65,
          performance: avgMargin >= 65 ? 'above' : avgMargin >= 60 ? 'at' : 'below',
          gap: avgMargin - 65
        },
        {
          metric: 'Average Food Cost %',
          restaurant_value: avgFoodCost,
          industry_standard: 30,
          performance: avgFoodCost <= 30 ? 'above' : avgFoodCost <= 33 ? 'at' : 'below',
          gap: 30 - avgFoodCost
        },
        {
          metric: 'Recipe Efficiency Score',
          restaurant_value: avgEfficiency,
          industry_standard: 70,
          performance: avgEfficiency >= 70 ? 'above' : avgEfficiency >= 65 ? 'at' : 'below',
          gap: avgEfficiency - 70
        },
        {
          metric: 'Active Recipe Utilization',
          restaurant_value: (performance.length / (recipes?.length || 1)) * 100,
          industry_standard: 85,
          performance: (performance.length / (recipes?.length || 1)) * 100 >= 85 ? 'above' : 'below',
          gap: ((performance.length / (recipes?.length || 1)) * 100) - 85
        }
      ];

      // Generate predictions
      const recentWeekSales = performance.reduce((sum, r) => {
        const lastWeekStart = format(subDays(new Date(), 7), 'yyyy-MM-dd');
        const lastWeekSales = currentSales?.filter(s => 
          (s.item_name === r.name || s.item_name === (recipes?.find(rec => rec.id === r.id)?.pos_item_name)) &&
          s.sale_date >= lastWeekStart
        ) || [];
        return sum + lastWeekSales.reduce((s, sale) => s + (sale.total_price || 0), 0);
      }, 0);

      const predictions = {
        next_week_revenue: recentWeekSales * 1.05,
        confidence: 0.75,
        top_recipes: performance
          .sort((a, b) => b.velocity - a.velocity)
          .slice(0, 5)
          .map(r => r.name)
      };

      // Calculate summary
      const summary = {
        total_recipes: recipes?.length || 0,
        active_recipes: performance.length,
        average_margin: avgMargin,
        total_revenue: totalRevenue,
        average_efficiency_score: avgEfficiency,
        high_performers: performance.filter(r => r.efficiency_score > 75).length,
        low_performers: performance.filter(r => r.efficiency_score < 50).length
      };

      setData({
        summary,
        performance: performance.sort((a, b) => b.efficiency_score - a.efficiency_score),
        cost_trends: costTrends.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        ingredient_impact: ingredientImpact,
        insights: insights.sort((a, b) => a.priority - b.priority),
        benchmarks,
        predictions
      });

    } catch (error: any) {
      console.error('Error fetching recipe intelligence:', error);
      toast({
        title: "Error loading recipe intelligence",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (restaurantId) {
      fetchIntelligence();
    }
  }, [restaurantId, dateFrom, dateTo]);

  return { data, loading, refetch: fetchIntelligence };
};
