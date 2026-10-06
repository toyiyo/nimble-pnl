import { describe, it, expect } from 'vitest';

import {
  DEFAULT_TEMPLATE_NAME,
  addEmployeeRow,
  addShifts,
  buildGrid,
  dayTotals,
  draftFromTemplate,
  emptyDraft,
  employeeHours,
  findOverlap,
  isValidDayOffset,
  totalShiftHours,
  formatHours,
  formatShortTime,
  isDraftDirty,
  normalizeTime,
  removeEmployeeRow,
  removeShift,
  shiftHours,
  toSnapshot,
  updateShift,
} from '@/lib/weekTemplateDraft';

import type { DraftShiftInput, SchedulePlanTemplate, TemplateShiftSnapshot } from '@/types/scheduling';

const ALICE = 'emp-alice';
const BOB = 'emp-bob';

const input = (overrides: Partial<DraftShiftInput> = {}): DraftShiftInput => ({
  start_time: '09:00',
  end_time: '17:00',
  break_duration: 30,
  position: 'Server',
  notes: null,
  ...overrides,
});

const snap = (overrides: Partial<TemplateShiftSnapshot> = {}): TemplateShiftSnapshot => ({
  day_offset: 0,
  start_time: '09:00:00',
  end_time: '17:00:00',
  break_duration: 30,
  position: 'Server',
  employee_id: ALICE,
  employee_name: 'Alice',
  notes: null,
  ...overrides,
});

const template = (shifts: TemplateShiftSnapshot[], overrides: Partial<SchedulePlanTemplate> = {}): SchedulePlanTemplate => ({
  id: 'tmpl-1',
  restaurant_id: 'rest-1',
  name: 'Weekday Lunch',
  shifts,
  shift_count: shifts.length,
  created_at: '2026-10-01T10:00:00.123456+00:00',
  updated_at: '2026-10-01T10:00:00.123456+00:00',
  ...overrides,
});

describe('normalizeTime', () => {
  it('adds seconds to HH:MM', () => {
    expect(normalizeTime('09:00')).toBe('09:00:00');
  });
  it('keeps HH:MM:SS', () => {
    expect(normalizeTime('22:30:15')).toBe('22:30:15');
  });
});

describe('emptyDraft', () => {
  it('starts unsaved with no rows and no shifts', () => {
    const d = emptyDraft();
    expect(d).toMatchObject({ id: null, name: DEFAULT_TEMPLATE_NAME, updatedAt: null, rowEmployeeIds: [], shifts: [] });
  });
});

describe('draftFromTemplate', () => {
  it('keeps the raw updated_at string (no Date round trip)', () => {
    const d = draftFromTemplate(template([snap()]));
    expect(d.updatedAt).toBe('2026-10-01T10:00:00.123456+00:00');
  });

  it('makes one row per employee, sorted by name, and gives each shift a unique key', () => {
    const d = draftFromTemplate(template([
      snap({ employee_id: BOB, employee_name: 'Bob' }),
      snap({ employee_id: ALICE, employee_name: 'Alice', day_offset: 1 }),
      snap({ employee_id: ALICE, employee_name: 'Alice', day_offset: 2 }),
    ]));
    expect(d.rowEmployeeIds).toEqual([ALICE, BOB]);
    expect(new Set(d.shifts.map((s) => s.key)).size).toBe(3);
  });
});

describe('row and shift edits', () => {
  it('addEmployeeRow adds a row once', () => {
    const d = addEmployeeRow(addEmployeeRow(emptyDraft(), ALICE), ALICE);
    expect(d.rowEmployeeIds).toEqual([ALICE]);
  });

  it('addShifts adds one shift per day, normalizes times, and adds the row', () => {
    const d = addShifts(emptyDraft(), ALICE, 'Alice', input(), [0, 2, 4]);
    expect(d.shifts.map((s) => s.day_offset)).toEqual([0, 2, 4]);
    expect(d.shifts.every((s) => s.start_time === '09:00:00' && s.end_time === '17:00:00')).toBe(true);
    expect(d.rowEmployeeIds).toEqual([ALICE]);
  });

  it('updateShift changes only the target shift and keeps other shift objects', () => {
    const d = addShifts(emptyDraft(), ALICE, 'Alice', input(), [0, 1]);
    const [first, second] = d.shifts;
    const next = updateShift(d, first.key, input({ start_time: '10:00', position: 'Host' }));
    expect(next.shifts[0]).toMatchObject({ start_time: '10:00:00', position: 'Host', day_offset: 0 });
    expect(next.shifts[1]).toBe(second);
  });

  it('removeShift deletes the shift and keeps the row', () => {
    const d = addShifts(emptyDraft(), ALICE, 'Alice', input(), [0]);
    const next = removeShift(d, d.shifts[0].key);
    expect(next.shifts).toEqual([]);
    expect(next.rowEmployeeIds).toEqual([ALICE]);
  });

  it('removeEmployeeRow deletes the row and its shifts only', () => {
    let d = addShifts(emptyDraft(), ALICE, 'Alice', input(), [0, 1]);
    d = addShifts(d, BOB, 'Bob', input(), [0]);
    const next = removeEmployeeRow(d, ALICE);
    expect(next.rowEmployeeIds).toEqual([BOB]);
    expect(next.shifts.map((s) => s.employee_id)).toEqual([BOB]);
  });
});

