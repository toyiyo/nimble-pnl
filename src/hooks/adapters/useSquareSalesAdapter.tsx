import { useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSquareIntegration } from '@/hooks/useSquareIntegration';
import { POSAdapter, POSIntegrationStatus, UnifiedSaleItem } from '@/types/pos';
import { useToast } from '@/hooks/use-toast';

export const useSquareSalesAdapter = (restaurantId: string | null): POSAdapter => {
  const { isConnected, connection } = useSquareIntegration(restaurantId);
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
        .eq('pos_system', 'square')
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
        posSystem: 'square',
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
      console.error('Error fetching Square sales:', error);
      return [];
    }
  }, [isConnected]);

  const syncToUnified = useCallback(async (restaurantId: string): Promise<number> => {
    if (!isConnected) return 0;

    try {
      // Sync Square data to unified_sales table
      const { data, error } = await supabase.rpc('sync_square_to_unified_sales' as any, {
        p_restaurant_id: restaurantId
      });

      if (error) throw error;

      const syncedCount = Number(data) || 0;
      
      if (syncedCount > 0) {
        toast({
          title: "Sales synced",
          description: `${syncedCount} new sales records synced from Square.`,
        });
      }

      return syncedCount;
    } catch (error: any) {
      console.error('Error syncing Square sales:', error);
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
      system: 'square',
      isConnected,
      isConfigured: !!connection,
      connectionId: connection?.id,
      lastSyncAt: connection?.connected_at,
    };
  }, [isConnected, connection]);

  return useMemo(() => ({
    system: 'square' as const,
    isConnected,
    fetchSales,
    syncToUnified,
    getIntegrationStatus,
  }), [isConnected, fetchSales, syncToUnified, getIntegrationStatus]);
};