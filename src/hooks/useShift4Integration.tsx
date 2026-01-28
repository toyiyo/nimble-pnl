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
  initial_sync_done?: boolean;
  sync_cursor?: number;
  is_active?: boolean;
  connection_status?: string;
  last_error?: string | null;
  last_error_at?: string | null;
  last_sync_time?: string | null;
}

export function useShift4Integration(restaurantId: string | null) {
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
    environment: 'production' | 'sandbox' = 'production',
    email?: string,
    password?: string
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
          email,
          password,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to connect Shift4');
      }

      const merchantIdDisplay = merchantId ? ` (Merchant ID: ${data.merchantId})` : '';
      toast({
        title: "Shift4 Connected",
        description: `Successfully connected to Shift4${merchantIdDisplay}`,
      });

      await checkConnection();

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
        const chargesSynced = syncData.results?.chargesSynced || 0;
        const refundsSynced = syncData.results?.refundsSynced || 0;
        toast({
          title: "Initial Sync Complete",
          description: `Synced ${chargesSynced + refundsSynced} records from Shift4.`,
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

  const triggerManualSync = useCallback(async (
    options?: { startDate?: string; endDate?: string }
  ): Promise<{
    success: boolean;
    ticketsSynced: number;
    errors: string[];
    syncComplete: boolean;
    progress: number;
    daysRemaining: number;
  } | null> => {
    if (!restaurantId) {
      throw new Error('No restaurant selected');
    }

    // Build request body
    const body: Record<string, unknown> = { restaurantId };

    if (options?.startDate && options?.endDate) {
      // Custom date range sync
      body.dateRange = {
        startDate: options.startDate,
        endDate: options.endDate,
      };
    }
    // If no options, the edge function will use default behavior:
    // - initial_sync if not done, otherwise hourly_sync

    const { data, error } = await supabase.functions.invoke('shift4-sync-data', {
      body,
    });

    if (error) throw error;

    if (!data.success && data.error) {
      throw new Error(data.error);
    }

    await checkConnection();

    return {
      success: data.success,
      ticketsSynced: data.results?.chargesSynced || 0,
      errors: data.results?.errors || [],
      syncComplete: data.syncProgress?.syncComplete ?? true,
      progress: data.syncProgress?.syncComplete ? 100 :
        Math.round(((90 - (data.syncProgress?.daysRemaining || 0)) / 90) * 100),
      daysRemaining: data.syncProgress?.daysRemaining || 0,
    };
  }, [restaurantId, checkConnection]);

  // Legacy syncNow for backward compatibility
  const syncNow = useCallback(async () => {
    if (!restaurantId || !isConnected) {
      throw new Error('Shift4 is not connected');
    }

    setLoading(true);

    try {
      const result = await triggerManualSync();

      if (result) {
        toast({
          title: "Sync Complete",
          description: `Synced ${result.ticketsSynced} tickets from Shift4.`,
        });
      }

      return result;
    } catch (error: unknown) {
      console.error('Shift4 sync error:', error);
      const message = error instanceof Error ? error.message : 'Failed to sync from Shift4';
      toast({
        title: "Sync Failed",
        description: message,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [restaurantId, isConnected, toast, triggerManualSync]);

  return {
    isConnected,
    connection,
    loading,
    connectShift4,
    disconnectShift4,
    syncNow,
    triggerManualSync,
    checkConnection,
  };
}
