import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Shift4Connection {
  id: string;
  restaurant_id: string;
  merchant_id: string;
  environment: 'production' | 'sandbox';
  connected_at: string;
  last_sync_at: string | null;
}

export const useShift4Integration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connection, setConnection] = useState<Shift4Connection | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const checkConnection = useCallback(async () => {
    if (!restaurantId) {
      setIsConnected(false);
      setConnection(null);
      return;
    }

    try {
      const result = await supabase
        .from('shift4_connections' as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (result.error) throw result.error;

      const data = result.data as any;
      if (data) {
        setIsConnected(true);
        setConnection(data);
      } else {
        setIsConnected(false);
        setConnection(null);
      }
    } catch (error: any) {
      console.error('Error checking Shift4 connection:', error);
      setIsConnected(false);
      setConnection(null);
    }
  }, [restaurantId]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const connectShift4 = useCallback(async (
    secretKey: string,
    merchantId: string | undefined,
    environment: 'production' | 'sandbox' = 'production'
  ) => {
    if (!restaurantId) {
      throw new Error('No restaurant selected');
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('shift4-connect', {
        body: {
          restaurantId,
          secretKey,
          merchantId,
          environment,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to connect Shift4');
      }

      toast({
        title: "Shift4 Connected",
        description: `Successfully connected to Shift4${merchantId ? ` (Merchant ID: ${data.merchantId})` : ''}`,
      });

      // Refresh connection status
      await checkConnection();

      // Trigger initial sync
      toast({
        title: "Initial Sync Started",
        description: "Fetching your sales data from Shift4...",
      });

      const { data: syncData, error: syncError } = await supabase.functions.invoke(
        'shift4-sync-data',
        {
          body: {
            restaurantId,
            action: 'initial_sync',
          },
        }
      );

      if (syncError) {
        console.error('Initial sync error:', syncError);
        toast({
          title: "Sync Warning",
          description: "Connected successfully, but initial sync encountered issues. You can manually sync from POS settings.",
          variant: "destructive",
        });
      } else if (syncData.success) {
        const total = (syncData.results?.chargesSynced || 0) + 
                      (syncData.results?.refundsSynced || 0);
        toast({
          title: "Initial Sync Complete",
          description: `Synced ${total} records from Shift4.`,
        });
      }

      return data;
    } catch (error: any) {
      console.error('Shift4 connection error:', error);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to Shift4",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [restaurantId, toast, checkConnection]);

  const disconnectShift4 = useCallback(async () => {
    if (!restaurantId || !connection) {
      throw new Error('No connection to disconnect');
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('shift4_connections' as any)
        .delete()
        .eq('id', connection.id);

      if (error) throw error;

      toast({
        title: "Shift4 Disconnected",
        description: "Successfully disconnected from Shift4",
      });

      setIsConnected(false);
      setConnection(null);
    } catch (error: any) {
      console.error('Shift4 disconnection error:', error);
      toast({
        title: "Disconnection Failed",
        description: error.message || "Failed to disconnect from Shift4",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [restaurantId, connection, toast]);

  const syncNow = useCallback(async () => {
    if (!restaurantId || !isConnected) {
      throw new Error('Shift4 is not connected');
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('shift4-sync-data', {
        body: {
          restaurantId,
          action: 'hourly_sync',
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Sync failed');
      }

      const total = (data.results?.chargesSynced || 0) + 
                    (data.results?.refundsSynced || 0);

      toast({
        title: "Sync Complete",
        description: `Synced ${total} records from Shift4.`,
      });

      await checkConnection();

      return data;
    } catch (error: any) {
      console.error('Shift4 sync error:', error);
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync from Shift4",
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [restaurantId, isConnected, toast, checkConnection]);

  return {
    isConnected,
    connection,
    loading,
    connectShift4,
    disconnectShift4,
    syncNow,
    checkConnection,
  };
};
