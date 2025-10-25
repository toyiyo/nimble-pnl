import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, differenceInDays, parseISO } from "date-fns";

interface RevenueHealthMetrics {
  depositFrequency: number; // days between deposits
  depositFrequencyScore: number; // 0-5 stars
  avgDepositSize: number;
  largestDeposit: number;
  depositCount: number;
  revenueSourceBreakdown: Array<{
    source: string;
    amount: number;
    percentage: number;
  }>;
  refundRate: number;
  missingDepositDays: number;
  anomalousDeposits: Array<{
    date: string;
    amount: number;
    reason: string;
  }>;
}

export function useRevenueHealth(startDate: Date, endDate: Date) {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['revenue-health', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')],
    queryFn: async (): Promise<RevenueHealthMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const { data: transactions, error } = await supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status, description, merchant_name')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .eq('status', 'posted')
        .gte('transaction_date', format(startDate, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'))
        .order('transaction_date', { ascending: true });

      if (error) throw error;

      const txns = transactions || [];
      
      // Filter deposits (inflows)
      const deposits = txns.filter(t => t.amount > 0);
      
      // Identify POS deposits
      const posDeposits = deposits.filter(t => {
        const desc = (t.description || '').toLowerCase();
        const merchant = (t.merchant_name || '').toLowerCase();
        return desc.includes('square') || desc.includes('clover') || 
               desc.includes('toast') || merchant.includes('square') || 
               merchant.includes('clover') || merchant.includes('toast');
      });

      // Calculate deposit frequency
      const periodDays = differenceInDays(endDate, startDate) + 1;
      const depositFrequency = posDeposits.length > 0 
        ? periodDays / posDeposits.length 
        : 0;
      
      // Convert to star rating (daily = 5 stars, every 2 days = 4, etc.)
      const depositFrequencyScore = depositFrequency === 0 ? 0 :
        depositFrequency <= 1.2 ? 5 :
        depositFrequency <= 1.5 ? 4 :
        depositFrequency <= 2 ? 3 :
        depositFrequency <= 3 ? 2 : 1;

      // Average deposit size
      const avgDepositSize = posDeposits.length > 0
        ? posDeposits.reduce((sum, t) => sum + t.amount, 0) / posDeposits.length
        : 0;

      // Largest deposit
      const largestDeposit = posDeposits.length > 0
        ? Math.max(...posDeposits.map(t => t.amount))
        : 0;

      // Revenue source breakdown
      const deliveryKeywords = ['doordash', 'ubereats', 'grubhub', 'postmates', 'uber eats'];
      const deliveryDeposits = deposits.filter(t => {
        const desc = (t.description || '').toLowerCase();
        return deliveryKeywords.some(keyword => desc.includes(keyword));
      });

      const totalInflows = deposits.reduce((sum, t) => sum + t.amount, 0);
      const posTotal = posDeposits.reduce((sum, t) => sum + t.amount, 0);
      const deliveryTotal = deliveryDeposits.reduce((sum, t) => sum + t.amount, 0);
      const otherTotal = totalInflows - posTotal - deliveryTotal;

      const revenueSourceBreakdown = [
        { source: 'POS Deposits', amount: posTotal, percentage: totalInflows > 0 ? (posTotal / totalInflows) * 100 : 0 },
        { source: 'Third-Party Delivery', amount: deliveryTotal, percentage: totalInflows > 0 ? (deliveryTotal / totalInflows) * 100 : 0 },
        { source: 'Other', amount: otherTotal, percentage: totalInflows > 0 ? (otherTotal / totalInflows) * 100 : 0 },
      ].filter(item => item.amount > 0);

      // Refund rate
      const refunds = txns.filter(t => {
        const desc = (t.description || '').toLowerCase();
        return desc.includes('refund') || desc.includes('chargeback') || desc.includes('reversal');
      });
      const totalRefunds = Math.abs(refunds.reduce((sum, t) => sum + t.amount, 0));
      const refundRate = totalInflows > 0 ? (totalRefunds / totalInflows) * 100 : 0;

      // Missing deposit days (expected vs actual)
      const expectedDeposits = Math.floor(periodDays / (depositFrequency || 1));
      const missingDepositDays = Math.max(0, expectedDeposits - posDeposits.length);

      // Anomalous deposits (>2x average)
      const anomalousDeposits = posDeposits
        .filter(t => t.amount > avgDepositSize * 2)
        .map(t => ({
          date: format(parseISO(t.transaction_date), 'MMM dd, yyyy'),
          amount: t.amount,
          reason: `${((t.amount / avgDepositSize) * 100).toFixed(0)}% larger than average`
        }));

      return {
        depositFrequency,
        depositFrequencyScore,
        avgDepositSize,
        largestDeposit,
        depositCount: posDeposits.length,
        revenueSourceBreakdown,
        refundRate,
        missingDepositDays,
        anomalousDeposits,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
