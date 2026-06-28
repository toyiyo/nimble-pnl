import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

// Mirrors focus_connections DB columns — explicit list keeps select leaner than select('*')
type FocusConnection = {
  id: string;
  restaurant_id: string;
  report_base_url: string;
  report_path: string;
  db_server: string | null;
  db_catalog: string | null;
  report_user_id: string | null;
  store_id: string;
  revenue_center: string | null;
  timezone: string;
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

// Explicit column list — design F8: no select('*')
const FOCUS_CONNECTION_COLUMNS = [
  'id',
  'restaurant_id',
  'report_base_url',
  'report_path',
  'db_server',
  'db_catalog',
  'report_user_id',
  'store_id',
  'revenue_center',
  'timezone',
  'last_sync_time',
  'initial_sync_done',
  'sync_cursor',
  'is_active',
  'connection_status',
  'last_error',
  'last_error_at',
  'created_at',
  'updated_at',
].join(',');

export function useFocusConnection(restaurantId?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query — design §10 / F8: maybeSingle(), explicit column list, staleTime 30s,
  // refetchOnWindowFocus:false, refetchOnMount:true, enabled:!!restaurantId
  const { data: connection, isLoading: loading, error } = useQuery({
    queryKey: ['focus-connection', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return null;
      }

       
      const { data, error } = await supabase
        .from('focus_connections' as any)
        .select(FOCUS_CONNECTION_COLUMNS)
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data as any) ?? null) as FocusConnection | null;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const isConnected = !!connection;

  // ---- saveConnection ----
  // Both invoke error shapes handled (lesson 2026-05-16):
  //   Shape 1: invoke itself rejects (network, timeout) → error object
  //   Shape 2: {data:null, error:{message:...}} from HTTP-level error

  async function saveConnection(
    restaurantId: string,
    reportUrl: string
  ): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('focus-save-connection', {
      body: { restaurantId, reportUrl },
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });

    return data;
  }

  // ---- testConnection ----

  async function testConnection(restaurantId: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('focus-test-connection', {
      body: { restaurantId },
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });

    return data;
  }

  // ---- disconnect ----
  // Uses the Supabase JS client directly (RLS FOR ALL owner/manager policy covers this)

  const disconnectMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
       
      const { error } = await supabase
        .from('focus_connections' as any)
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }
    },
    onSuccess: (_, restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });
      toast({
        title: 'Disconnected',
        description: 'Focus POS connection has been disabled',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to disconnect from Focus POS',
        variant: 'destructive',
      });
    },
  });

  async function disconnect(restaurantId: string): Promise<void> {
    return disconnectMutation.mutateAsync(restaurantId);
  }

  // ---- triggerManualSync ----
  // Both invoke error shapes handled

  async function triggerManualSync(
    restaurantId: string
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase.functions.invoke('focus-sync-data', {
      body: { restaurantId },
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });

    return data;
  }

  return {
    isConnected,
    connection,
    loading,
    error,
    saveConnection,
    testConnection,
    disconnect,
    triggerManualSync,
  };
}
