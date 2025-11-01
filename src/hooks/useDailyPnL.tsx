import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';
import { getTodayInTimezone, formatDateInTimezone } from '@/lib/timezone';

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

/**
 * @deprecated Use usePeriodMetrics instead for revenue calculations.
 * This hook is maintained only for historical monthly breakdown data.
 * 
 * ⚠️ WARNING: Do NOT use this hook for revenue calculations!
 * - net_revenue in daily_pnl includes liabilities (incorrect)
 * - Use usePeriodMetrics which calculates revenue from unified_sales
 * 
 * @see usePeriodMetrics - The correct hook for period financial metrics
 */
export function useDailyPnL(restaurantId: string | null, dateRange?: { from: Date; to: Date }) {
  const [pnlData, setPnlData] = useState<DailyPnL[]>([]);
  const [loading, setLoading] = useState(true);
  const [restaurantTimezone, setRestaurantTimezone] = useState<string>('UTC');
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
        // Default to last 30 days - using UTC dates since that's how we store them
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
  }, [restaurantId, restaurantTimezone, toast]);

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
    if (!pnlData || pnlData.length === 0) return null;
    
    // Get today's date in the restaurant's timezone
    const todayStr = getTodayInTimezone(restaurantTimezone);
    
    return pnlData.find(data => data.date === todayStr) || null;
  };

  const getGroupedPnLData = () => {
    if (!pnlData || pnlData.length === 0) return [];
    
    // Since dates are already stored as UTC dates (YYYY-MM-DD format), we don't need complex grouping
    // The P&L calculation already aggregates by date, so just return sorted data
    return [...pnlData].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const getAverages = (days: number = 7) => {
    const groupedData = getGroupedPnLData();
    const recentData = groupedData.slice(0, days);
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

  const getWeeklyData = () => {
    if (!pnlData || pnlData.length === 0) return [];

    const weeklyMap = new Map<string, {
      period: string;
      net_revenue: number;
      food_cost: number;
      labor_cost: number;
      days_count: number;
      start_date: string;
      end_date: string;
    }>();

    pnlData.forEach((day) => {
      const date = new Date(day.date + 'T12:00:00Z');
      const year = date.getUTCFullYear();
      const week = getISOWeek(date);
      const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;

      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, {
          period: weekKey,
          net_revenue: 0,
          food_cost: 0,
          labor_cost: 0,
          days_count: 0,
          start_date: day.date,
          end_date: day.date,
        });
      }

      const weekData = weeklyMap.get(weekKey)!;
      weekData.net_revenue += day.net_revenue;
      weekData.food_cost += day.food_cost;
      weekData.labor_cost += day.labor_cost;
      weekData.days_count += 1;
      
      if (day.date < weekData.start_date) weekData.start_date = day.date;
      if (day.date > weekData.end_date) weekData.end_date = day.date;
    });

    return Array.from(weeklyMap.values())
      .map((week) => ({
        ...week,
        food_cost_percentage: week.net_revenue > 0 ? (week.food_cost / week.net_revenue) * 100 : 0,
        labor_cost_percentage: week.net_revenue > 0 ? (week.labor_cost / week.net_revenue) * 100 : 0,
        prime_cost_percentage: week.net_revenue > 0 
          ? ((week.food_cost + week.labor_cost) / week.net_revenue) * 100 
          : 0,
        prime_cost: week.food_cost + week.labor_cost,
        gross_profit: week.net_revenue - week.food_cost - week.labor_cost,
      }))
      .sort((a, b) => b.period.localeCompare(a.period));
  };

  const getMonthlyData = () => {
    if (!pnlData || pnlData.length === 0) return [];

    const monthlyMap = new Map<string, {
      period: string;
      net_revenue: number;
      food_cost: number;
      labor_cost: number;
      days_count: number;
      start_date: string;
      end_date: string;
    }>();

    pnlData.forEach((day) => {
      const date = new Date(day.date + 'T12:00:00Z');
      const monthKey = `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}`;

      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          period: monthKey,
          net_revenue: 0,
          food_cost: 0,
          labor_cost: 0,
          days_count: 0,
          start_date: day.date,
          end_date: day.date,
        });
      }

      const monthData = monthlyMap.get(monthKey)!;
      monthData.net_revenue += day.net_revenue;
      monthData.food_cost += day.food_cost;
      monthData.labor_cost += day.labor_cost;
      monthData.days_count += 1;
      
      if (day.date < monthData.start_date) monthData.start_date = day.date;
      if (day.date > monthData.end_date) monthData.end_date = day.date;
    });

    return Array.from(monthlyMap.values())
      .map((month) => ({
        ...month,
        food_cost_percentage: month.net_revenue > 0 ? (month.food_cost / month.net_revenue) * 100 : 0,
        labor_cost_percentage: month.net_revenue > 0 ? (month.labor_cost / month.net_revenue) * 100 : 0,
        prime_cost_percentage: month.net_revenue > 0 
          ? ((month.food_cost + month.labor_cost) / month.net_revenue) * 100 
          : 0,
        prime_cost: month.food_cost + month.labor_cost,
        gross_profit: month.net_revenue - month.food_cost - month.labor_cost,
      }))
      .sort((a, b) => b.period.localeCompare(a.period));
  };

  // Helper function to calculate ISO week number
  const getISOWeek = (date: Date): number => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };

  // Fetch restaurant timezone when restaurantId changes
  useEffect(() => {
    if (restaurantId) {
      const fetchTimezone = async () => {
        try {
          // First try to get timezone from Square locations
          const { data: locationData, error: locationError } = await supabase
            .from('square_locations')
            .select('timezone')
            .eq('restaurant_id', restaurantId)
            .limit(1)
            .maybeSingle();
          
          if (locationData?.timezone && !locationError) {
            setRestaurantTimezone(locationData.timezone);
            return;
          }

          // Fall back to restaurant timezone
          const { data: restaurantData, error: restaurantError } = await supabase
            .from('restaurants')
            .select('timezone')
            .eq('id', restaurantId)
            .single();
          
          if (restaurantData?.timezone && !restaurantError) {
            setRestaurantTimezone(restaurantData.timezone);
          } else {
            setRestaurantTimezone('UTC');
          }
        } catch (error) {
          console.log('Error fetching timezone, using UTC:', error);
          setRestaurantTimezone('UTC');
        }
      };
      
      fetchTimezone();
    }
  }, [restaurantId]);

  useEffect(() => {
    if (restaurantId) {
      // If dateRange is provided, use it; otherwise fetch last 90 days for monthly view
      if (dateRange) {
        const from = dateRange.from.toISOString().split('T')[0];
        const to = dateRange.to.toISOString().split('T')[0];
        fetchPnLData({ from, to });
      } else {
        // Default to last 90 days to show multiple months
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const from = ninetyDaysAgo.toISOString().split('T')[0];
        const to = new Date().toISOString().split('T')[0];
        fetchPnLData({ from, to });
      }
    }
  }, [restaurantId, dateRange?.from, dateRange?.to, fetchPnLData]);

  return {
    pnlData,
    loading,
    upsertSales,
    upsertFoodCosts,
    upsertLaborCosts,
    fetchPnLData,
    getTodaysData,
    getAverages,
    getGroupedPnLData,
    getWeeklyData,
    getMonthlyData,
  };
}