import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';

import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';
import { computeStaffingSuggestions } from '@/hooks/useStaffingSuggestions';
import { computeAvgHourlyRateCents, computeMinStaffFromCrew } from '@/lib/staffingCalculator';
import { dayStringToDow } from '@/lib/staffingApply';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';

import type { StaffingSuggestionsResult } from '@/hooks/useStaffingSuggestions';
import type { StaffingSettings } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

export type { StaffingSuggestionsResult };

interface ActualSplhSaleRow {
  total_price: number | string;
}

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
 */
export function computeActualSplh(
  sales: ActualSplhSaleRow[],
  punches: TimePunch[],
): number | null {
  if (!sales.length || !punches.length) return null;

  const totalSales = sales.reduce((sum, s) => sum + Number(s.total_price), 0);

  const sessions = identifyWorkSessions(normalizePunches(punches));
  const totalHours = sessions.reduce((sum, s) => sum + s.worked_minutes / 60, 0);

  if (totalHours <= 0) return null;
  return Math.round(totalSales / totalHours);
}

export function useWeekStaffingSuggestions(
  restaurantId: string | null,
  weekDays: string[],
  settingsOverrides: Partial<StaffingSettings> | null,
) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = selectedRestaurant?.restaurant?.timezone ?? 'America/Chicago';

  const { effectiveSettings, isLoading: settingsLoading, updateSettings, isSaving } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);

  const avgHourlyRateCents = useMemo(
    () => computeAvgHourlyRateCents(employees),
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
  const dateRange = useMemo(() => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - activeSettings.lookback_weeks * 7);
    return {
      startStr: startDate.toISOString().split('T')[0],
      endStr: endDate.toISOString().split('T')[0],
    };
  }, [activeSettings.lookback_weeks]);

  const { data: allSales, isLoading: salesLoading, error: salesError, refetch: refetchSales } = useQuery({
    queryKey: ['hourly-sales-all', restaurantId, activeSettings.lookback_weeks],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('unified_sales')
        .select('sale_date, sale_time, sold_at, total_price')
        .eq('restaurant_id', restaurantId)
        .eq('item_type', 'sale')
        // Split-sale guard (§5 S-M1): exclude split-parent/child rows so a
        // split sale's total isn't summed twice, matching useSplhData.ts.
        .is('parent_sale_id', null)
        .gte('sale_date', dateRange.startStr)
        .lte('sale_date', dateRange.endStr)
        .order('sale_date');
      if (error) throw error;
      return data ?? [];
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
    () => computeActualSplh(allSales ?? [], timePunches ?? []),
    [allSales, timePunches],
  );

  // Pre-group sales by day-of-week in a single pass (avoids 7x Date allocations)
  const salesByDow = useMemo(() => {
    if (!allSales?.length) return new Map<number, typeof allSales>();
    const grouped = new Map<number, typeof allSales>();
    for (const sale of allSales) {
      const dow = dayStringToDow(sale.sale_date);
      if (!grouped.has(dow)) grouped.set(dow, []);
      grouped.get(dow)!.push(sale);
    }
    return grouped;
  }, [allSales]);

  const { daySuggestions, hasHourlyBreakdown } = useMemo(() => {
    if (!allSales?.length) return { daySuggestions: new Map<string, StaffingSuggestionsResult>(), hasHourlyBreakdown: false };

    const result = new Map<string, StaffingSuggestionsResult>();
    let anyHourly = false;
    for (const day of weekDays) {
      const dayOfWeek = dayStringToDow(day);
      const filtered = salesByDow.get(dayOfWeek) ?? [];
      const aggregated = aggregateHourlySales(filtered, tz);
      if (aggregated.hasHourlyBreakdown) anyHourly = true;
      result.set(day, computeStaffingSuggestions(aggregated.data, {
        targetSplh: activeSettings.target_splh,
        minStaff: computeMinStaffFromCrew(activeSettings.min_crew, activeSettings.min_staff),
        targetLaborPct: activeSettings.target_labor_pct,
        avgHourlyRateCents,
        day,
      }));
    }
    return { daySuggestions: result, hasHourlyBreakdown: anyHourly };
  }, [allSales, salesByDow, weekDays, activeSettings, avgHourlyRateCents, tz]);

  const refetch = () => {
    void refetchSales();
    void refetchPunches();
  };

  return {
    daySuggestions,
    isLoading: settingsLoading || salesLoading || punchesLoading,
    error: salesError,
    refetch,
    hasSalesData: (allSales?.length ?? 0) > 0,
    hasHourlyBreakdown,
    activeSettings,
    updateSettings,
    isSaving,
    employeePositions,
    actualSplh,
  };
}

/** Inferred return type — exported for reuse in consumers (e.g. ShiftTimelineTab). */
export type WeekStaffingSuggestions = ReturnType<typeof useWeekStaffingSuggestions>;
