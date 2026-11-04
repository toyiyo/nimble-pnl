import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';

import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { computeStaffingSuggestions } from '@/hooks/useStaffingSuggestions';
import { computeAvgHourlyRateCents, computeMinStaffFromCrew, hasHourlyWageData } from '@/lib/staffingCalculator';
import { dayStringToDow } from '@/lib/staffingApply';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { safeTz, toBusinessDay } from '@/lib/restaurantClock';

import type { StaffingSuggestionsResult } from '@/hooks/useStaffingSuggestions';
import type { StaffingSettings, HourlySalesData } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

export type { StaffingSuggestionsResult };

/**
 * Sums total sales and divides by total worked hours to produce a rough
 * actual-SPLH figure. Pure helper (no hook deps) so it's independently
 * testable.
 *
 * Worked hours are derived via `identifyWorkSessions(normalizePunches(...))`
 * — the same break-aware, anomaly-tolerant pipeline `useSplhCore` uses (see
 * `src/lib/splhAnalytics.ts`) — instead of a hand-rolled clock_in/clock_out
 * pairing loop, so break time is excluded here exactly as it is everywhere
 * else in the SPLH feature (design §4.3). This also fixes the original bug
 * where this hint's `punch_type` filter used stale `'in'`/`'out'` values that
 * never matched any row, silently collapsing `actualSplh` to `null` forever.
 *
 * Returns `null` when there's no usable data (no sales, no punches, or no
 * worked hours across all sessions).
 *
 * `hasSalesData` tells apart "no sales data was fetched" from "sales data
 * exists and totals exactly $0" (a fully refunded day) — `totalSales`
 * alone cannot, since both cases show as 0. It defaults to `totalSales !==
 * 0` so a caller that has no better signal keeps the old behavior.
 */
export function computeActualSplh(
  totalSales: number,
  punches: TimePunch[],
  hasSalesData: boolean = totalSales !== 0,
): number | null {
  if (!hasSalesData || !punches.length) return null;

  const sessions = identifyWorkSessions(normalizePunches(punches));
  const totalHours = sessions.reduce((sum, s) => sum + s.worked_minutes / 60, 0);

  if (totalHours <= 0) return null;
  return Math.round(totalSales / totalHours);
}

interface HourlySalesPatternSlot {
  start_minute: number;
  sales: number;
  sample_count: number;
}

interface HourlySalesPatternDay {
  day_of_week: number;
  has_hourly_breakdown: boolean;
  slots: HourlySalesPatternSlot[];
}

interface HourlySalesPatternResult {
  total_sales?: number | null;
  days?: HourlySalesPatternDay[] | null;
}

const EMPTY_DAY_ENTRY: { data: HourlySalesData[]; hasHourlyBreakdown: boolean } = {
  data: [],
  hasHourlyBreakdown: false,
};

/**
 * Maps `get_hourly_sales_pattern`'s jsonb result to a Map keyed by
 * `day_of_week` (0=Sunday..6=Saturday), one entry per weekday. A weekday
 * absent from `days[]` (no sales in the lookback window) still gets an
 * entry, with empty data -- so callers never guard a missing Map key with
 * their own default.
 *
 * `hour = start_minute / 60` -- correct only at `p_interval_minutes = 60`,
 * the only interval this hook requests.
 */
export function mapHourlySalesPattern(
  result: HourlySalesPatternResult | null | undefined,
): Map<number, { data: HourlySalesData[]; hasHourlyBreakdown: boolean }> {
  const byDow = new Map<number, HourlySalesPatternDay>();
  for (const day of result?.days ?? []) {
    byDow.set(day.day_of_week, day);
  }

  const mapped = new Map<number, { data: HourlySalesData[]; hasHourlyBreakdown: boolean }>();
  for (let dow = 0; dow <= 6; dow++) {
    const day = byDow.get(dow);
    if (!day) {
      mapped.set(dow, EMPTY_DAY_ENTRY);
      continue;
    }
    mapped.set(dow, {
      hasHourlyBreakdown: day.has_hourly_breakdown,
      data: (day.slots ?? []).map((slot) => ({
        hour: slot.start_minute / 60,
        avgSales: slot.sales,
        sampleCount: slot.sample_count,
      })),
    });
  }
  return mapped;
}

/**
 * The lookback window as restaurant business days. `sale_date` is a date-only
 * column, so both bounds must be the restaurant's business day, not the UTC
 * day. UTC days slide the whole lookback window by a day for zones west of
 * Greenwich in the evening.
 */
