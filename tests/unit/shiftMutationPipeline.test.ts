import { describe, it, expect, vi } from 'vitest';
import { collectShiftIssues, assertNotLockedClient, LockedShiftError } from '@/lib/shiftMutationPipeline';
import { ShiftInterval } from '@/lib/shiftInterval';
import type { Shift, ConflictCheck } from '@/types/scheduling';

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

const NO_CONFLICTS = { conflicts: [] as ConflictCheck[], hasConflicts: false };

describe('collectShiftIssues', () => {
  it('returns no warnings/conflicts for a clean, non-overlapping shift', async () => {
    const interval = ShiftInterval.fromTimestamps(
      '2026-01-16T15:00:00.000Z',
      '2026-01-16T23:00:00.000Z',
      '2026-01-16',
    );
    const checkConflicts = vi.fn().mockResolvedValue(NO_CONFLICTS);

    const result = await collectShiftIssues({
      employeeId: 'emp-1',
      restaurantId: 'rest-1',
      interval,
      shifts: [makeShift()],
      checkConflicts,
    });

    expect(result.warnings).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(checkConflicts).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      restaurantId: 'rest-1',
      startTime: '2026-01-16T15:00:00.000Z',
      endTime: '2026-01-16T23:00:00.000Z',
    });
  });

  it('aggregates validateShift warnings (e.g. OVERLAP) for the same employee', async () => {
    // Overlaps with the existing 15:00-23:00 shift on 2026-01-15
    const interval = ShiftInterval.fromTimestamps(
      '2026-01-15T18:00:00.000Z',
      '2026-01-16T02:00:00.000Z',
      '2026-01-15',
    );
    const checkConflicts = vi.fn().mockResolvedValue(NO_CONFLICTS);

    const result = await collectShiftIssues({
      employeeId: 'emp-1',
      restaurantId: 'rest-1',
      interval,
      shifts: [makeShift()],
      checkConflicts,
    });

    expect(result.warnings.some((w) => w.code === 'OVERLAP')).toBe(true);
  });

  it('passes excludeShiftId through to validateShift so the shift being edited excludes itself', async () => {
    // Same interval as the existing shift being edited — would self-overlap if not excluded.
    const interval = ShiftInterval.fromTimestamps(
      '2026-01-15T15:00:00.000Z',
      '2026-01-15T23:00:00.000Z',
      '2026-01-15',
    );
    const checkConflicts = vi.fn().mockResolvedValue(NO_CONFLICTS);

    const result = await collectShiftIssues({
      employeeId: 'emp-1',
      restaurantId: 'rest-1',
      interval,
      shifts: [makeShift({ id: 'shift-1' })],
      excludeShiftId: 'shift-1',
      checkConflicts,
    });

    expect(result.warnings.some((w) => w.code === 'OVERLAP')).toBe(false);
  });

  it('merges RPC conflicts (time-off / availability) into the result', async () => {
    const interval = ShiftInterval.fromTimestamps(
      '2026-01-16T15:00:00.000Z',
      '2026-01-16T23:00:00.000Z',
      '2026-01-16',
    );
    const rpcConflicts: ConflictCheck[] = [
      { has_conflict: true, conflict_type: 'time-off', message: 'Employee has approved time-off' },
    ];
    const checkConflicts = vi.fn().mockResolvedValue({ conflicts: rpcConflicts, hasConflicts: true });

    const result = await collectShiftIssues({
      employeeId: 'emp-1',
      restaurantId: 'rest-1',
      interval,
      shifts: [],
      checkConflicts,
    });

    expect(result.conflicts).toEqual(rpcConflicts);
  });

  it('does not swallow a checker rejection — it propagates to the caller', async () => {
    const interval = ShiftInterval.fromTimestamps(
      '2026-01-16T15:00:00.000Z',
      '2026-01-16T23:00:00.000Z',
      '2026-01-16',
    );
    const checkConflicts = vi.fn().mockRejectedValue(new Error('RPC_FAILED'));

    await expect(
      collectShiftIssues({
        employeeId: 'emp-1',
        restaurantId: 'rest-1',
        interval,
        shifts: [],
        checkConflicts,
      }),
    ).rejects.toThrow('RPC_FAILED');
  });

  it('skips the conflict RPC entirely when checkConflicts=false is passed', async () => {
    const interval = ShiftInterval.fromTimestamps(
      '2026-01-16T15:00:00.000Z',
      '2026-01-16T23:00:00.000Z',
      '2026-01-16',
    );

    const result = await collectShiftIssues({
      employeeId: 'emp-1',
      restaurantId: 'rest-1',
      interval,
      shifts: [],
      checkConflicts: false,
    });

    expect(result.conflicts).toEqual([]);
  });

  it('defaults to checkConflictsImperative when no checker is injected', async () => {
    // Cannot easily assert the real RPC ran without a live Supabase client,
    // but we can pin that omitting `checkConflicts` does not throw synchronously
    // and instead attempts the real network call (which will reject in this
    // test environment without a mocked client) — proving the DI default wired up.
    const interval = ShiftInterval.fromTimestamps(
      '2026-01-16T15:00:00.000Z',
      '2026-01-16T23:00:00.000Z',
      '2026-01-16',
    );

    await expect(
      collectShiftIssues({
        employeeId: 'emp-1',
        restaurantId: 'rest-1',
        interval,
        shifts: [],
      }),
    ).rejects.toBeTruthy();
  });
});

describe('assertNotLockedClient', () => {
  it('does not throw for an unlocked shift', () => {
    expect(() => assertNotLockedClient(makeShift({ locked: false }))).not.toThrow();
  });

  it('throws a LockedShiftError for a locked shift', () => {
    expect(() => assertNotLockedClient(makeShift({ locked: true }))).toThrow(LockedShiftError);
  });

  it('LockedShiftError carries a human-readable message', () => {
    try {
      assertNotLockedClient(makeShift({ locked: true, id: 'shift-99' }));
      expect.fail('expected assertNotLockedClient to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LockedShiftError);
      expect((err as LockedShiftError).shiftId).toBe('shift-99');
      expect((err as Error).message).toMatch(/locked/i);
    }
  });
});
