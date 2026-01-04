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
  full_name: string;
}

interface AuditEntryWithUser extends AuditEntry {
  user?: User;
}

export function useTipSplitAuditLog(splitId: string | null) {
  return useQuery<AuditEntryWithUser[]>({
    queryKey: ['tip-split-audit', splitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tip_split_audit')
        .select('*')
        .eq('split_reference', splitId)
        .order('changed_at', { ascending: false });

      if (error) throw error;

      const userIds = [...new Set((data as unknown as AuditEntry[])?.map(e => e.changed_by).filter(Boolean))] as string[];
      
      if (userIds.length > 0) {
        // Try profiles first (preferred), then fall back to auth.users
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', userIds);

        const { data: authUsers } = await supabase.rpc('get_users_by_ids', { 
          user_ids: userIds 
        });

        return (data as unknown as AuditEntry[])?.map(entry => {
          // Check profiles first
          const profileUser = profiles?.find(u => u.id === entry.changed_by);
          if (profileUser) {
            return {
              ...entry,
              user: { email: profileUser.email, full_name: profileUser.full_name } as User,
            };
          }
          
          // Fall back to auth.users
          const authUser = authUsers?.find((u: any) => u.id === entry.changed_by);
          if (authUser) {
            return {
              ...entry,
              user: { email: authUser.email, full_name: authUser.full_name } as User,
            };
          }

          return entry;
        }) || [];
      }

      return (data as unknown as AuditEntry[]) || [];
    },
    enabled: !!splitId,
    staleTime: 30000,
  });
}