export function lookbackDateRange(lookbackWeeks: number, tz: string, now: Date = new Date()) {
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - lookbackWeeks * 7);
  return {
    startStr: toBusinessDay(startDate, tz),
    endStr: toBusinessDay(now, tz),
  };
}

/** One sales total for each business day in the lookback window. */
export interface LookbackDailySalesRow {
  sale_date: string;
  total_price: number;
}

interface HourlySalesByDateResult {
  days?: { date: string; day_total: number | null }[] | null;
}

/**
 * Query options for the daily sales totals of the lookback window. Exported
 * so that every caller (for example `useDailyLaborPercent`) shares one React
 * Query cache entry.
 *
 * `get_hourly_sales_pattern` with `p_view: 'by_date'` returns one total for
 * each date with sales. The SQL function is authoritative for the filters
 * (item_type 'sale', no split children). It has no row cap, so no date is
 * partial.
 *
 * The key is not 'hourly-sales-all': that key holds the weekday result of the
 * planner query, which has a different shape. `tz` belongs in the key because
 * the date range is derived from it.
 */
export function lookbackSalesQueryOptions(
  restaurantId: string | null,
  lookbackWeeks: number,
  tz: string,
) {
  return {
    queryKey: ['daily-sales-by-date', restaurantId, lookbackWeeks, tz],
    queryFn: async (): Promise<LookbackDailySalesRow[]> => {
      if (!restaurantId) return [];
      const dateRange = lookbackDateRange(lookbackWeeks, tz);
      const { data, error } = await supabase.rpc('get_hourly_sales_pattern', {
        p_restaurant_id: restaurantId,
        p_start_date: dateRange.startStr,
        p_end_date: dateRange.endStr,
        p_interval_minutes: 60,
        p_view: 'by_date',
      });
      if (error) throw error;
      const days = (data as unknown as HourlySalesByDateResult | null)?.days ?? [];
      return days.map((day) => ({ sale_date: day.date, total_price: Number(day.day_total) || 0 }));
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  };
}

export function useWeekStaffingSuggestions(
  restaurantId: string | null,
  weekDays: string[],
  settingsOverrides: Partial<StaffingSettings> | null,
) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = safeTz(selectedRestaurant?.restaurant?.timezone);

  const { effectiveSettings, isLoading: settingsLoading, updateSettings, isSaving } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);

  const avgHourlyRateCents = useMemo(
    () => computeAvgHourlyRateCents(employees),
    [employees],
  );

  // Gates every implied-%/implied-SPLH readout downstream (design §4a): true
  // only when at least one active hourly employee has a real wage, false
  // when avgHourlyRateCents is just the DEFAULT_HOURLY_RATE_CENTS fallback.
  const hasWageData = useMemo(
    () => hasHourlyWageData(employees),
    [employees],
  );

  const employeePositions = useMemo(() => {
    if (!employees?.length) return [];
    const positions = new Set<string>();
    for (const emp of employees) {
      if (emp.position) positions.add(emp.position);
    }
    return Array.from(positions).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [employees]);

  // Merge DB settings with local overrides for live preview.
  // Filter out undefined values from settingsOverrides: a Partial can carry
  // sparse keys, and spreading undefined onto effectiveSettings would corrupt
  // numeric fields like lookback_weeks that drive the date range.
  const activeSettings = useMemo(() => {
    const definedOverrides = Object.fromEntries(
      Object.entries(settingsOverrides ?? {}).filter(([, v]) => v !== undefined),
    ) as Partial<StaffingSettings>;

    return {
      ...effectiveSettings,
      ...definedOverrides,
    };
  }, [effectiveSettings, settingsOverrides]);

  // Compute date range once for both queries
  const dateRange = useMemo(
    () => lookbackDateRange(activeSettings.lookback_weeks, tz),
    [activeSettings.lookback_weeks, tz],
  );

  const {
    data: hourlySalesResult,
    isLoading: salesLoading,
    error: salesError,
    refetch: refetchSales,
  } = useQuery({
    // `tz` belongs in the key because `dateRange` is now derived from it --
    // without it, changing the restaurant's zone leaves this window cached
    // against the old business days. The punch query below already keys on tz.
    queryKey: ['hourly-sales-all', restaurantId, activeSettings.lookback_weeks, tz],
    queryFn: async (): Promise<HourlySalesPatternResult | null> => {
      if (!restaurantId) return null;
      // The SQL function (supabase/migrations/20260927120000_get_hourly_sales_pattern.sql)
      // is authoritative for the hourly-sales aggregation and the rounding --
      // no client-side pagination or grouping needed.
      const { data, error } = await supabase.rpc('get_hourly_sales_pattern', {
        p_restaurant_id: restaurantId,
        p_start_date: dateRange.startStr,
        p_end_date: dateRange.endStr,
        p_interval_minutes: 60,
        p_view: 'weekday',
      });
      if (error) throw error;
      return data as unknown as HourlySalesPatternResult;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Fetch time punches to compute actual labor hours for SPLH hint.
  // isLoading and refetch are joined with the sales query so callers see a
  // unified loading state; punch failures collapse actualSplh to null, which
  // the UI already handles gracefully.
  const {
    data: timePunches,
    isLoading: punchesLoading,
    refetch: refetchPunches,
  } = useQuery({
    queryKey: ['staffing-time-punches', restaurantId, activeSettings.lookback_weeks, tz],
    queryFn: async () => {
      if (!restaurantId) return [];
      // `punch_time` is TIMESTAMPTZ, unlike `sale_date` above (a plain DATE
      // column) — bare `YYYY-MM-DD` strings would be interpreted as UTC
      // instants by Postgres/PostgREST, skewing the window for any
      // restaurant not in UTC. Resolve the local midnight-to-midnight window
      // to explicit UTC instants via `tz` first (matches useSplhData.ts).
      const startIso = fromZonedTime(`${dateRange.startStr}T00:00:00`, tz).toISOString();
      const endIso = fromZonedTime(`${dateRange.endStr}T23:59:59.999`, tz).toISOString();
      // Paginated (matches useSplhData.ts's fetchAllPunches): an unbounded
      // select is subject to PostgREST's default row cap, which a
      // multi-employee, multi-week lookback window can plausibly exceed,
      // silently truncating computeActualSplh's inputs.
      const PAGE_SIZE = 1000;
      const MAX_PAGES = 20;
      const rows: TimePunch[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const { data, error } = await supabase
          .from('time_punches')
          .select('id, restaurant_id, employee_id, punch_type, punch_time')
          .eq('restaurant_id', restaurantId)
          .gte('punch_time', startIso)
          .lte('punch_time', endIso)
          .in('punch_type', ['clock_in', 'clock_out', 'break_start', 'break_end'])
          .order('employee_id')
          .order('punch_time')
          .order('id')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as unknown as TimePunch[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return rows;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Compute actual SPLH from historical sales and labor hours
  const actualSplh = useMemo(
    () =>
      computeActualSplh(
        hourlySalesResult?.total_sales ?? 0,
        timePunches ?? [],
        (hourlySalesResult?.days?.length ?? 0) > 0,
      ),
    [hourlySalesResult, timePunches],
  );

  const hourlySalesByDow = useMemo(
    () => mapHourlySalesPattern(hourlySalesResult),
    [hourlySalesResult],
  );

  const { daySuggestions, hasHourlyBreakdown } = useMemo(() => {
    if (!hourlySalesResult?.days?.length) {
      return { daySuggestions: new Map<string, StaffingSuggestionsResult>(), hasHourlyBreakdown: false };
    }

    const result = new Map<string, StaffingSuggestionsResult>();
    let anyHourly = false;
    for (const day of weekDays) {
      const dayOfWeek = dayStringToDow(day);
      const entry = hourlySalesByDow.get(dayOfWeek) ?? EMPTY_DAY_ENTRY;
      if (entry.hasHourlyBreakdown) anyHourly = true;
      result.set(day, computeStaffingSuggestions(entry.data, {
        targetSplh: activeSettings.target_splh,
        minStaff: computeMinStaffFromCrew(activeSettings.min_crew, activeSettings.min_staff),
        targetLaborPct: activeSettings.target_labor_pct,
        avgHourlyRateCents,
        day,
      }));
    }
    return { daySuggestions: result, hasHourlyBreakdown: anyHourly };
  }, [hourlySalesResult, hourlySalesByDow, weekDays, activeSettings, avgHourlyRateCents]);

  const refetch = () => {
    void refetchSales();
    void refetchPunches();
  };

  return {
    daySuggestions,
    isLoading: settingsLoading || salesLoading || punchesLoading,
    error: salesError,
    refetch,
    hasSalesData: (hourlySalesResult?.days?.length ?? 0) > 0,
    hasHourlyBreakdown,
    activeSettings,
    updateSettings,
    isSaving,
    employeePositions,
    actualSplh,
    avgHourlyRateCents,
    hasWageData,
  };
}

/** Inferred return type — exported for reuse in consumers (e.g. ShiftTimelineTab). */
export type WeekStaffingSuggestions = ReturnType<typeof useWeekStaffingSuggestions>;
