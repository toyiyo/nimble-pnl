
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

type MockTableState = number | { count?: number; error?: unknown };

// We need a more dynamic mock to handle different return values per test
let mockDbState: Record<string, MockTableState> = {};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table) => {
      const state = mockDbState[table];
      const count = typeof state === 'number' ? state : state?.count ?? 0;
      const error = typeof state === 'object' && state !== null && 'error' in state 
        ? (state as { error?: unknown }).error ?? null 
        : null;
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      };
      // The promise resolves to data when awaited
      // In the hook we await the chain directly or checkCount calls await query.
      // Actually checkTableCount returns `query` which is a promise-like.
      // So checking `await checkTableCount(...)` waits on this object.
      // We need to attach the properties to a Promise.
      const promise = Promise.resolve({ count, error, data: [] });
      return Object.assign(promise, chain);
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
    // Reset DB state
    mockDbState = {
      integrations: 0,
      user_restaurants: 0,
      employees: 0,
      recipes: 0,
      receipts: 0,
      inventory_counts: 0,
      bank_connections: 0
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

  it('should calculate progress correctly when some steps are done', async () => {
    // Setup state: POS connected, Bank connected
    mockDbState = {
      integrations: 1, // POS
      user_restaurants: 1, // Collaborators: need >1 to be true. Let's set 2 next time.
      employees: 0,
      recipes: 0,
      receipts: 0,
      inventory_counts: 0,
      bank_connections: 1, // Bank
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
    // Setup state: No generic integration, but specific Square connection
    mockDbState = {
      integrations: 0,
      square_connections: 1,
      // others default to 0
    };

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const posStep = result.current.steps.find(s => s.id === 'pos');
    expect(posStep?.isCompleted).toBe(true);
  });

  it('handles errors gracefully by defaulting to incomplete', async () => {
    mockDbState.integrations = { error: new Error('network failure') };

    const { result } = renderHook(() => useOnboardingStatus(), { wrapper });

    // Should NOT have an error
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(null);
    
    // Should be incomplete (count 0)
    expect(result.current.completedCount).toBe(0);
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
      integrations: 0,
      user_restaurants: 1,
      employees: 0,
      recipes: 0,
      receipts: 0,
      inventory_counts: 0,
      bank_connections: 0
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
      integrations: 1, // POS connected
      user_restaurants: 1,
      employees: 0,
      recipes: 0,
      receipts: 0,
      inventory_counts: 0,
      bank_connections: 1 // Bank connected
    };

    // Force rerender to pick up the new restaurant
    rerender();

    // Wait for the new query to complete
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    
    // Should now show 2 completed (POS + Bank)
    expect(result.current.completedCount).toBe(2);
    
    const posStep = result.current.steps.find(s => s.id === 'pos');
    expect(posStep?.isCompleted).toBe(true);
    
    const bankStep = result.current.steps.find(s => s.id === 'bank');
    expect(bankStep?.isCompleted).toBe(true);
  });
});
