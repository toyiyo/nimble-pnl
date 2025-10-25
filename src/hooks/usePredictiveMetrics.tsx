import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, differenceInDays, addDays, parseISO, getDay } from "date-fns";

interface NextDepositPrediction {
  expectedDate: Date;
  expectedAmount: number;
  confidence: number;
}

interface NextPayrollPrediction {
  expectedDate: Date;
  expectedAmount: number;
  dayOfWeek: string;
}

interface SupplierCostDrift {
  supplier: string;
  avgLast30Days: number;
  avgPrevious30Days: number;
  driftPercent: number;
}

interface RecurringExpense {
  vendor: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  avgAmount: number;
  lastAmount: number;
  nextExpectedDate: Date;
}

interface PredictiveMetrics {
  nextDeposit: NextDepositPrediction | null;
  nextPayroll: NextPayrollPrediction | null;
  supplierCostDrift: SupplierCostDrift[];
  seasonalityDetected: boolean;
  seasonalityMessage: string;
  recurringExpenses: RecurringExpense[];
}

export function usePredictiveMetrics(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['predictive-metrics', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<PredictiveMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const periodDays = differenceInDays(endDate, startDate) + 1;
      const extendedStart = addDays(startDate, -60); // Look back 60 more days for patterns

      let query = supabase
        .from('bank_transactions')
        .select('id, transaction_date, amount, status, description, merchant_name, normalized_payee, category_id')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .gte('transaction_date', format(extendedStart, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

      // Apply bank account filter if specified
      if (bankAccountId && bankAccountId !== 'all') {
        query = query.eq('connected_bank_id', bankAccountId);
      }

      const { data: transactions, error } = await query.order('transaction_date', { ascending: true });

      if (error) throw error;

      const txns = transactions || [];

      // Fetch revenue accounts for categorization-based detection
      const { data: revenueAccounts } = await supabase
        .from('chart_of_accounts')
        .select('id')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('account_type', 'revenue');
      
      const revenueAccountIds = new Set(revenueAccounts?.map(a => a.id) || []);

      // Predict next deposit - Enhanced detection
      const deposits = txns.filter(t => t.amount > 0);
      
      // Method 1: Categorized as revenue
      const categorizedRevenue = deposits.filter(t => 
        t.category_id && revenueAccountIds.has(t.category_id)
      );
      
      // Method 2: Keyword-based detection
      const uncategorized = deposits.filter(t => !t.category_id);
      
      const posKeywords = [
        'square', 'clover', 'toast', 'lightspeed', 'shopify',
        'revel', 'touchbistro', 'upserve', 'aloha', 'micros',
        'par', 'omnivore', 'pos', 'point of sale'
      ];
      
      const paymentKeywords = [
        'stripe', 'paypal', 'venmo', 'zelle', 'cash app',
        'apple pay', 'google pay', 'payment received',
        'payment from', 'pay from'
      ];
      
      const depositKeywords = [
        'deposit', 'direct deposit', 'dir dep', 'mobile deposit',
        'ach credit', 'electronic payment', 'wire transfer',
        'online payment', 'ba electronic'
      ];
      
      const allKeywords = [...posKeywords, ...paymentKeywords, ...depositKeywords];
      
      const keywordMatches = uncategorized.filter(t => {
        const desc = (t.description || '').toLowerCase();
        const merchant = (t.merchant_name || '').toLowerCase();
        return allKeywords.some(kw => desc.includes(kw) || merchant.includes(kw));
      });
      
      // Method 3: Amount-based heuristic (deposits >= $50)
      const significantDeposits = uncategorized.filter(t => 
        t.amount >= 50 &&
        !keywordMatches.find(m => m.id === t.id)
      );
      
      // Combine all detection methods (deduplicate)
      const allRevenueDeposits = [
        ...categorizedRevenue,
        ...keywordMatches,
        ...significantDeposits
      ];
      
      const posDeposits = Array.from(
        new Map(allRevenueDeposits.map(t => [t.id, t])).values()
      )
        .map(t => ({
          date: parseISO(t.transaction_date),
          amount: t.amount,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      let nextDeposit: NextDepositPrediction | null = null;
      if (posDeposits.length >= 2) {
        // Calculate average interval between deposits
        const intervals: number[] = [];
        for (let i = 1; i < posDeposits.length; i++) {
          intervals.push(differenceInDays(posDeposits[i].date, posDeposits[i - 1].date));
        }
        const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
        const stdDev = Math.sqrt(intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length);
        
        // Average deposit amount
        const avgAmount = posDeposits.reduce((sum, d) => sum + d.amount, 0) / posDeposits.length;
        
        // Predict next deposit
        const lastDeposit = posDeposits[posDeposits.length - 1];
        const expectedDate = addDays(lastDeposit.date, Math.round(avgInterval));
        const confidence = Math.max(0, Math.min(100, 95 - (stdDev * 10))); // Lower confidence with higher variance

        nextDeposit = {
          expectedDate,
          expectedAmount: Math.round(avgAmount),
          confidence: Math.round(confidence),
        };
      }

      // Predict next payroll - Enhanced detection
      const payrollKeywords = [
        'payroll', 'gusto', 'adp', 'paychex', 'quickbooks payroll',
        'salary', 'wages', 'paycheck', 'paycor', 'rippling',
        'zenefits', 'bamboohr', 'namely'
      ];
      
      const payrollTxns = txns
        .filter(t => {
          if (t.amount >= 0) return false; // Must be outflow
          
          const desc = (t.description || '').toLowerCase();
          const merchant = (t.merchant_name || '').toLowerCase();
          const payee = (t.normalized_payee || '').toLowerCase();
          
          // Keyword match
          return payrollKeywords.some(kw => 
            desc.includes(kw) || merchant.includes(kw) || payee.includes(kw)
          );
        })
        .map(t => ({
          date: parseISO(t.transaction_date),
          amount: Math.abs(t.amount),
          dayOfWeek: getDay(parseISO(t.transaction_date)),
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      let nextPayroll: NextPayrollPrediction | null = null;
      if (payrollTxns.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < payrollTxns.length; i++) {
          intervals.push(differenceInDays(payrollTxns[i].date, payrollTxns[i - 1].date));
        }
        const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
        const avgAmount = payrollTxns.reduce((sum, p) => sum + p.amount, 0) / payrollTxns.length;
        
        // Most common day of week
        const dayOfWeekCounts = new Map<number, number>();
        payrollTxns.forEach(p => {
          dayOfWeekCounts.set(p.dayOfWeek, (dayOfWeekCounts.get(p.dayOfWeek) || 0) + 1);
        });
        const mostCommonDay = Array.from(dayOfWeekCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 5;
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        const lastPayroll = payrollTxns[payrollTxns.length - 1];
        const expectedDate = addDays(lastPayroll.date, Math.round(avgInterval));

        nextPayroll = {
          expectedDate,
          expectedAmount: Math.round(avgAmount),
          dayOfWeek: dayNames[mostCommonDay],
        };
      }

      // Supplier cost drift
      const last30Start = addDays(endDate, -30);
      const previous30Start = addDays(last30Start, -30);

      const supplierMap = new Map<string, { last30: number; previous30: number }>();
      
      txns.filter(t => t.amount < 0).forEach(t => {
        const txnDate = parseISO(t.transaction_date);
        const supplier = t.merchant_name || t.normalized_payee || 'Unknown';
        
        if (!supplierMap.has(supplier)) {
          supplierMap.set(supplier, { last30: 0, previous30: 0 });
        }
        
        const entry = supplierMap.get(supplier)!;
        if (txnDate >= last30Start && txnDate <= endDate) {
          entry.last30 += Math.abs(t.amount);
        } else if (txnDate >= previous30Start && txnDate < last30Start) {
          entry.previous30 += Math.abs(t.amount);
        }
      });

      const supplierCostDrift: SupplierCostDrift[] = Array.from(supplierMap.entries())
        .filter(([_, data]) => data.last30 > 0 && data.previous30 > 0)
        .map(([supplier, data]) => ({
          supplier,
          avgLast30Days: data.last30,
          avgPrevious30Days: data.previous30,
          driftPercent: ((data.last30 - data.previous30) / data.previous30) * 100,
        }))
        .filter(d => Math.abs(d.driftPercent) > 5) // Only show significant drifts
        .sort((a, b) => Math.abs(b.driftPercent) - Math.abs(a.driftPercent))
        .slice(0, 5);

      // Seasonality detection (simplified)
      const currentPeriodOutflows = txns
        .filter(t => {
          const txnDate = parseISO(t.transaction_date);
          return t.amount < 0 && txnDate >= startDate && txnDate <= endDate;
        })
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const previousPeriodOutflows = txns
        .filter(t => {
          const txnDate = parseISO(t.transaction_date);
          return t.amount < 0 && txnDate >= addDays(startDate, -periodDays) && txnDate < startDate;
        })
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const seasonalityDetected = previousPeriodOutflows > 0 && 
        Math.abs((currentPeriodOutflows - previousPeriodOutflows) / previousPeriodOutflows) > 0.15;

      const seasonalityMessage = seasonalityDetected
        ? currentPeriodOutflows > previousPeriodOutflows
          ? `Higher spend detected this period (+${(((currentPeriodOutflows - previousPeriodOutflows) / previousPeriodOutflows) * 100).toFixed(1)}%). This may indicate seasonal variation.`
          : `Lower spend detected this period (${(((currentPeriodOutflows - previousPeriodOutflows) / previousPeriodOutflows) * 100).toFixed(1)}%). This may indicate seasonal variation.`
        : 'No significant seasonal patterns detected in current period.';

      // Detect recurring expenses
      const vendorMap = new Map<string, { amounts: number[]; dates: Date[] }>();
      
      txns.filter(t => t.amount < 0).forEach(t => {
        const vendor = t.merchant_name || t.normalized_payee || 'Unknown';
        if (!vendorMap.has(vendor)) {
          vendorMap.set(vendor, { amounts: [], dates: [] });
        }
        const entry = vendorMap.get(vendor)!;
        entry.amounts.push(Math.abs(t.amount));
        entry.dates.push(parseISO(t.transaction_date));
      });

      const recurringExpenses: RecurringExpense[] = [];
      vendorMap.forEach((data, vendor) => {
        if (data.amounts.length >= 2) {
          const avgAmount = data.amounts.reduce((sum, a) => sum + a, 0) / data.amounts.length;
          
          // Check if amounts are similar (within 20%)
          const isSimilarAmount = data.amounts.every(a => Math.abs(a - avgAmount) / avgAmount < 0.2);
          
          if (isSimilarAmount) {
            const dates = data.dates.sort((a, b) => a.getTime() - b.getTime());
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
              lastAmount: data.amounts[data.amounts.length - 1],
              nextExpectedDate: addDays(dates[dates.length - 1], Math.round(avgInterval))
            });
          }
        }
      });

      return {
        nextDeposit,
        nextPayroll,
        supplierCostDrift,
        seasonalityDetected,
        seasonalityMessage,
        recurringExpenses: recurringExpenses.sort((a, b) => b.avgAmount - a.avgAmount),
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
