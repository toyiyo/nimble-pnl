import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { POSAdapter, POSIntegrationStatus, POSSystemType, UnifiedSaleItem } from '@/types/pos';

export const useShift4SalesAdapter = (restaurantId: string | null): POSAdapter => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | undefined>();
  const [connectionId, setConnectionId] = useState<string | undefined>();
  const { toast } = useToast();

  useEffect(() => {
    if (!restaurantId) {
      setIsConnected(false);
      setConnectionId(undefined);
      setLastSyncAt(undefined);
      return;
    }

    const checkConnection = async () => {
      const { data } = await supabase
        .from('shift4_connections')
        .select('id, connected_at, last_sync_at')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (data) {
        setIsConnected(true);
        setConnectionId(data.id);
        setLastSyncAt(data.last_sync_at || data.connected_at);
      } else {
        setIsConnected(false);
        setConnectionId(undefined);
        setLastSyncAt(undefined);
      }
    };

    checkConnection();
  }, [restaurantId]);

  const fetchSales = useCallback(async (
    restaurantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<UnifiedSaleItem[]> => {
    let query = supabase
      .from('unified_sales')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('pos_system', 'shift4')
      .order('sale_date', { ascending: false });

    if (startDate) {
      query = query.gte('sale_date', startDate);
    }
    if (endDate) {
      query = query.lte('sale_date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching Shift4 sales:', error);
      return [];
    }

    return (data || []).map(item => ({
      id: item.id,
      restaurantId: item.restaurant_id,
      posSystem: item.pos_system as POSSystemType,
      externalOrderId: item.external_order_id,
      externalItemId: item.external_item_id,
      itemName: item.item_name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      totalPrice: item.total_price,
      saleDate: item.sale_date,
      saleTime: item.sale_time,
      posCategory: item.pos_category,
      rawData: item.raw_data,
      syncedAt: item.synced_at,
      createdAt: item.created_at,
      item_type: item.item_type,
      adjustment_type: item.adjustment_type,
    }));
  }, []);

  const syncToUnified = useCallback(async (restaurantId: string): Promise<number> => {
    try {
      // Call the Edge Function to sync data from Shift4 API
      const { data: syncData, error: syncError } = await supabase.functions.invoke(
        'shift4-sync-data',
        {
          body: {
            restaurantId,
            action: 'hourly_sync',
          },
        }
      );

      if (syncError) {
        throw syncError;
      }

      if (!syncData.success) {
        throw new Error(syncData.error || 'Sync failed');
      }

      const totalSynced = (syncData.results?.chargesSynced || 0) + 
                          (syncData.results?.refundsSynced || 0);

      if (totalSynced > 0) {
        toast({
          title: "Sales synced",
          description: `${totalSynced} new records synced from Shift4.`,
        });
      } else {
        toast({
          title: "Sync complete",
          description: "No new sales to sync.",
        });
      }

      return totalSynced;
    } catch (error: any) {
      console.error('Error syncing Shift4 sales:', error);
      toast({
        title: "Sync Error",
        description: error.message || "Failed to sync Shift4 sales",
        variant: "destructive",
      });
      return 0;
    }
  }, [toast]);

  const getIntegrationStatus = useCallback((): POSIntegrationStatus => {
    return {
      system: 'shift4',
      isConnected,
      isConfigured: isConnected,
      lastSyncAt,
      connectionId,
    };
  }, [isConnected, lastSyncAt, connectionId]);

  return {
    system: 'shift4',
    isConnected,
    fetchSales,
    syncToUnified,
    getIntegrationStatus,
  };
};
