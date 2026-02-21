import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted runs before imports)
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

const mockFetchExpenseData = vi.hoisted(() => vi.fn());

const mockUseOperatingCosts = vi.hoisted(() => vi.fn());

const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/lib/expenseDataFetcher', () => ({
  fetchExpenseData: mockFetchExpenseData,
}));

vi.mock('@/hooks/useOperatingCosts', () => ({
  useOperatingCosts: mockUseOperatingCosts,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Import after mocks are set up
import { useExpenseSuggestions } from '../../src/hooks/useExpenseSuggestions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/**
 * Build a chainable mock for supabase.from('expense_suggestion_dismissals')
 * that returns the given data/error.
 */
function mockDismissalsQuery(data: any[] = [], error: any = null) {
  const chain: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  // The last call in the chain resolves the promise
  chain.eq.mockResolvedValue({ data, error });
  return chain;
}

/**
 * Build a chainable mock for supabase.from('expense_suggestion_dismissals')
 * used by the upsert mutation.
 */
function mockDismissalsUpsert(error: any = null) {
  const chain: Record<string, any> = {
    upsert: vi.fn().mockResolvedValue({ data: null, error }),
  };
  return chain;
}

/**
 * Build a combined mock that handles BOTH read (select/eq) and write (upsert)
 * paths on the same from() return value.
 */
function mockDismissalsCombined(
  queryData: any[] = [],
  queryError: any = null,
  upsertError: any = null,
) {
  const chain: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ data: null, error: upsertError }),
  };
  // The last call in the read chain resolves the promise
  chain.eq.mockResolvedValue({ data: queryData, error: queryError });
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useExpenseSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: operating costs returns empty
    mockUseOperatingCosts.mockReturnValue({
      costs: [],
      isLoading: false,
      error: null,
    });

    // Default: dismissals table returns empty
    const dismissalsChain = mockDismissalsQuery([], null);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'expense_suggestion_dismissals') {
        return dismissalsChain;
      }
      // fallback for upsert calls
      return mockDismissalsUpsert(null);
    });

    // Default: no bank transactions
    mockFetchExpenseData.mockResolvedValue({
      transactions: [],
      pendingOutflows: [],
      splitDetails: [],
    });
  });

  it('returns empty suggestions when no transactions exist', async () => {
    const { result } = renderHook(
      () => useExpenseSuggestions('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.suggestions).toEqual([]);
  });

  it('returns suggestions for recurring bank transactions', async () => {
    // Provide transactions that span 3 months with same payee, similar amounts
    mockFetchExpenseData.mockResolvedValue({
      transactions: [
        {
          id: 'tx-1',
          transaction_date: '2025-10-15',
          amount: -1500,
          status: 'posted',
          description: 'ABC Landlord',
          merchant_name: 'ABC Landlord LLC',
          normalized_payee: 'ABC Landlord LLC',
          category_id: 'cat-1',
          is_split: false,
          ai_confidence: null,
          chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
        },
        {
          id: 'tx-2',
          transaction_date: '2025-11-15',
          amount: -1500,
          status: 'posted',
          description: 'ABC Landlord',
          merchant_name: 'ABC Landlord LLC',
          normalized_payee: 'ABC Landlord LLC',
          category_id: 'cat-1',
          is_split: false,
          ai_confidence: null,
          chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
        },
        {
          id: 'tx-3',
          transaction_date: '2025-12-15',
          amount: -1500,
          status: 'posted',
          description: 'ABC Landlord',
          merchant_name: 'ABC Landlord LLC',
          normalized_payee: 'ABC Landlord LLC',
          category_id: 'cat-1',
          is_split: false,
          ai_confidence: null,
          chart_of_accounts: { account_name: 'Rent', account_subtype: 'rent' },
        },
      ],
      pendingOutflows: [],
      splitDetails: [],
    });

    const { result } = renderHook(
      () => useExpenseSuggestions('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.current.suggestions[0];
    expect(suggestion.payeeName).toBe('ABC Landlord LLC');
    expect(suggestion.costType).toBe('fixed');
    expect(suggestion.source).toBe('bank');
    expect(suggestion.matchedMonths).toBe(3);
    // 1500 dollars * 100 = 150000 cents
    expect(suggestion.monthlyAmount).toBe(150000);
  });

  it('returns empty suggestions and isLoading=false when restaurantId is null', async () => {
    const { result } = renderHook(
      () => useExpenseSuggestions(null),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.suggestions).toEqual([]);
    // fetchExpenseData should NOT have been called
    expect(mockFetchExpenseData).not.toHaveBeenCalled();
  });

  it('provides dismissSuggestion, snoozeSuggestion, and acceptSuggestion functions', async () => {
    const { result } = renderHook(
      () => useExpenseSuggestions('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.dismissSuggestion).toBe('function');
    expect(typeof result.current.snoozeSuggestion).toBe('function');
    expect(typeof result.current.acceptSuggestion).toBe('function');
  });

  it('dismissSuggestion calls upsert with action dismissed', async () => {
    const combinedChain = mockDismissalsCombined();
    mockSupabase.from.mockReturnValue(combinedChain);

    const { result } = renderHook(
      () => useExpenseSuggestions('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.dismissSuggestion('some-key');
    });

    await waitFor(() => {
      expect(combinedChain.upsert).toHaveBeenCalledWith(
        {
          restaurant_id: 'rest-123',
          suggestion_key: 'some-key',
          action: 'dismissed',
          snoozed_until: null,
        },
        { onConflict: 'restaurant_id,suggestion_key' },
      );
    });
  });

  it('snoozeSuggestion calls upsert with action snoozed and future date', async () => {
    const combinedChain = mockDismissalsCombined();
    mockSupabase.from.mockReturnValue(combinedChain);

    const { result } = renderHook(
      () => useExpenseSuggestions('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const beforeCall = Date.now();

    act(() => {
      result.current.snoozeSuggestion('some-key');
    });

    await waitFor(() => {
      expect(combinedChain.upsert).toHaveBeenCalledTimes(1);
    });

    const upsertArgs = combinedChain.upsert.mock.calls[0];
    const payload = upsertArgs[0];
    const options = upsertArgs[1];

    expect(payload.restaurant_id).toBe('rest-123');
    expect(payload.suggestion_key).toBe('some-key');
    expect(payload.action).toBe('snoozed');
    expect(options).toEqual({ onConflict: 'restaurant_id,suggestion_key' });

    // snoozed_until should be approximately 30 days in the future
    const snoozedDate = new Date(payload.snoozed_until).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    // Allow 5 seconds of tolerance for test execution time
    expect(snoozedDate).toBeGreaterThanOrEqual(beforeCall + thirtyDaysMs - 5000);
    expect(snoozedDate).toBeLessThanOrEqual(beforeCall + thirtyDaysMs + 5000);
  });

  it('acceptSuggestion calls upsert with action accepted', async () => {
    const combinedChain = mockDismissalsCombined();
    mockSupabase.from.mockReturnValue(combinedChain);

    const { result } = renderHook(
      () => useExpenseSuggestions('rest-123'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.acceptSuggestion('some-key');
    });

    await waitFor(() => {
      expect(combinedChain.upsert).toHaveBeenCalledWith(
        {
          restaurant_id: 'rest-123',
          suggestion_key: 'some-key',
          action: 'accepted',
          snoozed_until: null,
        },
        { onConflict: 'restaurant_id,suggestion_key' },
      );
    });
  });
});
