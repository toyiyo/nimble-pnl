import { useQuery } from "@tanstack/react-query";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format } from "date-fns";
import { getAccountDisplayName, isUncategorized } from "@/lib/expenseCategoryUtils";
import { fetchExpenseData, ExpenseTransaction, SplitDetail } from "@/lib/expenseDataFetcher";

export interface CategorySpend {
  category: string;
  amount: number;
  percentage: number;
  transactionCount: number;
  categoryId: string | null;
  delta?: number; // vs prior period
}

interface OutflowByCategoryMetrics {
  categories: CategorySpend[];
  totalOutflows: number;
  clearedOutflows: number;
  pendingOutflows: number;
  uncategorizedAmount: number;
  uncategorizedPercentage: number;
}

export function useOutflowByCategory(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['outflow-by-category', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<OutflowByCategoryMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      // Use shared expense data fetcher for consistent data
      const { transactions, pendingOutflows: pendingCheckTxns, splitDetails } = await fetchExpenseData({
        restaurantId: selectedRestaurant.restaurant_id,
        startDate,
        endDate,
        bankAccountId,
      });

      // Separate posted from pending bank transactions
      const postedTxns = transactions.filter(t => t.status === 'posted');
      const pendingTxns = transactions.filter(t => t.status === 'pending');
      
      const clearedOutflows = Math.abs(postedTxns.reduce((sum, t) => sum + t.amount, 0));
      const pendingBankOutflows = Math.abs(pendingTxns.reduce((sum, t) => sum + t.amount, 0));
      const totalPendingCheckOutflows = pendingCheckTxns.reduce((sum, t) => sum + t.amount, 0);
      
      // Total pending = pending bank transactions + pending checks
      const totalPendingOutflows = pendingBankOutflows + totalPendingCheckOutflows;

      // Group posted and pending bank transactions by category
      const categoryMap = new Map<string, { amount: number; pendingAmount: number; count: number; categoryId: string | null }>();

      // Process posted bank transactions
      // Skip split parent transactions - their categories are in bank_transaction_splits
      postedTxns.filter(t => !t.is_split).forEach(t => {
        const accountSubtype = t.chart_of_accounts?.account_subtype;
        const accountName = t.chart_of_accounts?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);
        const categoryId = t.category_id || null;

        if (!categoryMap.has(category)) {
          categoryMap.set(category, { amount: 0, pendingAmount: 0, count: 0, categoryId });
        }
        const entry = categoryMap.get(category)!;
        entry.amount += Math.abs(t.amount);
        entry.count += 1;
      });

      // Add pending bank transactions to category map
      // Skip split parent transactions
      pendingTxns.filter(t => !t.is_split).forEach(t => {
        const accountSubtype = t.chart_of_accounts?.account_subtype;
        const accountName = t.chart_of_accounts?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);
        const categoryId = t.category_id || null;

        if (!categoryMap.has(category)) {
          categoryMap.set(category, { amount: 0, pendingAmount: 0, count: 0, categoryId });
        }
        const entry = categoryMap.get(category)!;
        entry.pendingAmount += Math.abs(t.amount);
      });

      // Add pending check outflows to category map
      pendingCheckTxns.forEach(t => {
        const accountSubtype = t.chart_account?.account_subtype;
        const accountName = t.chart_account?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);
        const categoryId = t.category_id || null;

        if (!categoryMap.has(category)) {
          categoryMap.set(category, { amount: 0, pendingAmount: 0, count: 0, categoryId });
        }
        const entry = categoryMap.get(category)!;
        entry.pendingAmount += t.amount;
      });

      // Process split transaction line items (these have the actual categories)
      splitDetails.forEach(split => {
        const accountSubtype = split.chart_of_accounts?.account_subtype;
        const accountName = split.chart_of_accounts?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);
        const categoryId = split.category_id || null;

        // Determine if this is posted or pending based on parent transaction
        const parentTxn = transactions.find(t => t.id === split.transaction_id);
        const isPending = parentTxn?.status === 'pending';

        if (!categoryMap.has(category)) {
          categoryMap.set(category, { amount: 0, pendingAmount: 0, count: 0, categoryId });
        }
        const entry = categoryMap.get(category)!;
        
        // Split amounts are positive (representing the portion of the outflow)
        if (isPending) {
          entry.pendingAmount += split.amount;
        } else {
          entry.amount += split.amount;
        }
        entry.count += 1;
      });

      const totalOutflows = clearedOutflows + totalPendingOutflows;

      const categories: CategorySpend[] = Array.from(categoryMap.entries())
        .map(([category, data]) => ({
          category,
          amount: data.amount + data.pendingAmount, // Total = cleared + pending
          percentage: totalOutflows > 0 ? ((data.amount + data.pendingAmount) / totalOutflows) * 100 : 0,
          transactionCount: data.count,
          categoryId: data.categoryId,
        }))
        .sort((a, b) => b.amount - a.amount);

      const uncategorizedEntry = categories.find(c => isUncategorized(c.category));
      const uncategorizedAmount = uncategorizedEntry?.amount || 0;
      const uncategorizedPercentage = uncategorizedEntry?.percentage || 0;

      return {
        categories,
        totalOutflows,
        clearedOutflows,
        pendingOutflows: totalPendingOutflows,
        uncategorizedAmount,
        uncategorizedPercentage,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
