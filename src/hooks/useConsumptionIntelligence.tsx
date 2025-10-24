import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format, subDays, startOfDay, endOfDay, differenceInDays } from 'date-fns';

export interface ConsumptionTrend {
  date: string;
  ingredient_name: string;
  quantity_used: number;
  cost: number;
  transaction_count: number;
}

export interface IngredientPattern {
  ingredient_name: string;
  category: string;
  avg_daily_usage: number;
  total_usage: number;
  total_cost: number;
  usage_variance: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  waste_percentage: number;
  efficiency_score: number;
  peak_day: string;
  low_day: string;
}

export interface SeasonalPattern {
  day_of_week: string;
  avg_usage: number;
  avg_cost: number;
  transaction_count: number;
}

export interface ConsumptionInsight {
  id: string;
  type: 'critical' | 'warning' | 'success' | 'info';
  title: string;
  description: string;
  affected_items: string[];
  estimated_impact: number;
  recommendation: string;
  priority: number;
}

export interface ConsumptionBenchmark {
  metric: string;
  current_value: number;
  target_value: number;
  performance: 'above' | 'below' | 'at';
  gap: number;
}

export interface ConsumptionIntelligenceData {
  summary: {
    total_consumption_cost: number;
    total_items_tracked: number;
    avg_daily_cost: number;
    waste_percentage: number;
    efficiency_score: number;
    top_cost_drivers: string[];
    trend_direction: 'up' | 'down' | 'stable';
  };
  daily_trends: ConsumptionTrend[];
  ingredient_patterns: IngredientPattern[];
  seasonal_patterns: SeasonalPattern[];
  insights: ConsumptionInsight[];
  benchmarks: ConsumptionBenchmark[];
  predictions: {
    next_week_cost: number;
    next_week_usage: number;
    confidence: number;
    high_risk_items: string[];
  };
}

