/**
 * Unit tests: ShiftDialog save path goes through usePublishedShiftGuard's
 * `guardShiftChange` instead of calling the mutation directly.
 * Design: docs/superpowers/specs/2026-08-15-quiet-publish-live-edit-design.md
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ShiftDialog } from '@/components/ShiftDialog';
import { Shift } from '@/types/scheduling';

const mockCreateMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockUpdateMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockUpdateSeriesMutate = vi.fn();
const mockUpdateSeriesMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock('@/hooks/useShifts', () => ({
  useCreateShift: () => ({ mutate: mockCreateMutate, isPending: false }),
  // ShiftDialog awaits `mutateAsync` on the guarded edit path (a fresh
  // SELECT for the change-log row follows right after `run` resolves), so
  // both the sync and async forms need a mock here.
  useUpdateShift: () => ({
    mutate: mockUpdateMutate,
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  }),
  useUpdateShiftSeries: () => ({
    mutate: mockUpdateSeriesMutate,
    mutateAsync: mockUpdateSeriesMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    employees: [
      { id: 'emp-1', name: 'Alex Rivera', position: 'Server', is_active: true },
      { id: 'emp-2', name: 'Jamie Lee', position: 'Cook', is_active: true },
    ],
  }),
}));

vi.mock('@/hooks/useConflictDetection', () => ({
  useCheckConflicts: () => ({ conflicts: [], hasConflicts: false }),
}));

const lockedShift: Shift = {
  id: 'shift-1',
  restaurant_id: 'rest-1',
  employee_id: 'emp-1',
  start_time: '2026-08-17T17:00:00.000Z',
  end_time: '2026-08-17T22:00:00.000Z',
  break_duration: 30,
  position: 'Server',
  status: 'scheduled',
  is_published: true,
  locked: true,
  source: 'manual',
  created_at: '2026-08-15T00:00:00.000Z',
  updated_at: '2026-08-15T00:00:00.000Z',
};

describe('ShiftDialog save through the guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes an edit to a published shift through guardShiftChange, not the mutation directly', () => {
    const guardShiftChange = vi.fn();

    render(
      <ShiftDialog
        open
        onOpenChange={() => {}}
        shift={lockedShift}
        restaurantId="rest-1"
        timezone="UTC"
        guardShiftChange={guardShiftChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Update Shift' }));

    expect(guardShiftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        shiftId: 'shift-1',
        employeeName: 'Alex Rivera',
        run: expect.any(Function),
      })
    );
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });

  it('runs the update with allowPublished passed through once the guard confirms', async () => {
    const guardShiftChange = vi.fn();

    render(
      <ShiftDialog
        open
        onOpenChange={() => {}}
        shift={lockedShift}
        restaurantId="rest-1"
        timezone="UTC"
        guardShiftChange={guardShiftChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Update Shift' }));

    const { run } = guardShiftChange.mock.calls[0][0];
    await run({ allowPublished: true });

    // `run` awaits `mutateAsync`, not the fire-and-forget `mutate` — the
    // guard's post-save change-log lookup depends on the UPDATE having
    // actually committed by the time `run` resolves.
    expect(mockUpdateMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'shift-1', allowPublished: true })
    );
    expect(mockUpdateMutate).not.toHaveBeenCalled();
  });
});
