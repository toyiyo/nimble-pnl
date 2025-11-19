import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, parseISO, differenceInDays, subDays } from "date-fns";

export interface VendorSpend {
  vendor: string;
  spend: number;
  percentage: number;
  paymentCount: number;
  momChange?: number; // Month-over-month change %
  nextExpectedDate?: Date;
  isRecurring?: boolean;
}

interface TopVendorsMetrics {
  topVendors: VendorSpend[];
  vendorConcentration: number; // Top 3 as % of total
  totalVendorSpend: number;
}

export function useTopVendors(startDate: Date, endDate: Date, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();

  return useQuery({
    queryKey: ['top-vendors', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd'), bankAccountId],
    queryFn: async (): Promise<TopVendorsMetrics> => {
      if (!selectedRestaurant?.restaurant_id) {
        throw new Error("No restaurant selected");
      }

      const periodDays = differenceInDays(endDate, startDate) + 1;
      const previousPeriodStart = subDays(startDate, periodDays);

      // Fetch current and previous period transactions (including pending)
      let query = supabase
        .from('bank_transactions')
        .select('transaction_date, amount, status, merchant_name, normalized_payee, description')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .in('status', ['posted', 'pending'])
        .lt('amount', 0) // Only outflows
        .gte('transaction_date', format(previousPeriodStart, 'yyyy-MM-dd'))
        .lte('transaction_date', format(endDate, 'yyyy-MM-dd'));

      if (bankAccountId && bankAccountId !== 'all') {
        query = query.eq('connected_bank_id', bankAccountId);
      }

      const { data: transactions, error } = await query.order('transaction_date', { ascending: true });

      if (error) throw error;

      const txns = transactions || [];

      // Filter for current period
      const currentPeriodTxns = txns.filter(t => {
        const txnDate = parseISO(t.transaction_date);
        return txnDate >= startDate && txnDate <= endDate;
      });

      // Filter for previous period
      const previousPeriodTxns = txns.filter(t => {
        const txnDate = parseISO(t.transaction_date);
        return txnDate >= previousPeriodStart && txnDate < startDate;
      });

      const totalVendorSpend = Math.abs(currentPeriodTxns.reduce((sum, t) => sum + t.amount, 0));

      // Group by vendor (current period)
      const vendorMap = new Map<string, { spend: number; count: number; dates: Date[] }>();
      currentPeriodTxns.forEach(t => {
        const vendor = t.merchant_name || t.normalized_payee || t.description || 'Unknown Vendor';
        if (!vendorMap.has(vendor)) {
          vendorMap.set(vendor, { spend: 0, count: 0, dates: [] });
        }
        const entry = vendorMap.get(vendor)!;
        entry.spend += Math.abs(t.amount);
        entry.count += 1;
        entry.dates.push(parseISO(t.transaction_date));
      });

      // Group by vendor (previous period for MoM comparison)
      const previousVendorMap = new Map<string, number>();
      previousPeriodTxns.forEach(t => {
        const vendor = t.merchant_name || t.normalized_payee || t.description || 'Unknown Vendor';
        previousVendorMap.set(vendor, (previousVendorMap.get(vendor) || 0) + Math.abs(t.amount));
      });

      // Detect recurring vendors
      const isRecurringVendor = (dates: Date[]): { recurring: boolean; nextExpected?: Date } => {
        if (dates.length < 3) return { recurring: false };

        const sortedDates = dates.sort((a, b) => a.getTime() - b.getTime());
        const intervals: number[] = [];
        for (let i = 1; i < sortedDates.length; i++) {
          intervals.push(differenceInDays(sortedDates[i], sortedDates[i - 1]));
        }

        const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
        const intervalVariance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
        const intervalStdDev = Math.sqrt(intervalVariance);

        // Recurring if avg interval is between 6-32 days and variance is low
        const isRecurring = (avgInterval >= 6 && avgInterval <= 32) && (intervalStdDev / avgInterval < 0.3);

        if (isRecurring) {
          const lastDate = sortedDates[sortedDates.length - 1];
          const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
          const nextExpected = new Date(lastDate.getTime() + avgInterval * MILLISECONDS_PER_DAY);
          return { recurring: true, nextExpected };
        }

        return { recurring: false };
      };

      // Build top vendors list
      const topVendors: VendorSpend[] = Array.from(vendorMap.entries())
        .map(([vendor, data]) => {
          const previousSpend = previousVendorMap.get(vendor) || 0;
          const momChange = previousSpend > 0 ? ((data.spend - previousSpend) / previousSpend) * 100 : undefined;

          const recurringInfo = isRecurringVendor(data.dates);

          return {
            vendor,
            spend: data.spend,
            percentage: totalVendorSpend > 0 ? (data.spend / totalVendorSpend) * 100 : 0,
            paymentCount: data.count,
            momChange,
            isRecurring: recurringInfo.recurring,
            nextExpectedDate: recurringInfo.nextExpected,
          };
        })
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 10); // Top 10 vendors

      // Calculate vendor concentration (top 3)
      const top3Total = topVendors.slice(0, 3).reduce((sum, v) => sum + v.spend, 0);
      const vendorConcentration = totalVendorSpend > 0 ? (top3Total / totalVendorSpend) * 100 : 0;

      return {
        topVendors,
        vendorConcentration,
        totalVendorSpend,
      };
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
