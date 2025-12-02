import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO } from 'date-fns';

export interface TransactionLaborCostData {
  date: string;
  labor_cost: number;
  transaction_count: number;
}

export interface LaborCostsFromTransactionsResult {
  dailyCosts: TransactionLaborCostData[];
  totalCost: number;
  isLoading: boolean;
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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['labor-costs-from-transactions', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
    queryFn: async () => {
      if (!restaurantId) return null;

      // Fetch bank transactions categorized to labor accounts
      // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
      // to ensure we get all labor-related transactions for accurate cost calculations
      const { data: bankTxns, error: bankError } = await supabase
        .from('bank_transactions')
        .select(`
          transaction_date,
          amount,
          status,
          chart_of_accounts!category_id(
            account_subtype
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('transaction_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('transaction_date', format(dateTo, 'yyyy-MM-dd'))
        .in('status', ['posted', 'pending'])
        .lt('amount', 0) // Only outflows
        .limit(10000); // Override Supabase's default 1000 row limit

      if (bankError) throw bankError;

      // Fetch pending outflows categorized to labor accounts
      // Note: Supabase has a default limit of 1000 rows, so we need to set a higher limit
      // to ensure we get all labor-related pending outflows for accurate cost calculations
      const { data: pendingTxns, error: pendingError } = await supabase
        .from('pending_outflows')
        .select(`
          issue_date,
          amount,
          status,
          chart_account:chart_of_accounts!category_id(
            account_subtype
          )
        `)
        .eq('restaurant_id', restaurantId)
        .gte('issue_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('issue_date', format(dateTo, 'yyyy-MM-dd'))
        .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
        .limit(10000); // Override Supabase's default 1000 row limit

      if (pendingError) throw pendingError;

      // Filter and group by date
      const dateMap = new Map<string, { cost: number; count: number }>();

      // Process bank transactions - filter for labor accounts
      (bankTxns || []).forEach((txn) => {
        const account = txn.chart_of_accounts as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const date = txn.transaction_date;
          const cost = Math.abs(txn.amount);
          
          const existing = dateMap.get(date);
          if (existing) {
            existing.cost += cost;
            existing.count += 1;
          } else {
            dateMap.set(date, { cost, count: 1 });
          }
        }
      });

      // Process pending outflows - filter for labor accounts
      (pendingTxns || []).forEach((txn) => {
        const account = txn.chart_account as { account_subtype?: string } | null;
        if (account?.account_subtype === 'labor') {
          const date = txn.issue_date;
          const cost = Math.abs(txn.amount);
          
          const existing = dateMap.get(date);
          if (existing) {
            existing.cost += cost;
            existing.count += 1;
          } else {
            dateMap.set(date, { cost, count: 1 });
          }
        }
      });

      // Convert to array and sort by date
      const dailyCosts: TransactionLaborCostData[] = Array.from(dateMap.entries())
        .map(([date, data]) => ({
          date,
          labor_cost: data.cost,
          transaction_count: data.count,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalCost = dailyCosts.reduce((sum, day) => sum + day.labor_cost, 0);

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
