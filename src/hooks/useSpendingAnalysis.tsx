import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, differenceInDays, parseISO, subDays } from "date-fns";

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
      const previousPeriodStart = subDays(startDate, periodDays);

      // Fetch current and previous period transactions
      let query = supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status, description, merchant_name, normalized_payee, category_id, ai_confidence')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .gte('transaction_date', format(previousPeriodStart, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

      // Apply bank account filter if specified
      if (bankAccountId && bankAccountId !== 'all') {
        query = query.eq('connected_bank_id', bankAccountId);
      }

      const { data: transactions, error } = await query.order('transaction_date', { ascending: true });

      if (error) throw error;

      const txns = transactions || [];

      // Filter outflows for current period
      const currentOutflows = txns
        .filter(t => {
          const txnDate = parseISO(t.transaction_date);
          return t.amount < 0 && txnDate >= startDate && txnDate <= endDate;
        });

      // Filter outflows for previous period
      const previousOutflows = txns
        .filter(t => {
          const txnDate = parseISO(t.transaction_date);
          return t.amount < 0 && txnDate >= previousPeriodStart && txnDate < startDate;
        });

      const totalOutflows = Math.abs(currentOutflows.reduce((sum, t) => sum + t.amount, 0));

      // Group by vendor
      const vendorMap = new Map<string, { total: number; count: number; transactions: typeof currentOutflows }>();
      
      currentOutflows.forEach(t => {
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

      // Category breakdown (simplified - based on keywords)
      const categorizeTransaction = (t: typeof currentOutflows[0]) => {
        const text = `${t.description || ''} ${t.merchant_name || ''} ${t.normalized_payee || ''}`.toLowerCase();
        
        if (text.includes('sysco') || text.includes('food') || text.includes('produce') || text.includes('restaurant depot')) return 'Food & Supplies';
        if (text.includes('payroll') || text.includes('gusto') || text.includes('adp')) return 'Labor';
        if (text.includes('electric') || text.includes('gas') || text.includes('water') || text.includes('utility')) return 'Utilities';
        if (text.includes('rent') || text.includes('lease')) return 'Rent';
        if (text.includes('insurance')) return 'Insurance';
        if (text.includes('software') || text.includes('saas') || text.includes('subscription')) return 'Software/SaaS';
        if (text.includes('marketing') || text.includes('advertising')) return 'Marketing';
        return 'Other';
      };

      const categoryMap = new Map<string, number>();
      currentOutflows.forEach(t => {
        const category = categorizeTransaction(t);
        categoryMap.set(category, (categoryMap.get(category) || 0) + Math.abs(t.amount));
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
          
          // Check if amounts are similar (within 20%)
          const isSimilarAmount = amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.2);
          
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

      // Payment Processing Fees
      const processingFeeTransactions = currentOutflows.filter(t => {
        const desc = (t.description || '').toLowerCase();
        return desc.includes('square fee') || 
               desc.includes('stripe fee') || 
               desc.includes('processing fee') ||
               desc.includes('merchant fee') ||
               desc.includes('card fee') ||
               desc.includes('payment fee');
      });
      const processingFees = processingFeeTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      // Calculate total inflows for fee percentage
      const totalInflows = txns
        .filter(t => {
          const txnDate = parseISO(t.transaction_date);
          return t.amount > 0 && txnDate >= startDate && txnDate <= endDate;
        })
        .reduce((sum, t) => sum + t.amount, 0);
      
      const processingFeePercentage = totalInflows > 0 ? (processingFees / totalInflows) * 100 : 0;

      // Weekend vs Weekday Outflows
      const weekendOutflows = currentOutflows
        .filter(t => {
          const day = parseISO(t.transaction_date).getDay();
          return day === 0 || day === 6; // Sunday or Saturday
        })
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      
      const weekendRatio = totalOutflows > 0 ? (weekendOutflows / totalOutflows) * 100 : 0;

      // Auto-Categorization Confidence
      const currentPeriodTxns = txns.filter(t => {
        const txnDate = parseISO(t.transaction_date);
        return txnDate >= startDate && txnDate <= endDate;
      });
      
      const aiCategorizedCount = currentPeriodTxns.filter(t => 
        t.category_id && t.ai_confidence === 'high'
      ).length;
      
      const aiConfidencePercentage = currentPeriodTxns.length > 0 
        ? (aiCategorizedCount / currentPeriodTxns.length) * 100 
        : 0;

      // Uncategorized Spend
      const uncategorizedSpend = currentOutflows
        .filter(t => !t.category_id)
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
