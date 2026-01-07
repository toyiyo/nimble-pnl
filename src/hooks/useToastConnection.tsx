import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ToastConnection {
  id: string;
  restaurant_id: string;
  toast_restaurant_guid: string;
  client_id: string;
  is_active: boolean;
  webhook_active: boolean;
  connection_status: string;
  last_sync_time: string | null;
  initial_sync_done: boolean;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
}

export const useToastConnection = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [connection, setConnection] = useState<ToastConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const checkConnectionStatus = useCallback(async (restaurantId: string) => {
    if (!restaurantId) {
      setIsConnected(false);
      setConnection(null);
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('toast_connections' as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking Toast connection:', error);
        return null;
      }

      if (data) {
        setConnection(data as unknown as ToastConnection);
        setIsConnected(true);
        return data as unknown as ToastConnection;
      } else {
        setConnection(null);
        setIsConnected(false);
        return null;
      }
    } catch (error) {
      console.error('Error checking Toast connection:', error);
      setConnection(null);
      setIsConnected(false);
      return null;
    }
  }, []);

  const saveCredentials = async (
    restaurantId: string,
    clientId: string,
    clientSecret: string,
    toastRestaurantGuid: string
  ) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('toast-save-credentials', {
        body: {
          restaurantId,
          clientId,
          clientSecret,
          toastRestaurantGuid
        }
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      await checkConnectionStatus(restaurantId);
      
      toast({
        title: 'Credentials saved',
        description: 'Toast API credentials have been saved successfully'
      });

      return data;
    } catch (error: any) {
      console.error('Error saving Toast credentials:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save credentials',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async (restaurantId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('toast-test-connection', {
        body: { restaurantId }
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.success) {
        toast({
          title: 'Connection successful',
          description: `Connected to ${data.restaurantName || 'Toast'}`
        });
        return data;
      }

      throw new Error('Connection test failed');
    } catch (error: any) {
      console.error('Error testing Toast connection:', error);
      toast({
        title: 'Connection failed',
        description: error.message || 'Failed to connect to Toast',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const saveWebhookSecret = async (restaurantId: string, webhookSecret: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('toast-save-webhook-secret', {
        body: { restaurantId, webhookSecret }
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      await checkConnectionStatus(restaurantId);
      
      toast({
        title: 'Webhook configured',
        description: 'Webhook secret has been saved successfully'
      });

      return data;
    } catch (error: any) {
      console.error('Error saving webhook secret:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save webhook secret',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const disconnectToast = async (restaurantId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('toast_connections' as any)
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }

      setConnection(null);
      setIsConnected(false);
      
      toast({
        title: 'Disconnected',
        description: 'Toast connection has been disabled'
      });
    } catch (error: any) {
      console.error('Error disconnecting from Toast:', error);
      toast({
        title: 'Error',
        description: 'Failed to disconnect from Toast',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const triggerManualSync = async (restaurantId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('toast-sync-data', {
        body: { restaurantId }
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: 'Sync initiated',
        description: `Synced ${data?.ordersSynced || 0} orders`
      });

      await checkConnectionStatus(restaurantId);

      return data;
    } catch (error: any) {
      console.error('Error syncing Toast data:', error);
      toast({
        title: 'Sync failed',
        description: error.message || 'Failed to sync data',
        variant: 'destructive'
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const getConnectionStatus = (restaurantId: string) => {
    return checkConnectionStatus(restaurantId);
  };

  return {
    isConnected,
    connection,
    loading,
    saveCredentials,
    testConnection,
    saveWebhookSecret,
    disconnectToast,
    triggerManualSync,
    checkConnectionStatus,
    getConnectionStatus
  };
};
