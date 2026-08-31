import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from './useEmployees';
import { TimePunch, DBTimePunch } from '@/types/timeTracking';
import { calculateActualLaborCost, calculateActualLaborCostForRange } from '@/services/laborCalculations';
import { lookaheadPunchFetchRange, weekAlignedFetchStart, weekAlignedFetchEnd } from '@/utils/punchWindow';
import { appendOpenShiftClockOuts } from '@/utils/openShiftPunches';
import { fetchAllRows, asPagedRows } from '@/utils/fetchAllRows';
import { fetchTipSplitRows, fetchTipPayoutRows, netTipsOwedByEmployee } from '@/services/tipsFetch';
import { useRestaurantClock } from './useRestaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';

export interface LaborCostData {
  date: string;
  total_labor_cost: number;
  hourly_wages: number;
  salary_wages: number;
  contractor_payments: number;
  total_hours: number;
}

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
   * (`fetchAllRows`'s `maxPages`) — results may be truncated. */
  capped: boolean;
}

interface ManualPaymentDB {
  id: string;
  employee_id: string;
  date: string;
  allocated_cost: number;
  notes: string | null;
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

      // 1. Fetch time punches for the period.
      // Look-AHEAD only (not symmetric): calculateActualLaborCost attributes
      // hours/active-days to every day a shift touches and does NOT drop shifts
      // whose clock-in precedes dateFrom. A look-back would pull a prior-period
      // Sunday-night shift into Monday and overstate labor; the look-ahead still
      // completes an in-range shift whose clock_out lands just after dateTo.
      //
      // Paginated via `fetchAllRows` (not a single unbounded `.select()`):
      // this window can span 18 weeks, and PostgREST caps an unpaginated
      // response at 1,000 rows — silently dropping the newest punches (the
      // query orders `punch_time asc`) once a restaurant crosses that
      // threshold. The `.order('id')` tiebreaker makes each page boundary
      // deterministic when multiple punches share a `punch_time`.
      const { fetchStart, fetchEnd } = lookaheadPunchFetchRange(dateFrom, dateTo);

      // calculateActualLaborCostForRange (below) buckets punches by ISO week
      // and bands overtime over the FULL week. When dateFrom or dateTo does
      // not fall on a week boundary, the days outside [dateFrom, dateTo] in
      // that same edge week must still be fetched, or the week's hour total
      // comes out too low and hours that should band as overtime cost as
      // straight time instead. Widen the DB fetch to cover both edge weeks
      // whole — see src/utils/punchWindow.ts for the shared rule.
      // calculateActualLaborCost (the straight-time daily series) must NOT
      // see these extra days — see punchesForDailyCost below.
      const otFetchStart = weekAlignedFetchStart(dateFrom, fetchStart);
      const otFetchEnd = weekAlignedFetchEnd(dateTo, fetchEnd);

      // The four fetches below are independent. Run them together so the
      // wait is the slowest fetch, not the sum. This hook backs the
      // dashboard pills and reruns on every window refocus.
      const [
        { rows: punches, capped: punchesCapped },
        { rows: manualPaymentsData, capped: perJobCapped },
        { rows: tipRows, capped: tipsCapped },
        { rows: tipPayoutRows, capped: tipPayoutsCapped },
      ] = await Promise.all([
        fetchAllRows<DBTimePunch>((from, to) =>
          supabase
            .from('time_punches')
            // Every DBTimePunch column, named — no `select('*')` payload
            // (raw_data-style bloat) and no silent widening if the table
            // grows a column.
            .select('id, employee_id, restaurant_id, punch_time, punch_type, created_at, updated_at, shift_id, notes, photo_path, device_info, location, created_by, modified_by')
            .eq('restaurant_id', restaurantId)
            .gte('punch_time', otFetchStart.toISOString())
            .lte('punch_time', otFetchEnd.toISOString())
            .order('punch_time', { ascending: true })
            .order('id')
            .range(from, to),
        ),
        // 2. Fetch per-job contractor payments (source records only),
        // paged like the other fetches — an unpaged select stops at
        // PostgREST's 1,000-row cap and drops the rest silently.
        fetchAllRows<ManualPaymentDB>((from, to) =>
          asPagedRows<ManualPaymentDB>(
            supabase
              .from('daily_labor_allocations')
              .select('id, employee_id, date, allocated_cost, notes')
              .eq('restaurant_id', restaurantId)
              .eq('source', 'per-job') // Only per-job source records, not auto-generated
              .gte('date', toDateOnlyString(dateFrom))
              .lte('date', toDateOnlyString(dateTo))
              .order('id')
              .range(from, to),
          )
        ),
        // Tips owed in the window (integer cents). Same source and window rule
        // as useMonthlyMetrics so the two surfaces agree.
        fetchTipSplitRows(
          supabase,
          restaurantId,
          toDateOnlyString(dateFrom),
          toDateOnlyString(dateTo)
        ),
        // Payouts in the same window reduce tips owed (same netting as
        // Payroll — see netTipsOwedByEmployee).
        fetchTipPayoutRows(
          supabase,
          restaurantId,
          toDateOnlyString(dateFrom),
          toDateOnlyString(dateTo)
        ),
      ]);

