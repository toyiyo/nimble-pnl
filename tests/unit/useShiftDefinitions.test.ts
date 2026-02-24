/**
 * Unit Tests: useShiftDefinitions hook
 *
 * Tests CRUD hooks for shift_templates (shift definitions):
 * - useShiftDefinitions (fetch all)
 * - useCreateShiftDefinition (create)
 * - useUpdateShiftDefinition (update)
 * - useDeleteShiftDefinition (delete)
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useShiftDefinitions,
  useCreateShiftDefinition,
  useUpdateShiftDefinition,
  useDeleteShiftDefinition,
} from '@/hooks/useShiftDefinitions';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

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

const RESTAURANT_ID = 'rest-abc-123';

const mockDefinition = {
  id: 'def-1',
  restaurant_id: RESTAURANT_ID,
  name: 'Morning Prep',
  day_of_week: null,
  start_time: '06:00:00',
  end_time: '14:00:00',
  break_duration: 30,
  position: 'cook',
  is_active: true,
  color: '#3b82f6',
  description: 'Morning prep shift',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

let mockFromChain: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
    single: vi.fn().mockResolvedValue({ data: mockDefinition, error: null }),
  };

  mockSupabase.from.mockReturnValue(mockFromChain);
});

// ---------------------------------------------------------------------------
// Export verification
// ---------------------------------------------------------------------------

describe('useShiftDefinitions exports', () => {
  it('exports useShiftDefinitions as a function', () => {
    expect(typeof useShiftDefinitions).toBe('function');
  });

  it('exports useCreateShiftDefinition as a function', () => {
    expect(typeof useCreateShiftDefinition).toBe('function');
  });

  it('exports useUpdateShiftDefinition as a function', () => {
    expect(typeof useUpdateShiftDefinition).toBe('function');
  });

  it('exports useDeleteShiftDefinition as a function', () => {
    expect(typeof useDeleteShiftDefinition).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// useShiftDefinitions query tests
// ---------------------------------------------------------------------------

describe('useShiftDefinitions', () => {
  it('returns empty array and does not fetch when restaurantId is null', async () => {
    const { result } = renderHook(() => useShiftDefinitions(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.definitions).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches definitions when restaurantId is provided', async () => {
    mockFromChain.order.mockResolvedValue({
      data: [mockDefinition],
      error: null,
    });

    const { result } = renderHook(() => useShiftDefinitions(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('shift_templates');
    expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID);
    expect(result.current.definitions).toEqual([mockDefinition]);
  });

  it('handles query error', async () => {
    mockFromChain.order.mockResolvedValue({
      data: null,
      error: { message: 'Table not found' },
    });

    const { result } = renderHook(() => useShiftDefinitions(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// useCreateShiftDefinition mutation tests
// ---------------------------------------------------------------------------

describe('useCreateShiftDefinition', () => {
  it('creates a shift definition and shows toast', async () => {
    mockFromChain.single.mockResolvedValue({
      data: mockDefinition,
      error: null,
    });

    const { result } = renderHook(() => useCreateShiftDefinition(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurant_id: RESTAURANT_ID,
        name: 'Morning Prep',
        start_time: '06:00:00',
        end_time: '14:00:00',
        break_duration: 30,
        is_active: true,
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('shift_templates');
    expect(mockFromChain.insert).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Shift definition created',
      description: '"Morning Prep" has been added.',
    });
  });

  it('shows error toast on failure', async () => {
    mockFromChain.single.mockResolvedValue({
      data: null,
      error: { message: 'Duplicate name' },
    });

    const { result } = renderHook(() => useCreateShiftDefinition(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          restaurant_id: RESTAURANT_ID,
          name: 'Morning Prep',
          start_time: '06:00:00',
          end_time: '14:00:00',
          break_duration: 30,
          is_active: true,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error creating shift definition',
          variant: 'destructive',
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useUpdateShiftDefinition mutation tests
// ---------------------------------------------------------------------------

describe('useUpdateShiftDefinition', () => {
  it('updates a shift definition and shows toast', async () => {
    const updated = { ...mockDefinition, name: 'Evening Prep' };
    mockFromChain.single.mockResolvedValue({
      data: updated,
      error: null,
    });

    const { result } = renderHook(() => useUpdateShiftDefinition(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'def-1',
        name: 'Evening Prep',
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('shift_templates');
    expect(mockFromChain.update).toHaveBeenCalledWith({ name: 'Evening Prep' });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Shift definition updated',
      description: '"Evening Prep" has been updated.',
    });
  });
});

// ---------------------------------------------------------------------------
// useDeleteShiftDefinition mutation tests
// ---------------------------------------------------------------------------

describe('useDeleteShiftDefinition', () => {
  it('deletes a shift definition and shows toast', async () => {
    mockFromChain.eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useDeleteShiftDefinition(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'def-1',
        restaurantId: RESTAURANT_ID,
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('shift_templates');
    expect(mockFromChain.delete).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Shift definition deleted',
      description: 'The shift definition has been removed.',
    });
  });

  it('shows error toast on delete failure', async () => {
    mockFromChain.eq.mockResolvedValue({ error: { message: 'FK constraint' } });

    const { result } = renderHook(() => useDeleteShiftDefinition(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          id: 'def-1',
          restaurantId: RESTAURANT_ID,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error deleting shift definition',
          variant: 'destructive',
        })
      );
    });
  });
});