async function fetchConsumptionIntelligence(
  restaurantId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<ConsumptionIntelligenceData> {
  // Use provided dates or default to 30/60 days
  const endDate = dateTo || new Date();
  const startDate = dateFrom || subDays(endDate, 30);
  const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const previousPeriodStart = subDays(startDate, periodDays);

  const thirtyDaysAgo = format(startDate, 'yyyy-MM-dd');
  const sixtyDaysAgo = format(previousPeriodStart, 'yyyy-MM-dd');

  // Fetch current period transactions
  const { data: currentTransactions, error: currentError } = await supabase
    .from('inventory_transactions')
    .select(`
      created_at,
      quantity,
      total_cost,
      transaction_type,
      reason,
      product:products(name, category, cost_per_unit, uom_purchase)
    `)
    .eq('restaurant_id', restaurantId)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())
    .in('transaction_type', ['usage', 'waste', 'transfer']);

  if (currentError) throw currentError;

  // Fetch previous period for comparison
  const { data: previousTransactions, error: previousError } = await supabase
    .from('inventory_transactions')
    .select('total_cost, quantity, created_at, product:products(name)')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', previousPeriodStart.toISOString())
    .lt('created_at', startDate.toISOString())
    .in('transaction_type', ['usage', 'waste', 'transfer']);

  if (previousError) throw previousError;

  // Process daily trends
  const dailyTrendsMap = new Map<string, Map<string, ConsumptionTrend>>();
  
  currentTransactions?.forEach(t => {
    const date = format(new Date(t.created_at), 'yyyy-MM-dd');
    const name = t.product?.name || 'Unknown';
    
    if (!dailyTrendsMap.has(date)) {
      dailyTrendsMap.set(date, new Map());
    }
    
    const dayMap = dailyTrendsMap.get(date)!;
    if (!dayMap.has(name)) {
      dayMap.set(name, {
        date,
        ingredient_name: name,
        quantity_used: 0,
        cost: 0,
        transaction_count: 0
      });
    }
    
    const trend = dayMap.get(name)!;
    trend.quantity_used += Math.abs(t.quantity || 0);
    trend.cost += Math.abs(t.total_cost || 0);
    trend.transaction_count++;
  });

  const dailyTrends: ConsumptionTrend[] = [];
  dailyTrendsMap.forEach(dayMap => {
    dayMap.forEach(trend => dailyTrends.push(trend));
  });

  // Process ingredient patterns
  const ingredientMap = new Map<string, {
    usage: number[];
    costs: number[];
    waste: number;
    category: string;
    dates: string[];
  }>();

  currentTransactions?.forEach(t => {
    const name = t.product?.name || 'Unknown';
    const date = format(new Date(t.created_at), 'yyyy-MM-dd');
    
    if (!ingredientMap.has(name)) {
      ingredientMap.set(name, {
        usage: [],
        costs: [],
        waste: 0,
        category: t.product?.category || 'Other',
        dates: []
      });
    }
    
    const item = ingredientMap.get(name)!;
    const qty = Math.abs(t.quantity || 0);
    const cost = Math.abs(t.total_cost || 0);
    
    item.usage.push(qty);
    item.costs.push(cost);
    item.dates.push(date);
    
    if (t.transaction_type === 'waste') {
      item.waste += cost;
    }
  });

  const ingredientPatterns: IngredientPattern[] = [];
  ingredientMap.forEach((data, name) => {
    const totalUsage = data.usage.reduce((sum, u) => sum + u, 0);
    const totalCost = data.costs.length > 0 ? data.costs.reduce((sum, c) => sum + c, 0) : 0;
    const avgDailyUsage = totalUsage / periodDays;
    
    // Calculate variance
    const mean = avgDailyUsage;
    const variance = data.usage.length > 0 
      ? data.usage.reduce((sum, u) => sum + Math.pow(u - mean, 2), 0) / data.usage.length 
      : 0;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? (stdDev / mean) * 100 : 0;
    
    // Determine trend
    const firstHalf = data.costs.slice(0, Math.floor(data.costs.length / 2));
    const secondHalf = data.costs.slice(Math.floor(data.costs.length / 2));
    const firstAvg = firstHalf.length > 0 
      ? firstHalf.reduce((sum, c) => sum + c, 0) / firstHalf.length 
      : 0;
    const secondAvg = secondHalf.length > 0 
      ? secondHalf.reduce((sum, c) => sum + c, 0) / secondHalf.length 
      : 0;
    
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (secondAvg > firstAvg * 1.1) trend = 'increasing';
    else if (secondAvg < firstAvg * 0.9) trend = 'decreasing';
    
    // Find peak and low days
    const usageByDate = new Map<string, number>();
    data.dates.forEach((date, i) => {
      usageByDate.set(date, (usageByDate.get(date) || 0) + data.usage[i]);
    });
    
    let peakDay = '';
    let lowDay = '';
    let maxUsage = 0;
    let minUsage = Infinity;
    
    usageByDate.forEach((usage, date) => {
      if (usage > maxUsage) {
        maxUsage = usage;
        peakDay = date;
      }
      if (usage < minUsage) {
        minUsage = usage;
        lowDay = date;
      }
    });
    
    const wastePercentage = totalCost > 0 ? (data.waste / totalCost) * 100 : 0;
    
    // Calculate efficiency score (0-100)
    const wasteScore = Math.max(0, 40 - wastePercentage);
    const varianceScore = Math.max(0, 30 - (coefficientOfVariation / 2));
    const trendScore = trend === 'stable' ? 30 : trend === 'decreasing' ? 20 : 10;
    const efficiencyScore = wasteScore + varianceScore + trendScore;
    
    ingredientPatterns.push({
      ingredient_name: name,
      category: data.category,
      avg_daily_usage: avgDailyUsage,
      total_usage: totalUsage,
      total_cost: totalCost,
      usage_variance: coefficientOfVariation,
      trend,
      waste_percentage: wastePercentage,
      efficiency_score: efficiencyScore,
      peak_day: peakDay,
      low_day: lowDay
    });
  });

  // Process seasonal patterns (day of week)
  const dayOfWeekMap = new Map<string, { usage: number; cost: number; count: number }>();
  
  currentTransactions?.forEach(t => {
    const date = new Date(t.created_at);
    const dayOfWeek = format(date, 'EEEE');
    
    if (!dayOfWeekMap.has(dayOfWeek)) {
      dayOfWeekMap.set(dayOfWeek, { usage: 0, cost: 0, count: 0 });
    }
    
    const day = dayOfWeekMap.get(dayOfWeek)!;
    day.usage += Math.abs(t.quantity || 0);
    day.cost += Math.abs(t.total_cost || 0);
    day.count++;
  });

  const seasonalPatterns: SeasonalPattern[] = [];
  const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  daysOrder.forEach(day => {
    const data = dayOfWeekMap.get(day) || { usage: 0, cost: 0, count: 0 };
    const weeks = Math.max(1, Math.floor(periodDays / 7)); // Calculate weeks in period
    seasonalPatterns.push({
      day_of_week: day,
      avg_usage: data.usage / weeks,
      avg_cost: data.cost / weeks,
      transaction_count: data.count
    });
  });

  // Generate insights
  const insights: ConsumptionInsight[] = [];
  let insightId = 1;

  const highWasteItems = ingredientPatterns.filter(i => i.waste_percentage > 10);
  if (highWasteItems.length > 0) {
    insights.push({
      id: `insight-${insightId++}`,
      type: 'critical',
      title: 'High Waste Detected',
      description: `${highWasteItems.length} ingredients have waste levels exceeding 10% of total usage.`,
      affected_items: highWasteItems.map(i => i.ingredient_name),
      estimated_impact: highWasteItems.reduce((sum, i) => sum + (i.total_cost * (i.waste_percentage / 100)), 0),
      recommendation: 'Review portion sizes, storage conditions, and ordering frequencies. Implement FIFO (First In, First Out) system and consider reducing order quantities for high-waste items.',
      priority: 1
    });
  }

  const volatileItems = ingredientPatterns.filter(i => i.usage_variance > 50);
  if (volatileItems.length > 0) {
    insights.push({
      id: `insight-${insightId++}`,
      type: 'warning',
      title: 'Inconsistent Usage Patterns',
      description: `${volatileItems.length} ingredients show high usage variability (>50% variance).`,
      affected_items: volatileItems.map(i => i.ingredient_name),
      estimated_impact: volatileItems.reduce((sum, i) => sum + i.total_cost, 0) * 0.15,
      recommendation: 'Standardize recipes, train staff on proper portioning, and implement recipe cards. High variance indicates lack of consistency which leads to unpredictable costs.',
      priority: 2
    });
  }

  const efficientItems = ingredientPatterns.filter(i => i.efficiency_score > 80);
  if (efficientItems.length > 0) {
    insights.push({
      id: `insight-${insightId++}`,
      type: 'success',
      title: 'Optimal Ingredient Management',
      description: `${efficientItems.length} ingredients are being managed with excellent efficiency.`,
      affected_items: efficientItems.map(i => i.ingredient_name),
      estimated_impact: 0,
      recommendation: 'Document and replicate the practices used for these items across other ingredients. Use these as benchmarks for staff training.',
      priority: 3
    });
  }

  const increasingTrend = ingredientPatterns.filter(i => i.trend === 'increasing' && i.total_cost > 100);
  if (increasingTrend.length > 0) {
    insights.push({
      id: `insight-${insightId++}`,
      type: 'warning',
      title: 'Rising Consumption Costs',
      description: `${increasingTrend.length} high-value ingredients showing increasing consumption trend.`,
      affected_items: increasingTrend.map(i => i.ingredient_name),
      estimated_impact: increasingTrend.reduce((sum, i) => sum + i.total_cost, 0) * 0.2,
      recommendation: 'Review menu pricing, negotiate with suppliers, or find alternative ingredients. Rising costs without corresponding revenue increase will erode margins.',
      priority: 2
    });
  }

  // Calculate benchmarks with safe division
  const totalCost = ingredientPatterns.reduce((sum, i) => sum + i.total_cost, 0);
  const avgWaste = ingredientPatterns.length 
    ? ingredientPatterns.reduce((sum, i) => sum + i.waste_percentage, 0) / ingredientPatterns.length 
    : 0;
  const avgEfficiency = ingredientPatterns.length 
    ? ingredientPatterns.reduce((sum, i) => sum + i.efficiency_score, 0) / ingredientPatterns.length 
    : 0;
  const avgVariance = ingredientPatterns.length 
    ? ingredientPatterns.reduce((sum, i) => sum + i.usage_variance, 0) / ingredientPatterns.length 
    : 0;

  const previousCost = previousTransactions?.reduce((sum, t) => sum + Math.abs(t.total_cost || 0), 0) || 0;
  const costChange = previousCost > 0 ? ((totalCost - previousCost) / previousCost) * 100 : 0;

  const benchmarks: ConsumptionBenchmark[] = [
    {
      metric: 'Waste Percentage',
      current_value: avgWaste,
      target_value: 5,
      performance: avgWaste <= 5 ? 'above' : avgWaste <= 8 ? 'at' : 'below',
      gap: 5 - avgWaste
    },
    {
      metric: 'Usage Consistency',
      current_value: 100 - avgVariance,
      target_value: 80,
      performance: avgVariance <= 20 ? 'above' : avgVariance <= 30 ? 'at' : 'below',
      gap: (100 - avgVariance) - 80
    },
    {
      metric: 'Efficiency Score',
      current_value: avgEfficiency,
      target_value: 75,
      performance: avgEfficiency >= 75 ? 'above' : avgEfficiency >= 65 ? 'at' : 'below',
      gap: avgEfficiency - 75
    },
    {
      metric: 'Cost Control',
      current_value: Math.abs(costChange),
      target_value: 5,
      performance: Math.abs(costChange) <= 5 ? 'above' : Math.abs(costChange) <= 10 ? 'at' : 'below',
      gap: 5 - Math.abs(costChange)
    }
  ];

  // Generate predictions
  const recentWeekCost = currentTransactions
    ?.filter(t => new Date(t.created_at) >= subDays(endDate, 7))
    .reduce((sum, t) => sum + Math.abs(t.total_cost || 0), 0) || 0;

  const recentWeekUsage = currentTransactions
    ?.filter(t => new Date(t.created_at) >= subDays(endDate, 7))
    .reduce((sum, t) => sum + Math.abs(t.quantity || 0), 0) || 0;

  const trendMultiplier = costChange > 0 ? 1 + (costChange / 100) : 1;

  const predictions = {
    next_week_cost: recentWeekCost * trendMultiplier,
    next_week_usage: recentWeekUsage * trendMultiplier,
    confidence: Math.max(0.6, Math.min(0.95, 0.8 - (avgVariance / 200))),
    high_risk_items: ingredientPatterns
      .filter(i => i.trend === 'increasing' && i.waste_percentage > 8)
      .sort((a, b) => b.total_cost - a.total_cost)
      .slice(0, 5)
      .map(i => i.ingredient_name)
  };

  // Calculate summary
  const topCostDrivers = [...ingredientPatterns]
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 5)
    .map(i => i.ingredient_name);

  const summary = {
    total_consumption_cost: totalCost,
    total_items_tracked: ingredientPatterns.length,
    avg_daily_cost: ingredientPatterns.length ? totalCost / periodDays : 0,
    waste_percentage: avgWaste,
    efficiency_score: avgEfficiency,
    top_cost_drivers: topCostDrivers,
    trend_direction: (costChange > 5 ? 'up' : costChange < -5 ? 'down' : 'stable') as 'up' | 'down' | 'stable'
  };

  return {
    summary,
    daily_trends: dailyTrends.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 100),
    ingredient_patterns: ingredientPatterns.sort((a, b) => b.total_cost - a.total_cost),
    seasonal_patterns: seasonalPatterns,
    insights: insights.sort((a, b) => a.priority - b.priority),
    benchmarks,
    predictions
  };
}

export const useConsumptionIntelligence = (
  restaurantId: string | null,
  dateFrom?: Date,
  dateTo?: Date
) => {
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['consumptionIntelligence', restaurantId, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async () => {
      if (!restaurantId || !dateFrom || !dateTo) {
        throw new Error('Missing required parameters');
      }
      return fetchConsumptionIntelligence(restaurantId, dateFrom, dateTo);
    },
    enabled: !!restaurantId && !!dateFrom && !!dateTo,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Show toast on error
  useEffect(() => {
    if (query.error) {
      toast({
        title: "Error loading consumption intelligence",
        description: (query.error as Error).message,
        variant: "destructive",
      });
    }
  }, [query.error, toast]);

  return {
    data: query.data ?? null,
    loading: query.isLoading || query.isFetching,
    refetch: query.refetch,
    error: query.error,
    status: query.status,
    isFetching: query.isFetching
  };
};
