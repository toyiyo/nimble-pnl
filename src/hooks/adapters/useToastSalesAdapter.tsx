import { useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToastIntegration } from '@/hooks/useToastIntegration';
import { POSAdapter, POSIntegrationStatus, UnifiedSaleItem } from '@/types/pos';
import { useToast } from '@/hooks/use-toast';

export const useToastSalesAdapter = (restaurantId: string | null): POSAdapter => {
  const { isConnected, connection } = useToastIntegration(restaurantId);
  const { toast } = useToast();

  const fetchSales = useCallback(async (
    restaurantId: string, 
    startDate?: string, 
    endDate?: string
  ): Promise<UnifiedSaleItem[]> => {
    if (!isConnected) return [];

    try {
      let query = supabase
        .from('unified_sales')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('pos_system', 'toast')
        .order('sale_date', { ascending: false });

      if (startDate) {
        query = query.gte('sale_date', startDate);
      }
      if (endDate) {
        query = query.lte('sale_date', endDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map(sale => ({
        id: sale.id,
        restaurantId: sale.restaurant_id,
        posSystem: 'toast',
        externalOrderId: sale.external_order_id,
        externalItemId: sale.external_item_id,
        itemName: sale.item_name,
        quantity: sale.quantity,
        unitPrice: sale.unit_price,
        totalPrice: sale.total_price,
        saleDate: sale.sale_date,
        saleTime: sale.sale_time,
        posCategory: sale.pos_category,
        rawData: sale.raw_data,
        syncedAt: sale.synced_at,
        createdAt: sale.created_at,
      }));
    } catch (error) {
      console.error('Error fetching Toast sales:', error);
      return [];
    }
  }, [isConnected]);

  const syncToUnified = useCallback(async (restaurantId: string): Promise<number> => {
    if (!isConnected) return 0;

    try {
      // Use date-range overload (last 7 days) to avoid timeout on large datasets.
      // Full historical sync is handled by the scheduled cron job.
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data, error } = await supabase.rpc('sync_toast_to_unified_sales' as any, {
        p_restaurant_id: restaurantId,
        p_start_date: startDate,
        p_end_date: endDate
      });

      if (error) throw error;

      const syncedCount = Number(data) || 0;
      
      if (syncedCount > 0) {
        toast({
          title: "Sales synced",
          description: `${syncedCount} new sales records synced from Toast.`,
        });
      }

      return syncedCount;
    } catch (error: any) {
      console.error('Error syncing Toast sales:', error);
      toast({
        title: "Error syncing sales",
        description: error.message,
        variant: "destructive",
      });
      return 0;
    }
  }, [isConnected, toast]);

  const getIntegrationStatus = useCallback((): POSIntegrationStatus => {
    return {
      system: 'toast',
      isConnected,
      isConfigured: !!connection,
      connectionId: connection?.id,
      lastSyncAt: connection?.last_sync_at || connection?.connected_at,
    };
  }, [isConnected, connection]);

  return useMemo(() => ({
    system: 'toast' as const,
    isConnected,
    fetchSales,
    syncToUnified,
    getIntegrationStatus,
  }), [isConnected, fetchSales, syncToUnified, getIntegrationStatus]);
};
