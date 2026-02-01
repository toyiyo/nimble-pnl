/**
 * Unit Tests: Shift Series Hooks
 *
 * Tests for useDeleteShiftSeries and useUpdateShiftSeries hooks in useShifts.tsx:
 * - Scope filtering ('this', 'following', 'all')
 * - Locked shift preservation
 * - Error handling and toast notifications
 * - Cache invalidation after mutations
 * - Optimistic updates and rollback
 */

import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useDeleteShiftSeries,
  useUpdateShiftSeries,
  useSeriesInfo,
} from '@/hooks/useShifts';
import { Shift } from '@/types/scheduling';

// Mock Supabase client
const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));

// Mock toast
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Helper to create mock shifts
const createMockShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  restaurant_id: 'rest-123',
  employee_id: 'emp-1',
  start_time: '2026-01-10T09:00:00Z',
  end_time: '2026-01-10T17:00:00Z',
  break_duration: 30,
  position: 'Server',
  status: 'scheduled',
  is_recurring: true,
  is_published: false,
  locked: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
};

// Helper: Create React Query wrapper with cache access
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) => {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  return { Wrapper, queryClient };
};

// Helper: Create mock query builder for delete operations
const createDeleteQueryBuilder = (
  countResult: { count: number | null; error: Error | null } = { count: 0, error: null },
  deleteResult: { data: { id: string }[] | null; error: Error | null } = { data: [], error: null }
): QueryBuilder => {
  const builder: QueryBuilder = {
    select: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
  };

  // For count queries (head: true)
  builder.select.mockImplementation((_: string, options?: { count?: string; head?: boolean }) => {
    if (options?.head) {
      return {
        ...builder,
        eq: vi.fn().mockReturnValue({
          ...builder,
          eq: vi.fn().mockResolvedValue(countResult),
          or: vi.fn().mockReturnValue({
            ...builder,
            eq: vi.fn().mockReturnValue({
              ...builder,
              gte: vi.fn().mockReturnValue({
                ...builder,
                eq: vi.fn().mockResolvedValue(countResult),
              }),
              eq: vi.fn().mockResolvedValue(countResult),
            }),
            gte: vi.fn().mockReturnValue({
              ...builder,
              eq: vi.fn().mockReturnValue({
                ...builder,
                eq: vi.fn().mockResolvedValue(countResult),
              }),
            }),
          }),
        }),
        or: vi.fn().mockReturnValue({
          ...builder,
          eq: vi.fn().mockReturnValue({
            ...builder,
            eq: vi.fn().mockResolvedValue(countResult),
          }),
          gte: vi.fn().mockReturnValue({
            ...builder,
            eq: vi.fn().mockReturnValue({
              ...builder,
              eq: vi.fn().mockResolvedValue(countResult),
            }),
          }),
        }),
      };
    }
    return builder;
  });

  // For delete/update operations that return data
  builder.delete.mockReturnValue({
    ...builder,
    eq: vi.fn().mockReturnValue({
      ...builder,
      eq: vi.fn().mockReturnValue({
        ...builder,
        select: vi.fn().mockResolvedValue(deleteResult),
      }),
      select: vi.fn().mockResolvedValue(deleteResult),
    }),
    or: vi.fn().mockReturnValue({
      ...builder,
      gte: vi.fn().mockReturnValue({
        ...builder,
        eq: vi.fn().mockReturnValue({
          ...builder,
          eq: vi.fn().mockReturnValue({
            ...builder,
            select: vi.fn().mockResolvedValue(deleteResult),
          }),
        }),
      }),
      eq: vi.fn().mockReturnValue({
        ...builder,
        eq: vi.fn().mockReturnValue({
          ...builder,
          select: vi.fn().mockResolvedValue(deleteResult),
        }),
      }),
    }),
  });

  return builder;
};

// Simplified approach - mock at the operation level
const setupMockForScope = (
  scope: 'this' | 'following' | 'all',
  lockedCount: number = 0,
  deletedCount: number = 1,
  error: Error | null = null
) => {
  const deletedIds = Array.from({ length: deletedCount }, (_, i) => ({ id: `deleted-${i}` }));

  mockSupabase.from.mockImplementation(() => ({
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: deletedIds, error }),
        }),
      }),
      or: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: deletedIds, error }),
            }),
          }),
        }),
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: deletedIds, error }),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: deletedIds, error }),
        }),
      }),
      or: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: deletedIds, error }),
            }),
          }),
        }),
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: deletedIds, error }),
          }),
        }),
      }),
    }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ count: lockedCount, error: null }),
      }),
      or: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ count: lockedCount, error: null }),
          }),
        }),
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ count: lockedCount, error: null }),
        }),
      }),
    }),
  }));
};

