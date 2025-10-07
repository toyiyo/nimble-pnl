import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { startOfWeek, endOfWeek, format, subDays, subWeeks, subMonths } from 'date-fns';

export interface DailyPnLData {
  date: string;
  net_revenue: number;
  food_cost: number;
  labor_cost: number;
  prime_cost: number;
  food_cost_percentage: number;
  labor_cost_percentage: number;
  prime_cost_percentage: number;
  gross_profit: number;
  day_of_week: string;
}

export interface PnLComparison {
  current_period: {
    revenue: number;
    food_cost: number;
    labor_cost: number;
    prime_cost: number;
    avg_food_cost_pct: number;
    avg_labor_cost_pct: number;
    avg_prime_cost_pct: number;
  };
  previous_period: {
    revenue: number;
    food_cost: number;
    labor_cost: number;
    prime_cost: number;
    avg_food_cost_pct: number;
    avg_labor_cost_pct: number;
    avg_prime_cost_pct: number;
  };
  change: {
    revenue_pct: number;
    food_cost_pct: number;
    labor_cost_pct: number;
    prime_cost_pct: number;
  };
}

export interface DayOfWeekPattern {
  day: string;
  avg_revenue: number;
  avg_food_cost_pct: number;
  avg_labor_cost_pct: number;
  transactions: number;
}

export interface PnLInsight {
  type: 'critical' | 'warning' | 'success' | 'info';
  title: string;
  description: string;
  metric: string;
  value: string;
  recommendation: string;
  priority: number;
}

export interface PnLForecast {
  date: string;
  predicted_revenue: number;
  confidence_level: 'high' | 'medium' | 'low';
}

export interface PnLAnalytics {
  dailyData: DailyPnLData[];
  comparison: PnLComparison;
  dayOfWeekPatterns: DayOfWeekPattern[];
  insights: PnLInsight[];
  forecast: PnLForecast[];
  benchmarks: {
    industry_avg_food_cost: number;
    industry_avg_labor_cost: number;
    industry_avg_prime_cost: number;
    your_avg_food_cost: number;
    your_avg_labor_cost: number;
    your_avg_prime_cost: number;
  };
  efficiency: {
    revenue_per_labor_dollar: number;
    cost_control_score: number;
    margin_trend: 'improving' | 'stable' | 'declining';
  };
}

