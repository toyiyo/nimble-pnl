import { useQuery } from "@tanstack/react-query";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, differenceInDays, parseISO } from "date-fns";
import { getAccountDisplayName } from "@/lib/expenseCategoryUtils";
import { fetchExpenseData, ExpenseTransaction, SplitDetail } from "@/lib/expenseDataFetcher";

interface VendorSpend {
  vendor: string;
  total: number;
  count: number;
  percentage: number;
}

interface RecurringExpense {
  vendor: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  avgAmount: number;
  lastAmount: number;
  nextExpectedDate: Date;
}

interface CategorySpend {
  category: string;
  amount: number;
  percentage: number;
}

interface SpendingAnalysisMetrics {
  topVendors: VendorSpend[];
  categoryBreakdown: CategorySpend[];
  vendorConcentration: number;
  recurringExpenses: RecurringExpense[];
  avgWeeklyOutflow: number;
  totalOutflows: number;
  vendorSpendVariance: Array<{
    vendor: string;
    currentSpend: number;
    previousSpend: number;
    changePercent: number;
  }>;
  processingFees: number;
  processingFeePercentage: number;
  weekendOutflows: number;
  weekendRatio: number;
  aiConfidencePercentage: number;
  uncategorizedSpend: number;
  uncategorizedPercentage: number;
}

