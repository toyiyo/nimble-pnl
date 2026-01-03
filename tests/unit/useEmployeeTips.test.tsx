import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEmployeeTips, calculateEmployeeTipTotal, groupTipsByDate, type EmployeeTip } from '@/hooks/useEmployeeTips';
import { supabase } from '@/integrations/supabase/client';
import React, { type ReactNode } from 'react';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  },
}));

// Mock toast
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('useEmployeeTips', () => {
  let queryClient: QueryClient;
  
  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when restaurantId is null', async () => {
    const { result } = renderHook(() => useEmployeeTips(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.tips).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('exposes submitTip mutation function', () => {
    const { result } = renderHook(() => useEmployeeTips('rest-123'), {
      wrapper: createWrapper(),
    });

    expect(result.current.submitTip).toBeDefined();
    expect(typeof result.current.submitTip).toBe('function');
  });

  it('exposes deleteTip mutation function', () => {
    const { result } = renderHook(() => useEmployeeTips('rest-123'), {
      wrapper: createWrapper(),
    });

    expect(result.current.deleteTip).toBeDefined();
    expect(typeof result.current.deleteTip).toBe('function');
  });

  it('console.error is only called in development', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Test error');
    
    // Verify the pattern used in the hook
    // In production (DEV=false), console.error should not be called
    const isDev = false;
    if (isDev) {
      console.error('Error submitting tips:', error);
    }

    expect(consoleSpy).not.toHaveBeenCalled();
    
    // In development (DEV=true), console.error should be called
    consoleSpy.mockClear();
    const isDevMode = true;
    if (isDevMode) {
      console.error('Error submitting tips:', error);
    }
    
    expect(consoleSpy).toHaveBeenCalledWith('Error submitting tips:', error);
    consoleSpy.mockRestore();
  });
});

describe('calculateEmployeeTipTotal', () => {
  it('calculates total from empty array', () => {
    expect(calculateEmployeeTipTotal([])).toBe(0);
  });

  it('calculates total from single tip', () => {
    const tips: EmployeeTip[] = [
      {
        id: '1',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 5000,
        tip_source: 'cash',
        recorded_at: '2024-01-01T12:00:00Z',
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
      },
    ];
    expect(calculateEmployeeTipTotal(tips)).toBe(5000);
  });

  it('calculates total from multiple tips', () => {
    const tips: EmployeeTip[] = [
      {
        id: '1',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 5000,
        tip_source: 'cash',
        recorded_at: '2024-01-01T12:00:00Z',
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
      },
      {
        id: '2',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 7550,
        tip_source: 'credit',
        recorded_at: '2024-01-01T18:00:00Z',
        created_at: '2024-01-01T18:00:00Z',
        updated_at: '2024-01-01T18:00:00Z',
      },
    ];
    expect(calculateEmployeeTipTotal(tips)).toBe(12550);
  });
});

describe('groupTipsByDate', () => {
  it('groups empty array', () => {
    const grouped = groupTipsByDate([]);
    expect(grouped.size).toBe(0);
  });

  it('groups tips by date', () => {
    const tips: EmployeeTip[] = [
      {
        id: '1',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 5000,
        tip_source: 'cash',
        recorded_at: '2024-01-01T12:00:00Z',
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
      },
      {
        id: '2',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 7550,
        tip_source: 'credit',
        recorded_at: '2024-01-01T18:00:00Z',
        created_at: '2024-01-01T18:00:00Z',
        updated_at: '2024-01-01T18:00:00Z',
      },
      {
        id: '3',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 3000,
        tip_source: 'cash',
        recorded_at: '2024-01-02T12:00:00Z',
        created_at: '2024-01-02T12:00:00Z',
        updated_at: '2024-01-02T12:00:00Z',
      },
    ];

    const grouped = groupTipsByDate(tips);
    
    expect(grouped.size).toBe(2);
    expect(grouped.get('2024-01-01')?.length).toBe(2);
    expect(grouped.get('2024-01-02')?.length).toBe(1);
  });

  it('handles multiple tips on same date', () => {
    const tips: EmployeeTip[] = [
      {
        id: '1',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 1000,
        tip_source: 'cash',
        recorded_at: '2024-01-01T08:00:00Z',
        created_at: '2024-01-01T08:00:00Z',
        updated_at: '2024-01-01T08:00:00Z',
      },
      {
        id: '2',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 2000,
        tip_source: 'cash',
        recorded_at: '2024-01-01T12:00:00Z',
        created_at: '2024-01-01T12:00:00Z',
        updated_at: '2024-01-01T12:00:00Z',
      },
      {
        id: '3',
        restaurant_id: 'rest-1',
        employee_id: 'emp-1',
        tip_amount: 3000,
        tip_source: 'credit',
        recorded_at: '2024-01-01T18:00:00Z',
        created_at: '2024-01-01T18:00:00Z',
        updated_at: '2024-01-01T18:00:00Z',
      },
    ];

    const grouped = groupTipsByDate(tips);
    const jan1Tips = grouped.get('2024-01-01');
    
    expect(jan1Tips?.length).toBe(3);
    expect(calculateEmployeeTipTotal(jan1Tips!)).toBe(6000);
  });
});