export function usePnLAnalytics(restaurantId: string | null, days: number = 30) {
  const [data, setData] = useState<PnLAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (restaurantId) {
      fetchPnLAnalytics();
    }
  }, [restaurantId, days]);

  const fetchPnLAnalytics = async () => {
    if (!restaurantId) return;

    try {
      setLoading(true);

      const endDate = new Date();
      const startDate = subDays(endDate, days);
      const previousPeriodStart = subDays(startDate, days);

      // Fetch current period data
      const { data: currentPnL, error: currentError } = await supabase
        .from('daily_pnl')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(startDate, 'yyyy-MM-dd'))
        .lte('date', format(endDate, 'yyyy-MM-dd'))
        .order('date', { ascending: true });

      if (currentError) throw currentError;

      // Fetch previous period data for comparison
      const { data: previousPnL, error: previousError } = await supabase
        .from('daily_pnl')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(previousPeriodStart, 'yyyy-MM-dd'))
        .lt('date', format(startDate, 'yyyy-MM-dd'))
        .order('date', { ascending: true });

      if (previousError) throw previousError;

      if (!currentPnL || currentPnL.length === 0) {
        setData(null);
        return;
      }

      // Transform daily data
      const dailyData: DailyPnLData[] = currentPnL.map((day: any) => ({
        date: day.date,
        net_revenue: Number(day.net_revenue) || 0,
        food_cost: Number(day.food_cost) || 0,
        labor_cost: Number(day.labor_cost) || 0,
        prime_cost: Number(day.prime_cost) || 0,
        food_cost_percentage: Number(day.food_cost_percentage) || 0,
        labor_cost_percentage: Number(day.labor_cost_percentage) || 0,
        prime_cost_percentage: Number(day.prime_cost_percentage) || 0,
        gross_profit: Number(day.gross_profit) || 0,
        day_of_week: format(new Date(day.date), 'EEEE'),
      }));

      // Calculate comparison
      const currentTotals = dailyData.reduce((acc, day) => ({
        revenue: acc.revenue + day.net_revenue,
        food_cost: acc.food_cost + day.food_cost,
        labor_cost: acc.labor_cost + day.labor_cost,
        prime_cost: acc.prime_cost + day.prime_cost,
        food_cost_pct_sum: acc.food_cost_pct_sum + day.food_cost_percentage,
        labor_cost_pct_sum: acc.labor_cost_pct_sum + day.labor_cost_percentage,
        prime_cost_pct_sum: acc.prime_cost_pct_sum + day.prime_cost_percentage,
        count: acc.count + 1,
      }), { revenue: 0, food_cost: 0, labor_cost: 0, prime_cost: 0, food_cost_pct_sum: 0, labor_cost_pct_sum: 0, prime_cost_pct_sum: 0, count: 0 });

      const previousTotals = (previousPnL || []).reduce((acc: any, day: any) => ({
        revenue: acc.revenue + (Number(day.net_revenue) || 0),
        food_cost: acc.food_cost + (Number(day.food_cost) || 0),
        labor_cost: acc.labor_cost + (Number(day.labor_cost) || 0),
        prime_cost: acc.prime_cost + (Number(day.prime_cost) || 0),
        food_cost_pct_sum: acc.food_cost_pct_sum + (Number(day.food_cost_percentage) || 0),
        labor_cost_pct_sum: acc.labor_cost_pct_sum + (Number(day.labor_cost_percentage) || 0),
        prime_cost_pct_sum: acc.prime_cost_pct_sum + (Number(day.prime_cost_percentage) || 0),
        count: acc.count + 1,
      }), { revenue: 0, food_cost: 0, labor_cost: 0, prime_cost: 0, food_cost_pct_sum: 0, labor_cost_pct_sum: 0, prime_cost_pct_sum: 0, count: 0 });

      const comparison: PnLComparison = {
        current_period: {
          revenue: currentTotals.revenue,
          food_cost: currentTotals.food_cost,
          labor_cost: currentTotals.labor_cost,
          prime_cost: currentTotals.prime_cost,
          avg_food_cost_pct: currentTotals.count > 0 ? currentTotals.food_cost_pct_sum / currentTotals.count : 0,
          avg_labor_cost_pct: currentTotals.count > 0 ? currentTotals.labor_cost_pct_sum / currentTotals.count : 0,
          avg_prime_cost_pct: currentTotals.count > 0 ? currentTotals.prime_cost_pct_sum / currentTotals.count : 0,
        },
        previous_period: {
          revenue: previousTotals.revenue,
          food_cost: previousTotals.food_cost,
          labor_cost: previousTotals.labor_cost,
          prime_cost: previousTotals.prime_cost,
          avg_food_cost_pct: previousTotals.count > 0 ? previousTotals.food_cost_pct_sum / previousTotals.count : 0,
          avg_labor_cost_pct: previousTotals.count > 0 ? previousTotals.labor_cost_pct_sum / previousTotals.count : 0,
          avg_prime_cost_pct: previousTotals.count > 0 ? previousTotals.prime_cost_pct_sum / previousTotals.count : 0,
        },
        change: {
          revenue_pct: previousTotals.revenue > 0 
            ? ((currentTotals.revenue - previousTotals.revenue) / previousTotals.revenue) * 100 
            : 0,
          food_cost_pct: previousTotals.food_cost > 0 
            ? ((currentTotals.food_cost - previousTotals.food_cost) / previousTotals.food_cost) * 100 
            : 0,
          labor_cost_pct: previousTotals.labor_cost > 0 
            ? ((currentTotals.labor_cost - previousTotals.labor_cost) / previousTotals.labor_cost) * 100 
            : 0,
          prime_cost_pct: previousTotals.prime_cost > 0 
            ? ((currentTotals.prime_cost - previousTotals.prime_cost) / previousTotals.prime_cost) * 100 
            : 0,
        },
      };

      // Calculate day-of-week patterns
      const dayGroups = dailyData.reduce((acc, day) => {
        if (!acc[day.day_of_week]) {
          acc[day.day_of_week] = [];
        }
        acc[day.day_of_week].push(day);
        return acc;
      }, {} as { [key: string]: DailyPnLData[] });

      const dayOfWeekPatterns: DayOfWeekPattern[] = Object.entries(dayGroups).map(([day, days]) => ({
        day,
        avg_revenue: days.reduce((sum, d) => sum + d.net_revenue, 0) / days.length,
        avg_food_cost_pct: days.reduce((sum, d) => sum + d.food_cost_percentage, 0) / days.length,
        avg_labor_cost_pct: days.reduce((sum, d) => sum + d.labor_cost_percentage, 0) / days.length,
        transactions: days.length,
      }));

      // Sort by day of week
      const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      dayOfWeekPatterns.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));

      // Generate insights
      const insights: PnLInsight[] = [];

      // Industry benchmarks (typical full-service restaurant)
      const INDUSTRY_FOOD_COST = 28;
      const INDUSTRY_LABOR_COST = 32;
      const INDUSTRY_PRIME_COST = 60;

      const avgFoodCost = comparison.current_period.avg_food_cost_pct;
      const avgLaborCost = comparison.current_period.avg_labor_cost_pct;
      const avgPrimeCost = comparison.current_period.avg_prime_cost_pct;

      // Food cost insights
      if (avgFoodCost > INDUSTRY_FOOD_COST + 5) {
        insights.push({
          type: 'critical',
          title: 'High Food Cost',
          description: 'Your food cost percentage is significantly above industry standards',
          metric: 'Food Cost %',
          value: `${avgFoodCost.toFixed(1)}%`,
          recommendation: 'Review menu pricing, portion sizes, and supplier contracts. Consider menu engineering to promote high-margin items.',
          priority: 1,
        });
      } else if (avgFoodCost < INDUSTRY_FOOD_COST - 5) {
        insights.push({
          type: 'success',
          title: 'Excellent Food Cost Control',
          description: 'Your food cost is well below industry average',
          metric: 'Food Cost %',
          value: `${avgFoodCost.toFixed(1)}%`,
          recommendation: 'Maintain current purchasing and portion control practices. Consider if quality is impacted.',
          priority: 3,
        });
      }

      // Labor cost insights
      if (avgLaborCost > INDUSTRY_LABOR_COST + 5) {
        insights.push({
          type: 'warning',
          title: 'Elevated Labor Costs',
          description: 'Labor costs are trending above optimal levels',
          metric: 'Labor Cost %',
          value: `${avgLaborCost.toFixed(1)}%`,
          recommendation: 'Optimize scheduling, review productivity metrics, and consider cross-training staff.',
          priority: 2,
        });
      }

      // Prime cost insights
      if (avgPrimeCost > INDUSTRY_PRIME_COST + 5) {
        insights.push({
          type: 'critical',
          title: 'Prime Cost Exceeds Target',
          description: 'Combined food and labor costs are too high',
          metric: 'Prime Cost %',
          value: `${avgPrimeCost.toFixed(1)}%`,
          recommendation: 'Immediate action needed. Review both food and labor costs. Target prime cost below 60%.',
          priority: 1,
        });
      } else if (avgPrimeCost < INDUSTRY_PRIME_COST - 5) {
        insights.push({
          type: 'success',
          title: 'Strong Prime Cost Control',
          description: 'Your prime cost is well-managed',
          metric: 'Prime Cost %',
          value: `${avgPrimeCost.toFixed(1)}%`,
          recommendation: 'Continue current operations. Strong financial health indicator.',
          priority: 3,
        });
      }

      // Revenue trend insights
      if (comparison.change.revenue_pct > 10) {
        insights.push({
          type: 'success',
          title: 'Strong Revenue Growth',
          description: 'Revenue is up significantly vs previous period',
          metric: 'Revenue Change',
          value: `+${comparison.change.revenue_pct.toFixed(1)}%`,
          recommendation: 'Monitor capacity and ensure quality standards are maintained during growth.',
          priority: 3,
        });
      } else if (comparison.change.revenue_pct < -10) {
        insights.push({
          type: 'warning',
          title: 'Revenue Decline',
          description: 'Revenue has dropped compared to previous period',
          metric: 'Revenue Change',
          value: `${comparison.change.revenue_pct.toFixed(1)}%`,
          recommendation: 'Investigate causes. Consider marketing initiatives, menu updates, or operational improvements.',
          priority: 2,
        });
      }

      // Day of week insights
      const highestRevenueDay = dayOfWeekPatterns.reduce((max, day) => 
        day.avg_revenue > max.avg_revenue ? day : max, dayOfWeekPatterns[0]
      );
      const lowestRevenueDay = dayOfWeekPatterns.reduce((min, day) => 
        day.avg_revenue < min.avg_revenue ? day : min, dayOfWeekPatterns[0]
      );

      if (highestRevenueDay.avg_revenue > lowestRevenueDay.avg_revenue * 2) {
        insights.push({
          type: 'info',
          title: 'Significant Day-of-Week Variation',
          description: `${highestRevenueDay.day} generates 2x more revenue than ${lowestRevenueDay.day}`,
          metric: 'Revenue Variance',
          value: `${((highestRevenueDay.avg_revenue / lowestRevenueDay.avg_revenue) * 100).toFixed(0)}%`,
          recommendation: 'Optimize staffing and inventory for peak days. Consider promotions on slower days.',
          priority: 2,
        });
      }

      // Sort insights by priority
      insights.sort((a, b) => a.priority - b.priority);

      // Simple forecast (moving average)
      const forecast: PnLForecast[] = [];
      const recentRevenue = dailyData.slice(-7);
      const avgDailyRevenue = recentRevenue.reduce((sum, d) => sum + d.net_revenue, 0) / recentRevenue.length;
      
      for (let i = 1; i <= 7; i++) {
        const forecastDate = new Date(endDate);
        forecastDate.setDate(forecastDate.getDate() + i);
        const dayOfWeek = format(forecastDate, 'EEEE');
        const dayPattern = dayOfWeekPatterns.find(p => p.day === dayOfWeek);
        
        forecast.push({
          date: format(forecastDate, 'yyyy-MM-dd'),
          predicted_revenue: dayPattern ? dayPattern.avg_revenue : avgDailyRevenue,
          confidence_level: dailyData.length >= 14 ? 'high' : dailyData.length >= 7 ? 'medium' : 'low',
        });
      }

      // Calculate efficiency metrics
      const revenuePerLaborDollar = currentTotals.labor_cost > 0 
        ? currentTotals.revenue / currentTotals.labor_cost 
        : 0;

      // Cost control score (0-100, higher is better)
      const foodCostScore = Math.max(0, 100 - Math.abs(avgFoodCost - INDUSTRY_FOOD_COST) * 2);
      const laborCostScore = Math.max(0, 100 - Math.abs(avgLaborCost - INDUSTRY_LABOR_COST) * 2);
      const costControlScore = (foodCostScore + laborCostScore) / 2;

      // Margin trend
      let marginTrend: 'improving' | 'stable' | 'declining' = 'stable';
      if (dailyData.length >= 14) {
        const firstHalf = dailyData.slice(0, Math.floor(dailyData.length / 2));
        const secondHalf = dailyData.slice(Math.floor(dailyData.length / 2));
        const firstHalfMargin = firstHalf.reduce((sum, d) => sum + (d.net_revenue - d.food_cost - d.labor_cost), 0) / firstHalf.length;
        const secondHalfMargin = secondHalf.reduce((sum, d) => sum + (d.net_revenue - d.food_cost - d.labor_cost), 0) / secondHalf.length;
        
        if (secondHalfMargin > firstHalfMargin * 1.1) marginTrend = 'improving';
        else if (secondHalfMargin < firstHalfMargin * 0.9) marginTrend = 'declining';
      }

      setData({
        dailyData,
        comparison,
        dayOfWeekPatterns,
        insights,
        forecast,
        benchmarks: {
          industry_avg_food_cost: INDUSTRY_FOOD_COST,
          industry_avg_labor_cost: INDUSTRY_LABOR_COST,
          industry_avg_prime_cost: INDUSTRY_PRIME_COST,
          your_avg_food_cost: avgFoodCost,
          your_avg_labor_cost: avgLaborCost,
          your_avg_prime_cost: avgPrimeCost,
        },
        efficiency: {
          revenue_per_labor_dollar: revenuePerLaborDollar,
          cost_control_score: costControlScore,
          margin_trend: marginTrend,
        },
      });

    } catch (error: any) {
      console.error('Error fetching P&L analytics:', error);
      toast({
        title: 'Error loading P&L analytics',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return {
    data,
    loading,
    refetch: fetchPnLAnalytics,
  };
}
