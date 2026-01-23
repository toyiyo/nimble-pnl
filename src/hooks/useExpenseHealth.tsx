import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, parseISO } from "date-fns";

// Processing fee detection patterns
const PROCESSING_FEE_PATTERNS = [
  'square fee',
  'stripe fee',
  'processing fee',
  'merchant fee',
  'card fee',
  'payment fee',
  'square',
  'stripe',
  'clover fee',
  'toast fee',
  'paypal fee',
];

export interface ExpenseHealthMetrics {
  foodCostPercentage: number;
  foodCostTarget: { min: number; max: number };
  laborPercentage: number;
  laborTarget: { min: number; max: number };
  primeCostPercentage: number;
  processingFeePercentage: number;
  processingFeeTarget: number;
  cashCoverageBeforePayroll: number; // multiplier (e.g., 1.5x)
  uncategorizedSpendPercentage: number;
  uncategorizedSpendTarget: number;
}

export function useExpenseHealth(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['expense-health', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<ExpenseHealthMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      // Fetch transactions for the period (including both posted and pending)
      let txQuery = supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status, description, merchant_name, category_id, chart_of_accounts!category_id(account_name, account_subtype)')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .in('status', ['posted', 'pending'])
        .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

      if (bankAccountId && bankAccountId !== 'all') {
        txQuery = txQuery.eq('connected_bank_id', bankAccountId);
      }

      const { data: transactions, error: txError } = await txQuery;
      if (txError) throw txError;

      const txns = transactions || [];

      // Calculate revenue (inflows)
      const revenue = txns
        .filter(t => t.amount > 0)
        .reduce((sum, t) => sum + t.amount, 0);

      // Calculate food cost (COGS)
      const foodCost = Math.abs(
        txns
          .filter(t => {
            if (t.amount >= 0) return false;
            if (!t.category_id || !t.chart_of_accounts) return false;
            const subtype = t.chart_of_accounts.account_subtype;
            const name = t.chart_of_accounts.account_name?.toLowerCase() || '';
            return subtype === 'cost_of_goods_sold' || name.includes('food') || name.includes('inventory');
          })
          .reduce((sum, t) => sum + t.amount, 0)
      );

      // Calculate labor cost
      const laborCost = Math.abs(
        txns
          .filter(t => {
            if (t.amount >= 0) return false;
            if (!t.category_id || !t.chart_of_accounts) return false;
            const subtype = t.chart_of_accounts.account_subtype;
            const name = t.chart_of_accounts.account_name?.toLowerCase() || '';
            return subtype === 'payroll' || name.includes('payroll') || name.includes('labor');
          })
          .reduce((sum, t) => sum + t.amount, 0)
      );

      // Calculate processing fees
      const processingFees = Math.abs(
        txns
          .filter(t => {
            if (t.amount >= 0) return false;
            const desc = (t.description || '').toLowerCase();
            const merchant = (t.merchant_name || '').toLowerCase();
            const text = `${desc} ${merchant}`;
            return PROCESSING_FEE_PATTERNS.some(pattern => text.includes(pattern));
          })
          .reduce((sum, t) => sum + t.amount, 0)
      );

      // Calculate uncategorized spend - only transactions with NO category_id assigned
      // Note: Transactions categorized under "Uncategorized Expense" account ARE categorized
      // (user made a conscious choice to put them there)
      const outflows = txns.filter(t => t.amount < 0);
      const totalOutflows = Math.abs(outflows.reduce((sum, t) => sum + t.amount, 0));
      const uncategorizedSpend = Math.abs(
        outflows.filter(t => !t.category_id).reduce((sum, t) => sum + t.amount, 0)
      );

      // Calculate percentages
      const foodCostPercentage = revenue > 0 ? (foodCost / revenue) * 100 : 0;
      const laborPercentage = revenue > 0 ? (laborCost / revenue) * 100 : 0;
      const primeCostPercentage = revenue > 0 ? ((foodCost + laborCost) / revenue) * 100 : 0;
      const processingFeePercentage = revenue > 0 ? (processingFees / revenue) * 100 : 0;
      const uncategorizedSpendPercentage = totalOutflows > 0 ? (uncategorizedSpend / totalOutflows) * 100 : 0;

      // Get current bank balance for cash coverage calculation
      const { data: balances, error: balancesError } = await supabase
        .from('bank_account_balances')
        .select('current_balance, connected_banks!inner(restaurant_id)')
        .eq('connected_banks.restaurant_id', selectedRestaurant.restaurant_id)
        .eq('is_active', true);

      if (balancesError) throw balancesError;

      const totalCashBalance = (balances || []).reduce((sum, b) => sum + Number(b.current_balance), 0);

      // Estimate next payroll (assume biweekly, calculate average payroll expense)
      const avgPayrollExpense = laborCost > 0 ? laborCost : 0;
      const cashCoverageBeforePayroll = avgPayrollExpense > 0 ? totalCashBalance / avgPayrollExpense : 0;

      // Targets (these could be configurable per restaurant in the future)
      const foodCostTarget = { min: 28, max: 32 };
      const laborTarget = { min: 25, max: 30 };
      const processingFeeTarget = 3.2;
      const uncategorizedSpendTarget = 5;

      return {
        foodCostPercentage,
        foodCostTarget,
        laborPercentage,
        laborTarget,
        primeCostPercentage,
        processingFeePercentage,
        processingFeeTarget,
        cashCoverageBeforePayroll,
        uncategorizedSpendPercentage,
        uncategorizedSpendTarget,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
