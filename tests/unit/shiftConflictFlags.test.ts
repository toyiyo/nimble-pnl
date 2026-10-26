import { describe, it, expect, vi } from 'vitest';
import {
  buildConflictIndex,
  attachConflicts,
  loadShiftConflicts,
  loadNeighborShifts,
  withNeighbors,
  compactConflictsToFit,
  type ConflictRow,
} from '../../supabase/functions/_shared/shiftConflictFlags';
import { groupShiftsByRestaurantDay } from '../../supabase/functions/_shared/scheduleOverview';
import { findShiftWarnings, type ShiftWarning, type WarnShift } from '../../supabase/functions/_shared/shiftWarnings';

interface FixtureShift extends WarnShift {
  position: string;
  employee: { name: string; position: string };
}

const row = (shift_id: string, conflict_type: 'time_off' | 'availability'): ConflictRow => ({
  shift_id,
  conflict_type,
  source: 'request',
  status: 'approved',
  message: 'Employee is off',
});

describe('buildConflictIndex', () => {
  it('merges RPC rows and warnings into one list per shift', () => {
    const warnings: ShiftWarning[] = [
      { shift_id: 'a', type: 'clopen', rule: 'editor', other_shift_id: 'b', rest_hours: 6.5 },
    ];
    const index = buildConflictIndex([row('a', 'time_off')], warnings);
    const list = index.get('a')!;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ type: 'time_off', rule: 'grid', source: 'request', status: 'approved' });
    expect(list[1]).toMatchObject({
      type: 'clopen',
      rule: 'editor',
      message: 'Only 6.5 h of rest after the previous shift',
    });
  });

  it('writes an overlap message', () => {
    const index = buildConflictIndex([], [
      { shift_id: 'a', type: 'overlap', rule: 'editor', other_shift_id: 'b' },
    ]);
    expect(index.get('a')![0].type).toBe('overlap');
    expect(index.get('a')![0].message).toMatch(/overlap/i);
  });
});

describe('attachConflicts', () => {
  it('omits the conflicts key when a shift has none and counts shifts, not rows', () => {
    const index = buildConflictIndex([row('a', 'time_off'), row('a', 'availability')], []);
    const out = attachConflicts([{ id: 'a' }, { id: 'b' }], index);
    expect(out.conflictedShiftCount).toBe(1);
    expect(out.shifts[0].conflicts).toHaveLength(2);
    expect('conflicts' in out.shifts[1]).toBe(false);
  });
});

describe('loadShiftConflicts', () => {
  it('calls the RPC with the expected params', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row('a', 'time_off')], error: null });
    const rows = await loadShiftConflicts({ rpc }, 'r1', 's', 'e');
    expect(rpc).toHaveBeenCalledWith('get_shift_conflicts', { p_restaurant_id: 'r1', p_start: 's', p_end: 'e' });
    expect(rows).toHaveLength(1);
  });

  it('throws on RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(loadShiftConflicts({ rpc }, 'r1', 's', 'e')).rejects.toThrow('Failed to fetch shift conflicts: boom');
  });
});

describe('overview size', () => {
  it('stays below 40,000 chars for 31 days, 25 employees, 2 shifts a day, 20% conflicted', () => {
    const shifts: FixtureShift[] = [];
    const rows: ConflictRow[] = [];
    let n = 0;
    for (let d = 1; d <= 31; d++) {
      for (let e = 0; e < 25; e++) {
        for (let k = 0; k < 2; k++) {
          const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
          const day = String(d).padStart(2, '0');
          shifts.push({
            id,
            employee_id: `emp-${e}`,
            start_time: `2026-10-${day}T${k ? '20' : '14'}:00:00Z`,
            end_time: `2026-10-${day}T${k ? '23' : '18'}:00:00Z`,
            status: 'scheduled',
            position: 'Server',
            employee: { name: `Employee ${e}`, position: 'Server' },
          });
          if (n % 5 === 0) rows.push({ ...row(id, 'time_off'), message: 'Approved time off overlaps this shift' });
          n++;
        }
      }
    }
    const index = buildConflictIndex(rows, []);
    const { shifts: withConflicts } = attachConflicts(shifts, index);
    const data = { shifts_by_date: groupShiftsByRestaurantDay(withConflicts, 'UTC') };
    const base = { shifts_by_date: groupShiftsByRestaurantDay(shifts, 'UTC') };
    // 1,550 shift rows alone are about 190,000 chars, so the plan's 40,000
    // cap on the whole payload cannot hold. Cap the cost the flags add (310 flagged shifts).
    const overhead = JSON.stringify(data).length - JSON.stringify(base).length;
    expect(overhead).toBeLessThan(50000);
    expect(JSON.stringify(data)).not.toContain('"notes"');
  });
});

