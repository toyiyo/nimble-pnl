import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TipDispute {
  id: string;
  restaurant_id: string;
  employee_id: string;
  tip_split_id: string | null;
  dispute_type: 'missing_hours' | 'wrong_role' | 'other';
  message: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TipDisputeWithDetails extends TipDispute {
  employee?: {
    name: string;
    position: string;
  };
  tip_split?: {
    split_date: string;
    total_amount: number;
  };
}

/**
 * Hook to manage tip disputes for managers
 */
export function useTipDisputes(restaurantId: string | null, status?: 'open' | 'resolved' | 'dismissed') {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch disputes
  const { data: disputes, isLoading, error } = useQuery({
    queryKey: ['tip-disputes', restaurantId, status],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('tip_disputes')
        .select(`
          *,
          employee:employees(name, position),
          tip_split:tip_splits(split_date, total_amount)
        `)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as TipDisputeWithDetails[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  // Create dispute
  const { mutate: createDispute, isPending: isCreating } = useMutation({
    mutationFn: async (input: {
      restaurant_id: string;
      employee_id: string;
      tip_split_id: string;
      dispute_type: 'missing_hours' | 'incorrect_amount' | 'wrong_date' | 'missing_tips' | 'other';
      message?: string;
    }) => {
      const { error } = await supabase.from('tip_disputes').insert({
        restaurant_id: input.restaurant_id,
        employee_id: input.employee_id,
        tip_split_id: input.tip_split_id,
        dispute_type: input.dispute_type,
        message: input.message?.trim() || null,
        status: 'open',
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-disputes', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['tip-splits'] });
    },
    onError: (error: Error) => {
      throw error;
    },
  });

  // Resolve dispute
  const { mutate: resolveDispute, isPending: isResolving } = useMutation({
    mutationFn: async ({ disputeId, notes }: { disputeId: string; notes?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('tip_disputes')
        .update({
          status: 'resolved',
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
          resolution_notes: notes || null,
        })
        .eq('id', disputeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-disputes', restaurantId] });
      toast({
        title: 'Dispute resolved',
        description: 'The issue has been marked as resolved.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error resolving dispute',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Dismiss dispute
  const { mutate: dismissDispute, isPending: isDismissing } = useMutation({
    mutationFn: async ({ disputeId, notes }: { disputeId: string; notes?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('tip_disputes')
        .update({
          status: 'dismissed',
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
          resolution_notes: notes || null,
        })
        .eq('id', disputeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-disputes', restaurantId] });
      toast({
        title: 'Dispute dismissed',
        description: 'The issue has been dismissed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error dismissing dispute',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const openDisputes = disputes?.filter(d => d.status === 'open') || [];

  return {
    disputes,
    openDisputes,
    isLoading,
    error,
    createDispute,
    isCreating,
    resolveDispute,
    isResolving,
    dismissDispute,
    isDismissing,
  };
}
