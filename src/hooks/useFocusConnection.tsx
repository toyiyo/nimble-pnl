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
  // refetchOnWindowFocus:true, refetchOnMount:true, enabled:!!restaurantId
  const { data: connection, isLoading: loading, error } = useQuery({
    queryKey: ['focus-connection', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return null;
      }

      // focus_connections is not yet in the generated Supabase types — same pattern
      // as useSlingConnection.ts. The cast is removed automatically once types are
      // regenerated after the migration is deployed.
       
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const isConnected = !!connection;

  // ---- saveConnection ----
  // useMutation with onSettled: invalidates cache on both success and failure.
  // focus-save-connection writes to DB; even if it returns a non-2xx, the
  // connection row may have been partially updated, so we always re-fetch.
  // Both invoke error shapes handled (lesson 2026-05-16):
  //   Shape 1: invoke itself rejects (network, timeout) → error object
  //   Shape 2: {data:null, error:{message:...}} from HTTP-level error

  const saveConnectionMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      username,
      password,
      storeId,
    }: {
      restaurantId: string;
      username: string;
      password: string;
      storeId: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('focus-save-connection', {
        body: { restaurantId, username, password, storeId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as Record<string, unknown>;
    },
    onSettled: (_data, _error, { restaurantId }) => {
      queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });
    },
  });

  async function saveConnection(
    restaurantId: string,
    username: string,
    password: string,
    storeId: string,
  ): Promise<Record<string, unknown>> {
    return saveConnectionMutation.mutateAsync({ restaurantId, username, password, storeId });
  }

  // ---- testConnection ----
  // useMutation with onSettled: focus-test-connection writes connection_status
  // before returning; a failed HTTP response still leaves the row updated,
  // so we invalidate on both success and failure paths.

  const testConnectionMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.functions.invoke('focus-test-connection', {
        body: { restaurantId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as Record<string, unknown>;
    },
    onSettled: (_data, _error, restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });
    },
  });

  async function testConnection(restaurantId: string): Promise<Record<string, unknown>> {
    return testConnectionMutation.mutateAsync(restaurantId);
  }

  // ---- disconnect ----
  // Uses the Supabase JS client directly (RLS FOR ALL owner/manager policy covers this)

  const disconnectMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      // focus_connections is not yet in the generated Supabase types — same pattern
      // as useSlingConnection.ts.

      const { error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('focus_connections' as any)
        .update({ is_active: false })
        .eq('restaurant_id', restaurantId);

      if (error) {
        throw error;
      }
    },
    onSettled: (_data, _error, restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });
    },
    onSuccess: () => {
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
  // useMutation with onSettled: focus-sync-data writes sync_cursor and
  // last_sync_time before returning; invalidate on both paths so sync
  // progress is always fresh after a manual trigger.

  const triggerManualSyncMutation = useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.functions.invoke('focus-sync-data', {
        body: { restaurantId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data ?? null) as Record<string, unknown> | null;
    },
    onSettled: (_data, _error, restaurantId) => {
      queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });
    },
  });

  async function triggerManualSync(
    restaurantId: string
  ): Promise<Record<string, unknown> | null> {
    return triggerManualSyncMutation.mutateAsync(restaurantId);
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
