import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBankTransactions } from '@/hooks/useBankTransactions';
import type { TransactionFilters } from '@/types/transactions';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

const mockRestaurantContext = vi.hoisted(() => ({
  selectedRestaurant: { restaurant_id: 'rest-123' } as { restaurant_id: string } | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockRestaurantContext,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

type TransactionRow = {
  id: string;
  transaction_date: string;
  amount: number;
};

type QueryRangeResult = {
  data: TransactionRow[];
  count: number;
  error: null;
};

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
};

type AccountBalanceResult = {
  data: { stripe_financial_account_id: string | null } | null;
  error: { code: string; message: string } | null;
};

type AccountBalanceQuery = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

const createQueryBuilder = (pageData: TransactionRow[], count?: number): QueryBuilder => {
  const builder: QueryBuilder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: pageData, count: count ?? pageData.length, error: null }),
  };
  return builder;
};

const createAccountBalanceBuilder = (result: AccountBalanceResult): AccountBalanceQuery => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue(result),
});

describe('useBankTransactions (paginated)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies server-side filters and sorting before paginating', async () => {
    const filters: TransactionFilters = {
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      minAmount: 50,
      maxAmount: 300,
      status: 'posted',
      transactionType: 'debit',
      categoryId: 'cat-1',
      bankAccountId: 'bank-1',
      showUncategorized: true,
    };

    const pageData = [
      { id: 'txn-1', transaction_date: '2024-01-10', amount: -120 },
      { id: 'txn-2', transaction_date: '2024-01-11', amount: -80 },
    ];

    // Mock the bank_account_balances lookup query
    const accountBalanceBuilder = createAccountBalanceBuilder({
      data: { stripe_financial_account_id: 'fca_stripe_123' },
      error: null,
    });

    const transactionBuilder = createQueryBuilder(pageData, 2);

    // Mock different table queries
    mockSupabase.from.mockImplementation((tableName: string) => {
      if (tableName === 'bank_account_balances') {
        return accountBalanceBuilder;
      }
      return transactionBuilder;
    });

    const { result } = renderHook(
      () =>
        useBankTransactions('for_review', {
          searchTerm: 'coffee',
          filters,
          sortBy: 'date',
          sortDirection: 'desc',
          pageSize: 2,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.transactions).toHaveLength(2);
    expect(result.current.totalCount).toBe(2);
    expect(result.current.hasMore).toBe(false);

    // Verify the main query
    expect(transactionBuilder.range).toHaveBeenCalledWith(0, 1);
    expect(transactionBuilder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(transactionBuilder.eq).toHaveBeenCalledWith('is_categorized', false);
    expect(transactionBuilder.is).toHaveBeenCalledWith('excluded_reason', null);
    expect(transactionBuilder.or).toHaveBeenCalledWith(
      expect.stringContaining('description.ilike.%coffee%')
    );
    expect(transactionBuilder.gte).toHaveBeenCalledWith('transaction_date', '2024-01-01');
    expect(transactionBuilder.lte).toHaveBeenCalledWith('transaction_date', '2024-01-31');
    expect(transactionBuilder.or).toHaveBeenCalledWith('amount.lte.-50,amount.gte.50');
    expect(transactionBuilder.gte).toHaveBeenCalledWith('amount', -300);
    expect(transactionBuilder.lte).toHaveBeenCalledWith('amount', 300);
    expect(transactionBuilder.eq).toHaveBeenCalledWith('status', 'posted');
    expect(transactionBuilder.lt).toHaveBeenCalledWith('amount', 0);
    expect(transactionBuilder.eq).toHaveBeenCalledWith('category_id', 'cat-1');
    expect(transactionBuilder.eq).toHaveBeenCalledWith('raw_data->>account', 'fca_stripe_123');
    expect(transactionBuilder.order).toHaveBeenCalledWith('transaction_date', { ascending: false, nullsFirst: false });
    expect(transactionBuilder.order).toHaveBeenCalledWith('id', { ascending: false });
    
    // Verify the bank account balance lookup was called correctly
    expect(accountBalanceBuilder.select).toHaveBeenCalledWith('stripe_financial_account_id');
    expect(accountBalanceBuilder.eq).toHaveBeenCalledWith('id', 'bank-1');
    expect(accountBalanceBuilder.single).toHaveBeenCalled();
  });

  it('handles missing bank account balance gracefully', async () => {
    const filters: TransactionFilters = {
      bankAccountId: 'bank-nonexistent',
    };

    const pageData = [
      { id: 'txn-1', transaction_date: '2024-01-10', amount: -120 },
      { id: 'txn-2', transaction_date: '2024-01-11', amount: -80 },
    ];

    // Mock the bank_account_balances lookup query with no rows found
    const accountBalanceBuilder = createAccountBalanceBuilder({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const transactionBuilder = createQueryBuilder(pageData, 2);

    // Track calls to eq to verify account filter is NOT applied
    const eqCalls: Array<[string, unknown]> = [];
    transactionBuilder.eq = vi.fn((...args: [string, unknown]) => {
      eqCalls.push(args);
      return transactionBuilder;
    });

    mockSupabase.from.mockImplementation((tableName: string) => {
      if (tableName === 'bank_account_balances') {
        return accountBalanceBuilder;
      }
      return transactionBuilder;
    });

    const { result } = renderHook(
      () =>
        useBankTransactions('for_review', {
          filters,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Query should proceed without the account filter
    expect(result.current.transactions).toHaveLength(2);
    
    // Verify the account filter was NOT applied (raw_data->>account should not be in eqCalls)
    const accountFilterApplied = eqCalls.some(
      ([key]) => key === 'raw_data->>account'
    );
    expect(accountFilterApplied).toBe(false);
    
    // Verify balance lookup was attempted
    expect(accountBalanceBuilder.single).toHaveBeenCalled();
  });

  it('handles null stripe_financial_account_id in balance record', async () => {
    const filters: TransactionFilters = {
      bankAccountId: 'bank-2',
    };

    const pageData = [
      { id: 'txn-1', transaction_date: '2024-01-10', amount: -120 },
      { id: 'txn-2', transaction_date: '2024-01-11', amount: -80 },
    ];

    // Mock the bank_account_balances lookup with null stripe_financial_account_id
    const accountBalanceBuilder = createAccountBalanceBuilder({
      data: { stripe_financial_account_id: null },
      error: null,
    });

    const transactionBuilder = createQueryBuilder(pageData, 2);

    // Track calls to eq to verify account filter is NOT applied
    const eqCalls: Array<[string, unknown]> = [];
    transactionBuilder.eq = vi.fn((...args: [string, unknown]) => {
      eqCalls.push(args);
      return transactionBuilder;
    });

    mockSupabase.from.mockImplementation((tableName: string) => {
      if (tableName === 'bank_account_balances') {
        return accountBalanceBuilder;
      }
      return transactionBuilder;
    });

    const { result } = renderHook(
      () =>
        useBankTransactions('for_review', {
          filters,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Query should proceed without the account filter
    expect(result.current.transactions).toHaveLength(2);
    
    // Verify the account filter was NOT applied
    const accountFilterApplied = eqCalls.some(
      ([key]) => key === 'raw_data->>account'
    );
    expect(accountFilterApplied).toBe(false);
    
    // Verify balance lookup was attempted
    expect(accountBalanceBuilder.single).toHaveBeenCalled();
  });

  it('handles balance lookup query error', async () => {
    const filters: TransactionFilters = {
      bankAccountId: 'bank-3',
    };

    // Mock the bank_account_balances lookup with database error
    const accountBalanceBuilder = createAccountBalanceBuilder({
      data: null,
      error: { code: '500', message: 'Database error' },
    });

    const transactionBuilder = createQueryBuilder([], 0);

    // Track calls to eq
    const eqCalls: Array<[string, unknown]> = [];
    transactionBuilder.eq = vi.fn((...args: [string, unknown]) => {
      eqCalls.push(args);
      return transactionBuilder;
    });

    mockSupabase.from.mockImplementation((tableName: string) => {
      if (tableName === 'bank_account_balances') {
        return accountBalanceBuilder;
      }
      return transactionBuilder;
    });

    const { result } = renderHook(
      () =>
        useBankTransactions('for_review', {
          filters,
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Query should proceed without applying the account filter
    const accountFilterApplied = eqCalls.some(
      ([key]) => key === 'raw_data->>account'
    );
    expect(accountFilterApplied).toBe(false);
    
    // Verify balance lookup was attempted
    expect(accountBalanceBuilder.single).toHaveBeenCalled();
  });

  it('loads additional pages when requested', async () => {
    const pageOne = [
      { id: 'txn-1', transaction_date: '2024-01-10', amount: -120 },
      { id: 'txn-2', transaction_date: '2024-01-11', amount: -80 },
    ];
    const pageTwo = [{ id: 'txn-3', transaction_date: '2024-01-12', amount: -40 }];

    const builders = [
      createQueryBuilder(pageOne, 3),
      createQueryBuilder(pageTwo, 3),
    ];
    const queue = [...builders];
    mockSupabase.from.mockImplementation(() => queue.shift());

    const { result } = renderHook(
      () =>
        useBankTransactions('categorized', {
          pageSize: 2, // Force a small page size
        }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.transactions).toHaveLength(2));
    await act(async () => {
      await result.current.loadMore();
    });

    await waitFor(() => expect(result.current.transactions).toHaveLength(3));
    expect(result.current.hasMore).toBe(false);
    expect(builders[1].range).toHaveBeenCalledWith(2, 3);
  });

  it('returns empty results when no restaurant is selected', async () => {
    mockRestaurantContext.selectedRestaurant = null;
    mockSupabase.from.mockReset();

    const { result } = renderHook(
      () => useBankTransactions('for_review'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.transactions).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(mockSupabase.from).not.toHaveBeenCalled();

    mockRestaurantContext.selectedRestaurant = { restaurant_id: 'rest-123' }; // restore for other tests
  });
});
