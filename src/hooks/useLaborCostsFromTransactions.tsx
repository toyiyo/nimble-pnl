import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toDateOnlyString } from '@/lib/dateOnly';
import { keepDataUnlessRestaurantChanged } from '@/lib/react-query-config';
import {
  loadPeriodBankLabor,
  type TransactionLaborCostData,
} from '../../supabase/functions/_shared/labor/periodLaborCost';

export type { TransactionLaborCostData };

export interface LaborCostsFromTransactionsResult {
  dailyCosts: TransactionLaborCostData[];
  totalCost: number;
  /** True when a paged read (bank transactions, pending outflows) hit the
   * `maxPages` cap of the loader. The results can then be incomplete. */
  capped: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Query labor costs from bank transactions and pending outflows that are categorized
 * to labor-related chart of accounts (account_subtype='labor').
 * 
 * This captures payroll expenses paid through bank accounts that aren't tracked
 * in the time punch system (e.g., payroll taxes, benefits, external payroll services).
 * 
 * @param restaurantId - Restaurant ID to filter costs
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Labor cost data from financial transactions
 */
export function useLaborCostsFromTransactions(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): LaborCostsFromTransactionsResult {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['labor-costs-from-transactions', restaurantId, toDateOnlyString(dateFrom), toDateOnlyString(dateTo)],
    queryFn: async () => {
      if (!restaurantId) return null;

      // The loader pages both reads past the PostgREST 1,000-row limit, up
      // to its `maxPages` cap, and filters the calendar-day columns by the
      // day strings. `capped` is true when a read stops at that cap.
      const { dailyCosts, totalCost, capped } = await loadPeriodBankLabor(supabase, {
        restaurantId,
        startDay: toDateOnlyString(dateFrom),
        endDay: toDateOnlyString(dateTo),
      });
      return { dailyCosts, totalCost, capped };
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: keepDataUnlessRestaurantChanged(restaurantId),
  });

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    capped: data?.capped ?? false,
    isLoading,
    isFetching,
    error: error as Error | null,
    refetch,
  };
}
