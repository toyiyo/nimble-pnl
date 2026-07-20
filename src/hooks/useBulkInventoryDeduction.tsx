import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BulkCounts {
  processed: number;
  skipped: number;
  errors: number;
}

export interface BulkProcessResult extends BulkCounts {
  total: number;
}

export interface BulkProgress extends BulkCounts {
  batches: number;
}

interface BulkBatchCursor {
  sale_date: string;
  created_at: string;
  id: string;
}

interface BulkBatchResponse extends BulkCounts {
  batch_count: number;
  done: boolean;
  next_cursor: BulkBatchCursor | null;
}

const BATCH_SIZE = 500;
// The keyset cursor advances strictly on every non-final batch, so the loop
// terminates on its own once the range is exhausted. Do NOT impose a low
// fixed batch cap: it would strand any range larger than cap×BATCH_SIZE,
// because a re-run re-walks the already-processed prefix (counted as skipped
// batches) and would hit the same cap before reaching the remaining rows.
// Instead, guard against a *non-advancing* cursor (a backend stall — the only
// real infinite-loop risk), backed by a very high absolute backstop.
// ([2026-05-17] bound total — but bound it above real workloads, not below.)
const ITERATION_BACKSTOP = 1_000_000; // ~500M rows; anomaly guard only

export const useBulkInventoryDeduction = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const bulkProcessHistoricalSales = useCallback(async (
    restaurantId: string,
    startDate: string,
    endDate: string,
    onProgress?: (progress: BulkProgress) => void,
  ): Promise<BulkProcessResult | null> => {
    setLoading(true);
    const totals = { processed: 0, skipped: 0, errors: 0 };
    let cursor: BulkBatchCursor | null = null;
    let done = false;
    let batches = 0;
    // Blanket invalidation is acceptable for a rare, user-initiated bulk op:
    // refreshes derived React-Query views (food cost, COGS, consumption, P&L,
    // unified-sales). The products list uses an imperative useState hook
    // (useProducts), not React Query, so it is out of scope here. Called on both
    // the success and partial-failure paths — completed batches wrote real data.
    const refreshDerivedQueries = () => queryClient.invalidateQueries();
    try {
      while (!done) {
        const { data, error } = await supabase.rpc('bulk_process_historical_sales', {
          p_restaurant_id: restaurantId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_batch_size: BATCH_SIZE,
          p_after_sale_date: cursor?.sale_date ?? null,
          p_after_created_at: cursor?.created_at ?? null,
          p_after_id: cursor?.id ?? null,
        });

        if (error) throw error;
        if (!data) throw new Error('Empty response from bulk_process_historical_sales');

        const batch = data as unknown as BulkBatchResponse;
        batches += 1;
        totals.processed += batch.processed;
        totals.skipped += batch.skipped;
        totals.errors += batch.errors;

        // Non-advancement guard: a non-final batch must return a cursor strictly
        // past the previous one (id is a unique, monotonic PK). An identical id
        // means the backend cursor stalled — abort instead of looping forever.
        if (!batch.done && batch.next_cursor && cursor && batch.next_cursor.id === cursor.id) {
          throw new Error('Backfill stalled: the cursor did not advance. Aborted to avoid an infinite loop.');
        }

        cursor = batch.next_cursor;
        done = batch.done;
        onProgress?.({ ...totals, batches });

        if (batches >= ITERATION_BACKSTOP) {
          throw new Error('Backfill exceeded the safety iteration backstop; aborted.');
        }
      }

      refreshDerivedQueries();

      toast({
        title: "Bulk Processing Complete",
        description: `Processed ${totals.processed} sales, skipped ${totals.skipped} (already processed or no recipe), ${totals.errors} errors.`,
      });

      return { ...totals, total: totals.processed + totals.skipped + totals.errors };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error bulk processing sales:', error);
      refreshDerivedQueries();
      toast({
        title: "Bulk processing interrupted",
        description: `Processed ${totals.processed} sales (${totals.errors} errors) before: ${message}. Safe to re-run — already-processed sales are skipped.`,
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, queryClient]);

  return {
    loading,
    bulkProcessHistoricalSales,
  };
};
