import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';

export interface DailyPnL {
  id: string;
  restaurant_id: string;
  date: string;
  net_revenue: number;
  food_cost: number;
  labor_cost: number;
  prime_cost: number;
  gross_profit: number;
  food_cost_percentage: number;
  labor_cost_percentage: number;
  prime_cost_percentage: number;
  created_at: string;
  updated_at: string;
}

export interface DailySales {
  id?: string;
  restaurant_id: string;
  date: string;
  source: string;
  gross_revenue: number;
  discounts: number;
  comps: number;
  transaction_count?: number;
}

export interface DailyFoodCosts {
  id?: string;
  restaurant_id: string;
  date: string;
  source: string;
  purchases: number;
  inventory_adjustments: number;
}

export interface DailyLaborCosts {
  id?: string;
  restaurant_id: string;
  date: string;
  source: string;
  hourly_wages: number;
  salary_wages: number;
  benefits: number;
  total_hours?: number;
}

export function useDailyPnL(restaurantId: string | null) {
  const [pnlData, setPnlData] = useState<DailyPnL[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchPnLData = useCallback(async (dateRange?: { from: string; to: string }) => {
    if (!restaurantId) return;

    try {
      setLoading(true);
      let query = supabase
        .from('daily_pnl')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('date', { ascending: false });

      if (dateRange) {
        query = query.gte('date', dateRange.from).lte('date', dateRange.to);
      } else {
        // Default to last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        query = query.gte('date', thirtyDaysAgo.toISOString().split('T')[0]);
      }

      const { data, error } = await query;

      if (error) throw error;
      setPnlData(data || []);
    } catch (error: any) {
      toast({
        title: "Error fetching P&L data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, toast]);

  const upsertSales = async (salesData: DailySales) => {
    try {
      console.log('Upserting sales data:', salesData);
      const { data, error } = await supabase
        .from('daily_sales')
        .upsert({
          restaurant_id: salesData.restaurant_id,
          date: salesData.date,
          source: salesData.source,
          gross_revenue: salesData.gross_revenue,
          discounts: salesData.discounts,
          comps: salesData.comps,
          transaction_count: salesData.transaction_count || 0,
        }, {
          onConflict: 'restaurant_id,date,source'
        });

      console.log('Sales upsert result:', { data, error });
      if (error) throw error;

      toast({
        title: "Sales data updated!",
        description: "P&L calculations have been refreshed.",
      });

      // Refresh P&L data
      await fetchPnLData();
    } catch (error: any) {
      toast({
        title: "Error updating sales",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const upsertFoodCosts = async (foodCostsData: DailyFoodCosts) => {
    try {
      console.log('Upserting food costs data:', foodCostsData);
      const { data, error } = await supabase
        .from('daily_food_costs')
        .upsert({
          restaurant_id: foodCostsData.restaurant_id,
          date: foodCostsData.date,
          source: foodCostsData.source,
          purchases: foodCostsData.purchases,
          inventory_adjustments: foodCostsData.inventory_adjustments,
        }, {
          onConflict: 'restaurant_id,date,source'
        });

      console.log('Food costs upsert result:', { data, error });
      if (error) throw error;

      toast({
        title: "Food costs updated!",
        description: "P&L calculations have been refreshed.",
      });

      await fetchPnLData();
    } catch (error: any) {
      toast({
        title: "Error updating food costs",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const upsertLaborCosts = async (laborCostsData: DailyLaborCosts) => {
    try {
      console.log('Upserting labor costs data:', laborCostsData);
      const { data, error } = await supabase
        .from('daily_labor_costs')
        .upsert({
          restaurant_id: laborCostsData.restaurant_id,
          date: laborCostsData.date,
          source: laborCostsData.source,
          hourly_wages: laborCostsData.hourly_wages,
          salary_wages: laborCostsData.salary_wages,
          benefits: laborCostsData.benefits,
          total_hours: laborCostsData.total_hours || 0,
        }, {
          onConflict: 'restaurant_id,date,source'
        });

      console.log('Labor costs upsert result:', { data, error });
      if (error) throw error;

      toast({
        title: "Labor costs updated!",
        description: "P&L calculations have been refreshed.",
      });

      await fetchPnLData();
    } catch (error: any) {
      toast({
        title: "Error updating labor costs",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getTodaysData = () => {
    const today = new Date().toISOString().split('T')[0];
    return pnlData.find(data => data.date === today) || null;
  };

  const getAverages = (days: number = 7) => {
    const recentData = pnlData.slice(0, days);
    if (recentData.length === 0) return null;

    const totals = recentData.reduce((acc, day) => ({
      revenue: acc.revenue + day.net_revenue,
      foodCost: acc.foodCost + day.food_cost,
      laborCost: acc.laborCost + day.labor_cost,
      foodCostPercentage: acc.foodCostPercentage + day.food_cost_percentage,
      laborCostPercentage: acc.laborCostPercentage + day.labor_cost_percentage,
      primeCostPercentage: acc.primeCostPercentage + day.prime_cost_percentage,
    }), {
      revenue: 0,
      foodCost: 0,
      laborCost: 0,
      foodCostPercentage: 0,
      laborCostPercentage: 0,
      primeCostPercentage: 0,
    });

    return {
      avgRevenue: totals.revenue / recentData.length,
      avgFoodCost: totals.foodCost / recentData.length,
      avgLaborCost: totals.laborCost / recentData.length,
      avgFoodCostPercentage: totals.foodCostPercentage / recentData.length,
      avgLaborCostPercentage: totals.laborCostPercentage / recentData.length,
      avgPrimeCostPercentage: totals.primeCostPercentage / recentData.length,
    };
  };

  useEffect(() => {
    if (restaurantId) {
      fetchPnLData();
    }
  }, [restaurantId, fetchPnLData]);

  return {
    pnlData,
    loading,
    upsertSales,
    upsertFoodCosts,
    upsertLaborCosts,
    fetchPnLData,
    getTodaysData,
    getAverages,
  };
}