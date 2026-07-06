/**
 * Unit tests: useValidatedShiftMutations — the shared validate→confirm→mutate
 * pipeline hook (design doc: docs/superpowers/specs/2026-07-05-timeline-edit-create-design.md).
 *
 * Mocks `@/hooks/useShifts` mutations (useCreateShift/useUpdateShift/useDeleteShift) and
 * DI's the conflict checker so no network/Supabase call is exercised here — that's covered
 * by useConflictDetection's own tests and shiftMutationPipeline's collectShiftIssues tests.
 */
import React, { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useValidatedShiftMutations } from '@/hooks/useValidatedShiftMutations';
import { LockedShiftError } from '@/lib/shiftMutationPipeline';
import { ShiftInterval } from '@/lib/shiftInterval';
import type { Shift, ConflictCheck } from '@/types/scheduling';

const mockCreateMutateAsync = vi.hoisted(() => vi.fn());
const mockUpdateMutateAsync = vi.hoisted(() => vi.fn());
const mockDeleteMutate = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useShifts', () => ({
  useCreateShift: () => ({ mutateAsync: mockCreateMutateAsync }),
  useUpdateShift: () => ({ mutateAsync: mockUpdateMutateAsync }),
  useDeleteShift: () => ({ mutate: mockDeleteMutate }),
}));

const NO_CONFLICTS = { conflicts: [] as ConflictCheck[], hasConflicts: false };

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

function renderPipeline(shifts: Shift[] = [], checkConflicts = vi.fn().mockResolvedValue(NO_CONFLICTS)) {
  const Wrapper = createWrapper();
  return renderHook(
    () => useValidatedShiftMutations('rest-1', shifts, { checkConflicts }),
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateMutateAsync.mockResolvedValue(makeShift());
  mockUpdateMutateAsync.mockResolvedValue(makeShift());
});

