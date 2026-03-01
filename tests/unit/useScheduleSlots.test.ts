/**
 * Unit Tests: useScheduleSlots hook
 *
 * Tests all exported hooks for schedule_slots and RPCs:
 * - useScheduleSlots (fetch slots with joined data)
 * - useGenerateSchedule (call generate_schedule_from_template RPC)
 * - useAssignEmployee (assign employee to slot + shift)
 * - useUnassignEmployee (clear employee from slot + shift)
 * - useDeleteGeneratedSchedule (call delete_generated_schedule RPC)
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  useScheduleSlots,
  useGenerateSchedule,
  useAssignEmployee,
  useUnassignEmployee,
  useDeleteGeneratedSchedule,
} from '@/hooks/useScheduleSlots';

import {
  RESTAURANT_ID,
  createWrapper,
  buildMockFromChain,
  type MockFromChain,
} from './helpers/scheduling-test-helpers';

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

const WEEK_START = '2026-03-02';

const mockSlot = {
  id: 'slot-1',
  restaurant_id: RESTAURANT_ID,
  week_template_slot_id: 'wts-1',
  shift_id: 'shift-1',
  week_start_date: WEEK_START,
  slot_index: 0,
  employee_id: null,
  status: 'unfilled',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

let mockFromChain: MockFromChain;

beforeEach(() => {
  vi.clearAllMocks();

  mockFromChain = buildMockFromChain({ terminalData: mockSlot });
  // order() returns empty by default for list queries
  mockFromChain.order.mockResolvedValue({ data: [], error: null });

  mockSupabase.from.mockReturnValue(mockFromChain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// Export verification
// ---------------------------------------------------------------------------

describe('useScheduleSlots exports', () => {
  it('exports useScheduleSlots as a function', () => {
    expect(typeof useScheduleSlots).toBe('function');
  });

  it('exports useGenerateSchedule as a function', () => {
    expect(typeof useGenerateSchedule).toBe('function');
  });

  it('exports useAssignEmployee as a function', () => {
    expect(typeof useAssignEmployee).toBe('function');
  });

  it('exports useUnassignEmployee as a function', () => {
    expect(typeof useUnassignEmployee).toBe('function');
  });

  it('exports useDeleteGeneratedSchedule as a function', () => {
    expect(typeof useDeleteGeneratedSchedule).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// useScheduleSlots query tests
// ---------------------------------------------------------------------------

describe('useScheduleSlots', () => {
  it('returns empty array when restaurantId is null', async () => {
    const { result } = renderHook(() => useScheduleSlots(null, WEEK_START), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.slots).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns empty array when weekStartDate is null', async () => {
    const { result } = renderHook(() => useScheduleSlots(RESTAURANT_ID, null), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.slots).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fetches slots when both params are provided', async () => {
    mockFromChain.order.mockResolvedValue({
      data: [mockSlot],
      error: null,
    });

    const { result } = renderHook(() => useScheduleSlots(RESTAURANT_ID, WEEK_START), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockSupabase.from).toHaveBeenCalledWith('schedule_slots');
    expect(mockFromChain.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID);
    expect(mockFromChain.eq).toHaveBeenCalledWith('week_start_date', WEEK_START);
    expect(result.current.slots).toEqual([mockSlot]);
  });

  it('handles query error', async () => {
    mockFromChain.order.mockResolvedValue({
      data: null,
      error: { message: 'Permission denied' },
    });

    const { result } = renderHook(() => useScheduleSlots(RESTAURANT_ID, WEEK_START), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// useGenerateSchedule mutation tests
// ---------------------------------------------------------------------------

describe('useGenerateSchedule', () => {
  it('calls generate_schedule_from_template RPC and shows toast', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useGenerateSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurantId: RESTAURANT_ID,
        weekTemplateId: 'tmpl-1',
        weekStartDate: WEEK_START,
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('generate_schedule_from_template', {
      p_restaurant_id: RESTAURANT_ID,
      p_week_template_id: 'tmpl-1',
      p_week_start_date: WEEK_START,
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Schedule generated',
      description: 'Shifts and schedule slots have been created from the template.',
    });
  });

  it('shows error toast on RPC failure', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Schedule already exists for this week' },
    });

    const { result } = renderHook(() => useGenerateSchedule(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          restaurantId: RESTAURANT_ID,
          weekTemplateId: 'tmpl-1',
          weekStartDate: WEEK_START,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error generating schedule',
          variant: 'destructive',
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// useAssignEmployee mutation tests
// ---------------------------------------------------------------------------

describe('useAssignEmployee', () => {
  it('updates both slot and shift when shiftId is provided', async () => {
    // First from() call: update schedule_slots
    // Second from() call: update shifts
    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const { result } = renderHook(() => useAssignEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        slotId: 'slot-1',
        shiftId: 'shift-1',
        employeeId: 'emp-1',
        restaurantId: RESTAURANT_ID,
        weekStartDate: WEEK_START,
      });
    });

    // Should have called from() twice: once for schedule_slots, once for shifts
    expect(callCount).toBe(2);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Employee assigned',
      description: 'The employee has been assigned to the shift slot.',
    });
  });

  it('only updates slot when shiftId is null', async () => {
    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const { result } = renderHook(() => useAssignEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        slotId: 'slot-1',
        shiftId: null,
        employeeId: 'emp-1',
        restaurantId: RESTAURANT_ID,
        weekStartDate: WEEK_START,
      });
    });

    // Should have called from() once: only for schedule_slots
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// useUnassignEmployee mutation tests
// ---------------------------------------------------------------------------

describe('useUnassignEmployee', () => {
  it('clears employee from both slot and shift when shiftId is provided', async () => {
    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const { result } = renderHook(() => useUnassignEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        slotId: 'slot-1',
        shiftId: 'shift-1',
        restaurantId: RESTAURANT_ID,
        weekStartDate: WEEK_START,
      });
    });

    expect(callCount).toBe(2);
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Employee unassigned',
      description: 'The employee has been removed from the shift slot.',
    });
  });

  it('only updates slot when shiftId is null', async () => {
    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const { result } = renderHook(() => useUnassignEmployee(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        slotId: 'slot-1',
        shiftId: null,
        restaurantId: RESTAURANT_ID,
        weekStartDate: WEEK_START,
      });
    });

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// useDeleteGeneratedSchedule mutation tests
// ---------------------------------------------------------------------------

describe('useDeleteGeneratedSchedule', () => {
  it('calls delete_generated_schedule RPC and shows toast', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useDeleteGeneratedSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        restaurantId: RESTAURANT_ID,
        weekStartDate: WEEK_START,
      });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('delete_generated_schedule', {
      p_restaurant_id: RESTAURANT_ID,
      p_week_start_date: WEEK_START,
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'Schedule deleted',
      description: 'All generated shifts and slots for this week have been removed.',
    });
  });

  it('shows error toast on RPC failure', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'No schedule found' },
    });

    const { result } = renderHook(() => useDeleteGeneratedSchedule(), {
      wrapper: createWrapper(),
    });

    try {
      await act(async () => {
        await result.current.mutateAsync({
          restaurantId: RESTAURANT_ID,
          weekStartDate: WEEK_START,
        });
      });
    } catch {
      // expected
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error deleting schedule',
          variant: 'destructive',
        })
      );
    });
  });
});
