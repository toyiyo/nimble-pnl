import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateSplitQueries } from '@/hooks/useSplitTransactionHelpers';

describe('invalidateSplitQueries', () => {
  it('invalidates all split-related keys including the grouped POS aggregate', () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    invalidateSplitQueries(queryClient);

    const invalidatedKeys = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    // Grouped view is cached under a separate key that a ['unified-sales']
    // prefix invalidation does NOT match — splitting a sale must refresh it too.
    expect(invalidatedKeys).toContain('unified-sales');
    expect(invalidatedKeys).toContain('unified-sales-grouped');
    expect(invalidatedKeys).toContain('pos-sales-splits');
    expect(invalidatedKeys).toContain('bank-transactions');
    expect(invalidatedKeys).toContain('chart-of-accounts');
  });
});
