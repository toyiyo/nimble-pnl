import { describe, it, expect } from 'vitest';
import {
  generatePlannerCSV,
  buildExportRows,
  formatTime12,
  getDayName,
  findTemplateForShift,
  escapeCSVCell,
} from '@/utils/plannerExport';
import type { Shift, ShiftTemplate } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

function mockShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    employee_id: 'e1',
    start_time: '2026-03-02T09:00:00',
    end_time: '2026-03-02T17:00:00',
    break_duration: 30,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    employee: {
      id: 'e1',
      restaurant_id: 'r1',
      name: 'Alice Smith',
      position: 'Server',
      status: 'active',
      is_active: true,
      compensation_type: 'hourly',
      hourly_rate: 1500,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Shift['employee'],
    ...overrides,
  } as Shift;
}

function mockTemplate(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: 't1',
    restaurant_id: 'r1',
    name: 'Morning Server',
    days: [1, 2, 3, 4, 5], // Mon–Fri
    start_time: '09:00:00',
    end_time: '17:00:00',
    break_duration: 30,
    position: 'Server',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const WEEK_DAYS = [
  '2026-03-02', // Mon
  '2026-03-03', // Tue
  '2026-03-04', // Wed
  '2026-03-05', // Thu
  '2026-03-06', // Fri
  '2026-03-07', // Sat
  '2026-03-08', // Sun
];

// ---------------------------------------------------------------------------
// formatTime12
// ---------------------------------------------------------------------------

describe('formatTime12', () => {
  it('formats morning hour without minutes', () => {
    expect(formatTime12('2026-03-02T09:00:00')).toBe('9AM');
  });

  it('formats afternoon hour without minutes', () => {
    expect(formatTime12('2026-03-02T17:00:00')).toBe('5PM');
  });

  it('formats noon', () => {
    expect(formatTime12('2026-03-02T12:00:00')).toBe('12PM');
  });

  it('formats midnight', () => {
    expect(formatTime12('2026-03-03T00:00:00')).toBe('12AM');
  });

  it('formats times with minutes', () => {
    expect(formatTime12('2026-03-02T09:30:00')).toBe('9:30AM');
  });

  it('formats 1PM correctly', () => {
    expect(formatTime12('2026-03-02T13:00:00')).toBe('1PM');
  });
});

// ---------------------------------------------------------------------------
// getDayName
// ---------------------------------------------------------------------------

describe('getDayName', () => {
  it('returns "Mon" for Monday date', () => {
    expect(getDayName('2026-03-02')).toBe('Mon');
  });

  it('returns "Fri" for Friday date', () => {
    expect(getDayName('2026-03-06')).toBe('Fri');
  });

  it('returns "Sun" for Sunday date', () => {
    expect(getDayName('2026-03-08')).toBe('Sun');
  });

  it('returns "Sat" for Saturday date', () => {
    expect(getDayName('2026-03-07')).toBe('Sat');
  });
});

// ---------------------------------------------------------------------------
// escapeCSVCell
// ---------------------------------------------------------------------------

describe('escapeCSVCell', () => {
  it('returns plain strings unchanged', () => {
    expect(escapeCSVCell('Alice Smith')).toBe('Alice Smith');
  });

  it('wraps cells containing commas in quotes', () => {
    expect(escapeCSVCell('Smith, Alice')).toBe('"Smith, Alice"');
  });

  it('wraps cells containing quotes and escapes inner quotes', () => {
    expect(escapeCSVCell('She said "hello"')).toBe('"She said ""hello"""');
  });

  it('wraps cells containing newlines', () => {
    expect(escapeCSVCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
  });

  it('handles empty string', () => {
    expect(escapeCSVCell('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// findTemplateForShift
// ---------------------------------------------------------------------------

describe('findTemplateForShift', () => {
  const templates = [
    mockTemplate({
      id: 't1',
      name: 'Morning Server',
      start_time: '09:00:00',
      end_time: '17:00:00',
      position: 'Server',
      days: [1, 2, 3, 4, 5],
    }),
    mockTemplate({
      id: 't2',
      name: 'Evening Cook',
      start_time: '16:00:00',
      end_time: '23:00:00',
      position: 'Cook',
      days: [1, 2, 3, 4, 5, 6],
    }),
  ];

  it('finds matching template by time, position, and day', () => {
    const shift = mockShift({
      start_time: '2026-03-02T09:00:00', // Monday
      end_time: '2026-03-02T17:00:00',
      position: 'Server',
    });
    const result = findTemplateForShift(shift, templates);
    expect(result).toBeDefined();
    expect(result!.id).toBe('t1');
  });

  it('returns undefined when position does not match', () => {
    const shift = mockShift({
      start_time: '2026-03-02T09:00:00',
      end_time: '2026-03-02T17:00:00',
      position: 'Bartender',
    });
    expect(findTemplateForShift(shift, templates)).toBeUndefined();
  });

  it('returns undefined when day is not in template days', () => {
    const shift = mockShift({
      start_time: '2026-03-07T09:00:00', // Saturday = 6
      end_time: '2026-03-07T17:00:00',
      position: 'Server',
    });
    // t1 only covers Mon-Fri (days [1,2,3,4,5]), Saturday is 6
    expect(findTemplateForShift(shift, templates)).toBeUndefined();
  });

  it('returns undefined when times do not match', () => {
    const shift = mockShift({
      start_time: '2026-03-02T10:00:00', // 10am, not 9am
      end_time: '2026-03-02T17:00:00',
      position: 'Server',
    });
    expect(findTemplateForShift(shift, templates)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildExportRows
// ---------------------------------------------------------------------------

describe('buildExportRows', () => {
  const templates = [
    mockTemplate({
      id: 't1',
      name: 'Morning Server',
      start_time: '09:00:00',
      end_time: '17:00:00',
      position: 'Server',
      days: [1, 2, 3, 4, 5],
    }),
  ];

  it('builds rows from shifts with employee and template data', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        break_duration: 30,
        employee: {
          id: 'e1',
          name: 'Alice Smith',
          position: 'Server',
        } as Shift['employee'],
      }),
    ];

    const rows = buildExportRows(shifts, templates, WEEK_DAYS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      employee: 'Alice Smith',
      shift: 'Morning Server',
      day: 'Mon',
      date: '2026-03-02',
      start: '9AM',
      end: '5PM',
      position: 'Server',
      break: '30 min',
    });
  });

  it('excludes cancelled shifts', () => {
    const shifts = [
      mockShift({ status: 'cancelled' }),
      mockShift({
        id: 's2',
        start_time: '2026-03-03T09:00:00',
        end_time: '2026-03-03T17:00:00',
        status: 'scheduled',
      }),
    ];

    const rows = buildExportRows(shifts, templates, WEEK_DAYS);
    expect(rows).toHaveLength(1);
  });

  it('uses "Unassigned" for shifts without template match', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T06:00:00',
        end_time: '2026-03-02T14:00:00',
        position: 'Prep Cook',
      }),
    ];

    const rows = buildExportRows(shifts, templates, WEEK_DAYS);
    expect(rows).toHaveLength(1);
    expect(rows[0].shift).toBe('—');
  });

  it('uses "Unassigned" when employee is missing', () => {
    const shifts = [
      mockShift({
        employee: undefined,
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
      }),
    ];

    const rows = buildExportRows(shifts, templates, WEEK_DAYS);
    expect(rows[0].employee).toBe('Unassigned');
  });

  it('shows "0 min" when break_duration is 0', () => {
    const shifts = [
      mockShift({
        break_duration: 0,
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
      }),
    ];

    const rows = buildExportRows(shifts, templates, WEEK_DAYS);
    expect(rows[0].break).toBe('0 min');
  });

  it('sorts rows by date then employee name', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-03T09:00:00',
        end_time: '2026-03-03T17:00:00',
        employee: { id: 'e1', name: 'Zelda' } as Shift['employee'],
      }),
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        employee: { id: 'e2', name: 'Alice' } as Shift['employee'],
      }),
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        employee: { id: 'e3', name: 'Bob' } as Shift['employee'],
      }),
    ];

    const rows = buildExportRows(shifts, templates, WEEK_DAYS);
    expect(rows.map((r) => r.employee)).toEqual(['Alice', 'Bob', 'Zelda']);
    expect(rows.map((r) => r.date)).toEqual(['2026-03-02', '2026-03-02', '2026-03-03']);
  });
});

