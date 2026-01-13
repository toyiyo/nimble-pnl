
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import React from 'react';

type MockTableState = number | { count?: number; error?: unknown };
type ChainableMock = Promise<{ count?: number; error?: unknown; data: [] }> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

// We need a more dynamic mock to handle different return values per test
let mockDbState: Record<string, MockTableState> = {};
let mockQueries: Array<{ table: string; chainable: ChainableMock }> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table) => {
      // Create the promise that will read state when resolved (not when created)
      const promise = new Promise((resolve) => {
        // Use setImmediate/setTimeout to defer reading the state
        setTimeout(() => {
          const state = mockDbState[table];
          const count = typeof state === 'number' ? state : state?.count ?? undefined;
          const error = typeof state === 'object' && state !== null && 'error' in state 
            ? (state as { error?: unknown }).error ?? null 
            : null;
          resolve({ count, error, data: [] });
        }, 0);
      });
      
      // Create chain methods that return the promise itself (not 'this')
      // This allows .select().eq().limit() to keep returning the promise
      const chainable = Object.assign(promise, {
        select: vi.fn(() => chainable),
        eq: vi.fn(() => chainable),
        limit: vi.fn(() => chainable),
      }) as ChainableMock;

      mockQueries.push({ table, chainable });
      
      return chainable;
    }),
  },
}));

// Mock Restaurant Context - make it mutable so we can change it in tests
let mockSelectedRestaurant: any = {
  id: 'test-restaurant-id',
  restaurant_id: 'test-restaurant-id', // Assuming mapping
  user_id: 'user-id',
  role: 'owner',
};

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: vi.fn(() => ({
    selectedRestaurant: mockSelectedRestaurant,
  })),
}));

