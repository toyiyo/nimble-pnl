import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ToastConnection {
  id: string;
  restaurant_id: string;
  toast_restaurant_guid: string;
  connected_at: string;
  last_sync_at: string | null;
  scopes: string[];
}

export const useToastIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<ToastConnection | null>(null);
  const { toast } = useToast();

  const checkConnectionStatus = useCallback(async () => {
    if (!restaurantId) {
      setIsConnected(false);
      setConnection(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('toast_connections' as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') { // Not found error
        console.error('Error checking Toast connection:', error);
        return;
      }

      if (data) {
        setConnection(data as unknown as ToastConnection);
        setIsConnected(true);
      } else {
        setConnection(null);
        setIsConnected(false);
      }
    } catch (error) {
      console.error('Error checking Toast connection:', error);
      setConnection(null);
      setIsConnected(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    if (restaurantId) {
      checkConnectionStatus();
    }
  }, [restaurantId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        description: "Failed to connect to Toast. Please try again.",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const disconnectToast = async () => {
    if (!restaurantId || !connection) return;

    try {
      const { error } = await supabase
        .from('toast_connections' as any)
        .delete()
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }

      setConnection(null);
      setIsConnected(false);
      
      toast({
        title: "Disconnected",
        description: "Successfully disconnected from Toast",
      });
    } catch (error) {
      console.error('Error disconnecting from Toast:', error);
      toast({
        title: "Error",
        description: "Failed to disconnect from Toast",
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
    checkConnectionStatus
  };
};
