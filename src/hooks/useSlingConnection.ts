import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

type SlingConnection = {
  id: string;
  restaurant_id: string;
  email: string;
  password_encrypted: string;
  auth_token: string | null;
  token_fetched_at: string | null;
  sling_org_id: number | null;
  sling_org_name: string | null;
  last_sync_time: string | null;
  initial_sync_done: boolean;
  sync_cursor: number;
  is_active: boolean;
  connection_status: string;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export function useSlingConnection(restaurantId?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: connection, isLoading: loading } = useQuery({
    queryKey: ['sling-connection', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return null;
      }

      const { data, error } = await supabase
        .from('sling_connections' as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data as unknown as SlingConnection | null;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const isConnected = !!connection;

  async function saveCredentials(
    restaurantId: string,
    email: string,
    password: string
  ): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('sling-save-credentials', {
      body: { restaurantId, email, password },
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    queryClient.invalidateQueries({ queryKey: ['sling-connection', restaurantId] });

    toast({
      title: 'Credentials saved',
      description: 'Sling credentials have been saved successfully',
    });

    return data;
  }

  async function testConnection(
    restaurantId: string,
    slingOrgId?: number
  ): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('sling-test-connection', {
      body: { restaurantId, ...(slingOrgId !== undefined && { slingOrgId }) },
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    // If the backend needs org selection, pass that through to the caller
    if (data?.needsOrgSelection) {
      return data;
    }

    if (data?.success) {
      toast({
        title: 'Connection successful',
        description: `Connected to ${data.orgName || 'Sling'}`,
      });

      queryClient.invalidateQueries({ queryKey: ['sling-connection', restaurantId] });

      return data;
    }

    throw new Error('Connection test failed');
  }

  const disconnectMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      const { error } = await supabase
        .from('sling_connections' as any)
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }
    },
    onSuccess: (_, restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['sling-connection', restaurantId] });
      toast({
        title: 'Disconnected',
        description: 'Sling connection has been disabled',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: 'Failed to disconnect from Sling',
        variant: 'destructive',
      });
      throw error;
    },
  });

  async function disconnectSling(restaurantId: string): Promise<void> {
    return disconnectMutation.mutateAsync(restaurantId);
  }

  async function triggerManualSync(
    restaurantId: string,
    options?: { startDate?: string; endDate?: string; mode?: 'initial' | 'incremental' | 'custom' }
  ): Promise<Record<string, unknown> | null> {
    const body = {
      restaurantId,
      ...(options?.startDate && { startDate: options.startDate }),
      ...(options?.endDate && { endDate: options.endDate }),
      ...(options?.mode && { mode: options.mode }),
    };

    const { data, error } = await supabase.functions.invoke('sling-sync-data', {
      body,
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    // Only show toast for non-custom range syncs (custom range shows progress in UI)
    if (!options?.startDate) {
      toast({
        title: 'Sync initiated',
        description: `Synced ${data?.shiftsSynced || 0} shifts and ${data?.timesheetsSynced || 0} timesheets`,
      });
    }

    queryClient.invalidateQueries({ queryKey: ['sling-connection', restaurantId] });

    return data;
  }

  return {
    isConnected,
    connection,
    loading,
    saveCredentials,
    testConnection,
    disconnectSling,
    triggerManualSync,
  };
}