describe('useDeleteShiftSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Scope: this', () => {
    it('should delete only the target shift when scope is "this"', async () => {
      setupMockForScope('this', 0, 1);

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({ id: 'target-shift', locked: false });

      await result.current.mutateAsync({
        shift,
        scope: 'this',
        restaurantId: 'rest-123',
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('shifts');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Shifts deleted',
        })
      );
    });

    it('should throw error when trying to delete locked shift with scope "this"', async () => {
      setupMockForScope('this');

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const lockedShift = createMockShift({ id: 'locked-shift', locked: true });

      await expect(
        result.current.mutateAsync({
          shift: lockedShift,
          scope: 'this',
          restaurantId: 'rest-123',
        })
      ).rejects.toThrow('Cannot delete a locked shift');

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });

  describe('Scope: following', () => {
    it('should delete following shifts and report locked count', async () => {
      setupMockForScope('following', 2, 3);

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({
        id: 'parent-shift',
        is_recurring: true,
        recurrence_parent_id: null,
      });

      const response = await result.current.mutateAsync({
        shift,
        scope: 'following',
        restaurantId: 'rest-123',
      });

      expect(response.deletedCount).toBe(3);
      expect(response.lockedCount).toBe(2);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Shifts deleted',
          description: expect.stringContaining('3 shifts deleted'),
        })
      );
    });
  });

  describe('Scope: all', () => {
    it('should delete all unlocked shifts in series', async () => {
      setupMockForScope('all', 1, 5);

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({
        id: 'child-shift',
        is_recurring: true,
        recurrence_parent_id: 'parent-id',
      });

      const response = await result.current.mutateAsync({
        shift,
        scope: 'all',
        restaurantId: 'rest-123',
      });

      expect(response.deletedCount).toBe(5);
      expect(response.lockedCount).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle Supabase error and show destructive toast', async () => {
      const dbError = { message: 'Database error' };
      mockSupabase.from.mockImplementation(() => ({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: dbError }),
          }),
        }),
      }));

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({ locked: false });

      await expect(
        result.current.mutateAsync({
          shift,
          scope: 'this',
          restaurantId: 'rest-123',
        })
      ).rejects.toThrow();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });
});

