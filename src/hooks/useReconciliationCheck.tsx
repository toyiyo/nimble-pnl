import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ReconciliationCheck {
  has_violation: boolean;
  message?: string;
  boundary_date?: string;
  earliest_transaction_date?: string;
  older_transactions_sum?: number;
  adjustment_needed?: number;
  current_opening_balance?: number;
  new_opening_balance?: number;
}

interface ReconciliationAdjustment {
  adjusted: boolean;
  message?: string;
  adjustment_amount?: number;
  old_opening_balance?: number;
  new_opening_balance?: number;
  old_boundary_date?: string;
  new_boundary_date?: string;
  journal_entry_id?: string;
}

export const useReconciliationCheck = (restaurantId: string | undefined) => {
  const queryClient = useQueryClient();

  // Check for reconciliation violations
  const checkQuery = useQuery({
    queryKey: ['reconciliation-check', restaurantId],
    queryFn: async () => {
      if (!restaurantId) throw new Error('Restaurant ID required');
      
      const { data, error } = await supabase.rpc('check_reconciliation_boundary', {
        p_restaurant_id: restaurantId
      });

      if (error) throw error;
      return data as unknown as ReconciliationCheck;
    },
    enabled: !!restaurantId,
  });

  // Apply reconciliation adjustment
  const applyAdjustment = useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.rpc('apply_reconciliation_adjustment', {
        p_restaurant_id: restaurantId
      });

      if (error) throw error;
      return data as unknown as ReconciliationAdjustment;
    },
    onSuccess: (data) => {
      if (data.adjusted) {
        toast.success(
          `Reconciliation adjusted`,
          {
            description: `Opening balance updated from ${new Intl.NumberFormat('en-US', { 
              style: 'currency', 
              currency: 'USD' 
            }).format(data.old_opening_balance || 0)} to ${new Intl.NumberFormat('en-US', { 
              style: 'currency', 
              currency: 'USD' 
            }).format(data.new_opening_balance || 0)}. Boundary date moved from ${new Date(data.old_boundary_date || '').toLocaleDateString()} to ${new Date(data.new_boundary_date || '').toLocaleDateString()}.`,
          }
        );
      } else {
        toast.info(data.message || 'No adjustment needed');
      }
      
      queryClient.invalidateQueries({ queryKey: ['reconciliation-check'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
    },
    onError: (error: Error) => {
      toast.error(`Reconciliation adjustment failed: ${error.message}`);
    },
  });

  return {
    check: checkQuery.data,
    isChecking: checkQuery.isLoading,
    applyAdjustment: applyAdjustment.mutate,
    isApplying: applyAdjustment.isPending,
  };
};