// Review on PR 846: a shift next to the period edge can flag a shift inside it.
describe('neighbor shifts', () => {
  const ws = (id: string, start: string, end: string): WarnShift => ({
    id, employee_id: 'a', start_time: start, end_time: end, status: 'scheduled',
  });

  it('flags a clopen on the first period shift after a shift before the period', () => {
    const before = ws('prev', '2026-10-11T18:00:00Z', '2026-10-12T02:00:00Z');
    const first = ws('first', '2026-10-12T07:00:00Z', '2026-10-12T15:00:00Z');
    expect(findShiftWarnings([first])).toEqual([]);
    const index = buildConflictIndex([], findShiftWarnings(withNeighbors([first], [before])));
    const { shifts, conflictedShiftCount } = attachConflicts([first], index);
    expect(conflictedShiftCount).toBe(1);
    expect(shifts[0].conflicts?.[0]).toMatchObject({ type: 'clopen', rule: 'editor' });
  });

  it('does not add a neighbor that is already in the period list', () => {
    const s = ws('s1', '2026-10-12T07:00:00Z', '2026-10-12T15:00:00Z');
    expect(withNeighbors([s], [s])).toEqual([s]);
  });

  it('reads the rest window before the start and the day after the end', async () => {
    const calls: { filters: [string, string, unknown][] }[] = [];
    const supabase = {
      from: () => {
        const call = { filters: [] as [string, string, unknown][] };
        calls.push(call);
        const chain: Record<string, unknown> = {};
        for (const op of ['select', 'eq', 'neq', 'lt', 'gt', 'lte', 'limit']) {
          chain[op] = (c: string, v: unknown) => (call.filters.push([op, c, v]), chain);
        }
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
        return chain;
      },
    };
    await loadNeighborShifts(supabase, 'r1', '2026-10-12T05:00:00.000Z', '2026-10-19T04:59:59.999Z');
    const [before, after] = calls.map((c) => c.filters);
    expect(before).toContainEqual(['eq', 'restaurant_id', 'r1']);
    expect(before).toContainEqual(['neq', 'status', 'cancelled']);
    expect(before).toContainEqual(['lt', 'start_time', '2026-10-12T05:00:00.000Z']);
    expect(before).toContainEqual(['gt', 'end_time', '2026-10-11T21:00:00.000Z']);
    expect(after).toContainEqual(['gt', 'start_time', '2026-10-19T04:59:59.999Z']);
    expect(after).toContainEqual(['lte', 'start_time', '2026-10-20T04:59:59.999Z']);
  });
});

describe('compactConflictsToFit', () => {
  const data = {
    total_shifts: 1,
    shifts_by_date: {
      '2026-10-12': [{ id: 's1', conflicts: [{ type: 'clopen' as const, rule: 'editor' as const, message: 'm'.repeat(200) }] }],
    },
  };

  it('keeps the data when it fits', () => {
    expect(compactConflictsToFit(data, 40_000)).toBe(data);
  });

  it('deletes the conflict messages when the data is over the limit', () => {
    const out = compactConflictsToFit(data, 100);
    expect(out.conflict_messages_omitted).toBe(true);
    expect(out.shifts_by_date['2026-10-12'][0]).toEqual({ id: 's1', conflicts: [{ type: 'clopen', rule: 'editor' }] });
  });
});
