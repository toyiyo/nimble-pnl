import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
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
});
