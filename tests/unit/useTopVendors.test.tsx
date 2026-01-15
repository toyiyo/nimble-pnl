import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTopVendors } from '@/hooks/useTopVendors';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

type TransactionRow = {
  transaction_date: string;
  amount: number;
  status: string;
  merchant_name: string | null;
  normalized_payee: string | null;
  description: string | null;
};

const createTransactionsBuilder = (data: TransactionRow[]) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  lt: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data, error: null }),
});

const createPendingOutflowsBuilder = (data: { issue_date: string; amount: number; vendor_name: string }[]) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  lte: vi.fn().mockResolvedValue({ data, error: null }),
});

describe('useTopVendors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters pending outflows to exclude linked bank transactions', async () => {
    const transactionsBuilder = createTransactionsBuilder([
      {
        transaction_date: '2024-05-10',
        amount: -45,
        status: 'posted',
        merchant_name: 'Vendor A',
        normalized_payee: null,
        description: null,
      },
    ]);

    const pendingBuilder = createPendingOutflowsBuilder([
      { issue_date: '2024-05-12', amount: 20, vendor_name: 'Vendor B' },
    ]);

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'bank_transactions') {
        return transactionsBuilder;
      }
      if (table === 'pending_outflows') {
        return pendingBuilder;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const startDate = new Date('2024-05-01');
    const endDate = new Date('2024-05-31');

    const { result } = renderHook(() => useTopVendors(startDate, endDate), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(pendingBuilder.is).toHaveBeenCalledWith('linked_bank_transaction_id', null);
  });
});
