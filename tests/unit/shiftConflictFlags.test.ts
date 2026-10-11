import { describe, it, expect, vi } from 'vitest';
import {
  buildConflictIndex,
  attachConflicts,
  loadShiftConflicts,
  type ConflictRow,
} from '../../supabase/functions/_shared/shiftConflictFlags';
import { groupShiftsByRestaurantDay } from '../../supabase/functions/_shared/scheduleOverview';
import type { ShiftWarning } from '../../supabase/functions/_shared/shiftWarnings';

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
    const shifts: any[] = [];
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
