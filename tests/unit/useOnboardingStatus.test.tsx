
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock Supabase with improved chaining support
const mockSelect = vi.fn();
const mockEq = vi.fn();

const createMockChain = (tableName: string) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: any) => {
        // Return count based on table name simulation
        let count = 0;
        switch(tableName) {
            case 'integrations': count = 1; break; // POS Connected
            case 'user_restaurants': count = 2; break; // Collaborators (>1)
            case 'employees': count = 0; break; // No Employees
            // Others 0
        }
        resolve({ count, error: null });
    }
  };
  return chain;
};

// We need a more dynamic mock to handle different return values per test
let mockDbState: Record<string, number> = {};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn((table) => {
        const count = mockDbState[table] ?? 0;
        return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ count, error: null })
        };
    }),
  },
}));

// Mock Restaurant Context
const mockSelectedRestaurant = {
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
});
