import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { POSAdapter, POSIntegrationStatus, POSSystemType, UnifiedSaleItem } from '@/types/pos';

export const useCloverSalesAdapter = (restaurantId: string | null): POSAdapter => {
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
        .from('clover_connections')
        .select('id, connected_at')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (data) {
        setIsConnected(true);
        setConnectionId(data.id);
        setLastSyncAt(data.connected_at);
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
      .eq('pos_system', 'clover')
      .order('sale_date', { ascending: false });

    if (startDate) {
      query = query.gte('sale_date', startDate);
    }
    if (endDate) {
      query = query.lte('sale_date', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching Clover sales:', error);
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
      createdAt: item.created_at
    }));
  }, []);

  const syncToUnified = useCallback(async (restaurantId: string): Promise<number> => {
    try {
      const { data, error } = await supabase.rpc('sync_clover_to_unified_sales', {
        p_restaurant_id: restaurantId
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Sync Complete",
        description: `Synced ${data || 0} Clover sales to unified table`,
      });

      return data || 0;
    } catch (error: any) {
      console.error('Error syncing Clover sales:', error);
      toast({
        title: "Sync Error",
        description: error.message || "Failed to sync Clover sales",
        variant: "destructive",
      });
      return 0;
    }
  }, [toast]);

  const getIntegrationStatus = useCallback((): POSIntegrationStatus => {
    return {
      system: 'clover',
      isConnected,
      isConfigured: isConnected,
      lastSyncAt,
      connectionId,
    };
  }, [isConnected, lastSyncAt, connectionId]);

  return {
    system: 'clover',
    isConnected,
    fetchSales,
    syncToUnified,
    getIntegrationStatus,
  };
};
