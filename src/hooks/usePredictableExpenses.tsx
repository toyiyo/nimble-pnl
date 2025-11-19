import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, parseISO, differenceInDays, addDays } from "date-fns";

export interface PredictableExpense {
  vendor: string;
  expectedDate: Date;
  expectedAmount: number;
  confidence: 'high' | 'medium' | 'low';
  frequency: 'weekly' | 'biweekly' | 'monthly';
  lastAmount: number;
  paymentCount: number;
}

interface PredictableExpensesMetrics {
  upcomingExpenses: PredictableExpense[];
  totalExpected: number;
  highConfidenceTotal: number;
}

export function usePredictableExpenses(lookAheadDays: number = 30) {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['predictable-expenses', selectedRestaurant?.restaurant_id, lookAheadDays],
    queryFn: async (): Promise<PredictableExpensesMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const today = new Date();
      const lookbackDays = 120; // Look back 4 months for pattern detection
      const lookbackStart = addDays(today, -lookbackDays);

      // Fetch historical outflow transactions (including pending)
      const { data: transactions, error } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, merchant_name, normalized_payee, description')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .in('status', ['posted', 'pending'])
        .lt('amount', 0) // Only outflows
        .gte('transaction_date', format(lookbackStart, 'yyyy-MM-dd'))
        .lte('transaction_date', format(today, 'yyyy-MM-dd'))
        .order('transaction_date', { ascending: true });

      if (error) throw error;

      const txns = transactions || [];

      // Group by vendor using normalized key for accurate pattern detection
      const vendorMap = new Map<string, { label: string; payments: Array<{ date: Date; amount: number }> }>();
      txns.forEach(t => {
        // Normalized key for grouping (prefer normalized_payee, fallback to merchant_name/description)
        const normalizedKey = (t.normalized_payee || t.merchant_name || t.description || 'unknown vendor')
          .trim()
          .toLowerCase();
        
        // Human-readable label for display (prefer merchant_name, fallback to normalized_payee/description)
        const label = (t.merchant_name || t.normalized_payee || t.description || 'Unknown Vendor').trim();
        
        if (!vendorMap.has(normalizedKey)) {
          vendorMap.set(normalizedKey, { label, payments: [] });
        }
        vendorMap.get(normalizedKey)!.payments.push({
          date: parseISO(t.transaction_date),
          amount: Math.abs(t.amount),
        });
      });

      const upcomingExpenses: PredictableExpense[] = [];

      // Analyze each vendor for recurring patterns
      vendorMap.forEach((vendorData, normalizedKey) => {
        const { label, payments } = vendorData;
        if (payments.length < 3) return; // Need at least 3 payments to detect pattern

        const sortedPayments = payments.sort((a, b) => a.date.getTime() - b.date.getTime());
        
        // Calculate intervals between payments
        const intervals: number[] = [];
        for (let i = 1; i < sortedPayments.length; i++) {
          intervals.push(differenceInDays(sortedPayments[i].date, sortedPayments[i - 1].date));
        }

        if (intervals.length === 0) return;

        const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
        const intervalVariance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
        const intervalStdDev = Math.sqrt(intervalVariance);
        const intervalCV = avgInterval > 0 ? intervalStdDev / avgInterval : 1; // Coefficient of variation

        // Determine frequency
        let frequency: 'weekly' | 'biweekly' | 'monthly' | null = null;
        if (avgInterval >= 6 && avgInterval <= 8) frequency = 'weekly';
        else if (avgInterval >= 13 && avgInterval <= 17) frequency = 'biweekly';
        else if (avgInterval >= 26 && avgInterval <= 32) frequency = 'monthly';

        if (!frequency) return; // Not a recognized recurring pattern

        // Calculate amount statistics
        const amounts = sortedPayments.map(p => p.amount);
        const avgAmount = amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
        const amountVariance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length;
        const amountStdDev = Math.sqrt(amountVariance);
        const amountCV = avgAmount > 0 ? amountStdDev / avgAmount : 1;

        // Calculate confidence based on consistency
        let confidence: 'high' | 'medium' | 'low' = 'low';
        if (intervalCV < 0.15 && amountCV < 0.15 && payments.length >= 4) {
          confidence = 'high';
        } else if (intervalCV < 0.25 && amountCV < 0.25 && payments.length >= 3) {
          confidence = 'medium';
        }

        // Project next expected date
        const lastPayment = sortedPayments[sortedPayments.length - 1];
        const expectedDate = addDays(lastPayment.date, Math.round(avgInterval));

        // Only include if expected within lookAheadDays
        const daysUntilExpected = differenceInDays(expectedDate, today);
        if (daysUntilExpected > 0 && daysUntilExpected <= lookAheadDays) {
          upcomingExpenses.push({
            vendor: label, // Use human-readable label for display
            expectedDate,
            expectedAmount: avgAmount,
            confidence,
            frequency,
            lastAmount: lastPayment.amount,
            paymentCount: payments.length,
          });
        }
      });

      // Sort by expected date
      upcomingExpenses.sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime());

      const totalExpected = upcomingExpenses.reduce((sum, e) => sum + e.expectedAmount, 0);
      const highConfidenceTotal = upcomingExpenses
        .filter(e => e.confidence === 'high')
        .reduce((sum, e) => sum + e.expectedAmount, 0);

      return {
        upcomingExpenses,
        totalExpected,
        highConfidenceTotal,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 60000, // 60 seconds (less frequent updates needed)
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
