import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ---- Mocks -----------------------------------------------------------------
vi.mock('@/hooks/useAuth', () => {
  const user = { id: 'user-1' };
  return { useAuth: () => ({ user }) };
});

let rpcResponse: { data: { item_name: string }[] | null; error: unknown };
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      return Promise.resolve(rpcResponse);
    },
    // Any table read here means the banner went back to scanning sales rows.
    from: (...args: unknown[]) => {
      fromMock(...args);
      throw new Error(`Unexpected table read in test: ${String(args[0])}`);
    },
  },
}));

import {
  useUnmappedSaleItems,
  UNMAPPED_SALE_ITEMS_LIMIT,
} from '@/hooks/useUnmappedSaleItems';
import { createQueryWrapper } from './helpers/queryWrapper';

let wrapper: ReturnType<typeof createQueryWrapper>['wrapper'];

beforeEach(() => {
  vi.clearAllMocks();
  rpcResponse = { data: [{ item_name: 'Carne Guisada' }, { item_name: 'Horchata' }], error: null };
  ({ wrapper } = createQueryWrapper());
});

describe('useUnmappedSaleItems', () => {
  it('CRITICAL: resolves the banner from one RPC, never by scanning sales rows', async () => {
    const { result } = renderHook(() => useUnmappedSaleItems('rest-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // The old path paged 500 unified_sales rows and re-queried `recipes` a
    // second time just to diff them client-side. Neither table is touched now.
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('get_unmapped_sale_item_names', {
      p_restaurant_id: 'rest-1',
      p_limit: UNMAPPED_SALE_ITEMS_LIMIT,
    });
    expect(result.current.unmappedItems).toEqual(['Carne Guisada', 'Horchata']);
  });

  it('caps the request so the 1000-row PostgREST default can never truncate it silently', () => {
    expect(UNMAPPED_SALE_ITEMS_LIMIT).toBeLessThan(1000);
  });

  it('does not query at all without a restaurant id', async () => {
    const { result } = renderHook(() => useUnmappedSaleItems(null), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(result.current.unmappedItems).toEqual([]);
  });

  it('hides the banner on failure instead of showing another tenant-shaped list', async () => {
    rpcResponse = { data: null, error: { message: 'boom' } };

    const { result } = renderHook(() => useUnmappedSaleItems('rest-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // React Query keeps the last successful data on error; the banner is
    // advisory, so an empty list is the safe read.
    expect(result.current.unmappedItems).toEqual([]);
  });

  it('treats a null payload as no unmapped items', async () => {
    rpcResponse = { data: null, error: null };

    const { result } = renderHook(() => useUnmappedSaleItems('rest-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unmappedItems).toEqual([]);
  });
});
