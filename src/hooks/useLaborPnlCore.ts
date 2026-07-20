import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useSplhData } from '@/hooks/useSplhData';
import { useLaborCostsFromTimeTracking } from '@/hooks/useLaborCostsFromTimeTracking';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { validateTimeZone, buildSplhTimeseries } from '@/lib/splhAnalytics';
import { getTodayInTimezone } from '@/lib/timezone';

/**
 * Restaurant-tz window for the labor-cost fetch, expressed as `Date` objects
 * whose *host-local* calendar day matches the restaurant-tz calendar day
 * (§4/§5 design: window boundaries derive from `getTodayInTimezone`, not
 * `new Date()`). `useLaborCostsFromTimeTracking` formats these via
 * `date-fns`'s `format()`, which reads a Date's host-local
 * year/month/day — unlike `useSplhData`'s own UTC-anchored window, so we
 * deliberately build the Date with the *local* constructor here (not
 * `Date.UTC`) so `format(windowEnd, 'yyyy-MM-dd')` reproduces the exact
 * restaurant-tz "today" string regardless of the host's own timezone.
 *
 * `windowEnd` is the **end** of today (23:59:59.999), not midnight at its
 * start — `useLaborCostsFromTimeTracking` passes it straight into
 * `lookaheadPunchFetchRange(dateFrom, dateTo)` (`src/utils/punchWindow.ts`),
 * which widens only the *end* of the fetch by `OVERNIGHT_BUFFER_HOURS`.
 * Anchoring `windowEnd` at today's midnight-start silently capped the
 * `time_punches` fetch at ~6pm today (`OVERNIGHT_BUFFER_HOURS = 18` past
 * midnight), dropping every clock-in/clock-out later than that from the
 * query — not merely undercounting hours but excluding whole evening shifts
 * (an open clock-in with a since-fetched-out-of-window clock-out reads as an
 * incomplete shift and is entirely dropped). Anchoring at end-of-day makes
 * today's fetch cover the full day (through "now" and beyond, matching
 * design §3's clock-in-through-now requirement — future timestamps simply
 * don't exist yet, so this never over-fetches).
 */
function laborCostWindow(tz: string, weeks: number): { windowStart: Date; windowEnd: Date } {
  const todayStr = getTodayInTimezone(tz);
  const [y, m, d] = todayStr.split('-').map(Number);
  const windowEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  const windowStart = new Date(y, m - 1, d - weeks * 7);
  return { windowStart, windowEnd };
}

/**
 * Shared setup for the labor P&L hooks: restaurant tz/target, the
 * restaurant-tz labor-cost window, the paginated sales+punches fetch
 * (`useSplhData`, reused as-is), the payroll-grade daily labor series
 * (`useLaborCostsFromTimeTracking`), and the real per-day sales series
 * derived from the same sales+sessions `useSplhCore` already trusts.
 * `useLaborPnlSummary` (Dashboard card) and `useLaborPnlAnalytics` (`/labor`
 * page) both build on this and only differ in the `weeks` fetch window and
 * which additional aggregation (`buildFinancialSeries`, `buildSalesVolumeGrid`)
 * they layer on top.
 */
export function useLaborPnlCore(restaurantId: string | null, weeks: number) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = validateTimeZone(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings, updateSettings, isSaving: isSavingTarget } = useStaffingSettings(restaurantId);
  const targetPct = effectiveSettings.target_labor_pct;

  const { windowStart, windowEnd } = useMemo(() => laborCostWindow(tz, weeks), [tz, weeks]);

  const {
    data,
    isLoading: salesLoading,
    isError: salesIsError,
    error: salesError,
    refetch: refetchSales,
  } = useSplhData(restaurantId, tz, weeks);

  const {
    dailyCosts,
    isLoading: laborLoading,
    error: laborError,
    refetch: refetchLabor,
  } = useLaborCostsFromTimeTracking(restaurantId, windowStart, windowEnd);

  const sessions = useMemo(
    () => (data?.punches?.length ? identifyWorkSessions(normalizePunches(data.punches)) : []),
    [data?.punches],
  );

  const dailySales = useMemo(
    () => (data ? buildSplhTimeseries(data.sales, sessions, tz, 'day') : []),
    [data, sessions, tz],
  );

  return {
    tz,
    targetPct,
    windowStart,
    windowEnd,
    dailySales,
    dailyLabor: dailyCosts,
    // Raw per-sale/per-punch inputs, exposed (not just the derived daily
    // series) so `useLaborPnlAnalytics` (`/labor` page, C3) can build the
    // hourly sales-volume grid via `buildSplhGrid` without a second
    // `useSplhData` fetch — mirrors `useSplhCore` exposing both `data` and
    // `sessions` alongside its own derived `grid`/`summary`.
    sales: data?.sales ?? [],
    sessions,
    capped: data?.capped ?? false,
    // Per design §6 (mirroring `useSplhCore`): a restaurant with sales but
    // zero punches anywhere in the window hasn't enabled time tracking yet —
    // a setup-invite empty state, distinct from per-bucket "no labor" cells.
    hasData: (data?.sales?.length ?? 0) > 0 && (data?.punches?.length ?? 0) > 0,
    isLoading: salesLoading || laborLoading,
    isError: salesIsError || !!laborError,
    error: salesError ?? laborError ?? null,
    refetch: () => {
      refetchSales();
      refetchLabor();
    },
    // Target-% write path (design §2.2 "Editable target"), shared here so
    // `useLaborPnlAnalytics` doesn't need its own `useStaffingSettings` call.
    updateSettings,
    isSavingTarget,
  };
}
