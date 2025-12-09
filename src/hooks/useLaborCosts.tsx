import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

/**
 * ⚠️ DEPRECATED: Do NOT use this hook - use useLaborCostsFromTimeTracking instead
 * 
 * CONTEXT: This hook queries daily_labor_allocations aggregation table.
 * This pattern has proven problematic (data sync issues, stale data).
 * 
 * NEW PATTERN: Calculate labor costs on-demand from source tables
 * ✅ Use: useLaborCostsFromTimeTracking (calculates from time_punches + employees + per-job allocations)
 * 
 * See: src/hooks/useLaborCostsFromTimeTracking.tsx for the new approach
 * See: src/hooks/usePayroll.tsx for the pattern we're following
 * See: docs/INTEGRATIONS.md for data flow architecture
 * 
 * @deprecated Use useLaborCostsFromTimeTracking instead
 */

/**
 * @deprecated Use useLaborCostsFromTimeTracking instead
 */
export interface LaborCostData {
  date: string;
  total_labor_cost: number;
  hourly_wages: number;
  salary_wages: number;
  benefits: number;
  total_hours: number;
}

/**
 * @deprecated Use useLaborCostsFromTimeTracking instead
 */
export interface LaborCostsResult {
  dailyCosts: LaborCostData[];
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Query labor costs directly from daily_labor_costs table (source of truth) AND
 * daily_labor_allocations table (salary + contractor allocations).
 * 
 * This combines:
 * 1. Hourly wages from daily_labor_costs.hourly_wages (time punch based)
 * 2. Salary allocations from daily_labor_allocations (compensation_type='salary')
 * 3. Contractor payments from daily_labor_allocations (compensation_type='contractor')
 * 
 * @deprecated Use useLaborCostsFromTimeTracking instead - this queries aggregation tables
 * @param restaurantId - Restaurant ID to filter costs
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Labor cost data by date including all compensation types
 */
export function useLaborCosts(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): LaborCostsResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['labor-costs', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
    queryFn: async () => {
      if (!restaurantId) return null;

      // Query daily_labor_costs for hourly wages
      const { data: laborCostsData, error: laborCostsError } = await supabase
        .from('daily_labor_costs')
        .select('date, total_labor_cost, hourly_wages, salary_wages, benefits, total_hours')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'))
        .order('date', { ascending: true })
        .limit(10000);

      if (laborCostsError) throw laborCostsError;

      // Query daily_labor_allocations for salary and contractor
      const { data: allocationsData, error: allocationsError } = await supabase
        .from('daily_labor_allocations')
        .select('date, allocated_cost, compensation_type')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'))
        .order('date', { ascending: true })
        .limit(10000);

      if (allocationsError) throw allocationsError;

      // Combine both sources by date
      const dateMap = new Map<string, LaborCostData>();

      // Add labor costs (hourly wages)
      (laborCostsData || []).forEach((row) => {
        dateMap.set(row.date, {
          date: row.date,
          total_labor_cost: Math.abs(Number(row.total_labor_cost) || 0),
          hourly_wages: Math.abs(Number(row.hourly_wages) || 0),
          salary_wages: Math.abs(Number(row.salary_wages) || 0),
          benefits: Math.abs(Number(row.benefits) || 0),
          total_hours: Number(row.total_hours) || 0,
        });
      });

      // Add allocations (salary and contractor)
      (allocationsData || []).forEach((row) => {
        const existing = dateMap.get(row.date);
        const allocationCost = Math.abs(row.allocated_cost / 100); // Convert cents to dollars
        
        if (existing) {
          existing.total_labor_cost += allocationCost;
          if (row.compensation_type === 'salary') {
            existing.salary_wages += allocationCost;
          }
          // Note: contractor costs are added to total but not broken out separately
          // in the current LaborCostData interface
        } else {
          dateMap.set(row.date, {
            date: row.date,
            total_labor_cost: allocationCost,
            hourly_wages: 0,
            salary_wages: row.compensation_type === 'salary' ? allocationCost : 0,
            benefits: 0,
            total_hours: 0,
          });
        }
      });

      const dailyCosts: LaborCostData[] = Array.from(dateMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      const totalCost = dailyCosts.reduce((sum, day) => sum + day.total_labor_cost, 0);

      return { dailyCosts, totalCost };
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    isLoading,
    error: error ?? null,
    refetch: () => void refetch(),
  };
}
