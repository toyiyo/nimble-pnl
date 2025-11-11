import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface InventoryPurchasesData {
  totalPurchases: number;
  purchaseCount: number;
}

/**
 * Hook to fetch inventory purchase totals for a given period
 * @param restaurantId - The restaurant ID
 * @param startDate - Start date of the period
 * @param endDate - End date of the period
 */
export const useInventoryPurchases = (
  restaurantId: string | null,
  startDate: Date,
  endDate: Date
) => {
  return useQuery({
    queryKey: ['inventory-purchases', restaurantId, startDate.toISOString(), endDate.toISOString()],
    queryFn: async (): Promise<InventoryPurchasesData> => {
      if (!restaurantId) {
        return { totalPurchases: 0, purchaseCount: 0 };
      }

      // Query inventory_transactions for purchases in the date range
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('total_cost')
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'purchase')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      if (error) {
        console.error('Error fetching inventory purchases:', error);
        throw error;
      }

      // Calculate total purchases
      const totalPurchases = (data || []).reduce((sum, transaction) => {
        return sum + Math.abs(transaction.total_cost || 0);
      }, 0);

      return {
        totalPurchases,
        purchaseCount: data?.length || 0,
      };
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
};