// ---------------------------------------------------------------------------
// generatePlannerCSV
// ---------------------------------------------------------------------------

describe('generatePlannerCSV', () => {
  const templates = [
    mockTemplate({
      id: 't1',
      name: 'Morning Server',
      start_time: '09:00:00',
      end_time: '17:00:00',
      position: 'Server',
      days: [1, 2, 3, 4, 5],
    }),
  ];

  it('generates CSV with header row', () => {
    const csv = generatePlannerCSV({
      shifts: [],
      templates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n');
    expect(lines[0]).toBe('Employee,Shift,Day,Date,Start,End,Position,Break');
  });

  it('generates CSV with data rows', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        break_duration: 30,
        employee: {
          id: 'e1',
          name: 'Alice Smith',
          position: 'Server',
        } as Shift['employee'],
      }),
    ];

    const csv = generatePlannerCSV({
      shifts,
      templates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('Alice Smith,Morning Server,Mon,2026-03-02,9AM,5PM,Server,30 min');
  });

  it('escapes CSV cells with commas', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        employee: {
          id: 'e1',
          name: 'Smith, Alice',
          position: 'Server',
        } as Shift['employee'],
      }),
    ];

    const csv = generatePlannerCSV({
      shifts,
      templates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n');
    expect(lines[1]).toContain('"Smith, Alice"');
  });

  it('returns only header when no non-cancelled shifts', () => {
    const shifts = [mockShift({ status: 'cancelled' })];

    const csv = generatePlannerCSV({
      shifts,
      templates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('Employee,Shift,Day,Date,Start,End,Position,Break');
  });

  it('handles multiple shifts across multiple days', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        employee: { id: 'e1', name: 'Alice' } as Shift['employee'],
      }),
      mockShift({
        start_time: '2026-03-03T09:00:00',
        end_time: '2026-03-03T17:00:00',
        employee: { id: 'e1', name: 'Alice' } as Shift['employee'],
      }),
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        employee: { id: 'e2', name: 'Bob' } as Shift['employee'],
      }),
    ];

    const csv = generatePlannerCSV({
      shifts,
      templates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n').filter(Boolean);
    // Header + 3 data rows
    expect(lines).toHaveLength(4);
  });
});
