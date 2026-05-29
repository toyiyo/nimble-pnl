import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import type { HourlySalesData } from '@/types/scheduling';

interface RawSale {
  sale_date: string;
  sale_time: string | null;
  /** Absolute instant the sale was served (UTC ISO string). When present, takes
   *  priority over sale_time for hour-of-day derivation (converted via timeZone). */
  sold_at?: string | null;
  total_price: number;
}

// Default business hours for daily-sales fallback when no sale_time data exists
const DEFAULT_OPEN_HOUR = 9;
const DEFAULT_CLOSE_HOUR = 22; // 10pm

export interface AggregatedSalesResult {
  data: HourlySalesData[];
  /** True when we have actual per-hour timestamps, false when using daily spread */
  hasHourlyBreakdown: boolean;
}

/**
 * Convert a UTC ISO string to the local hour (0–23) in the given IANA timezone.
 * Uses Intl.DateTimeFormat with hourCycle:'h23' so midnight = 0 (not 24).
 */
function hourInTz(iso: string, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
  return parseInt(s, 10);
}

/**
 * Pure function: aggregate raw sales into hourly averages.
 * Groups by hour, sums per day (sale_date), then averages across days.
 *
 * Hour derivation (in priority order):
 *  1. `sold_at` (UTC ISO) converted to the given `timeZone` — e.g. Toast openedDate.
 *  2. `sale_time` parsed as already-local HH:MM:SS — legacy / non-Toast path.
 *
 * When no rows yield a usable hour, falls back to spreading daily totals
 * evenly across assumed business hours (9am–10pm).
 *
 * `timeZone` defaults to 'America/Chicago' so existing call-sites without
 * the argument are backward-compatible.
 *
 * Exported for testing.
 */
export function aggregateHourlySales(
  rawSales: RawSale[],
  timeZone: string = 'America/Chicago',
): AggregatedSalesResult {
  if (rawSales.length === 0) return { data: [], hasHourlyBreakdown: false };

  // Group by hour → by date → sum
  const hourDateMap = new Map<number, Map<string, number>>();

  for (const sale of rawSales) {
    let hour: number;
    if (sale.sold_at) {
      hour = hourInTz(sale.sold_at, timeZone);
    } else if (sale.sale_time) {
      hour = parseInt(sale.sale_time.split(':')[0], 10);
    } else {
      continue;
    }
    if (isNaN(hour)) continue;

    if (!hourDateMap.has(hour)) hourDateMap.set(hour, new Map());
    const dateMap = hourDateMap.get(hour)!;
    dateMap.set(sale.sale_date, (dateMap.get(sale.sale_date) ?? 0) + Number(sale.total_price));
  }

  // If we have hourly data, use it
  if (hourDateMap.size > 0) {
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
    return { data: result.sort((a, b) => a.hour - b.hour), hasHourlyBreakdown: true };
  }

  // Fallback: no sale_time data — spread daily totals across business hours
  const dailyTotals = new Map<string, number>();
  for (const sale of rawSales) {
    dailyTotals.set(sale.sale_date, (dailyTotals.get(sale.sale_date) ?? 0) + Number(sale.total_price));
  }

  const days = Array.from(dailyTotals.values());
  const avgDailySales = days.reduce((sum, v) => sum + v, 0) / days.length;
  const businessHours = DEFAULT_CLOSE_HOUR - DEFAULT_OPEN_HOUR;
  const avgPerHour = Math.round((avgDailySales / businessHours) * 100) / 100;

  const result: HourlySalesData[] = [];
  for (let hour = DEFAULT_OPEN_HOUR; hour < DEFAULT_CLOSE_HOUR; hour++) {
    result.push({ hour, avgSales: avgPerHour, sampleCount: days.length });
  }
  return { data: result, hasHourlyBreakdown: false };
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
        .select('sale_date, sale_time, sold_at, total_price')
        .eq('restaurant_id', restaurantId)
        .eq('item_type', 'sale')
        .gte('sale_date', startStr)
        .lte('sale_date', endStr)
        .order('sale_date');

      if (error) throw error;
      if (!data) return [];

      // Filter to matching day-of-week client-side
      const filtered = data.filter((sale) => {
        const d = new Date(sale.sale_date + 'T12:00:00');
        return d.getDay() === dayOfWeek;
      });

      return aggregateHourlySales(filtered).data;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}
