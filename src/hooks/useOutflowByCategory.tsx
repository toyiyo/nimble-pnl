import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, parseISO } from "date-fns";

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
  uncategorizedAmount: number;
  uncategorizedPercentage: number;
}

const STANDARD_CATEGORIES = [
  'Inventory/Food Purchases',
  'Labor/Payroll',
  'Rent & CAM',
  'Utilities',
  'Supplies & Packaging',
  'Marketing/Ads',
  'Equipment & Maintenance',
  'Processing/Bank Fees',
  'Loan/Lease Payments',
  'Taxes & Licenses',
  'Waste/Adjustments',
  'Other/Uncategorized'
];

export function useOutflowByCategory(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['outflow-by-category', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<OutflowByCategoryMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      // Fetch transactions (outflows only)
      let query = supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status, description, merchant_name, normalized_payee, category_id, chart_of_accounts(account_name, account_subtype)')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .lt('amount', 0) // Only outflows
        .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

      if (bankAccountId && bankAccountId !== 'all') {
        query = query.eq('connected_bank_id', bankAccountId);
      }

      const { data: transactions, error } = await query;

      if (error) throw error;

      const txns = transactions || [];
      const totalOutflows = Math.abs(txns.reduce((sum, t) => sum + t.amount, 0));

      // Group by category using chart of accounts
      const categoryMap = new Map<string, { amount: number; count: number; categoryId: string | null }>();

      txns.forEach(t => {
        let category = 'Other/Uncategorized';
        let categoryId: string | null = null;

        if (t.category_id && t.chart_of_accounts) {
          categoryId = t.category_id;
          const accountSubtype = t.chart_of_accounts.account_subtype;
          const accountName = t.chart_of_accounts.account_name || '';
          category = mapToStandardCategory(accountSubtype, accountName);
        }

        if (!categoryMap.has(category)) {
          categoryMap.set(category, { amount: 0, count: 0, categoryId });
        }
        const entry = categoryMap.get(category)!;
        entry.amount += Math.abs(t.amount);
        entry.count += 1;
      });

      const categories: CategorySpend[] = Array.from(categoryMap.entries())
        .map(([category, data]) => ({
          category,
          amount: data.amount,
          percentage: totalOutflows > 0 ? (data.amount / totalOutflows) * 100 : 0,
          transactionCount: data.count,
          categoryId: data.categoryId,
        }))
        .sort((a, b) => b.amount - a.amount);

      const uncategorizedEntry = categories.find(c => c.category === 'Other/Uncategorized');
      const uncategorizedAmount = uncategorizedEntry?.amount || 0;
      const uncategorizedPercentage = uncategorizedEntry?.percentage || 0;

      return {
        categories,
        totalOutflows,
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