describe('findOverlap', () => {
  const base = addShifts(emptyDraft(), ALICE, 'Alice', input({ start_time: '09:00', end_time: '17:00' }), [0]);

  it('finds an overlap on the same day', () => {
    expect(findOverlap(base, ALICE, 0, '16:00', '20:00')).not.toBeNull();
  });

  it('allows a shift that starts when the other ends', () => {
    expect(findOverlap(base, ALICE, 0, '17:00', '20:00')).toBeNull();
  });

  it('ignores other employees', () => {
    expect(findOverlap(base, BOB, 0, '10:00', '12:00')).toBeNull();
  });

  it('ignores the shift being edited', () => {
    expect(findOverlap(base, ALICE, 0, '10:00', '12:00', base.shifts[0].key)).toBeNull();
  });

  it('finds an overnight shift that runs into the next morning', () => {
    const d = addShifts(emptyDraft(), ALICE, 'Alice', input({ start_time: '22:00', end_time: '02:00' }), [0]);
    expect(findOverlap(d, ALICE, 1, '01:00', '05:00')).not.toBeNull();
    expect(findOverlap(d, ALICE, 1, '02:00', '05:00')).toBeNull();
  });

  it('does not let a Sunday overnight shift wrap to Monday', () => {
    const d = addShifts(emptyDraft(), ALICE, 'Alice', input({ start_time: '22:00', end_time: '04:00' }), [6]);
    expect(findOverlap(d, ALICE, 0, '01:00', '05:00')).toBeNull();
  });

  it('does not flag two normal shifts on consecutive days', () => {
    expect(findOverlap(base, ALICE, 1, '09:00', '17:00')).toBeNull();
  });
});

describe('hours and totals', () => {
  it('shiftHours subtracts the break', () => {
    expect(shiftHours({ start_time: '09:00:00', end_time: '17:00:00', break_duration: 30 })).toBe(7.5);
  });

  it('shiftHours handles an overnight shift', () => {
    expect(shiftHours({ start_time: '22:00:00', end_time: '02:00:00', break_duration: 0 })).toBe(4);
  });

  it('shiftHours never goes below zero', () => {
    expect(shiftHours({ start_time: '09:00:00', end_time: '09:30:00', break_duration: 60 })).toBe(0);
  });

  it('dayTotals and employeeHours add up the shifts', () => {
    let d = addShifts(emptyDraft(), ALICE, 'Alice', input(), [0, 1]);
    d = addShifts(d, BOB, 'Bob', input({ break_duration: 0 }), [0]);
    const totals = dayTotals(d);
    expect(totals[0]).toEqual({ count: 2, hours: 15.5 });
    expect(totals[1]).toEqual({ count: 1, hours: 7.5 });
    expect(totals[6]).toEqual({ count: 0, hours: 0 });
    expect(employeeHours(d).get(ALICE)).toBe(15);
    expect(employeeHours(d).get(BOB)).toBe(8);
  });
});

describe('buildGrid', () => {
  it('groups shifts by row and day, sorted by start time', () => {
    let d = addShifts(emptyDraft(), ALICE, 'Alice', input({ start_time: '17:00', end_time: '21:00' }), [0]);
    d = addShifts(d, ALICE, 'Alice', input({ start_time: '08:00', end_time: '12:00' }), [0]);
    d = addEmployeeRow(d, BOB);
    const grid = buildGrid(d);
    expect(grid.get(ALICE)?.[0].map((s) => s.start_time)).toEqual(['08:00:00', '17:00:00']);
    expect(grid.get(BOB)?.every((cell) => cell.length === 0)).toBe(true);
  });
});

