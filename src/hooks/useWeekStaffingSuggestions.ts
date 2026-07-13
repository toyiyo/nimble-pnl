import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';
import { computeStaffingSuggestions } from '@/hooks/useStaffingSuggestions';
import { computeAvgHourlyRateCents, computeMinStaffFromCrew } from '@/lib/staffingCalculator';
import { dayStringToDow } from '@/lib/staffingApply';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

import type { StaffingSuggestionsResult } from '@/hooks/useStaffingSuggestions';
import type { StaffingSettings } from '@/types/scheduling';

export type { StaffingSuggestionsResult };

interface ActualSplhSaleRow {
  total_price: number | string;
}

interface ActualSplhPunchRow {
  employee_id: string;
  punch_type: string;
  punch_time: string;
}

/**
 * Pairs `clock_in`/`clock_out` punches per employee to compute total worked
 * hours, then divides total sales by total hours for a rough actual-SPLH
 * figure. Pure helper (no hook deps) so it's independently testable.
 *
 * Note: the DB's real `punch_type` values are `clock_in`/`clock_out`/
 * `break_start`/`break_end` (see `src/types/timeTracking.ts`) — this used to
 * filter/pair on stale `'in'`/`'out'` values that never matched any row,
 * silently collapsing `actualSplh` to `null` forever.
 *
 * Returns `null` when there's no usable data (no sales, no punches, or no
 * complete clock_in/clock_out pairs).
 */
export function computeActualSplh(
  sales: ActualSplhSaleRow[],
  punches: ActualSplhPunchRow[],
): number | null {
  if (!sales.length || !punches.length) return null;

  const totalSales = sales.reduce((sum, s) => sum + Number(s.total_price), 0);

  // Pair clock_in/clock_out punches per employee to compute hours
  let totalHours = 0;
  const lastIn: Record<string, string> = {};
  for (const punch of punches) {
    if (punch.punch_type === 'clock_in') {
      lastIn[punch.employee_id] = punch.punch_time;
    } else if (punch.punch_type === 'clock_out' && lastIn[punch.employee_id]) {
      const inTime = new Date(lastIn[punch.employee_id]).getTime();
      const outTime = new Date(punch.punch_time).getTime();
      const hours = (outTime - inTime) / (1000 * 60 * 60);
      if (hours > 0 && hours < 24) totalHours += hours;
      delete lastIn[punch.employee_id];
    }
  }

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
    queryKey: ['staffing-time-punches', restaurantId, activeSettings.lookback_weeks],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('time_punches')
        .select('punch_time, punch_type, employee_id')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', dateRange.startStr)
        .lte('punch_time', dateRange.endStr + 'T23:59:59')
        .in('punch_type', ['clock_in', 'clock_out', 'break_start', 'break_end'])
        .order('employee_id')
        .order('punch_time');
      if (error) throw error;
      return data ?? [];
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
