import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  disconnectIntegration,
  notifyIntegrationDisconnect,
  AlreadyDisconnectedError,
  type DisconnectOptions,
} from '@/lib/integrationDisconnect';

interface CloverConnection {
  id: string;
  restaurant_id: string;
  merchant_id: string;
  connected_at: string;
  region: string;
}

export const useCloverIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connection, setConnection] = useState<CloverConnection | null>(null);
  const { toast } = useToast();

  const checkConnectionStatus = useCallback(async () => {
    if (!restaurantId) {
      setConnection(null);
      setIsConnected(false);
      return;
    }

    try {
      // First check if there are duplicates
      const { count, error: countError } = await supabase
        .from('clover_connections')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);

      if (countError) {
        console.error('Error checking Clover connection count:', countError);
        setConnection(null);
        setIsConnected(false);
        return;
      }

      // Warn if multiple connections exist (data integrity issue)
      if (count !== null && count > 1) {
        console.warn(`Data integrity issue: Found ${count} Clover connections for restaurant ${restaurantId}. Using the most recent one.`);
      }

      // Deterministically fetch the latest connection
      const { data, error } = await supabase
        .from('clover_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching Clover connection:', error);
        setConnection(null);
        setIsConnected(false);
        return;
      }

      if (data) {
        setConnection(data);
        setIsConnected(true);
      } else {
        setConnection(null);
        setIsConnected(false);
      }
    } catch (error) {
      console.error('Error checking Clover connection:', error);
      setConnection(null);
      setIsConnected(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    if (restaurantId) {
      checkConnectionStatus();
    }
  }, [restaurantId, checkConnectionStatus]);

  const connectClover = async (region: 'na' | 'eu' | 'latam' | 'apac' = 'na') => {
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
      const { data, error } = await supabase.functions.invoke('clover-oauth', {
        body: {
          action: 'authorize',
          restaurantId: restaurantId,
          region: region
        }
      });

      if (error) {
        throw error;
      }

      if (data?.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (error) {
      console.error('Error connecting to Clover:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to connect to Clover. Please try again.",
        variant: "destructive",
      });
      setIsConnecting(false);
    }
  };

  const disconnectClover = async (opts?: DisconnectOptions, targetId?: string) => {
    // targetId is the restaurant the dialog named. It can differ from the current restaurant.
    const rid = targetId ?? restaurantId;
    if (!rid || (!targetId && !connection)) return;
    const isCurrent = rid === restaurantId;

    try {
      const eventId = await disconnectIntegration({
        restaurantId: rid,
        integration: 'clover',
        reason: opts?.reason ?? null,
        reasonText: opts?.reasonText ?? null,
      });
      if (isCurrent) {
        setConnection(null);
        setIsConnected(false);
      }
      toast({ title: "Disconnected", description: "Successfully disconnected from Clover" });
      void notifyIntegrationDisconnect(eventId);
    } catch (error) {
      if (error instanceof AlreadyDisconnectedError) {
        if (isCurrent) {
          setConnection(null);
          setIsConnected(false);
        }
        toast({ title: "Already disconnected", description: "Clover was already disconnected" });
        return;
      }
      throw error;
    }
  };

  return {
    isConnected,
    isConnecting,
    connection,
    connectClover,
    disconnectClover,
    checkConnectionStatus
  };
};