describe('useOnboardingStatus', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    // Reset DB state - use correct table names from hook
    mockQueries = [];
    mockDbState = {
      user_restaurants: 0,
      employees: 0,
      recipes: 0,
      receipt_imports: 0,
      inventory_reconciliations: 0,
      inventory_transactions: 0,
      connected_banks: 0,
      bank_transactions: 0,
      square_connections: 0,
      toast_connections: 0,
      clover_connections: 0,
      shift4_connections: 0,
      invitations: 0,
      products: 0
    };
    // Reset mock restaurant
    mockSelectedRestaurant = {
      id: 'test-restaurant-id',
      restaurant_id: 'test-restaurant-id',
      user_id: 'user-id',
      role: 'owner',
    };
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should return 0% progress when nothing is set up', async () => {
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.percentage).toBe(0);
    expect(result.current.completedCount).toBe(0);
    expect(result.current.steps[0].isCompleted).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not run queries when no restaurant is selected', async () => {
    mockSelectedRestaurant = null;

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(supabase.from).not.toHaveBeenCalled();
    expect(result.current.completedCount).toBe(0);
  });

  it('returns null when refetch is called without a restaurant id', async () => {
    mockSelectedRestaurant = null;

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refetch();
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('should calculate progress correctly when some steps are done', async () => {
    // Setup state: POS connected (square), Bank connected
    mockDbState = {
      user_restaurants: 1,
      employees: 0,
      recipes: 0,
      receipt_imports: 0,
      inventory_reconciliations: 0,
      inventory_transactions: 0,
      connected_banks: 1, // Bank connected
      bank_transactions: 0,
      square_connections: 1, // POS connected
      toast_connections: 0,
      clover_connections: 0,
      shift4_connections: 0,
      invitations: 0,
      products: 0
    };

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Expected: POS (1), Bank (1) = 2 completed
    // Total steps = 7
    // Percentage = 2/7 * 100 = 29
    expect(result.current.completedCount).toBe(2);
    expect(result.current.percentage).toBe(Math.round((2/7)*100));
    
    const posStep = result.current.steps.find(s => s.id === 'pos');
    expect(posStep?.isCompleted).toBe(true);

    const bankStep = result.current.steps.find(s => s.id === 'bank');
    expect(bankStep?.isCompleted).toBe(true);
    
    const employeeStep = result.current.steps.find(s => s.id === 'employees');
    expect(employeeStep?.isCompleted).toBe(false);
  });

  it('should mark collaborators as complete only if count > 1', async () => {
     mockDbState.user_restaurants = 2; // Owner + 1 collaborator

     const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
     await waitFor(() => expect(result.current.isLoading).toBe(false));

     const collabStep = result.current.steps.find(s => s.id === 'collaborators');
     expect(collabStep?.isCompleted).toBe(true);
  });
  
  it('should not mark collaborators as complete if count is 1 (just owner)', async () => {
     mockDbState.user_restaurants = 1;

     const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
     await waitFor(() => expect(result.current.isLoading).toBe(false));

     const collabStep = result.current.steps.find(s => s.id === 'collaborators');
     expect(collabStep?.isCompleted).toBe(false);
  });

  it('should detect legacy POS connections (Square/Toast/Clover/Shift4)', async () => {
    // Setup state: Square connection exists
    mockDbState = {
      user_restaurants: 1,
      employees: 0,
      recipes: 0,
      receipt_imports: 0,
      inventory_reconciliations: 0,
      inventory_transactions: 0,
      connected_banks: 0,
      bank_transactions: 0,
      square_connections: 1, // Square POS connected
      toast_connections: 0,
      clover_connections: 0,
      shift4_connections: 0,
      invitations: 0,
      products: 0
    };

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const posStep = result.current.steps.find(s => s.id === 'pos');
    expect(posStep?.isCompleted).toBe(true);
  });

  it('handles errors gracefully by defaulting to incomplete', async () => {
    // Simulate an error in one of the queries
    mockDbState = {
      user_restaurants: { error: new Error('network failure') },
      employees: 0,
      recipes: 0,
      receipt_imports: 0,
      inventory_reconciliations: 0,
      inventory_transactions: 0,
      connected_banks: 0,
      bank_transactions: 0,
      square_connections: 0,
      toast_connections: 0,
      clover_connections: 0,
      shift4_connections: 0,
      invitations: 0,
      products: 0
    };

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    // Should NOT have an error
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(null);
    
    // Should be incomplete (count 0)
    expect(result.current.completedCount).toBe(0);
  });

  it('defaults to incomplete when the query throws', async () => {
    const fromMock = vi.mocked(supabase.from);
    fromMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.completedCount).toBe(0);
    expect(result.current.error).toBe(null);
  });

  it('should refetch data when restaurant changes', async () => {
    // Start with restaurant A with no data
    mockSelectedRestaurant = {
      id: 'restaurant-A',
      restaurant_id: 'restaurant-A',
      user_id: 'user-id',
      role: 'owner',
    };
    
    mockDbState = {
      user_restaurants: 1,
      employees: 0,
      recipes: 0,
      receipt_imports: 0,
      inventory_reconciliations: 0,
      inventory_transactions: 0,
      connected_banks: 0,
      bank_transactions: 0,
      square_connections: 0,
      toast_connections: 0,
      clover_connections: 0,
      shift4_connections: 0,
      invitations: 0,
      products: 0
    };

    const { result, rerender } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    // Initially, nothing completed
    expect(result.current.completedCount).toBe(0);

    // Switch to restaurant B with different data
    mockSelectedRestaurant = {
      id: 'restaurant-B',
      restaurant_id: 'restaurant-B',
      user_id: 'user-id',
      role: 'owner',
    };
    
    // Restaurant B has POS and Bank connected
    mockDbState = {
      user_restaurants: 1,
      employees: 0,
      recipes: 0,
      receipt_imports: 0,
      inventory_reconciliations: 0,
      inventory_transactions: 0,
      connected_banks: 1, // Bank connected
      bank_transactions: 0,
      square_connections: 1, // POS connected
      toast_connections: 0,
      clover_connections: 0,
      shift4_connections: 0,
      invitations: 0,
      products: 0
    };

    // Force rerender to pick up the new restaurant
    rerender();

    // Wait for the new query to complete
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    // Should now show 2 completed (POS + Bank)
    expect(result.current.completedCount).toBe(2);

    const hasRestaurantBQuery = mockQueries.some(({ chainable }) =>
      chainable.eq.mock.calls.some(
        ([column, value]) => column === 'restaurant_id' && value === 'restaurant-B'
      )
    );
    expect(hasRestaurantBQuery).toBe(true);
    
    const posStep = result.current.steps.find(s => s.id === 'pos');
    expect(posStep?.isCompleted).toBe(true);
    
    const bankStep = result.current.steps.find(s => s.id === 'bank');
    expect(bankStep?.isCompleted).toBe(true);
  });

  it('should detect completion using fallback tables (bank_transactions, inventory_transactions, products)', async () => {
    // Setup state: Using fallback tables instead of primary ones
    mockDbState = {
      user_restaurants: 1,
      employees: 0,
      recipes: 0,
      receipt_imports: 0, // No receipts
      inventory_reconciliations: 0,
      inventory_transactions: 3, // Has inventory data via transactions
      connected_banks: 0,
      bank_transactions: 10, // Has bank data via transactions (not connected banks)
      square_connections: 0,
      toast_connections: 0,
      clover_connections: 0,
      shift4_connections: 0,
      invitations: 0,
      products: 5 // Has inventory via products
    };

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Should mark inventory and bank as completed (using fallback tables)
    // Receipts should NOT be completed (no receipt_imports)
    const receiptStep = result.current.steps.find(s => s.id === 'receipt');
    expect(receiptStep?.isCompleted).toBe(false);

    const inventoryStep = result.current.steps.find(s => s.id === 'inventory');
    expect(inventoryStep?.isCompleted).toBe(true);

    const bankStep = result.current.steps.find(s => s.id === 'bank');
    expect(bankStep?.isCompleted).toBe(true);

    // Should have 2 completed steps (inventory + bank)
    expect(result.current.completedCount).toBe(2);
  });

  it('queries the expected onboarding tables', async () => {
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const queriedTables = new Set(mockQueries.map(({ table }) => table));
    const expectedTables = [
      'user_restaurants',
      'employees',
      'recipes',
      'receipt_imports',
      'inventory_reconciliations',
      'inventory_transactions',
      'connected_banks',
      'bank_transactions',
      'square_connections',
      'toast_connections',
      'clover_connections',
      'shift4_connections',
      'invitations',
      'products'
    ];
    expectedTables.forEach((table) => {
      expect(queriedTables.has(table)).toBe(true);
    });

    const legacyTables = ['integrations', 'receipts', 'inventory_counts', 'bank_connections'];
    legacyTables.forEach((table) => {
      expect(queriedTables.has(table)).toBe(false);
    });
  });

  it('filters each onboarding query by restaurant_id', async () => {
    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const missingRestaurantFilter = mockQueries.filter(({ chainable }) =>
      !chainable.eq.mock.calls.some(([column]) => column === 'restaurant_id')
    );

    expect(missingRestaurantFilter).toHaveLength(0);
  });
});
