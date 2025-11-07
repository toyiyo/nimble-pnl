import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ToastConnection {
  id: string;
  restaurant_id: string;
  restaurant_guid: string;
  management_group_guid: string | null;
  connected_at: string;
  scopes: string[];
  environment: string;
}

export const useToastIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<ToastConnection | null>(null);
  const { toast } = useToast();

  const checkConnectionStatus = useCallback(async () => {
    if (!restaurantId) return;

    try {
      const { data, error } = await supabase
        .from('toast_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') { // Not found error
        console.error('Error checking Toast connection:', error);
        return;
      }

      if (data) {
        setConnection(data);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Error checking Toast connection:', error);
    }
  }, [restaurantId]);

  useEffect(() => {
    if (restaurantId) {
      checkConnectionStatus();
    }
  }, [restaurantId, checkConnectionStatus]);

  const connectToast = async () => {
    if (!restaurantId) {
      toast({
        title: "Error",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);

    try {
      // Call the toast-oauth edge function to get authorization URL
      const { data, error } = await supabase.functions.invoke('toast-oauth', {
        body: {
          action: 'authorize',
          restaurantId: restaurantId
        }
      });

      if (error) {
        throw error;
      }

      if (data?.authorizationUrl) {
        // Redirect to Toast's authorization page
        window.location.href = data.authorizationUrl;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (error) {
      console.error('Error connecting to Toast:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to connect to Toast POS. Please try again.",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const disconnectToast = async () => {
    if (!restaurantId || !connection) return;

    try {
      const { error } = await supabase
        .from('toast_connections')
        .delete()
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }

      setConnection(null);
      setIsConnected(false);
      
      toast({
        title: "Disconnected",
        description: "Successfully disconnected from Toast POS",
      });
    } catch (error) {
      console.error('Error disconnecting from Toast:', error);
      toast({
        title: "Error",
        description: "Failed to disconnect from Toast POS",
        variant: "destructive",
      });
    }
  };

  const syncData = async () => {
    if (!restaurantId || !connection) {
      toast({
        title: "Error",
        description: "No Toast connection found",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Syncing...",
        description: "Starting Toast data sync",
      });

      const { error } = await supabase.functions.invoke('toast-sync-data', {
        body: {
          restaurantId: restaurantId,
          action: 'daily_sync'
        }
      });

      if (error) {
        throw error;
      }

      toast({
        title: "Sync Complete",
        description: "Toast data synced successfully",
      });
    } catch (error) {
      console.error('Error syncing Toast data:', error);
      toast({
        title: "Sync Failed",
        description: "Failed to sync Toast data. Please try again.",
        variant: "destructive",
      });
    }
  };

  return {
    isConnected,
    isConnecting,
    connection,
    connectToast,
    disconnectToast,
    syncData,
    checkConnectionStatus
  };
};
