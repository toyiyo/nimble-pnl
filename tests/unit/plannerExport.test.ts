import { describe, it, expect } from 'vitest';
import {
  generatePlannerCSV,
  buildGridExportData,
  formatTime12,
  formatTemplateTime,
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
// formatTemplateTime
// ---------------------------------------------------------------------------

describe('formatTemplateTime', () => {
  it('formats morning time', () => {
    expect(formatTemplateTime('09:00:00')).toBe('9AM');
  });

  it('formats evening time', () => {
    expect(formatTemplateTime('17:00:00')).toBe('5PM');
  });

  it('formats noon', () => {
    expect(formatTemplateTime('12:00:00')).toBe('12PM');
  });

  it('formats midnight', () => {
    expect(formatTemplateTime('00:00:00')).toBe('12AM');
  });

  it('formats time with minutes', () => {
    expect(formatTemplateTime('09:30:00')).toBe('9:30AM');
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
// buildGridExportData
// ---------------------------------------------------------------------------

describe('buildGridExportData', () => {
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

  it('produces day headers with name and date', () => {
    const { dayHeaders } = buildGridExportData([], templates, WEEK_DAYS);
    expect(dayHeaders[0]).toBe('Mon 3/2');
    expect(dayHeaders[4]).toBe('Fri 3/6');
    expect(dayHeaders[5]).toBe('Sat 3/7');
    expect(dayHeaders).toHaveLength(7);
  });

  it('produces one row per template', () => {
    const twoTemplates = [
      ...templates,
      mockTemplate({
        id: 't2',
        name: 'Evening Cook',
        start_time: '16:00:00',
        end_time: '23:00:00',
        position: 'Cook',
        days: [1, 2, 3, 4, 5, 6],
      }),
    ];
    const { rows } = buildGridExportData([], twoTemplates, WEEK_DAYS);
    expect(rows).toHaveLength(2);
    expect(rows[0].shiftLabel).toContain('Morning Server');
    expect(rows[1].shiftLabel).toContain('Evening Cook');
  });

  it('includes hours in shift label', () => {
    const { rows } = buildGridExportData([], templates, WEEK_DAYS);
    expect(rows[0].shiftLabel).toBe('Morning Server (9AM\u20135PM)');
  });

  it('marks inactive days with em dash', () => {
    // Template is Mon-Fri, so Sat (index 5) and Sun (index 6) are inactive
    const { rows } = buildGridExportData([], templates, WEEK_DAYS);
    expect(rows[0].cells[5]).toBe('\u2014'); // Sat
    expect(rows[0].cells[6]).toBe('\u2014'); // Sun
  });

  it('shows empty string for active days with no shifts', () => {
    const { rows } = buildGridExportData([], templates, WEEK_DAYS);
    expect(rows[0].cells[0]).toBe(''); // Mon, no shifts
  });

  it('places employee names in correct day cells', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00', // Mon
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        employee: { id: 'e1', name: 'Alice' } as Shift['employee'],
      }),
      mockShift({
        start_time: '2026-03-04T09:00:00', // Wed
        end_time: '2026-03-04T17:00:00',
        position: 'Server',
        employee: { id: 'e2', name: 'Bob' } as Shift['employee'],
      }),
    ];

    const { rows } = buildGridExportData(shifts, templates, WEEK_DAYS);
    expect(rows[0].cells[0]).toBe('Alice');  // Mon
    expect(rows[0].cells[1]).toBe('');       // Tue (empty)
    expect(rows[0].cells[2]).toBe('Bob');    // Wed
  });

  it('stacks multiple employees in same cell sorted alphabetically', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        employee: { id: 'e2', name: 'Zelda' } as Shift['employee'],
      }),
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        employee: { id: 'e1', name: 'Alice' } as Shift['employee'],
      }),
    ];

    const { rows } = buildGridExportData(shifts, templates, WEEK_DAYS);
    expect(rows[0].cells[0]).toBe('Alice\nZelda');
  });

  it('excludes cancelled shifts', () => {
    const shifts = [
      mockShift({
        status: 'cancelled',
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
      }),
    ];

    const { rows } = buildGridExportData(shifts, templates, WEEK_DAYS);
    expect(rows[0].cells[0]).toBe(''); // cancelled shift excluded
  });

  it('shows "Unassigned" when employee is missing', () => {
    const shifts = [
      mockShift({
        employee: undefined,
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
      }),
    ];

    const { rows } = buildGridExportData(shifts, templates, WEEK_DAYS);
    expect(rows[0].cells[0]).toBe('Unassigned');
  });

  it('skips shifts that do not match any template', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T06:00:00', // 6AM, no template match
        end_time: '2026-03-02T14:00:00',
        position: 'Prep Cook',
      }),
    ];

    const { rows } = buildGridExportData(shifts, templates, WEEK_DAYS);
    // All cells for the one template should be empty (shift didn't match it)
    expect(rows[0].cells[0]).toBe('');
  });
});

// ---------------------------------------------------------------------------
// generatePlannerCSV (grid layout)
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

  it('generates CSV with grid header (Shift + day columns)', () => {
    const csv = generatePlannerCSV({
      shifts: [],
      templates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n');
    expect(lines[0]).toBe('Shift,Mon 3/2,Tue 3/3,Wed 3/4,Thu 3/5,Fri 3/6,Sat 3/7,Sun 3/8');
  });

  it('generates one row per template with employee names in day cells', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        employee: { id: 'e1', name: 'Alice' } as Shift['employee'],
      }),
    ];

    const csv = generatePlannerCSV({ shifts, templates, weekDays: WEEK_DAYS });
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 template row
    // First column: shift label, then Alice on Mon, empty Tue-Fri, dash Sat/Sun
    expect(lines[1]).toContain('Alice');
    expect(lines[1]).toContain('\u2014'); // em-dash for inactive days
  });

  it('joins multiple employees with " / " in CSV cells', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        employee: { id: 'e1', name: 'Alice' } as Shift['employee'],
      }),
      mockShift({
        start_time: '2026-03-02T09:00:00',
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        employee: { id: 'e2', name: 'Bob' } as Shift['employee'],
      }),
    ];

    const csv = generatePlannerCSV({ shifts, templates, weekDays: WEEK_DAYS });
    const lines = csv.split('\n');
    expect(lines[1]).toContain('Alice / Bob');
  });

  it('escapes shift labels containing parentheses in CSV', () => {
    const csv = generatePlannerCSV({
      shifts: [],
      templates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n');
    // The shift label has parentheses but no commas/quotes, so it stays unquoted
    expect(lines[1]).toMatch(/^Morning Server \(9AM/);
  });

  it('shows only template rows when no shifts exist', () => {
    const twoTemplates = [
      ...templates,
      mockTemplate({
        id: 't2',
        name: 'Evening Cook',
        start_time: '16:00:00',
        end_time: '23:00:00',
        position: 'Cook',
        days: [1, 2, 3, 4, 5, 6],
      }),
    ];

    const csv = generatePlannerCSV({
      shifts: [],
      templates: twoTemplates,
      weekDays: WEEK_DAYS,
    });

    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 template rows
  });
});
