import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface AuditEntry {
  id: string;
  tip_split_id: string | null;
  split_reference: string;
  action: 'created' | 'approved' | 'reopened' | 'modified' | 'archived' | 'deleted';
  changed_by: string | null;
  changed_at: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  reason: string | null;
}

interface User {
  email: string;
}

interface AuditEntryWithUser extends AuditEntry {
  user?: User;
}

export function useTipSplitAuditLog(splitId: string | null) {
  return useQuery<AuditEntryWithUser[]>({
    queryKey: ['tip-split-audit', splitId],
    queryFn: async () => {
      // @ts-expect-error - tip_split_audit table not yet in generated types
      const { data, error } = await supabase
        .from('tip_split_audit')
        .select('*')
        .eq('split_reference', splitId)
        .order('changed_at', { ascending: false });

      if (error) throw error;

      const userIds = [...new Set((data as unknown as AuditEntry[])?.map(e => e.changed_by).filter(Boolean))] as string[];
      
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', userIds);

        return (data as unknown as AuditEntry[])?.map(entry => ({
          ...entry,
          user: users?.find(u => u.id === entry.changed_by) as User | undefined,
        })) || [];
      }

      return (data as unknown as AuditEntry[]) || [];
    },
    enabled: !!splitId,
    staleTime: 30000,
  });
}
