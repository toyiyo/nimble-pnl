/**
 * Unit tests: useShiftPlanner delegates its mutation surface to
 * useValidatedShiftMutations (plan task A4).
 *
 * These tests mock @/hooks/useValidatedShiftMutations directly and assert that
 * useShiftPlanner's validateAndCreate/forceCreate/validateAndUpdateTime/
 * validateAndReassign/deleteShift call through to it with the right shape,
 * and that its returned validationResult/clearValidation are the same
 * instances exposed by the pipeline hook — proving useShiftPlanner no longer
 * runs its own inline validation/mutation logic.
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useShiftPlanner } from '@/hooks/useShiftPlanner';
import type { Shift } from '@/types/scheduling';

const mockValidateAndCreate = vi.hoisted(() => vi.fn());
const mockForceCreate = vi.hoisted(() => vi.fn());
const mockValidateAndUpdateTime = vi.hoisted(() => vi.fn());
const mockValidateAndReassign = vi.hoisted(() => vi.fn());
const mockDeleteShift = vi.hoisted(() => vi.fn());
const mockClearValidation = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useValidatedShiftMutations', () => ({
  useValidatedShiftMutations: vi.fn(() => ({
    validateAndCreate: mockValidateAndCreate,
    forceCreate: mockForceCreate,
    validateAndUpdateTime: mockValidateAndUpdateTime,
    forceUpdateTime: vi.fn(),
    validateAndReassign: mockValidateAndReassign,
    forceReassign: vi.fn(),
    deleteShift: mockDeleteShift,
    validationResult: null,
    clearValidation: mockClearValidation,
  })),
}));

const mockShifts = vi.hoisted(() => vi.fn());
const mockEmployees = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useShifts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useShifts')>();
  return {
    ...actual,
    useShifts: mockShifts,
    useCreateShift: vi.fn(() => ({ mutateAsync: vi.fn() })),
    useUpdateShift: vi.fn(() => ({ mutateAsync: vi.fn() })),
    useDeleteShift: vi.fn(() => ({ mutate: vi.fn() })),
  };
});

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: mockEmployees,
}));

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time: '2026-01-15T15:00:00.000Z',
    end_time: '2026-01-15T23:00:00.000Z',
    break_duration: 0,
    position: 'server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    source: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return Wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockShifts.mockReturnValue({ shifts: [], loading: false, error: null });
  mockEmployees.mockReturnValue({ employees: [], loading: false, error: null });
});

function renderPlanner() {
  const Wrapper = createWrapper();
  return renderHook(() => useShiftPlanner('rest-1'), { wrapper: Wrapper });
}

describe('useShiftPlanner — delegates to useValidatedShiftMutations (A4)', () => {
  it('validateAndCreate delegates to the pipeline hook and returns its outcome verbatim', async () => {
    mockValidateAndCreate.mockResolvedValue({ created: true });
    const { result } = renderPlanner();

    const input = {
      employeeId: 'emp-2',
      date: '2026-02-01',
      startTime: '09:00',
      endTime: '17:00',
      position: 'server',
    };

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.validateAndCreate(input);
    });

    expect(mockValidateAndCreate).toHaveBeenCalledWith(input);
    expect(outcome).toEqual({ created: true });
  });

  it('forceCreate delegates to the pipeline hook', async () => {
    mockForceCreate.mockResolvedValue(true);
    const { result } = renderPlanner();

    const input = {
      employeeId: 'emp-2',
      date: '2026-02-01',
      startTime: '09:00',
      endTime: '17:00',
      position: 'server',
    };

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.forceCreate(input);
    });

    expect(mockForceCreate).toHaveBeenCalledWith(input);
    expect(outcome).toBe(true);
  });

  it('validateAndUpdateTime delegates with a translated {shift, startIso, endIso, businessDate} shape and unwraps `updated` to a boolean', async () => {
    mockValidateAndUpdateTime.mockResolvedValue({ updated: true });
    const { result } = renderPlanner();
    const shift = makeShift({ id: 'shift-9' });

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.validateAndUpdateTime({
        shift,
        newStartTime: '2026-02-01T09:00',
        newEndTime: '2026-02-01T17:00',
      });
    });

    expect(mockValidateAndUpdateTime).toHaveBeenCalledWith(
      expect.objectContaining({
        shift,
        startIso: expect.any(String),
        endIso: expect.any(String),
        businessDate: '2026-02-01',
      }),
    );
    expect(outcome).toBe(true);
  });

  it('validateAndUpdateTime returns false when the pipeline reports pending issues (does not throw)', async () => {
    mockValidateAndUpdateTime.mockResolvedValue({
      updated: false,
      pendingWarnings: [{ code: 'OVERLAP', message: 'Overlaps another shift' }],
    });
    const { result } = renderPlanner();
    const shift = makeShift({ id: 'shift-9' });

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.validateAndUpdateTime({
        shift,
        newStartTime: '2026-02-01T09:00',
        newEndTime: '2026-02-01T17:00',
      });
    });

    expect(outcome).toBe(false);
  });

  it('validateAndUpdateTime returns false (never throws) when the new time string has no T separator', async () => {
    const { result } = renderPlanner();
    const shift = makeShift({ id: 'shift-9' });

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.validateAndUpdateTime({
        shift,
        newStartTime: 'not-a-valid-timestamp',
        newEndTime: '2026-02-01T17:00',
      });
    });

    expect(outcome).toBe(false);
    expect(mockValidateAndUpdateTime).not.toHaveBeenCalled();
  });

  it('validateAndUpdateTime returns false (never throws) when ShiftInterval.create rejects the interval (e.g. zero duration)', async () => {
    const { result } = renderPlanner();
    const shift = makeShift({ id: 'shift-9' });

    let outcome: boolean | undefined;
    await act(async () => {
      // Equal start/end (no midnight crossing) → ShiftInterval.create throws INVALID_DURATION.
      outcome = await result.current.validateAndUpdateTime({
        shift,
        newStartTime: '2026-02-01T09:00',
        newEndTime: '2026-02-01T09:00',
      });
    });

    expect(outcome).toBe(false);
    expect(mockValidateAndUpdateTime).not.toHaveBeenCalled();
  });

  it('validateAndReassign delegates and unwraps `reassigned` to a boolean', async () => {
    mockValidateAndReassign.mockResolvedValue({ reassigned: true });
    const { result } = renderPlanner();
    const shift = makeShift({ id: 'shift-9' });

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.validateAndReassign({
        shift,
        newEmployeeId: 'emp-2',
      });
    });

    expect(mockValidateAndReassign).toHaveBeenCalledWith({ shift, newEmployeeId: 'emp-2' });
    expect(outcome).toBe(true);
  });

  it('deleteShift delegates to the pipeline hook', () => {
    const { result } = renderPlanner();

    act(() => {
      result.current.deleteShift('shift-9');
    });

    expect(mockDeleteShift).toHaveBeenCalledWith('shift-9');
  });

  it('exposes the pipeline hook validationResult and clearValidation (same instances, not shadowed by local state)', async () => {
    const { result } = renderPlanner();

    expect(result.current.validationResult).toBeNull();

    act(() => {
      result.current.clearValidation();
    });

    expect(mockClearValidation).toHaveBeenCalledTimes(1);
  });
});
