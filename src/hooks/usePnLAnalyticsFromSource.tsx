import { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { format, subDays } from 'date-fns';
import { useCostsFromSource } from './useCostsFromSource';
import { useRevenueBreakdown } from './useRevenueBreakdown';

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

/**
 * PnL Analytics hook that uses source tables instead of daily_pnl.
 * Queries unified_sales for revenue and source tables for costs.
 * 
 * @param restaurantId - Restaurant ID
 * @param options - Date range options
 * @returns PnL analytics data with insights and forecasts
 */
export function usePnLAnalyticsFromSource(
  restaurantId: string | null, 
  options: { days?: number; dateFrom?: Date; dateTo?: Date } = { days: 30 }
) {
  const [data, setData] = useState<PnLAnalytics | null>(null);
  const { toast } = useToast();

  const { days = 30, dateFrom, dateTo } = options;

  // Use provided dates or calculate from days
  const endDate = dateTo || new Date();
  const startDate = dateFrom || subDays(endDate, days);
  
  // Normalize date range: swap if startDate > endDate
  const normalizedStartDate = startDate > endDate ? endDate : startDate;
  const normalizedEndDate = startDate > endDate ? startDate : endDate;
  
  const rawPeriodDays = Math.ceil((normalizedEndDate.getTime() - normalizedStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const periodDays = Math.max(1, rawPeriodDays);
  const previousPeriodStart = subDays(normalizedStartDate, periodDays);
  const previousPeriodEnd = subDays(normalizedStartDate, 1);

  // Fetch current period data
  const { data: currentRevenue, isLoading: currentRevenueLoading } = useRevenueBreakdown(
    restaurantId,
    normalizedStartDate,
    normalizedEndDate
  );
  
  const { dailyCosts: currentCosts, isLoading: currentCostsLoading } = useCostsFromSource(
    restaurantId,
    normalizedStartDate,
    normalizedEndDate
  );

  // Fetch previous period data
  const { data: previousRevenue, isLoading: previousRevenueLoading } = useRevenueBreakdown(
    restaurantId,
    previousPeriodStart,
    previousPeriodEnd
  );
  
  const { totalFoodCost: prevFoodCost, totalLaborCost: prevLaborCost, isLoading: previousCostsLoading } = useCostsFromSource(
    restaurantId,
    previousPeriodStart,
    previousPeriodEnd
  );

  const loading = currentRevenueLoading || currentCostsLoading || previousRevenueLoading || previousCostsLoading;

  useEffect(() => {
    if (loading || !currentRevenue || !currentCosts) {
      return;
    }

    try {
      // Build daily data map combining revenue and costs
      const dailyMap = new Map<string, DailyPnLData>();
      
      // Add cost data
      currentCosts.forEach((cost) => {
        const date = new Date(cost.date);
        const dayOfWeek = format(date, 'EEEE');
        
        dailyMap.set(cost.date, {
          date: cost.date,
          net_revenue: 0,
          food_cost: cost.food_cost,
          labor_cost: cost.labor_cost,
          prime_cost: cost.food_cost + cost.labor_cost,
          food_cost_percentage: 0,
          labor_cost_percentage: 0,
          prime_cost_percentage: 0,
          gross_profit: 0,
          day_of_week: dayOfWeek,
        });
      });

      // Note: currentRevenue gives us totals, not daily breakdown
      // For a full implementation, we'd need to query unified_sales grouped by date
      // For now, we'll distribute revenue evenly across days (simplified)
      const totalRevenue = currentRevenue.totals.net_revenue;
      const daysWithCosts = dailyMap.size;
      const avgDailyRevenue = daysWithCosts > 0 ? totalRevenue / daysWithCosts : 0;

      // Update daily data with revenue
      dailyMap.forEach((day) => {
        day.net_revenue = avgDailyRevenue;
        day.food_cost_percentage = day.net_revenue > 0 ? (day.food_cost / day.net_revenue) * 100 : 0;
        day.labor_cost_percentage = day.net_revenue > 0 ? (day.labor_cost / day.net_revenue) * 100 : 0;
        day.prime_cost_percentage = day.net_revenue > 0 ? (day.prime_cost / day.net_revenue) * 100 : 0;
        day.gross_profit = day.net_revenue - day.prime_cost;
      });

      const dailyData = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      // Calculate comparison
      const currentTotals = {
        revenue: totalRevenue,
        food_cost: currentCosts.reduce((sum, c) => sum + c.food_cost, 0),
        labor_cost: currentCosts.reduce((sum, c) => sum + c.labor_cost, 0),
        prime_cost: currentCosts.reduce((sum, c) => sum + c.total_cost, 0),
      };

      const previousTotals = {
        revenue: previousRevenue?.totals.net_revenue || 0,
        food_cost: prevFoodCost,
        labor_cost: prevLaborCost,
        prime_cost: prevFoodCost + prevLaborCost,
      };

      const comparison: PnLComparison = {
        current_period: {
          revenue: currentTotals.revenue,
          food_cost: currentTotals.food_cost,
          labor_cost: currentTotals.labor_cost,
          prime_cost: currentTotals.prime_cost,
          avg_food_cost_pct: currentTotals.revenue > 0 ? (currentTotals.food_cost / currentTotals.revenue) * 100 : 0,
          avg_labor_cost_pct: currentTotals.revenue > 0 ? (currentTotals.labor_cost / currentTotals.revenue) * 100 : 0,
          avg_prime_cost_pct: currentTotals.revenue > 0 ? (currentTotals.prime_cost / currentTotals.revenue) * 100 : 0,
        },
        previous_period: {
          revenue: previousTotals.revenue,
          food_cost: previousTotals.food_cost,
          labor_cost: previousTotals.labor_cost,
          prime_cost: previousTotals.prime_cost,
          avg_food_cost_pct: previousTotals.revenue > 0 ? (previousTotals.food_cost / previousTotals.revenue) * 100 : 0,
          avg_labor_cost_pct: previousTotals.revenue > 0 ? (previousTotals.labor_cost / previousTotals.revenue) * 100 : 0,
          avg_prime_cost_pct: previousTotals.revenue > 0 ? (previousTotals.prime_cost / previousTotals.revenue) * 100 : 0,
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

      // Calculate day of week patterns
      const dayPatterns = new Map<string, { revenue: number; food_cost: number; labor_cost: number; count: number }>();
      
      dailyData.forEach((day) => {
        const existing = dayPatterns.get(day.day_of_week) || { revenue: 0, food_cost: 0, labor_cost: 0, count: 0 };
        dayPatterns.set(day.day_of_week, {
          revenue: existing.revenue + day.net_revenue,
          food_cost: existing.food_cost + day.food_cost,
          labor_cost: existing.labor_cost + day.labor_cost,
          count: existing.count + 1,
        });
      });

      const dayOfWeekPatterns: DayOfWeekPattern[] = Array.from(dayPatterns.entries()).map(([day, totals]) => ({
        day,
        avg_revenue: totals.count > 0 ? totals.revenue / totals.count : 0,
        avg_food_cost_pct: totals.revenue > 0 ? (totals.food_cost / totals.revenue) * 100 : 0,
        avg_labor_cost_pct: totals.revenue > 0 ? (totals.labor_cost / totals.revenue) * 100 : 0,
        transactions: totals.count,
      }));

      // Generate insights
      const insights = generateInsights(comparison, dailyData);

      // Simple forecast (placeholder - would need more sophisticated logic)
      const forecast: PnLForecast[] = [];

      // Calculate benchmarks
      const benchmarks = {
        industry_avg_food_cost: 30,
        industry_avg_labor_cost: 30,
        industry_avg_prime_cost: 60,
        your_avg_food_cost: comparison.current_period.avg_food_cost_pct,
        your_avg_labor_cost: comparison.current_period.avg_labor_cost_pct,
        your_avg_prime_cost: comparison.current_period.avg_prime_cost_pct,
      };

      // Calculate efficiency metrics
      const revenue_per_labor_dollar = currentTotals.labor_cost > 0 
        ? currentTotals.revenue / currentTotals.labor_cost 
        : 0;
      
      const cost_control_score = Math.max(0, Math.min(100, 
        100 - ((comparison.current_period.avg_prime_cost_pct - 60) * 2)
      ));

      const margin_trend: 'improving' | 'stable' | 'declining' = 
        comparison.current_period.avg_prime_cost_pct < comparison.previous_period.avg_prime_cost_pct - 2 ? 'improving' :
        comparison.current_period.avg_prime_cost_pct > comparison.previous_period.avg_prime_cost_pct + 2 ? 'declining' :
        'stable';

      const efficiency = {
        revenue_per_labor_dollar,
        cost_control_score,
        margin_trend,
      };

      setData({
        dailyData,
        comparison,
        dayOfWeekPatterns,
        insights,
        forecast,
        benchmarks,
        efficiency,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({
        title: "Error calculating P&L analytics",
        description: errorMessage,
        variant: "destructive",
      });
    }
  }, [loading, currentRevenue, currentCosts, previousRevenue, prevFoodCost, prevLaborCost, toast]);

  return { data, loading };
}

function generateInsights(comparison: PnLComparison, dailyData: DailyPnLData[]): PnLInsight[] {
  const insights: PnLInsight[] = [];

  // Food cost insight
  if (comparison.current_period.avg_food_cost_pct > 35) {
    insights.push({
      type: 'critical',
      title: 'High Food Cost',
      description: 'Your food cost percentage is significantly above the industry average.',
      metric: 'Food Cost %',
      value: `${comparison.current_period.avg_food_cost_pct.toFixed(1)}%`,
      recommendation: 'Review vendor pricing, reduce waste, and optimize portion sizes.',
      priority: 1,
    });
  } else if (comparison.current_period.avg_food_cost_pct > 30) {
    insights.push({
      type: 'warning',
      title: 'Food Cost Above Target',
      description: 'Food cost is slightly above the 30% target.',
      metric: 'Food Cost %',
      value: `${comparison.current_period.avg_food_cost_pct.toFixed(1)}%`,
      recommendation: 'Monitor ingredient costs and track waste more closely.',
      priority: 2,
    });
  }

  // Labor cost insight
  if (comparison.current_period.avg_labor_cost_pct > 35) {
    insights.push({
      type: 'critical',
      title: 'High Labor Cost',
      description: 'Labor costs are consuming too much of your revenue.',
      metric: 'Labor Cost %',
      value: `${comparison.current_period.avg_labor_cost_pct.toFixed(1)}%`,
      recommendation: 'Optimize staff scheduling and review overtime policies.',
      priority: 1,
    });
  }

  // Prime cost insight
  if (comparison.current_period.avg_prime_cost_pct < 60) {
    insights.push({
      type: 'success',
      title: 'Excellent Cost Control',
      description: 'Your prime cost is below the 60% target.',
      metric: 'Prime Cost %',
      value: `${comparison.current_period.avg_prime_cost_pct.toFixed(1)}%`,
      recommendation: 'Continue current cost management practices.',
      priority: 3,
    });
  } else if (comparison.current_period.avg_prime_cost_pct > 65) {
    insights.push({
      type: 'critical',
      title: 'Prime Cost Too High',
      description: 'Combined food and labor costs are eating into your profits.',
      metric: 'Prime Cost %',
      value: `${comparison.current_period.avg_prime_cost_pct.toFixed(1)}%`,
      recommendation: 'Address both food and labor costs immediately.',
      priority: 1,
    });
  }

  // Revenue trend insight
  if (comparison.change.revenue_pct > 10) {
    insights.push({
      type: 'success',
      title: 'Strong Revenue Growth',
      description: `Revenue increased by ${comparison.change.revenue_pct.toFixed(1)}% vs previous period.`,
      metric: 'Revenue Growth',
      value: `+${comparison.change.revenue_pct.toFixed(1)}%`,
      recommendation: 'Analyze what drove this growth and replicate successful strategies.',
      priority: 2,
    });
  } else if (comparison.change.revenue_pct < -10) {
    insights.push({
      type: 'warning',
      title: 'Revenue Decline',
      description: `Revenue decreased by ${Math.abs(comparison.change.revenue_pct).toFixed(1)}% vs previous period.`,
      metric: 'Revenue Change',
      value: `${comparison.change.revenue_pct.toFixed(1)}%`,
      recommendation: 'Review marketing efforts and customer feedback to identify issues.',
      priority: 1,
    });
  }

  return insights.sort((a, b) => a.priority - b.priority);
}