describe('toSnapshot', () => {
  it('strips keys, uses current employee names, and sorts by day and start', () => {
    let d = addShifts(emptyDraft(), ALICE, 'Old Alice', input({ start_time: '12:00', end_time: '16:00' }), [1]);
    d = addShifts(d, ALICE, 'Old Alice', input(), [0]);
    const out = toSnapshot(d, new Map([[ALICE, 'Alice Moreno']]));
    expect(out).toEqual([
      snap({ day_offset: 0, employee_name: 'Alice Moreno' }),
      snap({ day_offset: 1, start_time: '12:00:00', end_time: '16:00:00', employee_name: 'Alice Moreno' }),
    ]);
    expect(out[0]).not.toHaveProperty('key');
  });

  it('keeps the stored name when the employee is not in the list', () => {
    const d = addShifts(emptyDraft(), ALICE, 'Alice (former)', input(), [0]);
    expect(toSnapshot(d, new Map())[0].employee_name).toBe('Alice (former)');
  });
});

describe('isDraftDirty', () => {
  it('is false for a draft built from the saved template', () => {
    const t = template([snap(), snap({ day_offset: 3 })]);
    expect(isDraftDirty(draftFromTemplate(t), t)).toBe(false);
  });

  it('ignores empty rows', () => {
    const t = template([snap()]);
    expect(isDraftDirty(addEmployeeRow(draftFromTemplate(t), BOB), t)).toBe(false);
  });

  it('ignores HH:MM vs HH:MM:SS in the saved data', () => {
    const t = template([snap({ start_time: '09:00', end_time: '17:00' })]);
    expect(isDraftDirty(draftFromTemplate(t), t)).toBe(false);
  });

  it('is true after a name change (trimmed)', () => {
    const t = template([snap()]);
    expect(isDraftDirty({ ...draftFromTemplate(t), name: '  Weekday Lunch ' }, t)).toBe(false);
    expect(isDraftDirty({ ...draftFromTemplate(t), name: 'Brunch' }, t)).toBe(true);
  });

  it('is true after a shift edit', () => {
    const t = template([snap()]);
    const d = draftFromTemplate(t);
    expect(isDraftDirty(updateShift(d, d.shifts[0].key, input({ end_time: '18:00' })), t)).toBe(true);
  });

  it('for a new draft, is true only when it has shifts', () => {
    expect(isDraftDirty(emptyDraft(), null)).toBe(false);
    expect(isDraftDirty(addEmployeeRow(emptyDraft(), ALICE), null)).toBe(false);
    expect(isDraftDirty(addShifts(emptyDraft(), ALICE, 'Alice', input(), [0]), null)).toBe(true);
  });
});

describe('formatShortTime and formatHours', () => {
  it('formats times in 12-hour short form', () => {
    expect(['00:00:00', '09:00:00', '12:00:00', '13:30:00', '23:05'].map(formatShortTime)).toEqual(['12a', '9a', '12p', '1:30p', '11:05p']);
  });
  it('rounds hours to one decimal', () => {
    expect(formatHours(7.5)).toBe('7.5h');
    expect(formatHours(8)).toBe('8h');
    expect(formatHours(2 / 3)).toBe('0.7h');
  });
});

describe('templates with out-of-range day offsets', () => {
  it('isValidDayOffset accepts 0-6 only', () => {
    expect([-1, 0, 6, 7, 1.5].map(isValidDayOffset)).toEqual([false, true, true, false, false]);
  });

  it('draftFromTemplate ignores offsets outside 0-6, so the grid and totals do not throw', () => {
    const t = template([snap({ day_offset: -1 }), snap({ day_offset: 7 }), snap({ day_offset: 2 })]);
    const d = draftFromTemplate(t);
    expect(d.shifts.map((s) => s.day_offset)).toEqual([2]);
    expect(() => buildGrid(d)).not.toThrow();
    expect(dayTotals(d)[2].count).toBe(1);
    expect(isDraftDirty(d, t)).toBe(false);
  });

  it('totalShiftHours adds up shift hours', () => {
    expect(totalShiftHours([snap(), snap({ break_duration: 0 })])).toBe(15.5);
  });
});
