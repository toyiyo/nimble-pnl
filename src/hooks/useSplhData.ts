import { useQuery } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';

import { supabase } from '@/integrations/supabase/client';

import type { SplhSaleRow } from '@/lib/splhAnalytics';
import type { TimePunch } from '@/types/timeTracking';

const PAGE = 1000;
/** Hard cap on pages fetched per table (§11 S-min3) — avoids an unbounded
 * loop on runaway date ranges; surfaced to callers via `capped`. */
const MAX_PAGES = 20;

interface PagedResult<T> {
  rows: T[];
  capped: boolean;
}

export interface SplhDataResult {
  sales: SplhSaleRow[];
  punches: TimePunch[];
  /** True when either table hit MAX_PAGES — results may be truncated. */
  capped: boolean;
}

async function fetchAllSales(
  restaurantId: string,
  startStr: string,
  endStr: string,
): Promise<PagedResult<SplhSaleRow>> {
  const rows: SplhSaleRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from('unified_sales')
      .select('sale_date, sale_time, sold_at, total_price')
      .eq('restaurant_id', restaurantId)
      .eq('item_type', 'sale')
      .is('parent_sale_id', null)
      .gte('sale_date', startStr)
      .lte('sale_date', endStr)
      .order('sale_date')
      .order('created_at')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as SplhSaleRow[]));
    if (!data || data.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

async function fetchAllPunches(
  restaurantId: string,
  startStr: string,
  endStr: string,
  tz: string,
): Promise<PagedResult<TimePunch>> {
  // `punch_time` is TIMESTAMPTZ (unlike `sale_date`, which is a plain DATE
  // column): bare `YYYY-MM-DD` strings would be interpreted by
  // Postgres/PostgREST as UTC instants, not restaurant-local boundaries, for
  // any restaurant not in UTC (e.g. America/Chicago). Resolve the local
  // midnight-to-midnight window to explicit UTC instants via `tz` first.
  const startIso = fromZonedTime(`${startStr}T00:00:00`, tz).toISOString();
  const endIso = fromZonedTime(`${endStr}T23:59:59.999`, tz).toISOString();
  const rows: TimePunch[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from('time_punches')
      .select('id, restaurant_id, employee_id, punch_type, punch_time')
      .eq('restaurant_id', restaurantId)
      .gte('punch_time', startIso)
      .lte('punch_time', endIso)
      .order('employee_id')
      .order('punch_time')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as TimePunch[]));
    if (!data || data.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

/**
 * Window boundaries derived from the restaurant-local "today", not host/UTC
 * `new Date()` (§5 S-min1). `endStr` is today's date in `tz`; `startStr` is
 * `weeks` weeks earlier. Dates are formatted as plain YYYY-MM-DD (no time
 * component), matching `unified_sales.sale_date`'s column type.
 */
function localWindow(tz: string, weeks: number): { startStr: string; endStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const endStr = fmt.format(now); // YYYY-MM-DD in tz (en-CA locale formats this way)
  const [y, m, d] = endStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - weeks * 7);
  return { startStr: start.toISOString().slice(0, 10), endStr };
}

/**
 * Shared paginated fetch of `unified_sales` + `time_punches` for the SPLH
 * heatmap/timeline/summary. Internal building block for `useSplhAnalytics`
 * and `useSplhSummary` — callers are expected to have already validated
 * `tz` (e.g. via `validateTimeZone`).
 */
export function useSplhData(restaurantId: string | null, tz: string, weeks: number) {
  return useQuery({
    queryKey: ['splh-data', restaurantId, tz, weeks],
    queryFn: async (): Promise<SplhDataResult> => {
      const { startStr, endStr } = localWindow(tz, weeks);
      const [sales, punches] = await Promise.all([
        fetchAllSales(restaurantId!, startStr, endStr),
        fetchAllPunches(restaurantId!, startStr, endStr, tz),
      ]);
      return {
        sales: sales.rows,
        punches: punches.rows,
        capped: sales.capped || punches.capped,
      };
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
}
