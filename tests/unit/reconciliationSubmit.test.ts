import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

import { useReconciliation } from '@/hooks/useReconciliation';

const mockSession = {
  id: 'session-1',
  restaurant_id: 'restaurant-1',
  reconciliation_date: '2024-01-01',
  started_at: '2024-01-01T00:00:00Z',
  submitted_at: null,
  status: 'in_progress' as const,
  performed_by: 'user-1',
  total_items_counted: 0,
  items_with_variance: 0,
  total_shrinkage_value: 0,
  notes: null,
};

const mockItems = [
  {
    id: 'item-1',
    reconciliation_id: 'session-1',
    product_id: 'prod-1',
    expected_quantity: 10,
    actual_quantity: 8,
    variance: -2,
    unit_cost: 5,
    variance_value: -10,
    notes: 'counted',
    counted_at: '2024-01-01T01:00:00Z',
  },
];

type MockOptions = {
  productError?: Error | null;
};

function setupSupabaseMocks(options: MockOptions = {}) {
  const callOrder: string[] = [];

  const inventorySelectChain: any = {
    eq: vi.fn(() => inventorySelectChain),
    in: vi.fn(() => inventorySelectChain),
    order: vi.fn(() => inventorySelectChain),
    limit: vi.fn(() => inventorySelectChain),
    maybeSingle: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
  };

  const inventoryUpdateChain: any = {
    eq: vi.fn(() => {
      callOrder.push('status-update');
      return Promise.resolve({ data: null, error: null });
    }),
  };

  const inventoryFrom = {
    select: vi.fn(() => inventorySelectChain),
    update: vi.fn(() => inventoryUpdateChain),
  };

  const itemsOrder = vi.fn(() =>
    Promise.resolve({
      data: mockItems,
      error: null,
    }),
  );

  const itemsSelectChain: any = {
    eq: vi.fn(() => ({
      order: itemsOrder,
    })),
  };

  const itemsFrom = {
    select: vi.fn(() => itemsSelectChain),
  };

  const productsEq = vi.fn((_, id) => {
    callOrder.push(`product-${id}`);
    return Promise.resolve({
      data: null,
      error: options.productError || null,
    });
  });

  const productsFrom = {
    update: vi.fn(() => ({
      eq: productsEq,
    })),
  };

  const transactionsInsert = vi.fn((payload: any) => {
    callOrder.push(`transaction-${payload.product_id}`);
    return Promise.resolve({ data: null, error: null });
  });

  const transactionsFrom = {
    insert: transactionsInsert,
  };

  mockSupabase.from.mockImplementation((table: string) => {
    switch (table) {
      case 'inventory_reconciliations':
        return inventoryFrom as any;
      case 'reconciliation_items':
        return itemsFrom as any;
      case 'products':
        return productsFrom as any;
      case 'inventory_transactions':
        return transactionsFrom as any;
      default:
        return {
          select: vi.fn(),
          update: vi.fn(),
          insert: vi.fn(),
          delete: vi.fn(),
        } as any;
    }
  });

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });

  return {
    callOrder,
    inventoryUpdateChain,
    productsEq,
  };
}

describe('submitReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates products before marking reconciliation submitted', async () => {
    const { callOrder, inventoryUpdateChain } = setupSupabaseMocks();
    const { result } = renderHook(() => useReconciliation('restaurant-1'));

    await waitFor(() => expect(result.current.items).toHaveLength(mockItems.length));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.submitReconciliation();
    });

    expect(success).toBe(true);
    expect(callOrder).toEqual(['product-prod-1', 'transaction-prod-1', 'status-update']);
    expect(inventoryUpdateChain.eq).toHaveBeenCalled();
  });

  it('stops submission when a product update fails', async () => {
    const { callOrder, inventoryUpdateChain } = setupSupabaseMocks({
      productError: new Error('update failed'),
    });

    const { result } = renderHook(() => useReconciliation('restaurant-1'));

    await waitFor(() => expect(result.current.items).toHaveLength(mockItems.length));

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.submitReconciliation();
    });

    expect(success).toBe(false);
    expect(callOrder).toContain('product-prod-1');
    expect(callOrder).not.toContain('status-update');
    expect(inventoryUpdateChain.eq).not.toHaveBeenCalled();
  });
});
