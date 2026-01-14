import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BulkCategorizeParams {
  transactionIds: string[];
  categoryId: string;
  restaurantId: string;
}

/**
 * Hook for bulk categorizing bank transactions
 * Applies a category to multiple transactions at once
 */
export function useBulkCategorizeTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionIds, categoryId, restaurantId }: BulkCategorizeParams) => {
      const { data, error } = await supabase
        .from('bank_transactions')
        .update({
          category_id: categoryId,
          is_categorized: true,
          suggested_category_id: null, // Clear AI suggestions
        })
        .in('id', transactionIds)
        .eq('restaurant_id', restaurantId)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      // Invalidate all transaction queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      
      toast.success(`${variables.transactionIds.length} transactions categorized`, {
        description: 'Changes have been applied successfully',
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            // TODO: Implement undo functionality
            toast.info('Undo feature coming soon');
          },
        },
      });
    },
    onError: (error) => {
      console.error('Error bulk categorizing transactions:', error);
      toast.error('Failed to categorize transactions', {
        description: 'Please try again or contact support',
      });
    },
  });
}

interface BulkExcludeParams {
  transactionIds: string[];
  reason: string;
  restaurantId: string;
}

/**
 * Hook for bulk excluding bank transactions from P&L
 */
export function useBulkExcludeTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionIds, reason, restaurantId }: BulkExcludeParams) => {
      const { data, error } = await supabase
        .from('bank_transactions')
        .update({
          is_excluded: true,
          excluded_reason: reason,
        })
        .in('id', transactionIds)
        .eq('restaurant_id', restaurantId)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      
      toast.success(`${variables.transactionIds.length} transactions excluded`, {
        description: 'Transactions will not appear in P&L',
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            toast.info('Undo feature coming soon');
          },
        },
      });
    },
    onError: (error) => {
      console.error('Error bulk excluding transactions:', error);
      toast.error('Failed to exclude transactions');
    },
  });
}

interface BulkMarkTransferParams {
  transactionIds: string[];
  isTransfer: boolean;
  restaurantId: string;
}

/**
 * Hook for bulk marking bank transactions as transfers
 */
export function useBulkMarkAsTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionIds, isTransfer, restaurantId }: BulkMarkTransferParams) => {
      const { data, error } = await supabase
        .from('bank_transactions')
        .update({
          is_transfer: isTransfer,
        })
        .in('id', transactionIds)
        .eq('restaurant_id', restaurantId)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      
      const action = variables.isTransfer ? 'marked as transfers' : 'unmarked as transfers';
      toast.success(`${variables.transactionIds.length} transactions ${action}`, {
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            toast.info('Undo feature coming soon');
          },
        },
      });
    },
    onError: (error) => {
      console.error('Error bulk marking transactions:', error);
      toast.error('Failed to update transactions');
    },
  });
}
