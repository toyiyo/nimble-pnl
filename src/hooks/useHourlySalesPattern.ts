import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import type { HourlySalesData } from '@/types/scheduling';

interface RawSale {
  sale_date: string;
  sale_time: string | null;
  total_price: number;
}

/**
 * Pure function: aggregate raw sales into hourly averages.
 * Groups by hour, sums per day (sale_date), then averages across days.
 * Exported for testing.
 */
export function aggregateHourlySales(rawSales: RawSale[]): HourlySalesData[] {
  if (rawSales.length === 0) return [];

  // Group by hour → by date → sum
  const hourDateMap = new Map<number, Map<string, number>>();

  for (const sale of rawSales) {
    if (!sale.sale_time) continue;
    const hour = parseInt(sale.sale_time.split(':')[0], 10);
    if (isNaN(hour)) continue;

    if (!hourDateMap.has(hour)) hourDateMap.set(hour, new Map());
    const dateMap = hourDateMap.get(hour)!;
    dateMap.set(sale.sale_date, (dateMap.get(sale.sale_date) ?? 0) + Number(sale.total_price));
  }

  const result: HourlySalesData[] = [];
  for (const [hour, dateMap] of hourDateMap) {
    const dailyTotals = Array.from(dateMap.values());
    const avgSales = dailyTotals.reduce((sum, v) => sum + v, 0) / dailyTotals.length;
    result.push({
      hour,
      avgSales: Math.round(avgSales * 100) / 100,
      sampleCount: dailyTotals.length,
    });
  }

  return result.sort((a, b) => a.hour - b.hour);
}

/**
 * Fetches unified_sales for a specific day-of-week over the last N weeks,
 * then aggregates into hourly averages.
 */
export function useHourlySalesPattern(
  restaurantId: string | null,
  dayOfWeek: number,
  lookbackWeeks: number = 4,
) {
  return useQuery({
    queryKey: ['hourly-sales-pattern', restaurantId, dayOfWeek, lookbackWeeks],
    queryFn: async (): Promise<HourlySalesData[]> => {
      if (!restaurantId) return [];

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - lookbackWeeks * 7);

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('unified_sales')
        .select('sale_date, sale_time, total_price')
        .eq('restaurant_id', restaurantId)
        .eq('item_type', 'sale')
        .gte('sale_date', startStr)
        .lte('sale_date', endStr)
        .not('sale_time', 'is', null)
        .order('sale_date');

      if (error) throw error;
      if (!data) return [];

      // Filter to matching day-of-week client-side
      const filtered = data.filter((sale) => {
        const d = new Date(sale.sale_date + 'T12:00:00');
        return d.getDay() === dayOfWeek;
      });

      return aggregateHourlySales(filtered);
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}
