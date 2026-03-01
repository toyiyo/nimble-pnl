/**
 * Unit Tests: useWeekTemplates hook
 *
 * Tests all exported hooks for week_templates and week_template_slots:
 * - useWeekTemplates (fetch all templates)
 * - useCreateWeekTemplate (create)
 * - useUpdateWeekTemplate (update)
 * - useDeleteWeekTemplate (delete)
 * - useSetActiveTemplate (deactivate all, activate one)
 * - useWeekTemplateSlots (fetch slots with joined shift_template)
 * - useAddTemplateSlot (add slot)
 * - useUpdateTemplateSlot (update slot)
 * - useRemoveTemplateSlot (remove slot)
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useWeekTemplates,
  useCreateWeekTemplate,
  useUpdateWeekTemplate,
  useDeleteWeekTemplate,
  useSetActiveTemplate,
  useWeekTemplateSlots,
  useAddTemplateSlot,
  useUpdateTemplateSlot,
  useRemoveTemplateSlot,
} from '@/hooks/useWeekTemplates';

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
const TEMPLATE_ID = 'tmpl-1';

const mockTemplate = {
  id: TEMPLATE_ID,
  restaurant_id: RESTAURANT_ID,
  name: 'Default Week',
  description: 'Standard weekly schedule',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockSlot = {
  id: 'slot-1',
  week_template_id: TEMPLATE_ID,
  shift_template_id: 'def-1',
  day_of_week: 1,
  position: 'cook',
  headcount: 2,
  sort_order: 0,
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
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockTemplate, error: null }),
  };

  // By default, order() resolves as the terminal call for queries
  // For chained .order().order(), the second order is the terminal call
  mockFromChain.order.mockImplementation(() => {
    const chainable = {
      ...mockFromChain,
      // When order is the last in chain (for queries), resolve
      then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
        resolve({ data: [], error: null });
      },
    };
    return chainable;
  });

  mockSupabase.from.mockReturnValue(mockFromChain);
});

// ---------------------------------------------------------------------------
// Export verification
// ---------------------------------------------------------------------------

describe('useWeekTemplates exports', () => {
  it('exports useWeekTemplates as a function', () => {
    expect(typeof useWeekTemplates).toBe('function');
  });

  it('exports useCreateWeekTemplate as a function', () => {
    expect(typeof useCreateWeekTemplate).toBe('function');
  });

  it('exports useUpdateWeekTemplate as a function', () => {
    expect(typeof useUpdateWeekTemplate).toBe('function');
  });

  it('exports useDeleteWeekTemplate as a function', () => {
    expect(typeof useDeleteWeekTemplate).toBe('function');
  });

  it('exports useSetActiveTemplate as a function', () => {
    expect(typeof useSetActiveTemplate).toBe('function');
  });

  it('exports useWeekTemplateSlots as a function', () => {
    expect(typeof useWeekTemplateSlots).toBe('function');
  });

  it('exports useAddTemplateSlot as a function', () => {
    expect(typeof useAddTemplateSlot).toBe('function');
  });

  it('exports useUpdateTemplateSlot as a function', () => {
    expect(typeof useUpdateTemplateSlot).toBe('function');
  });

  it('exports useRemoveTemplateSlot as a function', () => {
    expect(typeof useRemoveTemplateSlot).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// useWeekTemplates query tests
// ---------------------------------------------------------------------------

describe('useWeekTemplates', () => {
  it('returns empty array when restaurantId is null', async () => {
    const { result } = renderHook(() => useWeekTemplates(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.templates).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches templates when restaurantId is provided', async () => {
    // Override the order mock to return data for this test
    mockFromChain.order.mockResolvedValue({
      data: [mockTemplate],
      error: null,
    });

    const { result } = renderHook(() => useWeekTemplates(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_templates');
    expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID);
    expect(result.current.templates).toEqual([mockTemplate]);
  });

  it('handles query error', async () => {
    mockFromChain.order.mockResolvedValue({
      data: null,
      error: { message: 'Permission denied' },
    });

    const { result } = renderHook(() => useWeekTemplates(RESTAURANT_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// useCreateWeekTemplate mutation tests
// ---------------------------------------------------------------------------

describe('useCreateWeekTemplate', () => {
  it('creates a template and shows toast', async () => {
    mockFromChain.single.mockResolvedValue({
      data: mockTemplate,
      error: null,
    });

    const { result } = renderHook(() => useCreateWeekTemplate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurant_id: RESTAURANT_ID,
        name: 'Default Week',
        is_active: true,
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_templates');
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Week template created',
      description: '"Default Week" has been added.',
    });
  });

  it('shows error toast on creation failure', async () => {
    mockFromChain.single.mockResolvedValue({
      data: null,
      error: { message: 'Duplicate name' },
    });

    const { result } = renderHook(() => useCreateWeekTemplate(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          restaurant_id: RESTAURANT_ID,
          name: 'Default Week',
          is_active: true,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error creating week template',
          variant: 'destructive',
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useUpdateWeekTemplate mutation tests
// ---------------------------------------------------------------------------

describe('useUpdateWeekTemplate', () => {
  it('updates a template and shows toast', async () => {
    const updatedTemplate = { ...mockTemplate, name: 'Updated Week' };
    mockFromChain.single.mockResolvedValue({
      data: updatedTemplate,
      error: null,
    });

    const { result } = renderHook(() => useUpdateWeekTemplate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: TEMPLATE_ID,
        name: 'Updated Week',
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_templates');
    expect(mockFromChain.update).toHaveBeenCalled();
    expect(mockFromChain.eq).toHaveBeenCalledWith('id', TEMPLATE_ID);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Week template updated',
      description: '"Updated Week" has been updated.',
    });
  });

  it('shows error toast on update failure', async () => {
    mockFromChain.single.mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });

    const { result } = renderHook(() => useUpdateWeekTemplate(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          id: TEMPLATE_ID,
          name: 'Updated Week',
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error updating week template',
          variant: 'destructive',
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useDeleteWeekTemplate mutation tests
// ---------------------------------------------------------------------------

describe('useDeleteWeekTemplate', () => {
  it('deletes a template and shows toast', async () => {
    mockFromChain.eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useDeleteWeekTemplate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: TEMPLATE_ID,
        restaurantId: RESTAURANT_ID,
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_templates');
    expect(mockFromChain.delete).toHaveBeenCalled();
    expect(mockFromChain.eq).toHaveBeenCalledWith('id', TEMPLATE_ID);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Week template deleted',
      description: 'The week template has been removed.',
    });
  });

  it('shows error toast on delete failure', async () => {
    mockFromChain.eq.mockResolvedValue({
      error: { message: 'Foreign key constraint' },
    });

    const { result } = renderHook(() => useDeleteWeekTemplate(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          id: TEMPLATE_ID,
          restaurantId: RESTAURANT_ID,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error deleting week template',
          variant: 'destructive',
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useSetActiveTemplate mutation tests
// ---------------------------------------------------------------------------

describe('useSetActiveTemplate', () => {
  it('deactivates all templates then activates selected one', async () => {
    // First call: deactivate all (update + eq for restaurant_id)
    // Second call: activate selected (update + eq for id + select + single)
    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        // Deactivate all - chain ends at eq
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      // Activate selected - chain ends at single
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockTemplate, error: null }),
            }),
          }),
        }),
      };
    });

    const { result } = renderHook(() => useSetActiveTemplate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: TEMPLATE_ID,
        restaurantId: RESTAURANT_ID,
      });
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Active template updated',
      description: '"Default Week" is now the active template.',
    });
  });

  it('shows error toast when deactivation step fails', async () => {
    mockSupabase.from.mockImplementation(() => {
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'Permission denied' } }),
        }),
      };
    });

    const { result } = renderHook(() => useSetActiveTemplate(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          id: TEMPLATE_ID,
          restaurantId: RESTAURANT_ID,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error setting active template',
          variant: 'destructive',
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useWeekTemplateSlots query tests
// ---------------------------------------------------------------------------

describe('useWeekTemplateSlots', () => {
  it('returns empty array when weekTemplateId is null', async () => {
    const { result } = renderHook(() => useWeekTemplateSlots(null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.slots).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches slots with joined shift_template data', async () => {
    // The second .order() call is the terminal one
    const secondOrder = vi.fn().mockResolvedValue({
      data: [mockSlot],
      error: null,
    });
    mockFromChain.order.mockReturnValue({
      ...mockFromChain,
      order: secondOrder,
    });

    const { result } = renderHook(() => useWeekTemplateSlots(TEMPLATE_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_template_slots');
    expect(mockFromChain.eq).toHaveBeenCalledWith('week_template_id', TEMPLATE_ID);
    expect(result.current.slots).toEqual([mockSlot]);
  });

  it('handles query error', async () => {
    const secondOrder = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Table not found' },
    });
    mockFromChain.order.mockReturnValue({
      ...mockFromChain,
      order: secondOrder,
    });

    const { result } = renderHook(() => useWeekTemplateSlots(TEMPLATE_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// useAddTemplateSlot mutation tests
// ---------------------------------------------------------------------------

describe('useAddTemplateSlot', () => {
  it('adds a slot and shows toast', async () => {
    mockFromChain.single.mockResolvedValue({
      data: mockSlot,
      error: null,
    });

    const { result } = renderHook(() => useAddTemplateSlot(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        week_template_id: TEMPLATE_ID,
        shift_template_id: 'def-1',
        day_of_week: 1,
        headcount: 2,
        sort_order: 0,
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_template_slots');
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Slot added',
      description: 'A new shift slot has been added to the template.',
    });
  });

  it('shows error toast on add failure', async () => {
    mockFromChain.single.mockResolvedValue({
      data: null,
      error: { message: 'Unique constraint violation' },
    });

    const { result } = renderHook(() => useAddTemplateSlot(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          week_template_id: TEMPLATE_ID,
          shift_template_id: 'def-1',
          day_of_week: 1,
          headcount: 2,
          sort_order: 0,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error adding slot',
          variant: 'destructive',
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useUpdateTemplateSlot mutation tests
// ---------------------------------------------------------------------------

describe('useUpdateTemplateSlot', () => {
  it('updates a slot and shows toast', async () => {
    mockFromChain.single.mockResolvedValue({
      data: { ...mockSlot, headcount: 3 },
      error: null,
    });

    const { result } = renderHook(() => useUpdateTemplateSlot(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'slot-1',
        weekTemplateId: TEMPLATE_ID,
        headcount: 3,
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_template_slots');
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Slot updated',
      description: 'The shift slot has been updated.',
    });
  });

  it('shows error toast on update failure', async () => {
    mockFromChain.single.mockResolvedValue({
      data: null,
      error: { message: 'Row not found' },
    });

    const { result } = renderHook(() => useUpdateTemplateSlot(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          id: 'slot-1',
          weekTemplateId: TEMPLATE_ID,
          headcount: 5,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error updating slot',
          variant: 'destructive',
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useRemoveTemplateSlot mutation tests
// ---------------------------------------------------------------------------

describe('useRemoveTemplateSlot', () => {
  it('removes a slot and shows toast', async () => {
    mockFromChain.eq.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useRemoveTemplateSlot(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'slot-1',
        weekTemplateId: TEMPLATE_ID,
      });
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('week_template_slots');
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Slot removed',
      description: 'The shift slot has been removed from the template.',
    });
  });

  it('shows error toast on remove failure', async () => {
    mockFromChain.eq.mockResolvedValue({
      error: { message: 'Foreign key constraint' },
    });

    const { result } = renderHook(() => useRemoveTemplateSlot(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          id: 'slot-1',
          weekTemplateId: TEMPLATE_ID,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error removing slot',
          variant: 'destructive',
        }),
      );
    });
  });
});
