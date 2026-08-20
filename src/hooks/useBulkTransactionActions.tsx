import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
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

/**
 * The three skip reasons the RPC's guarded branches set. Any other value
 * is the raw SQLERRM text from the RPC's catch-all exception trap
 * (supabase/migrations/20260819231210_add_bulk_categorize_bank_transactions.sql)
 * and must not reach the user verbatim or be underscore-replaced — a real
 * Postgres error can carry underscores from a constraint or column name.
 */
const KNOWN_SKIP_REASONS = new Set(['reconciled', 'closed_period', 'not_found']);

/** Groups skipped rows by reason for a toast description like "3 reconciled, 2 closed period". */
function summarizeSkipReasons(skipped: BulkCategorizeSkippedRow[]): string {
  const counts = new Map<string, number>();
  let unexpectedCount = 0;
  for (const row of skipped) {
    if (KNOWN_SKIP_REASONS.has(row.reason)) {
      counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
    } else {
      unexpectedCount += 1;
      console.error('Unexpected bulk categorize skip reason', { id: row.id, reason: row.reason });
    }
  }
  const parts = Array.from(counts.entries()).map(([reason, count]) => `${count} ${reason.replace(/_/g, ' ')}`);
  if (unexpectedCount > 0) {
    parts.push(`${unexpectedCount} unexpected error${unexpectedCount === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

/**
 * Thrown when a chunk fails after an earlier chunk already wrote real
 * journal entries, or when every chunk succeeds but the trailing balance
 * rebuild fails. Carries the partial aggregate so onError can invalidate
 * queries and tell the user how much succeeded, instead of discarding it.
 * `message` is for logging only — never render it in a toast; it can carry
 * the raw RPC error text (see KNOWN_SKIP_REASONS above for why).
 */
class PartialBulkCategorizeError extends Error {
  partial: BulkCategorizeRpcResult;
  /**
   * True when every selected row was categorized and only the trailing
   * balance-rebuild call failed. onError must not call this a partial
   * categorize — the categorize step fully succeeded.
   */
  rebuildOnlyFailed: boolean;
  constructor(message: string, partial: BulkCategorizeRpcResult, rebuildOnlyFailed = false) {
    super(message);
    this.name = 'PartialBulkCategorizeError';
    this.partial = partial;
    this.rebuildOnlyFailed = rebuildOnlyFailed;
  }
}

/** Invalidates every query the new journal entries change. Shared by the success and partial-failure paths. */
function invalidateBulkCategorizeQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
  queryClient.invalidateQueries({ queryKey: ['income-statement'] });
  queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
  queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
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
        try {
          const { data, error } = await supabase.rpc('bulk_categorize_bank_transactions', {
            p_transaction_ids: idChunk,
            p_category_id: categoryId,
            p_restaurant_id: restaurantId,
            // Every chunk skips its own rebuild; one rebuild_account_balances
            // call runs after the loop below, for the whole operation.
            p_skip_rebuild: true,
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
        } catch (chunkError) {
          // A later chunk's failure must not hide an earlier chunk's real
          // writes: those journal entries already exist in the database.
          if (aggregate.categorized_count + aggregate.reclassified_count > 0) {
            // Rebuild balances for the partial write now, so the ledger
            // is not left stale on top of the operation being incomplete.
            // A failure here must not replace the real cause below it —
            // log it and keep going.
            try {
              const { error: rescueRebuildError } = await supabase.rpc('rebuild_account_balances', {
                p_restaurant_id: restaurantId,
              });
              if (rescueRebuildError) {
                console.error('Balance rebuild after a partial bulk categorize also failed', rescueRebuildError);
              }
            } catch (rescueRebuildCatchError) {
              console.error('Balance rebuild after a partial bulk categorize also failed', rescueRebuildCatchError);
            }

            const message =
              chunkError instanceof Error
                ? chunkError.message
                : (chunkError as { message?: string })?.message || 'Failed to categorize transactions';
            throw new PartialBulkCategorizeError(message, aggregate);
          }
          throw chunkError;
        }
      }

      if (aggregate.categorized_count + aggregate.reclassified_count > 0) {
        const { error: rebuildError } = await supabase.rpc('rebuild_account_balances', {
          p_restaurant_id: restaurantId,
        });
        if (rebuildError) {
          // Every row was categorized; only the cached current_balance
          // rollup failed. This is not a partial categorize — flag it so
          // onError shows copy that matches what actually happened.
          throw new PartialBulkCategorizeError(rebuildError.message, aggregate, true);
        }
      }

      return aggregate;
    },
    onSuccess: (result) => {
      invalidateBulkCategorizeQueries(queryClient);

      const changedCount = result.categorized_count + result.reclassified_count;

      // A row only ever lands in categorized/reclassified, unchanged, or
      // skipped. Showing "0 transactions categorized" as a success when
      // every row was skipped would contradict the skip-count error toast
      // shown right below it.
      if (changedCount > 0 || result.unchanged_count > 0) {
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
      }

      if (result.skipped.length > 0) {
        toast.error(`${result.skipped.length} transactions skipped`, {
          description: summarizeSkipReasons(result.skipped),
          duration: 10000,
        });
      }
    },
    onError: (error) => {
      console.error('Error bulk categorizing transactions:', error);

      if (error instanceof PartialBulkCategorizeError) {
        // Some rows already wrote real journal entries before the failure.
        // Refresh the UI to show them instead of leaving it stale.
        invalidateBulkCategorizeQueries(queryClient);

        const changedCount = error.partial.categorized_count + error.partial.reclassified_count;

        // error.message may carry raw RPC error text (a guard message, a
        // network error, or a rebuild failure) — the same rule as
        // KNOWN_SKIP_REASONS applies: log it, do not render it.
        if (error.rebuildOnlyFailed) {
          toast.error('Categorized, but balances did not refresh', {
            description: `${changedCount} transactions were categorized. Reload the page, or contact support if balances still look wrong.`,
            duration: 10000,
          });
        } else {
          toast.error('Only part of the selection was categorized', {
            description: `${changedCount} transactions were categorized before this error. Please try again or contact support.`,
            duration: 10000,
          });
        }
        return;
      }

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
