import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SpotOnConnection {
  id: string;
  restaurant_id: string;
  location_id: string;
  connected_at: string;
  api_key_encrypted?: string;
}

export const useSpotOnIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<SpotOnConnection | null>(null);
  const { toast } = useToast();

  const checkConnectionStatus = useCallback(async () => {
    if (!restaurantId) return;

    try {
      const { data, error } = await supabase
        .from('spoton_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') { // Not found error
        console.error('Error checking SpotOn connection:', error);
        return;
      }

      if (data) {
        setConnection(data);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Error checking SpotOn connection:', error);
    }
  }, [restaurantId]);

  useEffect(() => {
    if (restaurantId) {
      checkConnectionStatus();
    }
  }, [restaurantId, checkConnectionStatus]);

  const connectSpotOn = async () => {
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
      // Call the spoton-oauth edge function to get authorization URL
      const { data, error } = await supabase.functions.invoke('spoton-oauth', {
        body: {
          action: 'authorize',
          restaurantId: restaurantId
        }
      });

      if (error) {
        throw error;
      }

      if (data?.authorizationUrl) {
        // Redirect to SpotOn's authorization page
        window.location.href = data.authorizationUrl;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (error) {
      console.error('Error connecting to SpotOn:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to connect to SpotOn. Please try again.",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const disconnectSpotOn = async () => {
    if (!restaurantId || !connection) return;

    try {
      const { error } = await supabase
        .from('spoton_connections')
        .delete()
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }

      setConnection(null);
      setIsConnected(false);
      
      toast({
        title: "Disconnected",
        description: "Successfully disconnected from SpotOn",
      });
    } catch (error) {
      console.error('Error disconnecting from SpotOn:', error);
      toast({
        title: "Error",
        description: "Failed to disconnect from SpotOn",
        variant: "destructive",
      });
    }
  };

  return {
    isConnected,
    isConnecting,
    connection,
    connectSpotOn,
    disconnectSpotOn,
    checkConnectionStatus
  };
};
