import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface BulkProcessResult {
  processed: number;
  skipped: number;
  errors: number;
  total: number;
}

export interface BulkProgress {
  processed: number;
  skipped: number;
  errors: number;
  batches: number;
}

interface BulkBatchCursor {
  sale_date: string;
  created_at: string;
  id: string;
}

interface BulkBatchResponse {
  processed: number;
  skipped: number;
  errors: number;
  batch_count: number;
  done: boolean;
  next_cursor: BulkBatchCursor | null;
}

// 500k-row safety cap ([2026-05-17] bound total, not per-call).
const MAX_BATCHES = 1000;
const BATCH_SIZE = 500;

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
    try {
      while (!done) {
        if (++batches > MAX_BATCHES) {
          throw new Error(
            `Reached the ${MAX_BATCHES}-batch safety cap. Progress was saved — re-run to resume from where it stopped.`
          );
        }

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

        const batch = data as unknown as BulkBatchResponse;
        totals.processed += batch.processed;
        totals.skipped += batch.skipped;
        totals.errors += batch.errors;
        cursor = batch.next_cursor;
        done = batch.done;

        onProgress?.({ ...totals, batches });
      }

      // Blanket invalidation is acceptable for a rare, user-initiated bulk op:
      // refreshes derived React-Query views (food cost, COGS, consumption, P&L,
      // unified-sales). The products list uses an imperative useState hook
      // (useProducts), not React Query, so it is out of scope here.
      queryClient.invalidateQueries();

      toast({
        title: "Bulk Processing Complete",
        description: `Processed ${totals.processed} sales, skipped ${totals.skipped} (already processed or no recipe), ${totals.errors} errors.`,
      });

      return { ...totals, total: totals.processed + totals.skipped + totals.errors };
    } catch (error: any) {
      console.error('Error bulk processing sales:', error);
      // Partial totals were still written by completed batches — refresh so
      // the UI reflects them even though the run didn't finish.
      queryClient.invalidateQueries();
      toast({
        title: "Bulk processing interrupted",
        description: `Processed ${totals.processed} sales (${totals.errors} errors) before: ${error.message}. Safe to re-run — it resumes where it left off.`,
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
