import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEmployees } from './useEmployees';
import { TimePunch } from '@/types/timeTracking';
import { format } from 'date-fns';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import { lookaheadPunchFetchRange } from '@/utils/punchWindow';
import { appendOpenShiftClockOuts } from '@/utils/openShiftPunches';
import { fetchAllRows } from '@/utils/fetchAllRows';

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
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  /** True when the time_punches fetch hit the pagination backstop
   * (`fetchAllRows`'s `maxPages`) — results may be truncated. */
  capped: boolean;
}

interface DBTimePunch {
  id: string;
  employee_id: string;
  restaurant_id: string;
  punch_time: string;
  punch_type: string;
  created_at: string;
  updated_at: string;
  shift_id: string | null;
  notes: string | null;
  photo_path: string | null;
  device_info: string | null;
  location: unknown;
  created_by: string | null;
  modified_by: string | null;
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

  // Opt-in: count still-open shifts (currently clocked in) as worked through
  // "now". Off by default so Payroll and other callers keep matched-pair
  // semantics; a *live* labor-cost view (the /labor page, dashboard card) turns
  // it on so today's in-progress hours aren't under-counted while staff are on
  // the clock. `throughNow` is in the query key so the two variants don't collide.
  const throughNow = options?.throughNow ?? false;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['labor-costs-from-time-tracking', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd'), throughNow],
    queryFn: async (): Promise<{ dailyCosts: LaborCostData[]; totalCost: number; capped: boolean }> => {
      if (!restaurantId) {
        return { dailyCosts: [], totalCost: 0, capped: false };
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
      const { rows: punches, capped } = await fetchAllRows<DBTimePunch>((from, to) =>
        supabase
          .from('time_punches')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .gte('punch_time', fetchStart.toISOString())
          .lte('punch_time', fetchEnd.toISOString())
          .order('punch_time', { ascending: true })
          .order('id')
          .range(from, to),
      );

      // 2. Fetch per-job contractor payments (source records only)
      const { data: manualPaymentsData, error: manualPaymentsError } = await supabase
        .from('daily_labor_allocations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('source', 'per-job') // Only per-job source records, not auto-generated
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'));

      if (manualPaymentsError) throw manualPaymentsError;

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
      const punchesForCost = throughNow
        ? appendOpenShiftClockOuts(typedPunches, new Date())
        : typedPunches;

      // 4. Use calculateActualLaborCost from laborCalculations.ts (same as payroll)
      // This ensures Dashboard and Payroll use identical calculation logic
      const { dailyCosts: laborDailyCosts } = calculateActualLaborCost(
        employees,
        punchesForCost,
        dateFrom,
        dateTo
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
      const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_labor_cost, 0);

      return { dailyCosts, totalCost, capped };
    },
    enabled: !!restaurantId && !!employees.length,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    isLoading,
    error,
    refetch: () => { refetch(); },
    capped: data?.capped ?? false,
  };
}