describe('useValidatedShiftMutations — create', () => {
  it('validateAndCreate mutates immediately when there are no issues', async () => {
    const checkConflicts = vi.fn().mockResolvedValue(NO_CONFLICTS);
    const { result } = renderPipeline([], checkConflicts);

    const outcome = await result.current.validateAndCreate({
      employeeId: 'emp-2',
      date: '2026-02-01',
      startTime: '09:00',
      endTime: '17:00',
      position: 'server',
    });

    expect(outcome.created).toBe(true);
    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1);
    expect(result.current.validationResult).toBeNull();
  });

  it('validateAndCreate returns pending issues (does not mutate) when warnings exist', async () => {
    // Existing shift built the same way validateAndCreate builds its own interval
    // (ShiftInterval.create, host-local) so the overlap holds regardless of host TZ.
    const existingInterval = ShiftInterval.create('2026-01-15', '09:00', '17:00');
    const existing = makeShift({
      start_time: existingInterval.startAt.toISOString(),
      end_time: existingInterval.endAt.toISOString(),
    });
    const { result } = renderPipeline([existing]);

    const outcome = await result.current.validateAndCreate({
      employeeId: 'emp-1',
      date: '2026-01-15',
      startTime: '12:00',
      endTime: '20:00',
      position: 'server',
    });

    expect(outcome.created).toBe(false);
    expect(outcome.pendingWarnings?.some((w) => w.code === 'OVERLAP')).toBe(true);
    expect(mockCreateMutateAsync).not.toHaveBeenCalled();
  });

  it('forceCreate mutates regardless of pending issues', async () => {
    const existingInterval = ShiftInterval.create('2026-01-15', '09:00', '17:00');
    const existing = makeShift({
      start_time: existingInterval.startAt.toISOString(),
      end_time: existingInterval.endAt.toISOString(),
    });
    const { result } = renderPipeline([existing]);

    const created = await result.current.forceCreate({
      employeeId: 'emp-1',
      date: '2026-01-15',
      startTime: '12:00',
      endTime: '20:00',
      position: 'server',
    });

    expect(created).toBe(true);
    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe('useValidatedShiftMutations — validateAndUpdateTime', () => {
  it('updates immediately when there are no issues', async () => {
    const { result } = renderPipeline([]);
    const shift = makeShift({ id: 'shift-9', locked: false });

    const outcome = await result.current.validateAndUpdateTime({
      shift,
      startIso: '2026-02-01T15:00:00.000Z',
      endIso: '2026-02-01T23:00:00.000Z',
      businessDate: '2026-02-01',
    });

    expect(outcome.updated).toBe(true);
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'shift-9',
        start_time: '2026-02-01T15:00:00.000Z',
        end_time: '2026-02-01T23:00:00.000Z',
      }),
    );
  });

  it('returns pending issues without mutating when warnings/conflicts exist', async () => {
    const rpcConflicts: ConflictCheck[] = [
      { has_conflict: true, conflict_type: 'time-off', message: 'Employee has approved time-off' },
    ];
    const checkConflicts = vi.fn().mockResolvedValue({ conflicts: rpcConflicts, hasConflicts: true });
    const { result } = renderPipeline([], checkConflicts);
    const shift = makeShift({ id: 'shift-9' });

    const outcome = await result.current.validateAndUpdateTime({
      shift,
      startIso: '2026-02-01T15:00:00.000Z',
      endIso: '2026-02-01T23:00:00.000Z',
      businessDate: '2026-02-01',
    });

    expect(outcome.updated).toBe(false);
    expect(outcome.pendingConflicts).toEqual(rpcConflicts);
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
  });

  it('excludes the shift being edited from overlap detection (excludeShiftId)', async () => {
    // Same interval as itself — must not self-overlap.
    const shift = makeShift({ id: 'shift-9' });
    const { result } = renderPipeline([shift]);

    const outcome = await result.current.validateAndUpdateTime({
      shift,
      startIso: shift.start_time,
      endIso: shift.end_time,
      businessDate: '2026-01-15',
    });

    expect(outcome.updated).toBe(true);
  });

  it('rejects with a LockedShiftError for a locked shift and does not mutate', async () => {
    const { result } = renderPipeline([]);
    const lockedShift = makeShift({ id: 'shift-locked', locked: true });

    await expect(
      result.current.validateAndUpdateTime({
        shift: lockedShift,
        startIso: '2026-02-01T15:00:00.000Z',
        endIso: '2026-02-01T23:00:00.000Z',
        businessDate: '2026-02-01',
      }),
    ).rejects.toBeInstanceOf(LockedShiftError);

    expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
  });

  it('TZ regression: builds the interval via ShiftInterval.fromTimestamps (restaurant-local wall clock preserved), not host-TZ split+create', async () => {
    // Restaurant TZ is America/Los_Angeles; host test-runner TZ is whatever CI uses (unpinned) —
    // fromTimestamps operates purely on the ISO instant, so the wall-clock components of the
    // ISO string sent to the mutation must be byte-identical to what was passed in, regardless
    // of host TZ. The bug this pins: `newStartTime.split('T')` + `ShiftInterval.create()`
    // re-anchors the HH:MM in the *host* TZ, silently shifting the instant.
    const { result } = renderPipeline([]);
    const shift = makeShift({ id: 'shift-tz' });

    // 23:00 restaurant-local the night before a DST fall-back, expressed as its UTC instant.
    const startIso = '2026-11-01T05:00:00.000Z'; // 22:00 America/Chicago (CDT, UTC-5) on Oct 31
    const endIso = '2026-11-01T14:00:00.000Z'; // 08:00 America/Chicago (CST, UTC-6) on Nov 1

    const outcome = await result.current.validateAndUpdateTime({
      shift,
      startIso,
      endIso,
      businessDate: '2026-10-31',
    });

    expect(outcome.updated).toBe(true);
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'shift-tz',
        start_time: startIso,
        end_time: endIso,
      }),
    );
  });
});

describe('useValidatedShiftMutations — forceUpdateTime', () => {
  it('mutates regardless of pending issues', async () => {
    const rpcConflicts: ConflictCheck[] = [
      { has_conflict: true, conflict_type: 'time-off', message: 'conflict' },
    ];
    const checkConflicts = vi.fn().mockResolvedValue({ conflicts: rpcConflicts, hasConflicts: true });
    const { result } = renderPipeline([], checkConflicts);
    const shift = makeShift({ id: 'shift-9' });

    const updated = await result.current.forceUpdateTime({
      shift,
      startIso: '2026-02-01T15:00:00.000Z',
      endIso: '2026-02-01T23:00:00.000Z',
      businessDate: '2026-02-01',
    });

    expect(updated).toBe(true);
    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects with LockedShiftError for a locked shift', async () => {
    const { result } = renderPipeline([]);
    const lockedShift = makeShift({ id: 'shift-locked', locked: true });

    await expect(
      result.current.forceUpdateTime({
        shift: lockedShift,
        startIso: '2026-02-01T15:00:00.000Z',
        endIso: '2026-02-01T23:00:00.000Z',
        businessDate: '2026-02-01',
      }),
    ).rejects.toBeInstanceOf(LockedShiftError);
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
  });
});

