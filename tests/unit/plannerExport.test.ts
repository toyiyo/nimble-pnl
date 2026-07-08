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

  // Area-aware matching — mirrors the on-screen planner grid
  // (buildTemplateGridData). A cross-area unlinked shift must NOT borrow
  // another area's template row in the exported file.
  describe('area compatibility', () => {
    // Josiah repro: Cold Stone is the only exact time/position match, but the
    // shift belongs to a Wetzel's employee.
    const cscPrep = mockTemplate({
      id: 't-csc', name: 'Prep-weekend', start_time: '10:00:00', end_time: '16:00:00',
      position: 'Server', days: [0, 5, 6], area: 'Cold Stone',
    });
    const wtzOpen = mockTemplate({
      id: 't-wtz', name: 'Open-weekend-wtz', start_time: '10:00:00', end_time: '16:00:00',
      position: 'Server', days: [0, 5, 6], area: "Wetzel's",
    });
    // Saturday 2026-03-07, 10:00-16:00, Server
    const wtzShift = (overrides: Partial<Shift> = {}) => mockShift({
      start_time: '2026-03-07T10:00:00', end_time: '2026-03-07T16:00:00', position: 'Server',
      employee: { id: 'e-w', name: 'Josiah', area: "Wetzel's" } as Shift['employee'],
      ...overrides,
    });

    it('CRITICAL: should not match a cross-area template', () => {
      expect(findTemplateForShift(wtzShift(), [cscPrep])).toBeUndefined();
    });

    it('CRITICAL: should prefer the same-area template over a cross-area one listed first', () => {
      const result = findTemplateForShift(wtzShift(), [cscPrep, wtzOpen]);
      expect(result?.id).toBe('t-wtz');
    });

    it('CRITICAL: should prefer the same-area template over an area-agnostic one listed first', () => {
      const generic = mockTemplate({ ...cscPrep, id: 't-generic', area: null });
      const result = findTemplateForShift(wtzShift(), [generic, wtzOpen]);
      expect(result?.id).toBe('t-wtz');
    });

    it('should match permissively when the employee has no area', () => {
      const shift = wtzShift({ employee: { id: 'e-n', name: 'NoArea' } as Shift['employee'] });
      expect(findTemplateForShift(shift, [cscPrep])?.id).toBe('t-csc');
    });

    it('should match permissively when the template has no area', () => {
      const noArea = mockTemplate({ ...cscPrep, id: 't-none', area: null });
      expect(findTemplateForShift(wtzShift(), [noArea])?.id).toBe('t-none');
    });
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

  it('routes a shift that matches no template into an off-template row instead of dropping it', () => {
    const shifts = [
      mockShift({
        start_time: '2026-03-02T06:00:00', // 6AM, no template match
        end_time: '2026-03-02T14:00:00',
        position: 'Prep Cook',
      }),
    ];

    const { rows } = buildGridExportData(shifts, templates, WEEK_DAYS);
    // Not under any template row...
    expect(rows[0].cells[0]).toBe('');
    // ...but preserved in an off-template row (mockShift's default employee has
    // no area, so it lands under Unassigned).
    const offRow = rows.find((r) => r.shiftLabel.includes('Unassigned'));
    expect(offRow?.cells[0]).toBe('Alice Smith');
  });

  it('CRITICAL: should not place a cross-area shift into another area\'s template row', () => {
    // Josiah repro: a Wetzel's employee's unlinked Sat 10-16 Server shift must
    // not appear in the Cold Stone "Prep-weekend" row of the exported grid.
    const cscPrep = mockTemplate({
      id: 't-csc', name: 'Prep-weekend', start_time: '10:00:00', end_time: '16:00:00',
      position: 'Server', days: [0, 5, 6], area: 'Cold Stone',
    });
    const shifts = [
      mockShift({
        start_time: '2026-03-07T10:00:00', // Sat
        end_time: '2026-03-07T16:00:00',
        position: 'Server',
        employee: { id: 'e-w', name: 'Josiah', area: "Wetzel's" } as Shift['employee'],
      }),
    ];

    const { rows } = buildGridExportData(shifts, [cscPrep], WEEK_DAYS);
    // Saturday is WEEK_DAYS index 5; the Cold Stone row must stay empty there.
    expect(rows[0].cells[5]).toBe('');
  });

  it('CRITICAL: should keep an explicit cross-area cover under its linked template row', () => {
    // A Wetzel's employee deliberately assigned (shift_template_id) to the Cold
    // Stone template is a real cover — the export must place them under that row,
    // mirroring the on-screen grid, even though the areas differ. The area filter
    // only governs UNLINKED shifts, never an explicit assignment.
    const cscPrep = mockTemplate({
      id: 't-csc', name: 'Prep-weekend', start_time: '10:00:00', end_time: '16:00:00',
      position: 'Server', days: [0, 5, 6], area: 'Cold Stone',
    });
    const shifts = [
      mockShift({
        start_time: '2026-03-07T10:00:00', // Sat
        end_time: '2026-03-07T16:00:00',
        position: 'Server',
        shift_template_id: 't-csc',
        employee: { id: 'e-w', name: 'Josiah', area: "Wetzel's" } as Shift['employee'],
      }),
    ];

    const { rows } = buildGridExportData(shifts, [cscPrep], WEEK_DAYS);
    expect(rows[0].cells[5]).toBe('Josiah');
  });

  it('should route a shift whose explicit shift_template_id is archived to the off-template section', () => {
    // Mirrors the grid's __unmatched__ handling: an explicit link to a template
    // that is no longer active must NOT fall through to time-based matching, and
    // must still be preserved (in the off-template section), not dropped.
    const shifts = [
      mockShift({
        start_time: '2026-03-02T09:00:00', // Mon, would match t1 by time
        end_time: '2026-03-02T17:00:00',
        position: 'Server',
        shift_template_id: 'archived-id',
        employee: { id: 'e1', name: 'Alice' } as Shift['employee'],
      }),
    ];

    const { rows } = buildGridExportData(shifts, templates, WEEK_DAYS);
    // Must NOT appear under t1 via time-based fallback...
    expect(rows[0].cells[0]).toBe('');
    // ...but must be preserved in an off-template row (no area → Unassigned).
    const offRow = rows.find((r) => r.shiftLabel.includes('Unassigned'));
    expect(offRow?.cells[0]).toBe('Alice');
  });

  // Off-template section — parity with the on-screen grid's off-template lane.
  // A shift that doesn't resolve to a template must still appear in the export,
  // grouped by the employee's home area, not silently omitted.
  describe('off-template section', () => {
    const cscPrep = mockTemplate({
      id: 't-csc', name: 'Prep-weekend', start_time: '10:00:00', end_time: '16:00:00',
      position: 'Server', days: [0, 5, 6], area: 'Cold Stone',
    });
    // Saturday 2026-03-07 (WEEK_DAYS index 5), 10:00-16:00 Server.
    const sat = (name: string, area?: string) => mockShift({
      start_time: '2026-03-07T10:00:00', end_time: '2026-03-07T16:00:00', position: 'Server',
      employee: { id: name, name, area } as Shift['employee'],
    });

    it('CRITICAL: should place a cross-area unlinked shift in an off-template row for its home area', () => {
      const { rows } = buildGridExportData([sat('Josiah', "Wetzel's")], [cscPrep], WEEK_DAYS);
      const offRow = rows.find((r) => r.shiftLabel.includes("Wetzel's"));
      expect(offRow).toBeDefined();
      expect(offRow!.cells[5]).toBe('Josiah');
      // and NOT under the Cold Stone template row
      const cscRow = rows.find((r) => r.shiftLabel.startsWith('Prep-weekend'));
      expect(cscRow!.cells[5]).toBe('');
    });

    it('should label the off-template row Unassigned when the employee has no area', () => {
      // A no-area employee is area-compatible with any template, so to land
      // off-template the shift must fail to match for a non-area reason — here a
      // position no template covers.
      const noMatch = mockShift({
        start_time: '2026-03-07T10:00:00', end_time: '2026-03-07T16:00:00', position: 'Dishwasher',
        employee: { id: 'e0', name: 'Sam' } as Shift['employee'],
      });
      const { rows } = buildGridExportData([noMatch], [cscPrep], WEEK_DAYS);
      const offRow = rows.find((r) => r.shiftLabel.includes('Unassigned'));
      expect(offRow?.cells[5]).toBe('Sam');
    });

    it('should not add any off-template rows when every shift matches a template', () => {
      const { rows } = buildGridExportData([sat('Cory', 'Cold Stone')], [cscPrep], WEEK_DAYS);
      expect(rows).toHaveLength(1); // only the template row
      expect(rows[0].cells[5]).toBe('Cory');
    });

    it('should group multiple off-template employees by area and sort names within a cell', () => {
      const { rows } = buildGridExportData([sat('Zed', "Wetzel's"), sat('Amy', "Wetzel's")], [cscPrep], WEEK_DAYS);
      const offRow = rows.find((r) => r.shiftLabel.includes("Wetzel's"));
      expect(offRow?.cells[5]).toBe('Amy\nZed');
    });
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
