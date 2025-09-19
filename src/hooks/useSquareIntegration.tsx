import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SquareConnection {
  id: string;
  restaurant_id: string;
  merchant_id: string;
  connected_at: string;
  scopes: string[];
}

export const useSquareIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<SquareConnection | null>(null);
  const { toast } = useToast();

  const checkConnectionStatus = useCallback(async () => {
    if (!restaurantId) return;

    try {
      const { data, error } = await supabase
        .from('square_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') { // Not found error
        console.error('Error checking Square connection:', error);
        return;
      }

      if (data) {
        setConnection(data);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Error checking Square connection:', error);
    }
  }, [restaurantId]);

  useEffect(() => {
    if (restaurantId) {
      checkConnectionStatus();
    }
  }, [restaurantId, checkConnectionStatus]);

  const connectSquare = async () => {
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
      // Call the square-oauth edge function to get authorization URL
      const { data, error } = await supabase.functions.invoke('square-oauth', {
        body: {
          action: 'authorize',
          restaurantId: restaurantId
        }
      });

      if (error) {
        throw error;
      }

      if (data?.authorizationUrl) {
        // Redirect to Square's authorization page
        window.location.href = data.authorizationUrl;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (error) {
      console.error('Error connecting to Square:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to connect to Square. Please try again.",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const disconnectSquare = async () => {
    if (!restaurantId || !connection) return;

    try {
      const { error } = await supabase
        .from('square_connections')
        .delete()
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }

      setConnection(null);
      setIsConnected(false);
      
      toast({
        title: "Disconnected",
        description: "Successfully disconnected from Square",
      });
    } catch (error) {
      console.error('Error disconnecting from Square:', error);
      toast({
        title: "Error",
        description: "Failed to disconnect from Square",
        variant: "destructive",
      });
    }
  };

  return {
    isConnected,
    isConnecting,
    connection,
    connectSquare,
    disconnectSquare,
    checkConnectionStatus
  };
};