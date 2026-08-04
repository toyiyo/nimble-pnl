import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRevertPosSaleSplit } from '@/hooks/useSplitPosSale';
import { useRevertBankTransactionSplit } from '@/hooks/useBankTransactions';
import { supabase } from '@/integrations/supabase/client';

// Reverting a split flips is_categorized/category_id without touching any of
// the negative-cache trigger's watched columns (item_name/total_price/
// pos_category for unified_sales; description/amount/supplier_id for
// bank_transactions -- see 20260804090000_rules_evaluated_at_columns.sql), so
// the row would otherwise keep its pre-revert rules_evaluated_at stamp and
// never re-enter the sweep's candidate set. Both revert mutations must reset
// it explicitly.

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('revert-split mutations reset rules_evaluated_at', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('useRevertPosSaleSplit resets unified_sales.rules_evaluated_at to -infinity', async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const deleteMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      delete: deleteMock,
      update: updateMock,
    } as unknown as ReturnType<typeof supabase.from>);

    const { result } = renderHook(() => useRevertPosSaleSplit(), { wrapper });

    result.current.mutate({ saleId: 'sale-123' });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_split: false,
        is_categorized: false,
        category_id: null,
        rules_evaluated_at: '-infinity',
      })
    );
  });

  it('useRevertBankTransactionSplit resets bank_transactions.rules_evaluated_at to -infinity', async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const deleteMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.mocked(supabase.from).mockReturnValue({
      delete: deleteMock,
      update: updateMock,
    } as unknown as ReturnType<typeof supabase.from>);

    const { result } = renderHook(() => useRevertBankTransactionSplit(), { wrapper });

    result.current.mutate({ transactionId: 'txn-123' });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_split: false,
        is_categorized: false,
        category_id: null,
        rules_evaluated_at: '-infinity',
      })
    );
  });
});
