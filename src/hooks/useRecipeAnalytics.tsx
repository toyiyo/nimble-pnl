import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  calculateRecipeProfitability, 
  getConsumptionTrends,
  type RecipeProfitabilityResult,
  type ConsumptionTrend
} from '@/services/recipeAnalytics.service';

// Re-export types for backward compatibility
export type RecipeProfitability = RecipeProfitabilityResult;
export type { ConsumptionTrend };

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
      
      const summary = await calculateRecipeProfitability(supabase, {
        restaurantId,
        daysBack: 30,
        includeZeroSales: false
      });

      setProfitabilityData({
        recipes: summary.recipes,
        highestMargin: summary.highestMargin,
        lowestMargin: summary.lowestMargin,
        averageFoodCost: summary.averageFoodCost
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
      const trends = await getConsumptionTrends(supabase, restaurantId, 7);
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