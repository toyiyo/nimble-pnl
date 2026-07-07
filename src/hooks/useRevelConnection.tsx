import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type RevelConnection = {
  id: string;
  restaurant_id: string;
  revel_instance: string;
  establishment_id: string | null;
  is_active: boolean;
  connection_status: string;
  initial_sync_done: boolean;
  last_sync_time: string | null;
  webhook_active: boolean;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export function useRevelConnection(restaurantId?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: connection, isLoading: loading } = useQuery({
    queryKey: ['revel-connection', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from('revel_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return data ?? null;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const isConnected = !!connection;

  async function checkConnectionStatus(id: string): Promise<RevelConnection | null> {
    if (!id) return null;
    const { data } = await supabase
      .from('revel_connections')
      .select('*')
      .eq('restaurant_id', id)
      .eq('is_active', true)
      .maybeSingle();
    return data ?? null;
  }

  async function connect(id: string, revelInstance: string, establishmentId?: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('revel-connect', {
      body: { restaurantId: id, revelInstance, establishmentId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    queryClient.invalidateQueries({ queryKey: ['revel-connection', id] });
    return data;
  }

  async function testConnection(id: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('revel-test-connection', {
      body: { restaurantId: id },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function triggerManualSync(id: string, options?: { startDate?: string; endDate?: string }): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase.functions.invoke('revel-sync-data', {
      body: { restaurantId: id, ...(options?.startDate && { startDate: options.startDate }), ...(options?.endDate && { endDate: options.endDate }) },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!options?.startDate) {
      toast({ title: 'Sync initiated', description: `Processed ${data?.ordersProcessed || 0} orders` });
    }
    queryClient.invalidateQueries({ queryKey: ['revel-connection', id] });
    return data;
  }

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('revel_connections').update({ is_active: false }).eq('restaurant_id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['revel-connection', id] });
      toast({ title: 'Disconnected', description: 'Revel connection has been disabled' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to disconnect from Revel', variant: 'destructive' });
    },
  });

  async function disconnectRevel(id: string): Promise<void> {
    return disconnectMutation.mutateAsync(id);
  }

  return { isConnected, connection, loading, connect, testConnection, triggerManualSync, disconnectRevel, checkConnectionStatus };
}
