/**
 * RED test (Phase 4 T3): drives the batch loop for
 * `useBulkInventoryDeduction` per docs/superpowers/specs/
 * 2026-07-20-bulk-deduction-timeout-design.md §3.
 *
 * The current hook (src/hooks/useBulkInventoryDeduction.tsx) makes a single
 * `supabase.rpc('bulk_process_historical_sales', ...)` call with no
 * `onProgress` param, no cursor threading, and no `queryClient.invalidateQueries()`
 * call. This test asserts the batched-loop contract the migration's new
 * 7-arg `{ processed, skipped, errors, batch_count, done, next_cursor }`
 * response shape requires, and is expected to FAIL until the hook is
 * rewritten (T4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBulkInventoryDeduction } from '@/hooks/useBulkInventoryDeduction';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

let invalidateQueriesSpy: ReturnType<typeof vi.spyOn>;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateQueriesSpy = vi.spyOn(qc, 'invalidateQueries');
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useBulkInventoryDeduction batch loop', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    toastMock.mockReset();
  });

  it('loops until done, threads the cursor, accumulates totals, and reports progress per batch', async () => {
    const cursor1 = { sale_date: '2026-01-05', created_at: '2026-01-05T12:00:00Z', id: 'sale-500' };

    rpcMock
      .mockResolvedValueOnce({
        data: { processed: 480, skipped: 20, errors: 0, batch_count: 500, done: false, next_cursor: cursor1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { processed: 18, skipped: 2, errors: 0, batch_count: 20, done: true, next_cursor: null },
        error: null,
      });

    const onProgress = vi.fn();
    const { result } = renderHook(() => useBulkInventoryDeduction(), { wrapper });

    let summary: Awaited<ReturnType<typeof result.current.bulkProcessHistoricalSales>> | undefined;
    await act(async () => {
      summary = await result.current.bulkProcessHistoricalSales(
        'restaurant-1',
        '2026-01-01',
        '2026-01-31',
        onProgress,
      );
    });

    // Called exactly twice: once per batch until `done: true`.
    expect(rpcMock).toHaveBeenCalledTimes(2);

    // First call: no cursor yet.
    expect(rpcMock).toHaveBeenNthCalledWith(1, 'bulk_process_historical_sales', {
      p_restaurant_id: 'restaurant-1',
      p_start_date: '2026-01-01',
      p_end_date: '2026-01-31',
      p_batch_size: 500,
      p_after_sale_date: null,
      p_after_created_at: null,
      p_after_id: null,
    });

    // Second call: threads batch 1's next_cursor.
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'bulk_process_historical_sales', {
      p_restaurant_id: 'restaurant-1',
      p_start_date: '2026-01-01',
      p_end_date: '2026-01-31',
      p_batch_size: 500,
      p_after_sale_date: cursor1.sale_date,
      p_after_created_at: cursor1.created_at,
      p_after_id: cursor1.id,
    });

    // onProgress fires once per batch with running totals.
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { processed: 480, skipped: 20, errors: 0, batches: 1 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { processed: 498, skipped: 22, errors: 0, batches: 2 });

    // Final resolved value sums both batches.
    expect(summary).toEqual({ processed: 498, skipped: 22, errors: 0, total: 520 });

    // Success invalidates the derived-data caches exactly once.
    await waitFor(() => expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1));

    expect(toastMock).toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0].variant).not.toBe('destructive');
  });

  it('on a mid-run RPC error, returns null, reports partial totals with a resume hint, and still invalidates', async () => {
    const cursor1 = { sale_date: '2026-01-05', created_at: '2026-01-05T12:00:00Z', id: 'sale-500' };

    rpcMock
      .mockResolvedValueOnce({
        data: { processed: 500, skipped: 0, errors: 0, batch_count: 500, done: false, next_cursor: cursor1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      });

    const { result } = renderHook(() => useBulkInventoryDeduction(), { wrapper });

    let summary: Awaited<ReturnType<typeof result.current.bulkProcessHistoricalSales>> | undefined;
    await act(async () => {
      summary = await result.current.bulkProcessHistoricalSales(
        'restaurant-1',
        '2026-01-01',
        '2026-01-31',
      );
    });

    expect(summary).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(2);

    await waitFor(() => expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1));

    expect(toastMock).toHaveBeenCalled();
    const call = toastMock.mock.calls.find((c) => c[0].variant === 'destructive');
    expect(call).toBeTruthy();
    // Reports the partial processed count from batch 1 before the failure.
    expect(call![0].description).toMatch(/500/);
    // Signals the run is safely resumable.
    expect(call![0].description).toMatch(/resum|re-run/i);
  });

  it('stops with a destructive cap toast once MAX_BATCHES is exceeded, without ever finishing', async () => {
    // Always reports done: false with a fresh cursor, so the loop would spin
    // forever without a hard cap.
    rpcMock.mockImplementation((_fn: string, args: Record<string, unknown>) =>
      Promise.resolve({
        data: {
          processed: 1,
          skipped: 0,
          errors: 0,
          batch_count: 500,
          done: false,
          next_cursor: { sale_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', id: `sale-${args.p_batch_size}` },
        },
        error: null,
      }),
    );

    const { result } = renderHook(() => useBulkInventoryDeduction(), { wrapper });

    let summary: Awaited<ReturnType<typeof result.current.bulkProcessHistoricalSales>> | undefined;
    await act(async () => {
      summary = await result.current.bulkProcessHistoricalSales(
        'restaurant-1',
        '2026-01-01',
        '2026-12-31',
      );
    });

    expect(summary).toBeNull();
    // MAX_BATCHES = 1000 per design §3: the loop makes exactly 1000 RPC
    // calls, then throws before issuing a 1001st.
    expect(rpcMock).toHaveBeenCalledTimes(1000);

    await waitFor(() => expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1));

    const call = toastMock.mock.calls.find((c) => c[0].variant === 'destructive');
    expect(call).toBeTruthy();
    expect(call![0].description).toMatch(/1000|1,000/);
    expect(call![0].description).toMatch(/cap|re-run|resum/i);
  }, 15000);
});