describe('useValidatedShiftMutations — validateAndReassign', () => {
  it('reassigns immediately when there are no issues', async () => {
    const { result } = renderPipeline([]);
    const shift = makeShift({ id: 'shift-9' });

    const outcome = await result.current.validateAndReassign({
      shift,
      newEmployeeId: 'emp-2',
    });

    expect(outcome.reassigned).toBe(true);
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'shift-9', employee_id: 'emp-2' }),
    );
  });

  it('returns pending issues without mutating when the new employee has a conflict', async () => {
    const rpcConflicts: ConflictCheck[] = [
      { has_conflict: true, conflict_type: 'time-off', message: 'Employee has approved time-off' },
    ];
    const checkConflicts = vi.fn().mockResolvedValue({ conflicts: rpcConflicts, hasConflicts: true });
    const { result } = renderPipeline([], checkConflicts);
    const shift = makeShift({ id: 'shift-9' });

    const outcome = await result.current.validateAndReassign({ shift, newEmployeeId: 'emp-2' });

    expect(outcome.reassigned).toBe(false);
    expect(outcome.pendingConflicts).toEqual(rpcConflicts);
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
  });

  it('rejects with LockedShiftError for a locked shift', async () => {
    const { result } = renderPipeline([]);
    const lockedShift = makeShift({ id: 'shift-locked', locked: true });

    await expect(
      result.current.validateAndReassign({ shift: lockedShift, newEmployeeId: 'emp-2' }),
    ).rejects.toBeInstanceOf(LockedShiftError);
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
  });
});

describe('useValidatedShiftMutations — forceReassign', () => {
  it('mutates regardless of pending issues', async () => {
    const rpcConflicts: ConflictCheck[] = [
      { has_conflict: true, conflict_type: 'time-off', message: 'conflict' },
    ];
    const checkConflicts = vi.fn().mockResolvedValue({ conflicts: rpcConflicts, hasConflicts: true });
    const { result } = renderPipeline([], checkConflicts);
    const shift = makeShift({ id: 'shift-9' });

    const reassigned = await result.current.forceReassign({ shift, newEmployeeId: 'emp-2' });

    expect(reassigned).toBe(true);
    expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects with LockedShiftError for a locked shift', async () => {
    const { result } = renderPipeline([]);
    const lockedShift = makeShift({ id: 'shift-locked', locked: true });

    await expect(
      result.current.forceReassign({ shift: lockedShift, newEmployeeId: 'emp-2' }),
    ).rejects.toBeInstanceOf(LockedShiftError);
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
  });
});

describe('useValidatedShiftMutations — deleteShift', () => {
  it('delegates to useDeleteShift with id + restaurantId', () => {
    const shift = makeShift({ id: 'shift-9', locked: false });
    const { result } = renderPipeline([shift]);

    result.current.deleteShift('shift-9');

    expect(mockDeleteMutate).toHaveBeenCalledWith({ id: 'shift-9', restaurantId: 'rest-1' });
  });

  it('throws a LockedShiftError and does not call the mutation for a locked shift', () => {
    const lockedShift = makeShift({ id: 'shift-locked', locked: true });
    const { result } = renderPipeline([lockedShift]);

    expect(() => result.current.deleteShift('shift-locked')).toThrow(LockedShiftError);
    expect(mockDeleteMutate).not.toHaveBeenCalled();
  });
});

describe('useValidatedShiftMutations — validationResult / clearValidation', () => {
  it('clearValidation resets validationResult to null', async () => {
    const existing = makeShift();
    const { result } = renderPipeline([existing]);

    await result.current.validateAndCreate({
      employeeId: 'emp-1',
      date: '2026-01-15',
      startTime: '18:00',
      endTime: '20:00',
      position: 'server',
    });

    await waitFor(() => expect(result.current.validationResult).not.toBeNull());

    result.current.clearValidation();

    await waitFor(() => expect(result.current.validationResult).toBeNull());
  });
});
