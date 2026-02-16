import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Table not yet in generated types -- helper avoids repeating the cast
function opsInboxTable() {
  return supabase.from('ops_inbox_item' as never) as ReturnType<typeof supabase.from>;
}

export interface OpsInboxItem {
  id: string;
  restaurant_id: string;
  title: string;
  description: string | null;
  kind: 'uncategorized_txn' | 'uncategorized_pos' | 'anomaly' | 'reconciliation' | 'recommendation';
  priority: number;
  status: 'open' | 'snoozed' | 'done' | 'dismissed';
  snoozed_until: string | null;
  due_at: string | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  evidence_json: Array<{ table: string; id?: string; date?: string; summary: string }>;
  meta: Record<string, unknown>;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface UseOpsInboxOptions {
  status?: string;
  kind?: string;
  priority?: number;
  limit?: number;
}

export function useOpsInbox(restaurantId: string | undefined, options: UseOpsInboxOptions = {}) {
  const queryClient = useQueryClient();
  const { status = 'open', kind, priority, limit = 100 } = options;

  const query = useQuery({
    queryKey: ['ops-inbox', restaurantId, status, kind, priority],
    queryFn: async () => {
      if (!restaurantId) return [];

      let q = opsInboxTable()
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status && status !== 'all') {
        q = q.eq('status', status);
      }
      if (kind) {
        q = q.eq('kind', kind);
      }
      if (priority) {
        q = q.eq('priority', priority);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as OpsInboxItem[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ itemId, newStatus, snoozedUntil }: {
      itemId: string;
      newStatus: 'open' | 'snoozed' | 'done' | 'dismissed';
      snoozedUntil?: string;
    }) => {
      const updates: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'snoozed' && snoozedUntil) {
        updates.snoozed_until = snoozedUntil;
      }
      if (newStatus === 'done' || newStatus === 'dismissed') {
        updates.resolved_at = new Date().toISOString();
      }

      const { error } = await opsInboxTable()
        .update(updates)
        .eq('id', itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-inbox', restaurantId] });
    },
  });

  return {
    items: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    updateStatus: updateStatus.mutate,
    isUpdating: updateStatus.isPending,
    refetch: query.refetch,
  };
}

export function useOpsInboxCount(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['ops-inbox-count', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return { open: 0, critical: 0 };

      const { count: openCount, error: openError } = await opsInboxTable()
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open');

      const { count: criticalCount, error: critError } = await opsInboxTable()
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open')
        .eq('priority', 1);

      if (openError || critError) throw openError || critError;
      return { open: openCount || 0, critical: criticalCount || 0 };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });
}
