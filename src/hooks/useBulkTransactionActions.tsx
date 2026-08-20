import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BulkCategorizeParams {
  transactionIds: string[];
  categoryId: string;
  restaurantId: string;
}

interface BulkCategorizeSkippedRow {
  id: string;
  reason: string;
}

interface BulkCategorizeRpcResult {
  success: boolean;
  categorized_count: number;
  reclassified_count: number;
  unchanged_count: number;
  skipped: BulkCategorizeSkippedRow[];
}

/** The RPC accepts at most 500 ids per call (see the migration's guard 4). */
const BULK_CATEGORIZE_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Groups skipped rows by reason for a toast description like "3 reconciled, 2 closed period". */
function summarizeSkipReasons(skipped: BulkCategorizeSkippedRow[]): string {
  const counts = new Map<string, number>();
  for (const row of skipped) {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => `${count} ${reason.replace(/_/g, ' ')}`)
    .join(', ');
}

/**
 * Hook for bulk categorizing bank transactions.
 * Calls the bulk_categorize_bank_transactions RPC, which writes a journal
 * entry per transaction so the change reaches the income statement.
 */
export function useBulkCategorizeTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      transactionIds,
      categoryId,
      restaurantId,
    }: BulkCategorizeParams): Promise<BulkCategorizeRpcResult> => {
      const aggregate: BulkCategorizeRpcResult = {
        success: true,
        categorized_count: 0,
        reclassified_count: 0,
        unchanged_count: 0,
        skipped: [],
      };

      for (const idChunk of chunk(transactionIds, BULK_CATEGORIZE_CHUNK_SIZE)) {
        const { data, error } = await supabase.rpc('bulk_categorize_bank_transactions', {
          p_transaction_ids: idChunk,
          p_category_id: categoryId,
          p_restaurant_id: restaurantId,
        });

        if (error) throw error;

        const result = data as unknown as BulkCategorizeRpcResult;
        if (!result.success) {
          throw new Error('Failed to categorize transactions');
        }

        aggregate.categorized_count += result.categorized_count;
        aggregate.reclassified_count += result.reclassified_count;
        aggregate.unchanged_count += result.unchanged_count;
        aggregate.skipped.push(...result.skipped);
      }

      return aggregate;
    },
    onSuccess: (result) => {
      // Invalidate every query the new journal entries change.
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });

      const changedCount = result.categorized_count + result.reclassified_count;
      const description =
        result.unchanged_count > 0
          ? `${result.unchanged_count} already had this category`
          : 'Changes have been applied successfully';

      toast.success(`${changedCount} transactions categorized`, {
        description,
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            // TODO: Implement undo functionality
            toast.info('Undo feature coming soon');
          },
        },
      });

      if (result.skipped.length > 0) {
        toast.error(`${result.skipped.length} transactions skipped`, {
          description: summarizeSkipReasons(result.skipped),
          duration: 10000,
        });
      }
    },
    onError: (error) => {
      console.error('Error bulk categorizing transactions:', error);
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
      toast.error('Failed to categorize transactions', {
        description: message || 'Please try again or contact support',
      });
    },
  });
}

interface BulkDeleteParams {
  transactionIds: string[];
  restaurantId: string;
}

/**
 * Hook for bulk deleting bank transactions
 * Used when transactions from shared bank accounts don't belong to this restaurant
 */
export function useBulkDeleteTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionIds, restaurantId }: BulkDeleteParams) => {
      const { data, error } = await supabase.rpc('bulk_delete_bank_transactions', {
        p_transaction_ids: transactionIds,
        p_restaurant_id: restaurantId,
      });

      if (error) throw error;

      const result = data as { success: boolean; error?: string; deleted_count?: number };
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete transactions');
      }

      return result;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });

      toast.success(`${result.deleted_count || variables.transactionIds.length} transactions deleted`, {
        description: 'Transactions have been permanently removed',
      });
    },
    onError: (error) => {
      console.error('Error bulk deleting transactions:', error);
      toast.error('Failed to delete transactions', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
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
