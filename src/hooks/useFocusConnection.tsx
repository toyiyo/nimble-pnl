import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

// Mirrors focus_connections DB columns — explicit list keeps select leaner than select('*').
// api_key / api_secret_encrypted are intentionally omitted: credentials must stay server-side.
type FocusConnection = {
  id: string;
  restaurant_id: string;
  store_id: string;
  environment: string;
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

// Restaurant option returned by focus-list-restaurants — design §4.2.
export type FocusRestaurantOption = {
  restaurant_guid: string;
  restaurant_name: string;
};

// Explicit column list — design F8: no select('*').
// api_key excluded: credential fields must not reach the browser.
const FOCUS_CONNECTION_COLUMNS = [
  'id',
  'restaurant_id',
  'store_id',
  'environment',
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

/**
 * Determines whether the connection query should poll for progress updates.
 * Exported for unit testing (design §8.5 / Frontend major #1).
 *
 * Returns 8000ms when:
 *   - a connection row exists
 *   - the backfill is not yet done (initial_sync_done=false)
 *   - the connection is active (is_active=true)
 *   - there is no persisted error (connection_status !== 'error')
 *
 * Returns false in all other cases (done, disconnected, errored, no data).
 * NOTE: Do not lower staleTime below 30000 or polling will cause excessive DB load.
 */
export function __focusRefetchInterval(
  query: { state: { data: Pick<FocusConnection, 'initial_sync_done' | 'is_active' | 'connection_status'> | null | undefined } }
): number | false {
  const d = query.state.data;
  if (!d || d.initial_sync_done || !d.is_active || d.connection_status === 'error') {
    return false;
  }
  return 8000;
}

export function useFocusConnection(restaurantId?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Query — design §10 / F8: maybeSingle(), explicit column list,
  // refetchOnWindowFocus:true, refetchOnMount:true, enabled:!!restaurantId.
  // refetchInterval (design §8.5 / Frontend major #1): polls every 8s while backfilling;
  // stops on done, disconnect, or persisted error.
  // staleTime: 0 while backfilling so each refetchInterval tick actually fires a network
  // request (React Query skips refetches when cached data is still "fresh"). On done/error
  // the interval stops anyway, so 0 staleTime only has a cost during the backfill window.
  const { data: connection, isLoading: loading, error } = useQuery<FocusConnection | null>({
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
    // staleTime: 0 ensures refetchInterval polls actually fire network requests
    // during backfill. Once backfill ends the interval stops, so there is no
    // steady-state cost from the low staleTime.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: __focusRefetchInterval as Parameters<typeof useQuery>[0]['refetchInterval'],
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
      apiKey,
      apiSecret,
      restaurantGuid,
      environment,
    }: {
      restaurantId: string;
      apiKey: string;
      apiSecret: string;
      restaurantGuid: string;
      environment: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('focus-save-connection', {
        body: {
          restaurantId,
          apiKey,
          apiSecret,
          restaurantGuid,
          environment,
        },
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
    apiKey: string,
    apiSecret: string,
    restaurantGuid: string,
    environment: string = 'production',
  ): Promise<Record<string, unknown>> {
    return saveConnectionMutation.mutateAsync({
      restaurantId,
      apiKey,
      apiSecret,
      restaurantGuid,
      environment,
    });
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
  //
  // Design §8.5 (Frontend critical #1): options MUST be spread into the body
  // so custom-range startDate/endDate reach the edge function. Omitting this
  // caused custom range to silently fall back to a normal sync.

  const triggerManualSyncMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      options,
    }: {
      restaurantId: string;
      options?: { startDate?: string; endDate?: string };
    }) => {
      const { data, error } = await supabase.functions.invoke('focus-sync-data', {
        body: {
          restaurantId,
          ...(options?.startDate && { startDate: options.startDate }),
          ...(options?.endDate && { endDate: options.endDate }),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data ?? null) as Record<string, unknown> | null;
    },
    onSettled: (_data, _error, { restaurantId }) => {
      queryClient.invalidateQueries({ queryKey: ['focus-connection', restaurantId] });
    },
  });

  async function triggerManualSync(
    restaurantId: string,
    options?: { startDate?: string; endDate?: string },
  ): Promise<Record<string, unknown> | null> {
    return triggerManualSyncMutation.mutateAsync({ restaurantId, options });
  }

  // ---- listRestaurants ----
  // useMutation (not useQuery) because it carries unsaved API credentials in
  // the body; caching them in React Query would risk stale-credential confusion
  // and expose key/secret in query state. Design §4.2 / §8.5.
  //
  // Both invoke error shapes handled (lesson 2026-05-16):
  //   Shape 1: invoke itself rejects (network, timeout)
  //   Shape 2: {data:null, error:{message:...}} from HTTP-level error
  //   Shape 3: {data:{success:false, error:'...'}} Focus-side friendly message

  const listRestaurantsMutation = useMutation({
    mutationFn: async ({
      restaurantId,
      apiKey,
      apiSecret,
      environment,
    }: {
      restaurantId: string;
      apiKey: string;
      apiSecret: string;
      environment: string;
    }): Promise<FocusRestaurantOption[]> => {
      const { data, error } = await supabase.functions.invoke('focus-list-restaurants', {
        body: { restaurantId, apiKey, apiSecret, environment },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.restaurants ?? []) as FocusRestaurantOption[];
    },
    // No cache invalidation needed — read-only, credentials not stored.
  });

  async function listRestaurants(
    restaurantId: string,
    apiKey: string,
    apiSecret: string,
    environment: string = 'production',
  ): Promise<FocusRestaurantOption[]> {
    return listRestaurantsMutation.mutateAsync({ restaurantId, apiKey, apiSecret, environment });
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
    listRestaurants,
  };
}