      const tipsOwedByEmployee = netTipsOwedByEmployee(tipRows, tipPayoutRows);

      // 3. Convert database punches to TimePunch type
      const typedPunches: TimePunch[] = (punches || []).map((punch: DBTimePunch) => ({
        ...punch,
        punch_type: punch.punch_type as TimePunch['punch_type'],
        location: punch.location && typeof punch.location === 'object' && 'latitude' in punch.location && 'longitude' in punch.location
          ? punch.location as { latitude: number; longitude: number }
          : undefined,
      }));

      // 3b. For a live view, close still-open shifts at "now" so in-progress
      // hours count (parseWorkPeriods otherwise drops an un-clocked-out shift).
      // `punchesForCost` can hold extra days from before `dateFrom` (the week
      // look-back added above, for OT banding only).
      const punchesForCost = throughNow
        ? appendOpenShiftClockOuts(typedPunches, new Date())
        : typedPunches;

      // calculateActualLaborCost attributes hours to every day a shift
      // touches and does not drop shifts whose clock-in precedes or follows
      // the window, so it must not see the week look-back or look-ahead
      // days — those would pull a shift from outside the range into an
      // in-range day and overstate labor. Drop back to the punches the
      // un-widened fetch would have returned.
      const punchesForDailyCost = punchesForCost.filter((punch) => {
        const t = new Date(punch.punch_time).getTime();
        return t >= fetchStart.getTime() && t <= fetchEnd.getTime();
      });

      // 4. Use calculateActualLaborCost from laborCalculations.ts (same as payroll)
      // This ensures Dashboard and Payroll use identical calculation logic
      const { dailyCosts: laborDailyCosts } = calculateActualLaborCost(
        employees,
        punchesForDailyCost,
        dateFrom,
        dateTo,
        timezone
      );

      // 5. Add per-job contractor payments to the daily costs
      // (these are manual payments not included in the time-punch-based calculation)
      const dateMap = new Map<string, LaborCostData>();
      
      // Convert laborCalculations format to our format
      laborDailyCosts.forEach(day => {
        dateMap.set(day.date, {
          date: day.date,
          total_labor_cost: day.total_cost,
          hourly_wages: day.hourly_cost,
          salary_wages: day.salary_cost,
          contractor_payments: day.contractor_cost,
          total_hours: day.hours_worked,
        });
      });

      // Add per-job contractor payments
      (manualPaymentsData || []).forEach((payment: ManualPaymentDB) => {
        const dayData = dateMap.get(payment.date);
        if (dayData) {
          const paymentDollars = payment.allocated_cost / 100; // Convert cents to dollars
          dayData.contractor_payments += paymentDollars;
          dayData.total_labor_cost += paymentDollars;
        } else {
          // Create entry for this date if it doesn't exist (edge case: payment outside period)
          dateMap.set(payment.date, {
            date: payment.date,
            total_labor_cost: payment.allocated_cost / 100,
            hourly_wages: 0,
            salary_wages: 0,
            contractor_payments: payment.allocated_cost / 100,
            total_hours: 0,
          });
        }
      });

      const dailyCosts = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      // dailyCosts stays straight-time for the daily chart. totalCost uses
      // the payroll formula (OT banding + tips owed) so the pills equal
      // Monthly Performance and Payroll.
      const rangeStart = new Date(dateFrom);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeEnd = new Date(dateTo);
      rangeEnd.setHours(23, 59, 59, 999);

      const { wagesCents, actualLaborCents } = calculateActualLaborCostForRange({
        employees,
        timePunches: punchesForCost,
        tipsOwedByEmployee,
        rangeStart,
        rangeEnd,
        timezone,
      });

      const perJobDollars = (manualPaymentsData ?? []).reduce(
        (sum: number, payment: ManualPaymentDB) => sum + payment.allocated_cost / 100,
        0
      );

      const totalCost = actualLaborCents / 100 + perJobDollars;
      const wageCost = wagesCents / 100 + perJobDollars;

      return {
        dailyCosts,
        totalCost,
        wageCost,
        capped: punchesCapped || perJobCapped || tipsCapped || tipPayoutsCapped,
      };
    },
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    // Keep the previous period's data on screen during a refetch, but never
    // across a restaurant switch (queryKey[1] is the restaurant id).
    placeholderData: (previousData, previousQuery) =>
      previousQuery && previousQuery.queryKey[1] !== restaurantId
        ? undefined
        : previousData,
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
