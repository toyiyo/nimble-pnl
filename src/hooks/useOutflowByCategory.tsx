import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format } from "date-fns";
import { getAccountDisplayName, isUncategorized } from "@/lib/expenseCategoryUtils";

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

      // Fetch cleared and pending transactions (outflows only)
      let query = supabase
        .from('bank_transactions')
        .select('id, transaction_date, amount, status, description, merchant_name, normalized_payee, category_id, is_split, is_transfer, chart_of_accounts!category_id(account_name, account_subtype)')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .in('status', ['posted', 'pending'])
        .eq('is_transfer', false) // Exclude transfers
        .lt('amount', 0) // Only outflows
        .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

      if (bankAccountId && bankAccountId !== 'all') {
        query = query.eq('connected_bank_id', bankAccountId);
      }

      const { data: transactions, error } = await query;

      if (error) throw error;

      const txns = transactions || [];
      
      // Fetch split transaction details for split parent transactions
      const splitParentIds = txns.filter(t => t.is_split).map(t => t.id);
      
      interface SplitDetail {
        transaction_id: string;
        amount: number;
        category_id: string;
        chart_of_accounts: { account_name: string; account_subtype: string } | null;
      }
      
      let splitDetails: SplitDetail[] = [];
      
      if (splitParentIds.length > 0) {
        const { data: splits, error: splitsError } = await supabase
          .from('bank_transaction_splits')
          .select('transaction_id, amount, category_id, chart_of_accounts:chart_of_accounts!category_id(account_name, account_subtype)')
          .in('transaction_id', splitParentIds);

        if (splitsError) {
          console.error('Error fetching split details:', splitsError);
        } else {
          splitDetails = (splits || []) as SplitDetail[];
        }
      }
      
      // Separate posted from pending bank transactions
      const postedTxns = txns.filter(t => t.status === 'posted');
      const pendingTxns = txns.filter(t => t.status === 'pending');
      
      const clearedOutflows = Math.abs(postedTxns.reduce((sum, t) => sum + t.amount, 0));
      const pendingBankOutflows = Math.abs(pendingTxns.reduce((sum, t) => sum + t.amount, 0));

      // Fetch pending outflows (checks) for the same period
      const { data: pendingOutflows, error: pendingError } = await supabase
        .from('pending_outflows')
        .select('amount, category_id, issue_date, status, chart_account:chart_of_accounts!category_id(account_name, account_subtype)')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .in('status', ['pending', 'stale_30', 'stale_60', 'stale_90'])
        .gte('issue_date', format(startDate, 'yyyy-MM-dd'))
        .lte('issue_date', format(endDate, 'yyyy-MM-dd'));

      if (pendingError) throw pendingError;

      const pendingCheckTxns = pendingOutflows || [];
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
        const parentTxn = txns.find(t => t.id === split.transaction_id);
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
