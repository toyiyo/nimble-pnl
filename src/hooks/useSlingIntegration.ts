import { useState, useEffect, useCallback } from 'react';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

interface SlingConnection {
  id: string;
  restaurant_id: string;
  email: string;
  sling_org_id: number | null;
  sling_org_name: string | null;
  last_sync_time: string | null;
  initial_sync_done: boolean;
  is_active: boolean;
  connection_status: string;
}

export const useSlingIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<SlingConnection | null>(null);
  const { toast } = useToast();

  const checkConnectionStatus = useCallback(async () => {
    if (!restaurantId) {
      setIsConnected(false);
      setConnection(null);
      return;
    }

    setIsConnecting(true);
    try {
      const { data, error } = await supabase
        .from('sling_connections' as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking Sling connection:', error);
        return;
      }

      if (data) {
        setConnection(data as unknown as SlingConnection);
        setIsConnected(true);
      } else {
        setConnection(null);
        setIsConnected(false);
      }
    } catch (error) {
      console.error('Error checking Sling connection:', error);
      setConnection(null);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    if (restaurantId) {
      checkConnectionStatus();
    }
  }, [restaurantId, checkConnectionStatus]);

  const disconnectSling = async () => {
    if (!restaurantId || !connection) return;

    try {
      const { error } = await supabase
        .from('sling_connections' as any)
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }

      setConnection(null);
      setIsConnected(false);

      toast({
        title: 'Disconnected',
        description: 'Successfully disconnected from Sling',
      });
    } catch (error) {
      console.error('Error disconnecting from Sling:', error);
      toast({
        title: 'Error',
        description: 'Failed to disconnect from Sling',
        variant: 'destructive',
      });
    }
  };

  return {
    isConnected,
    isConnecting,
    connection,
    disconnectSling,
    checkConnectionStatus,
  };
};