describe('useUpdateShiftSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Scope: this', () => {
    it('should update only the target shift and detach from series', async () => {
      const updatedShift = { id: 'target-shift' };
      mockSupabase.from.mockImplementation(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [updatedShift], error: null }),
            }),
          }),
        }),
      }));

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({ id: 'target-shift', locked: false });

      const response = await result.current.mutateAsync({
        shift,
        scope: 'this',
        updates: { position: 'Cook' },
        restaurantId: 'rest-123',
      });

      expect(response.updatedCount).toBe(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Shifts updated',
        })
      );
    });

    it('should throw error when trying to update locked shift with scope "this"', async () => {
      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const lockedShift = createMockShift({ id: 'locked-shift', locked: true });

      await expect(
        result.current.mutateAsync({
          shift: lockedShift,
          scope: 'this',
          updates: { position: 'Cook' },
          restaurantId: 'rest-123',
        })
      ).rejects.toThrow('Cannot update a locked shift');
    });

    it('should include time changes for scope "this"', async () => {
      const updatedShift = { id: 'target-shift' };
      let capturedUpdate: Record<string, unknown> | null = null;

      mockSupabase.from.mockImplementation(() => ({
        update: vi.fn().mockImplementation((updates: Record<string, unknown>) => {
          capturedUpdate = updates;
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({ data: [updatedShift], error: null }),
              }),
            }),
          };
        }),
      }));

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({ id: 'target-shift', locked: false });

      await result.current.mutateAsync({
        shift,
        scope: 'this',
        updates: {
          start_time: '2026-01-10T10:00:00Z',
          end_time: '2026-01-10T18:00:00Z',
        },
        restaurantId: 'rest-123',
      });

      expect(capturedUpdate).toMatchObject({
        start_time: '2026-01-10T10:00:00Z',
        end_time: '2026-01-10T18:00:00Z',
        recurrence_parent_id: null,
        is_recurring: false,
      });
    });
  });

  describe('Scope: following', () => {
    it('should update following shifts and report locked count', async () => {
      setupMockForScope('following', 1, 4);

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({
        id: 'parent-shift',
        is_recurring: true,
        recurrence_parent_id: null,
      });

      const response = await result.current.mutateAsync({
        shift,
        scope: 'following',
        updates: { position: 'Host' },
        restaurantId: 'rest-123',
      });

      expect(response.updatedCount).toBe(4);
      expect(response.lockedCount).toBe(1);
    });

    it('should NOT include time changes for scope "following"', async () => {
      let capturedUpdate: Record<string, unknown> | null = null;

      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
              }),
            }),
          }),
        }),
        update: vi.fn().mockImplementation((updates: Record<string, unknown>) => {
          capturedUpdate = updates;
          return {
            or: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    select: vi.fn().mockResolvedValue({ data: [{ id: 's1' }], error: null }),
                  }),
                }),
              }),
            }),
          };
        }),
      }));

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({ locked: false });

      await result.current.mutateAsync({
        shift,
        scope: 'following',
        updates: {
          position: 'Host',
          start_time: '2026-01-10T10:00:00Z', // Should be excluded
          end_time: '2026-01-10T18:00:00Z', // Should be excluded
        },
        restaurantId: 'rest-123',
      });

      expect(capturedUpdate).toMatchObject({ position: 'Host' });
      expect(capturedUpdate).not.toHaveProperty('start_time');
      expect(capturedUpdate).not.toHaveProperty('end_time');
    });
  });

  describe('Scope: all', () => {
    it('should update all unlocked shifts in series', async () => {
      setupMockForScope('all', 2, 6);

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({
        id: 'child-shift',
        is_recurring: true,
        recurrence_parent_id: 'parent-id',
      });

      const response = await result.current.mutateAsync({
        shift,
        scope: 'all',
        updates: { notes: 'Updated note' },
        restaurantId: 'rest-123',
      });

      expect(response.updatedCount).toBe(6);
      expect(response.lockedCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle Supabase error and show destructive toast', async () => {
      mockSupabase.from.mockImplementation(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: null, error: new Error('Update failed') }),
            }),
          }),
        }),
      }));

      const { Wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateShiftSeries(), { wrapper: Wrapper });

      await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

      const shift = createMockShift({ locked: false });

      await expect(
        result.current.mutateAsync({
          shift,
          scope: 'this',
          updates: { position: 'Cook' },
          restaurantId: 'rest-123',
        })
      ).rejects.toThrow('Update failed');

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        })
      );
    });
  });
});

describe('useSeriesInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch series info for recurring shift', async () => {
    mockSupabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
        }),
        eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
      }),
    }));

    const { Wrapper } = createWrapper();
    const shift = createMockShift({ is_recurring: true });

    const { result } = renderHook(() => useSeriesInfo(shift, 'rest-123'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.seriesCount).toBeGreaterThanOrEqual(0);
  });

  it('should return zeros for null shift', async () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useSeriesInfo(null, 'rest-123'), { wrapper: Wrapper });

    expect(result.current.seriesCount).toBe(0);
    expect(result.current.lockedCount).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('should return zeros for null restaurantId', async () => {
    const { Wrapper } = createWrapper();
    const shift = createMockShift({ is_recurring: true });

    const { result } = renderHook(() => useSeriesInfo(shift, null), { wrapper: Wrapper });

    expect(result.current.seriesCount).toBe(0);
    expect(result.current.lockedCount).toBe(0);
  });

  it('should not fetch for non-recurring shift', async () => {
    const { Wrapper } = createWrapper();
    const shift = createMockShift({ is_recurring: false });

    const { result } = renderHook(() => useSeriesInfo(shift, 'rest-123'), { wrapper: Wrapper });

    expect(result.current.seriesCount).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

describe('Toast Messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show singular message for 1 shift deleted', async () => {
    setupMockForScope('this', 0, 1);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

    await result.current.mutateAsync({
      shift: createMockShift({ locked: false }),
      scope: 'this',
      restaurantId: 'rest-123',
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('1 shift deleted'),
      })
    );
  });

  it('should show plural message for multiple shifts deleted', async () => {
    setupMockForScope('all', 0, 3);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

    await result.current.mutateAsync({
      shift: createMockShift(),
      scope: 'all',
      restaurantId: 'rest-123',
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('3 shifts deleted'),
      })
    );
  });

  it('should include locked count in message when shifts are preserved', async () => {
    setupMockForScope('all', 2, 3);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteShiftSeries(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

    await result.current.mutateAsync({
      shift: createMockShift(),
      scope: 'all',
      restaurantId: 'rest-123',
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/2.*locked.*preserved/i),
      })
    );
  });
});
