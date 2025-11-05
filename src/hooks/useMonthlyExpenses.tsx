import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

// Helper function to map account types to standard expense categories
function mapToStandardCategory(accountSubtype: string, accountName: string): string {
  const nameLower = accountName.toLowerCase();
  
  // Map based on account subtype first
  if (accountSubtype === 'cost_of_goods_sold' || nameLower.includes('food') || nameLower.includes('inventory')) {
    return 'Inventory/Food Purchases';
  }
  if (accountSubtype === 'payroll' || nameLower.includes('payroll') || nameLower.includes('labor')) {
    return 'Labor/Payroll';
  }
  
  // Map based on account name keywords
  if (nameLower.includes('rent') || nameLower.includes('cam') || nameLower.includes('lease')) {
    return 'Rent & CAM';
  }
  if (nameLower.includes('utilities') || nameLower.includes('electric') || nameLower.includes('gas') || nameLower.includes('water')) {
    return 'Utilities';
  }
  if (nameLower.includes('supplies') || nameLower.includes('packaging')) {
    return 'Supplies & Packaging';
  }
  if (nameLower.includes('marketing') || nameLower.includes('advertising')) {
    return 'Marketing/Ads';
  }
  if (nameLower.includes('equipment') || nameLower.includes('maintenance') || nameLower.includes('repair')) {
    return 'Equipment & Maintenance';
  }
  if (nameLower.includes('fee') || nameLower.includes('processing')) {
    return 'Processing/Bank Fees';
  }
  if (nameLower.includes('loan') || nameLower.includes('interest')) {
    return 'Loan/Lease Payments';
  }
  if (nameLower.includes('tax') || nameLower.includes('license')) {
    return 'Taxes & Licenses';
  }
  if (nameLower.includes('waste') || nameLower.includes('adjustment')) {
    return 'Waste/Adjustments';
  }
  
  // Default to Other/Uncategorized
  return 'Other/Uncategorized';
}

export interface MonthlyExpenseCategory {
  category: string;
  amount: number;
  transactionCount: number;
}

export interface MonthlyExpenses {
  period: string; // 'YYYY-MM'
  totalExpenses: number;
  laborCost: number;
  foodCost: number;
  categories: MonthlyExpenseCategory[];
}

/**
 * Hook to fetch monthly expense data from bank transactions
 * Groups expenses by the 12 standard categories
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
        .select('transaction_date, amount, status, category_id, chart_of_accounts!category_id(account_name, account_subtype)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'posted')
        .lt('amount', 0) // Only outflows
        .gte('transaction_date', format(dateFrom, 'yyyy-MM-dd'))
        .lte('transaction_date', format(dateTo, 'yyyy-MM-dd'));

      if (error) throw error;

      const txns = transactions || [];

      // Group by month
      const monthlyMap = new Map<string, {
        period: string;
        totalExpenses: number;
        laborCost: number;
        foodCost: number;
        categoryMap: Map<string, { amount: number; count: number }>;
      }>();

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

        let category = 'Other/Uncategorized';

        if (t.category_id && t.chart_of_accounts) {
          const accountSubtype = t.chart_of_accounts.account_subtype;
          const accountName = t.chart_of_accounts.account_name || '';
          category = mapToStandardCategory(accountSubtype, accountName);

          // Track food cost and labor separately
          if (category === 'Inventory/Food Purchases') {
            month.foodCost += txnAmount;
          } else if (category === 'Labor/Payroll') {
            month.laborCost += txnAmount;
          }
        }

        if (!month.categoryMap.has(category)) {
          month.categoryMap.set(category, { amount: 0, count: 0 });
        }
        const catEntry = month.categoryMap.get(category)!;
        catEntry.amount += txnAmount;
        catEntry.count += 1;
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
