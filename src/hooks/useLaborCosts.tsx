import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface LaborCostData {
  date: string;
  total_labor_cost: number;
  hourly_wages: number;
  salary_wages: number;
  benefits: number;
  total_hours: number;
}

export interface LaborCostsResult {
  dailyCosts: LaborCostData[];
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Query labor costs directly from daily_labor_costs table (source of truth).
 * This table contains manually entered or integrated labor cost data.
 * 
 * @param restaurantId - Restaurant ID to filter costs
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Labor cost data by date
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

      const { data, error } = await supabase
        .from('daily_labor_costs')
        .select('date, total_labor_cost, hourly_wages, salary_wages, benefits, total_hours')
        .eq('restaurant_id', restaurantId)
        .gte('date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('date', format(dateTo, 'yyyy-MM-dd'))
        .order('date', { ascending: true });

      if (error) throw error;

      const dailyCosts: LaborCostData[] = (data || []).map((row) => ({
        date: row.date,
        // Use Math.abs() because labor costs may be stored as negative values (accounting convention)
        // but profit calculations expect positive cost values
        total_labor_cost: Math.abs(Number(row.total_labor_cost) || 0),
        hourly_wages: Math.abs(Number(row.hourly_wages) || 0),
        salary_wages: Math.abs(Number(row.salary_wages) || 0),
        benefits: Math.abs(Number(row.benefits) || 0),
        total_hours: Number(row.total_hours) || 0,
      }));

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
    error: error as Error | null,
    refetch,
  };
}