export function useSpendingAnalysis(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['spending-analysis', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<SpendingAnalysisMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const periodDays = differenceInDays(endDate, startDate) + 1;

      // Use shared expense data fetcher for consistent data
      const { transactions, pendingOutflows, splitDetails, previousPeriodTransactions } = await fetchExpenseData({
        restaurantId: selectedRestaurant.restaurant_id,
        startDate,
        endDate,
        bankAccountId,
        includePreviousPeriod: true,
      });

      // Combine bank transactions with pending check outflows for current period analysis
      const currentOutflows = transactions;
      const previousOutflows = previousPeriodTransactions || [];

      // Calculate total outflows (bank transactions + pending checks)
      // For bank transactions, skip split parents - use split details instead
      const bankOutflowTotal = currentOutflows
        .filter(t => !t.is_split)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      const splitOutflowTotal = splitDetails.reduce((sum, s) => sum + s.amount, 0);
      const pendingCheckTotal = pendingOutflows.reduce((sum, t) => sum + t.amount, 0);
      
      const totalOutflows = bankOutflowTotal + splitOutflowTotal + pendingCheckTotal;

      // Group by vendor (bank transactions only - pending checks don't have detailed vendor info in the same format)
      const vendorMap = new Map<string, { total: number; count: number; transactions: ExpenseTransaction[] }>();
      
      currentOutflows.filter(t => !t.is_split).forEach(t => {
        const vendor = t.merchant_name || t.normalized_payee || t.description || 'Unknown';
        if (!vendorMap.has(vendor)) {
          vendorMap.set(vendor, { total: 0, count: 0, transactions: [] });
        }
        const entry = vendorMap.get(vendor)!;
        entry.total += Math.abs(t.amount);
        entry.count += 1;
        entry.transactions.push(t);
      });

      // Top 5 vendors
      const topVendors: VendorSpend[] = Array.from(vendorMap.entries())
        .map(([vendor, data]) => ({
          vendor,
          total: data.total,
          count: data.count,
          percentage: totalOutflows > 0 ? (data.total / totalOutflows) * 100 : 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      // Vendor concentration (top 3 as % of total)
      const top3Total = topVendors.slice(0, 3).reduce((sum, v) => sum + v.total, 0);
      const vendorConcentration = totalOutflows > 0 ? (top3Total / totalOutflows) * 100 : 0;

      // Category breakdown using actual chart of accounts names
      const categoryMap = new Map<string, number>();
      
      // Add non-split bank transactions
      currentOutflows.filter(t => !t.is_split).forEach(t => {
        const accountSubtype = t.chart_of_accounts?.account_subtype;
        const accountName = t.chart_of_accounts?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);
        categoryMap.set(category, (categoryMap.get(category) || 0) + Math.abs(t.amount));
      });

      // Add split details
      splitDetails.forEach(split => {
        const accountSubtype = split.chart_of_accounts?.account_subtype;
        const accountName = split.chart_of_accounts?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);
        categoryMap.set(category, (categoryMap.get(category) || 0) + split.amount);
      });

      // Add pending check outflows
      pendingOutflows.forEach(t => {
        const accountSubtype = t.chart_account?.account_subtype;
        const accountName = t.chart_account?.account_name;
        const category = getAccountDisplayName(accountName, accountSubtype);
        categoryMap.set(category, (categoryMap.get(category) || 0) + t.amount);
      });

      const categoryBreakdown: CategorySpend[] = Array.from(categoryMap.entries())
        .map(([category, amount]) => ({
          category,
          amount,
          percentage: totalOutflows > 0 ? (amount / totalOutflows) * 100 : 0
        }))
        .sort((a, b) => b.amount - a.amount);

      // Detect recurring expenses (simplified - look for similar amounts at regular intervals)
      const recurringExpenses: RecurringExpense[] = [];
      vendorMap.forEach((data, vendor) => {
        if (data.count >= 2) {
          const amounts = data.transactions.map(t => Math.abs(t.amount));
          const avgAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
          
          // Check if amounts are similar (within 20%), skip if avgAmount is 0
          const isSimilarAmount = avgAmount > 0 
            ? amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.2)
            : false;
          
          if (isSimilarAmount) {
            const dates = data.transactions.map(t => parseISO(t.transaction_date)).sort((a, b) => a.getTime() - b.getTime());
            const intervals = [];
            for (let i = 1; i < dates.length; i++) {
              intervals.push(differenceInDays(dates[i], dates[i - 1]));
            }
            const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
            
            let frequency: 'weekly' | 'biweekly' | 'monthly' = 'monthly';
            if (avgInterval <= 9) frequency = 'weekly';
            else if (avgInterval <= 16) frequency = 'biweekly';
            
            recurringExpenses.push({
              vendor,
              frequency,
              avgAmount,
              lastAmount: amounts[amounts.length - 1],
              nextExpectedDate: new Date(dates[dates.length - 1].getTime() + avgInterval * 24 * 60 * 60 * 1000)
            });
          }
        }
      });

      // Vendor spend variance
      const previousVendorMap = new Map<string, number>();
      previousOutflows.forEach(t => {
        const vendor = t.merchant_name || t.normalized_payee || t.description || 'Unknown';
        previousVendorMap.set(vendor, (previousVendorMap.get(vendor) || 0) + Math.abs(t.amount));
      });

      const vendorSpendVariance = topVendors.map(v => {
        const previousSpend = previousVendorMap.get(v.vendor) || 0;
        const changePercent = previousSpend > 0 
          ? ((v.total - previousSpend) / previousSpend) * 100
          : 100;
        return {
          vendor: v.vendor,
          currentSpend: v.total,
          previousSpend,
          changePercent
        };
      });

      // Average weekly outflow
      const weeks = periodDays / 7;
      const avgWeeklyOutflow = weeks > 0 ? totalOutflows / weeks : 0;

      // Payment Processing Fees - look for fee-related accounts by name since no dedicated subtype exists
      const processingFeeTransactions = currentOutflows.filter(t => {
        const accountName = (t.chart_of_accounts?.account_name || '').toLowerCase();
        // Match accounts explicitly named for fees/processing, but NOT professional fees
        return (accountName.includes('processing') || 
                accountName.includes('merchant fee') || 
                accountName.includes('bank fee') ||
                accountName.includes('card fee') ||
                accountName.includes('payment fee')) &&
               !accountName.includes('professional');
      });
      const processingFees = processingFeeTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      // Calculate total inflows for fee percentage (need separate query since fetcher only gets outflows)
      // For now, use outflows as denominator - can be refined later if needed
      const processingFeePercentage = totalOutflows > 0 ? (processingFees / totalOutflows) * 100 : 0;

      // Weekend vs Weekday Outflows
      const weekendOutflows = currentOutflows
        .filter(t => !t.is_split)
        .filter(t => {
          const day = parseISO(t.transaction_date).getDay();
          return day === 0 || day === 6; // Sunday or Saturday
        })
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      const weekendRatio = totalOutflows > 0 ? (weekendOutflows / totalOutflows) * 100 : 0;

      // Auto-Categorization Confidence
      const allBankTxns = currentOutflows;
      const aiCategorizedCount = allBankTxns.filter(t => 
        t.category_id && t.ai_confidence === 'high'
      ).length;
      
      const aiConfidencePercentage = allBankTxns.length > 0 
        ? (aiCategorizedCount / allBankTxns.length) * 100 
        : 0;

      // Uncategorized Spend - exclude split transactions (they have categories in child splits)
      const uncategorizedSpend = currentOutflows
        .filter(t => !t.category_id && !t.is_split)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      const uncategorizedPercentage = totalOutflows > 0 
        ? (uncategorizedSpend / totalOutflows) * 100 
        : 0;

      return {
        topVendors,
        categoryBreakdown,
        vendorConcentration,
        recurringExpenses,
        avgWeeklyOutflow,
        totalOutflows,
        vendorSpendVariance,
        processingFees,
        processingFeePercentage,
        weekendOutflows,
        weekendRatio,
        aiConfidencePercentage,
        uncategorizedSpend,
        uncategorizedPercentage,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
