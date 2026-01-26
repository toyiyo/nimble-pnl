import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { formatExpenseCategory, isLaborCategory, isFoodCostCategory } from '@/lib/expenseCategoryUtils';

export interface MonthlyExpenseCategory {
  category: string;
  amount: number;
  transactionCount: number;
  categoryIds: string[]; // Track UUIDs for drill-down navigation
}

export interface MonthlyExpenses {
  period: string; // 'YYYY-MM'
  totalExpenses: number;
  laborCost: number;
  foodCost: number;
  categories: MonthlyExpenseCategory[];
}

/**
 * Hook to fetch monthly expense data from bank transactions and pending outflows
 * Groups expenses by chart of account subtypes
 * Includes pending outflows that haven't been matched to bank transactions to avoid double-counting
 */
export function useMonthlyExpenses(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
) {
  return useQuery({
    queryKey: ['monthly-expenses', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd')],
    queryFn: async (): Promise<MonthlyExpenses[]> => {
      if (!restaurantId) return [];

      // Fetch all expense transactions (negative amounts)
      const { data: transactions, error } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status, category_id, is_transfer, chart_of_accounts!category_id(account_name, account_subtype)')
        .eq('restaurant_id', restaurantId)
        .in('status', ['posted', 'pending'])
        .lt('amount', 0) // Only outflows
        .gte('transaction_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('transaction_date', format(dateTo, 'yyyy-MM-dd'));

      if (error) throw error;

      // Exclude internal transfers (transfers between owned accounts)
      const txns = (transactions || []).filter(t => !t.is_transfer);

      // Fetch pending outflows (not yet matched to bank transactions)
      // Only include pending outflows that haven't been matched to avoid double-counting
      const { data: pendingOutflows, error: pendingError } = await supabase
        .from('pending_outflows')
        .select('amount, category_id, issue_date, status, linked_bank_transaction_id, chart_account:chart_of_accounts!category_id(account_name, account_subtype)')
        .eq('restaurant_id', restaurantId)
        .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
        .is('linked_bank_transaction_id', null) // Only unmatched pending outflows
        .gte('issue_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('issue_date', format(dateTo, 'yyyy-MM-dd'));

      if (pendingError) throw pendingError;

      const pendingTxns = pendingOutflows || [];

      // Group by month
      const monthlyMap = new Map<string, {
        period: string;
        totalExpenses: number;
        laborCost: number;
        foodCost: number;
        categoryMap: Map<string, { amount: number; count: number; categoryIds: Set<string> }>;
      }>();

      // Process cleared bank transactions
      txns.forEach(t => {
        const monthKey = format(new Date(t.transaction_date), 'yyyy-MM');

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            period: monthKey,
            totalExpenses: 0,
            laborCost: 0,
            foodCost: 0,
            categoryMap: new Map(),
          });
        }

        const month = monthlyMap.get(monthKey)!;
        const txnAmount = Math.abs(t.amount);
        
        month.totalExpenses += txnAmount;

        const accountSubtype = t.chart_of_accounts?.account_subtype;
        const accountName = t.chart_of_accounts?.account_name;
        const category = formatExpenseCategory(accountSubtype, accountName);

        // Track food cost and labor separately using helper functions
        if (isFoodCostCategory(category)) {
          month.foodCost += txnAmount;
        } else if (isLaborCategory(category)) {
          month.laborCost += txnAmount;
        }

        if (!month.categoryMap.has(category)) {
          month.categoryMap.set(category, { amount: 0, count: 0, categoryIds: new Set() });
        }
        const catEntry = month.categoryMap.get(category)!;
        catEntry.amount += txnAmount;
        catEntry.count += 1;
        if (t.category_id) {
          catEntry.categoryIds.add(t.category_id);
        }
      });

      // Process pending outflows (not yet matched to bank transactions)
      pendingTxns.forEach(t => {
        const monthKey = format(new Date(t.issue_date), 'yyyy-MM');

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            period: monthKey,
            totalExpenses: 0,
            laborCost: 0,
            foodCost: 0,
            categoryMap: new Map(),
          });
        }

        const month = monthlyMap.get(monthKey)!;
        const txnAmount = t.amount; // Pending outflows are stored as positive amounts
        
        month.totalExpenses += txnAmount;

        const accountSubtype = t.chart_account?.account_subtype;
        const accountName = t.chart_account?.account_name;
        const category = formatExpenseCategory(accountSubtype, accountName);

        // Track food cost and labor separately using helper functions
        if (isFoodCostCategory(category)) {
          month.foodCost += txnAmount;
        } else if (isLaborCategory(category)) {
          month.laborCost += txnAmount;
        }

        if (!month.categoryMap.has(category)) {
          month.categoryMap.set(category, { amount: 0, count: 0, categoryIds: new Set() });
        }
        const catEntry = month.categoryMap.get(category)!;
        catEntry.amount += txnAmount;
        // Don't increment count for pending outflows since they're not actual transactions yet
        if (t.category_id) {
          catEntry.categoryIds.add(t.category_id);
        }
      });

      // Convert to array format
      const result = Array.from(monthlyMap.values()).map(month => ({
        period: month.period,
        totalExpenses: month.totalExpenses,
        laborCost: month.laborCost,
        foodCost: month.foodCost,
        categories: Array.from(month.categoryMap.entries())
          .map(([category, data]) => ({
            category,
            amount: data.amount,
            transactionCount: data.count,
            categoryIds: Array.from(data.categoryIds),
          }))
          .sort((a, b) => b.amount - a.amount), // Sort by amount descending
      }));

      // Sort by period descending (most recent first)
      return result.sort((a, b) => b.period.localeCompare(a.period));
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}
