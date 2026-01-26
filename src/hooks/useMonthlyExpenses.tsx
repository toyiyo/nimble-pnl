import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { getAccountDisplayName, isLaborSubtype, isFoodCostSubtype } from '@/lib/expenseCategoryUtils';
import { fetchExpenseData } from '@/lib/expenseDataFetcher';

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
 * Groups expenses by chart of account names (individual accounts, not subtypes)
 * Includes pending outflows that haven't been matched to bank transactions to avoid double-counting
 * Uses shared expense data fetcher for consistency with other expense hooks
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

      // Use shared expense data fetcher for consistent data
      const { transactions, pendingOutflows, splitDetails } = await fetchExpenseData({
        restaurantId,
        startDate: dateFrom,
        endDate: dateTo,
      });

      // Group by month
      const monthlyMap = new Map<string, {
        period: string;
        totalExpenses: number;
        laborCost: number;
        foodCost: number;
        categoryMap: Map<string, { amount: number; count: number; categoryIds: Set<string> }>;
      }>();

      // Helper to ensure month entry exists
      const ensureMonth = (monthKey: string) => {
        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            period: monthKey,
            totalExpenses: 0,
            laborCost: 0,
            foodCost: 0,
            categoryMap: new Map(),
          });
        }
        return monthlyMap.get(monthKey)!;
      };

      // Helper to add to category map
      const addToCategory = (
        month: ReturnType<typeof ensureMonth>,
        category: string,
        amount: number,
        categoryId: string | null,
        incrementCount: boolean = true
      ) => {
        if (!month.categoryMap.has(category)) {
          month.categoryMap.set(category, { amount: 0, count: 0, categoryIds: new Set() });
        }
        const catEntry = month.categoryMap.get(category)!;
        catEntry.amount += amount;
        if (incrementCount) {
          catEntry.count += 1;
        }
        if (categoryId) {
          catEntry.categoryIds.add(categoryId);
        }
      };

      // Process bank transactions (skip split parents - use split details instead)
      transactions.filter(t => !t.is_split).forEach(t => {
        const monthKey = format(new Date(t.transaction_date), 'yyyy-MM');
        const month = ensureMonth(monthKey);
        const txnAmount = Math.abs(t.amount);
        
        month.totalExpenses += txnAmount;

        const accountSubtype = t.chart_of_accounts?.account_subtype;
        const accountName = t.chart_of_accounts?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);

        // Track food cost and labor separately using subtype-based helper functions
        if (isFoodCostSubtype(accountSubtype)) {
          month.foodCost += txnAmount;
        } else if (isLaborSubtype(accountSubtype)) {
          month.laborCost += txnAmount;
        }

        addToCategory(month, category, txnAmount, t.category_id);
      });

      // Process split transaction details (these have the actual categories)
      splitDetails.forEach(split => {
        // Find parent transaction to get the date
        const parentTxn = transactions.find(t => t.id === split.transaction_id);
        if (!parentTxn) return;

        const monthKey = format(new Date(parentTxn.transaction_date), 'yyyy-MM');
        const month = ensureMonth(monthKey);
        const splitAmount = split.amount; // Split amounts are already positive
        
        month.totalExpenses += splitAmount;

        const accountSubtype = split.chart_of_accounts?.account_subtype;
        const accountName = split.chart_of_accounts?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);

        // Track food cost and labor separately using subtype-based helper functions
        if (isFoodCostSubtype(accountSubtype)) {
          month.foodCost += splitAmount;
        } else if (isLaborSubtype(accountSubtype)) {
          month.laborCost += splitAmount;
        }

        addToCategory(month, category, splitAmount, split.category_id);
      });

      // Process pending outflows (not yet matched to bank transactions)
      pendingOutflows.forEach(t => {
        const monthKey = format(new Date(t.issue_date), 'yyyy-MM');
        const month = ensureMonth(monthKey);
        const txnAmount = t.amount; // Pending outflows are stored as positive amounts
        
        month.totalExpenses += txnAmount;

        const accountSubtype = t.chart_account?.account_subtype;
        const accountName = t.chart_account?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);

        // Track food cost and labor separately using subtype-based helper functions
        if (isFoodCostSubtype(accountSubtype)) {
          month.foodCost += txnAmount;
        } else if (isLaborSubtype(accountSubtype)) {
          month.laborCost += txnAmount;
        }

        // Don't increment count for pending outflows since they're not actual transactions yet
        addToCategory(month, category, txnAmount, t.category_id, false);
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
