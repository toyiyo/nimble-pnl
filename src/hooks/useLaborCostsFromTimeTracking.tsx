import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from './useEmployees';
import { useRestaurantClock } from './useRestaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';
import { keepDataUnlessRestaurantChanged } from '@/lib/react-query-config';
import {
  loadPeriodLaborCost,
  type LaborCostData,
} from '../../supabase/functions/_shared/labor/periodLaborCost';

export type { LaborCostData };

export interface LaborCostsFromTimeTrackingResult {
  dailyCosts: LaborCostData[];
  totalCost: number;
  /** Wages + per-job payments only, tips owed excluded. The labor-basis
   * decision reads this — a period with only tips owed must not count as
   * "has accrued labor" and hide paid (bank) labor. */
  wageCost: number;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
  /** True when any of the paged fetches (time punches, per-job payments,
   * tip splits, tip payouts) hit the pagination backstop
   * (`fetchAllRowsKeyset`'s `maxPages`) — results may be truncated. */
  capped: boolean;
}

/**
 * Calculate labor costs directly from source data (time punches + employee configs).
 * This follows the same pattern as usePayroll - query source tables and calculate on-demand.
 * 
 * ✅ Use this hook for Dashboard labor cost calculations
 * ❌ Do NOT use daily_labor_allocations aggregation table (except for per-job source records)
 * 
 * Data flow:
 * 1. Fetch time_punches for the period
 * 2. Fetch employees with compensation configs
 * 3. Fetch per-job contractor payments (from daily_labor_allocations source='per-job')
 * 4. Calculate costs using laborCalculations.calculateActualLaborCost() (same logic as payroll)
 * 
 * @param restaurantId - Restaurant ID to filter costs
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Labor cost data calculated from source tables
 */
export function useLaborCostsFromTimeTracking(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date,
  options?: { throughNow?: boolean }
): LaborCostsFromTimeTrackingResult {
  // Fetch ALL employees (including inactive) for historical labor cost accuracy
  const { employees } = useEmployees(restaurantId, { status: 'all' });
  const { tz: timezone } = useRestaurantClock();

  // Opt-in: count still-open shifts (currently clocked in) as worked through
  // "now". Off by default so Payroll and other callers keep matched-pair
  // semantics; a *live* labor-cost view (the /labor page, dashboard card) turns
  // it on so today's in-progress hours aren't under-counted while staff are on
  // the clock. `throughNow` is in the query key so the two variants don't collide.
  const throughNow = options?.throughNow ?? false;

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['labor-costs-from-time-tracking', restaurantId, toDateOnlyString(dateFrom), toDateOnlyString(dateTo), throughNow, timezone],
    queryFn: async (): Promise<{ dailyCosts: LaborCostData[]; totalCost: number; wageCost: number; capped: boolean }> => {
      if (!restaurantId) {
        return { dailyCosts: [], totalCost: 0, wageCost: 0, capped: false };
      }

      // The loader works on whole restaurant days. dateFrom / dateTo are
      // calendar-day tokens: their local fields name the days (the same
      // strings as the query key). `now` is a real instant, read here.
      const { dailyCosts, totalCost, wageCost, capped } = await loadPeriodLaborCost(supabase, {
        restaurantId,
        startDay: toDateOnlyString(dateFrom),
        endDay: toDateOnlyString(dateTo),
        timeZone: timezone,
        employees,
        throughNow,
        now: new Date(),
      });
      return { dailyCosts, totalCost, wageCost, capped };
    },
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    placeholderData: keepDataUnlessRestaurantChanged(restaurantId),
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    wageCost: data?.wageCost || 0,
    isLoading,
    isFetching,
    error,
    refetch: () => { refetch(); },
    capped: data?.capped ?? false,
  };
}
