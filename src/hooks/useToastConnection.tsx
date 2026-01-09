import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Database } from '@/integrations/supabase/types';

// Use proper type from generated schema (or define manually to match actual DB)
type ToastConnection = {
  id: string;
  restaurant_id: string;
  client_id: string;
  client_secret_encrypted: string;
  toast_restaurant_guid: string;
  access_token_encrypted: string | null;
  token_expires_at: string | null;
  token_fetched_at: string | null;
  webhook_secret_encrypted: string | null;
  webhook_subscription_guid: string | null;
  webhook_active: boolean;
  last_sync_time: string | null;
  initial_sync_done: boolean;
  is_active: boolean;
  connection_status: string;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export const useToastConnection = (restaurantId?: string | null) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query for checking connection status (only when restaurantId is provided)
  const { data: connection, isLoading: loading, error } = useQuery({
    queryKey: ['toast-connection', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return null;
      }

      const { data, error } = await supabase
        .from('toast_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data as ToastConnection | null;
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false, // Avoid excessive refetches on tab switching
    refetchOnMount: true,
  });

  const isConnected = !!connection;

  // Legacy function for backward compatibility - used by components that call hook without restaurantId
  // and then call this function with a restaurantId parameter
  const checkConnectionStatus = async (restaurantId: string) => {
    if (!restaurantId) {
      return null;
    }

    const { data, error } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    return data as ToastConnection | null;
  };

  const saveCredentials = async (
    restaurantId: string,
    clientId: string,
    clientSecret: string,
    toastRestaurantGuid: string
  ) => {
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

    queryClient.invalidateQueries({ queryKey: ['toast-connection', restaurantId] });
    
    toast({
      title: 'Credentials saved',
      description: 'Toast API credentials have been saved successfully'
    });

    return data;
  };

  const testConnection = async (restaurantId: string) => {
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
  };

  const saveWebhookSecret = async (restaurantId: string, webhookSecret: string) => {
    const { data, error } = await supabase.functions.invoke('toast-save-webhook-secret', {
      body: { restaurantId, webhookSecret }
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    queryClient.invalidateQueries({ queryKey: ['toast-connection', restaurantId] });
    
    toast({
      title: 'Webhook configured',
      description: 'Webhook secret has been saved successfully'
    });

    return data;
  };

  // Mutation for disconnecting Toast
  const disconnectMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      const { error } = await supabase
        .from('toast_connections')
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }
    },
    onSuccess: (_, restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['toast-connection', restaurantId] });
      toast({
        title: 'Disconnected',
        description: 'Toast connection has been disabled'
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: 'Failed to disconnect from Toast',
        variant: 'destructive'
      });
      throw error;
    }
  });

  const disconnectToast = async (restaurantId: string) => {
    return disconnectMutation.mutateAsync(restaurantId);
  };

  const triggerManualSync = async (restaurantId: string) => {
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

    queryClient.invalidateQueries({ queryKey: ['toast-connection', restaurantId] });

    return data;
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
