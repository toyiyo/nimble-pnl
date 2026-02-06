import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

export interface CheckAuditEntry {
  id: string;
  restaurant_id: string;
  check_number: number;
  payee_name: string;
  amount: number;
  issue_date: string;
  memo: string | null;
  action: 'printed' | 'voided' | 'reprinted';
  performed_by: string | null;
  performed_at: string;
  pending_outflow_id: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface LogCheckActionInput {
  check_number: number;
  payee_name: string;
  amount: number;
  issue_date: string;
  memo?: string | null;
  action: 'printed' | 'voided' | 'reprinted';
  pending_outflow_id?: string | null;
  void_reason?: string | null;
}

export function useCheckAuditLog() {
  const { selectedRestaurant } = useRestaurantContext();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['check-audit-log', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('check_audit_log' as any)
        .select('id, restaurant_id, check_number, payee_name, amount, issue_date, memo, action, performed_by, performed_at, pending_outflow_id, void_reason, created_at')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('performed_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return data as CheckAuditEntry[];
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 30_000,
  });

  const logCheckAction = useMutation({
    mutationFn: async (input: LogCheckActionInput) => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('check_audit_log' as any)
        .insert({
          restaurant_id: selectedRestaurant.restaurant_id,
          performed_by: userData.user.id,
          ...input,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CheckAuditEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-audit-log'] });
    },
    onError: (error: Error) => {
      // Audit logging failures are non-blocking — log to console
      console.error('Failed to log check action:', error);
    },
  });

  return {
    auditLog: query.data ?? [],
    isLoading: query.isLoading,
    logCheckAction,
  };
}
