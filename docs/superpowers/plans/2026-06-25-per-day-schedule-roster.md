# Per-Day Schedule Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-day roster print/PDF layout to the scheduling page — each day lists its shifts sorted by start time / name / hours, with the two stores (employee `area`) as sub-sections — alongside the existing weekly grid.

**Architecture:** A new pure, unit-tested helper (`src/lib/scheduleRoster.ts`) turns `(shifts, employees, day, sortBy, groupBy)` into sorted, area-grouped rows. A new `generateRosterPDF` in `src/utils/scheduleExport.ts` renders those rows as a portrait PDF (one table per day), reusing `formatKitchenTime`. The export dialog gains Layout / Sort-by / Day controls and a roster preview, and dispatches to the roster or grid generator. To avoid a circular import, `calculateShiftHours` moves to `scheduleRoster.ts` and is re-exported from `scheduleExport.ts`.

**Tech Stack:** React 18 + TypeScript, Vite, shadcn/ui (`Select`), date-fns, jsPDF + jspdf-autotable, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-25-per-day-schedule-roster-design.md`

---

## File Structure

- **Create** `src/lib/scheduleRoster.ts` — pure roster builder + the re-homed `calculateShiftHours`. Exports: `RosterSortBy`, `RosterRow`, `RosterSection`, `RosterDay`, `calculateShiftHours`, `buildRosterDay`, `buildRoster`. Imports only `date-fns`, `@/types/scheduling`, `@/lib/scheduleGrouping` (no cycle).
- **Create** `tests/unit/scheduleRoster.test.ts` — unit tests for the builder + `calculateShiftHours`.
- **Modify** `src/utils/scheduleExport.ts` — (a) remove the local `calculateShiftHours`, import it from `scheduleRoster` and re-export it; (b) add `RosterExportOptions` + `generateRosterPDF`.
- **Create** `tests/unit/scheduleRosterExport.test.ts` — `generateRosterPDF` tests (jsPDF/autotable mocked, mirroring `scheduleExport.test.ts`).
- **Modify** `src/components/scheduling/ScheduleExportDialog.tsx` — Layout/Sort/Day controls, roster preview, dispatch. No prop changes needed from `Scheduling.tsx` (layout/sort/day are dialog-internal state).

Dependency direction (one-way, no cycles): `scheduleExport → scheduleRoster → scheduleGrouping`; `ScheduleExportDialog → {scheduleExport, scheduleRoster}`.

---

## Task 1: Pure roster builder (`scheduleRoster.ts`)

**Files:**
- Create: `src/lib/scheduleRoster.ts`
- Test: `tests/unit/scheduleRoster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scheduleRoster.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRosterDay, buildRoster, calculateShiftHours } from '@/lib/scheduleRoster';
import type { Employee, Shift } from '@/types/scheduling';

function makeEmployee(overrides: Partial<Employee> & { name: string; position: string }): Employee {
  return {
    id: overrides.name.toLowerCase(),
    restaurant_id: 'rest-1',
    status: 'active',
    created_at: '',
    updated_at: '',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500,
    ...overrides,
  } as Employee;
}

function makeShift(employee: Employee, start: string, end: string, breakMin = 0): Shift {
  return {
    id: `${employee.id}-${start}`,
    restaurant_id: 'rest-1',
    employee_id: employee.id,
    start_time: start,
    end_time: end,
    break_duration: breakMin,
    position: employee.position,
    status: 'scheduled',
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    employee,
  } as Shift;
}

const DAY = new Date(2026, 5, 25);       // Thu Jun 25 2026 (local)
const OTHER_DAY = new Date(2026, 5, 26); // Fri Jun 26 2026

const alice = makeEmployee({ name: 'Alice', position: 'Server', area: 'Front Store' });
const bob = makeEmployee({ name: 'Bob', position: 'Cook', area: 'Back Store' });
const carol = makeEmployee({ name: 'Carol', position: 'Server', area: 'Front Store' });
const dave = makeEmployee({ name: 'Dave', position: 'Prep' }); // no area
const employees = [alice, bob, carol, dave];

// Thursday: Alice opens 6A, Bob 7A, Dave 8A, Carol closes 4P
const thuShifts = [
  makeShift(carol, '2026-06-25T16:00:00', '2026-06-25T21:00:00'), // 4P-9P (5h)
  makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T14:00:00'), // 6A-2P (8h)
  makeShift(dave, '2026-06-25T08:00:00', '2026-06-25T16:00:00'),  // 8A-4P (8h)
  makeShift(bob, '2026-06-25T07:00:00', '2026-06-25T15:00:00'),   // 7A-3P (8h)
];

describe('buildRosterDay', () => {
  it('sorts by start time within a single ungrouped list (morning before afternoon)', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'startTime', 'none');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].label).toBe('');
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Alice', 'Bob', 'Dave', 'Carol']);
  });

  it('groups by area with Unassigned last, each section sorted by start time', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'startTime', 'area');
    expect(result.sections.map(s => s.label)).toEqual(['Back Store', 'Front Store', 'Unassigned']);
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Bob']);
    expect(result.sections[1].rows.map(r => r.employee.name)).toEqual(['Alice', 'Carol']);
    expect(result.sections[2].rows.map(r => r.employee.name)).toEqual(['Dave']);
  });

  it('groups by position', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'startTime', 'position');
    expect(result.sections.map(s => s.label)).toEqual(['Cook', 'Prep', 'Server']);
    expect(result.sections[2].rows.map(r => r.employee.name)).toEqual(['Alice', 'Carol']);
  });

  it('sorts by name (A-Z) when sortBy is name', () => {
    const result = buildRosterDay(thuShifts, employees, DAY, 'name', 'none');
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
  });

  it('sorts by hours (most first) when sortBy is hours', () => {
    const shortEarly = makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T08:00:00'); // 6A, 2h
    const longLate = makeShift(bob, '2026-06-25T10:00:00', '2026-06-25T18:00:00');     // 10A, 8h
    const result = buildRosterDay([shortEarly, longLate], [alice, bob], DAY, 'hours', 'none');
    // Bob (8h) before Alice (2h), even though Alice starts earlier
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Bob', 'Alice']);
  });

  it('breaks start-time ties by name', () => {
    const zoe = makeEmployee({ name: 'Zoe', position: 'Server', area: 'Front Store' });
    const amy = makeEmployee({ name: 'Amy', position: 'Server', area: 'Front Store' });
    const shifts = [
      makeShift(zoe, '2026-06-25T09:00:00', '2026-06-25T17:00:00'),
      makeShift(amy, '2026-06-25T09:00:00', '2026-06-25T17:00:00'),
    ];
    const result = buildRosterDay(shifts, [zoe, amy], DAY, 'startTime', 'none');
    expect(result.sections[0].rows.map(r => r.employee.name)).toEqual(['Amy', 'Zoe']);
  });

  it('renders a split shift as two rows but counts the employee once in totalStaff', () => {
    const split = [
      makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T10:00:00'), // 6A-10A (4h)
      makeShift(alice, '2026-06-25T17:00:00', '2026-06-25T21:00:00'), // 5P-9P (4h)
    ];
    const result = buildRosterDay(split, [alice], DAY, 'startTime', 'none');
    expect(result.sections[0].rows).toHaveLength(2);
    expect(result.totalStaff).toBe(1);
    expect(result.totalHours).toBe(8);
  });

  it('excludes shifts on other days', () => {
    const result = buildRosterDay(thuShifts, employees, OTHER_DAY, 'startTime', 'none');
    expect(result.sections).toEqual([]);
    expect(result.totalStaff).toBe(0);
    expect(result.totalHours).toBe(0);
  });

  it('sums net hours excluding break in totalHours', () => {
    const shifts = [makeShift(alice, '2026-06-25T08:00:00', '2026-06-25T16:00:00', 30)]; // 7.5h
    const result = buildRosterDay(shifts, [alice], DAY, 'startTime', 'none');
    expect(result.totalHours).toBe(7.5);
  });

  it('skips shifts whose employee is not in the employees list', () => {
    const ghost = makeShift(
      makeEmployee({ name: 'Ghost', position: 'Server' }),
      '2026-06-25T09:00:00', '2026-06-25T17:00:00',
    );
    const result = buildRosterDay([ghost], employees, DAY, 'startTime', 'none');
    expect(result.sections).toEqual([]);
    expect(result.totalStaff).toBe(0);
  });
});

describe('buildRoster', () => {
  it('builds one RosterDay per day, preserving order', () => {
    const result = buildRoster(thuShifts, employees, [DAY, OTHER_DAY], 'startTime', 'none');
    expect(result).toHaveLength(2);
    expect(result[0].day).toBe(DAY);
    expect(result[0].totalStaff).toBe(4);
    expect(result[1].day).toBe(OTHER_DAY);
    expect(result[1].totalStaff).toBe(0);
  });
});

describe('calculateShiftHours (re-homed)', () => {
  it('subtracts break duration', () => {
    const shift = {
      start_time: '2026-06-25T08:00:00',
      end_time: '2026-06-25T16:00:00',
      break_duration: 30,
    } as Shift;
    expect(calculateShiftHours(shift)).toBe(7.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/scheduleRoster.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/scheduleRoster"` / module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/scheduleRoster.ts`:

```ts
import { isSameDay, parseISO } from 'date-fns';
import type { Shift, Employee } from '@/types/scheduling';
import { type GroupByMode, UNASSIGNED_LABEL } from '@/lib/scheduleGrouping';

/** How a day's shift rows are ordered within each area/position section. */
export type RosterSortBy = 'startTime' | 'name' | 'hours';

/** One printable line in the roster: a single shift + its employee. */
export interface RosterRow {
  shift: Shift;
  employee: Employee;
  hours: number; // net scheduled hours (break excluded)
}

/** A grouped block of rows under one area/position label ('' when ungrouped). */
export interface RosterSection {
  label: string;
  rows: RosterRow[];
}

/** All shifts for a single calendar day, grouped + sorted for printing. */
export interface RosterDay {
  day: Date;
  sections: RosterSection[];
  totalStaff: number; // distinct employees that day
  totalHours: number; // sum of net hours
}

/**
 * Net scheduled hours for a shift (break excluded), clamped to >= 0.
 * Canonical home for this helper; re-exported from utils/scheduleExport for
 * backward compatibility.
 */
export const calculateShiftHours = (shift: Shift): number => {
  const start = new Date(shift.start_time);
  const end = new Date(shift.end_time);
  const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
  return netMinutes / 60;
};

const startMs = (row: RosterRow): number => parseISO(row.shift.start_time).getTime();

/** Comparator for ordering rows within a section, with deterministic tie-breaks. */
function rowComparator(sortBy: RosterSortBy): (a: RosterRow, b: RosterRow) => number {
  if (sortBy === 'name') {
    return (a, b) => a.employee.name.localeCompare(b.employee.name) || startMs(a) - startMs(b);
  }
  if (sortBy === 'hours') {
    return (a, b) => b.hours - a.hours || a.employee.name.localeCompare(b.employee.name);
  }
  // 'startTime' (default): earliest first -> morning before afternoon
  return (a, b) => startMs(a) - startMs(b) || a.employee.name.localeCompare(b.employee.name);
}

/**
 * Builds the roster for a single day: filters shifts to `day`, joins each to its
 * employee, groups by `groupBy` (area/position/none), and sorts each section by
 * `sortBy`. Shifts whose employee is missing are skipped. Split shifts (same
 * employee, two shifts that day) produce two rows but count once in totalStaff.
 *
 * Callers should pre-filter `shifts` by area/position/selected-employees; this
 * function does not re-apply those filters.
 */
export function buildRosterDay(
  shifts: Shift[],
  employees: Employee[],
  day: Date,
  sortBy: RosterSortBy,
  groupBy: GroupByMode,
): RosterDay {
  const empById = new Map(employees.map(e => [e.id, e]));

  const rows: RosterRow[] = [];
  for (const shift of shifts) {
    if (!isSameDay(parseISO(shift.start_time), day)) continue;
    const employee = empById.get(shift.employee_id);
    if (!employee) continue;
    rows.push({ shift, employee, hours: calculateShiftHours(shift) });
  }

  const totalStaff = new Set(rows.map(r => r.employee.id)).size;
  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);
  const sortRows = (rs: RosterRow[]) => [...rs].sort(rowComparator(sortBy));

  if (groupBy === 'none') {
    return {
      day,
      sections: rows.length ? [{ label: '', rows: sortRows(rows) }] : [],
      totalStaff,
      totalHours,
    };
  }

  const sectionMap = new Map<string, RosterRow[]>();
  for (const row of rows) {
    const raw = (groupBy === 'area' ? row.employee.area : row.employee.position) || '';
    const key = raw.trim(); // '' === unassigned
    const arr = sectionMap.get(key);
    if (arr) arr.push(row);
    else sectionMap.set(key, [row]);
  }

  const sortedKeys = Array.from(sectionMap.keys()).sort((a, b) => {
    if (a === '') return 1; // unassigned last
    if (b === '') return -1;
    return a.localeCompare(b);
  });

  return {
    day,
    sections: sortedKeys.map(key => ({
      label: key || UNASSIGNED_LABEL,
      rows: sortRows(sectionMap.get(key) ?? []),
    })),
    totalStaff,
    totalHours,
  };
}

/** Builds rosters for multiple days (e.g., a full week), preserving day order. */
export function buildRoster(
  shifts: Shift[],
  employees: Employee[],
  days: Date[],
  sortBy: RosterSortBy,
  groupBy: GroupByMode,
): RosterDay[] {
  return days.map(day => buildRosterDay(shifts, employees, day, sortBy, groupBy));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/scheduleRoster.test.ts`
Expected: PASS — all tests in `buildRosterDay`, `buildRoster`, `calculateShiftHours (re-homed)` green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduleRoster.ts tests/unit/scheduleRoster.test.ts
git commit -m "feat(scheduling): pure per-day roster builder + re-homed calculateShiftHours"
```

---

## Task 2: Re-home `calculateShiftHours` in `scheduleExport.ts`

Removes the duplicate definition (now owned by `scheduleRoster.ts`) and re-exports it so existing importers keep working. This must land before Task 3 so `generateRosterPDF` can import `buildRoster` without a circular dependency.

**Files:**
- Modify: `src/utils/scheduleExport.ts`

- [ ] **Step 1: Add the import + re-export**

In `src/utils/scheduleExport.ts`, after the existing import block (the `import { groupEmployees, type GroupByMode } from "@/lib/scheduleGrouping";` line), add:

```ts
import { calculateShiftHours } from "@/lib/scheduleRoster";

// Re-exported for backward compatibility; canonical home is @/lib/scheduleRoster.
export { calculateShiftHours };
```

- [ ] **Step 2: Delete the local definition**

Remove this block from `src/utils/scheduleExport.ts` (the old `calculateShiftHours`):

```ts
/**
 * Calculate shift hours (excluding break)
 */
export const calculateShiftHours = (shift: Shift): number => {
  const start = new Date(shift.start_time);
  const end = new Date(shift.end_time);
  const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
  return netMinutes / 60;
};
```

(`generateSchedulePDF` keeps calling `calculateShiftHours` — it now resolves to the imported binding.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`Shift` is still imported/used by `ScheduleExportOptions`; do not remove that import.)

- [ ] **Step 4: Run the affected tests**

Run: `npm run test -- tests/unit/scheduleExportHelpers.test.ts tests/unit/scheduleExport.test.ts`
Expected: PASS — `calculateShiftHours` still importable from `@/utils/scheduleExport` (re-export), and `generateSchedulePDF` unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/utils/scheduleExport.ts
git commit -m "refactor(scheduling): re-home calculateShiftHours to scheduleRoster, re-export from scheduleExport"
```

---

## Task 3: `generateRosterPDF` + `RosterExportOptions`

**Files:**
- Modify: `src/utils/scheduleExport.ts`
- Test: `tests/unit/scheduleRosterExport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scheduleRosterExport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockText, mockSave, mockAutoTable } = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockSave: vi.fn(),
  mockAutoTable: vi.fn(),
}));

vi.mock('jspdf', () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
    setFontSize = vi.fn();
    setFont = vi.fn();
    setTextColor = vi.fn();
    text = mockText;
    save = mockSave;
    lastAutoTable = { finalY: 200 };
  },
}));
vi.mock('jspdf-autotable', () => ({ default: mockAutoTable }));

import { generateRosterPDF } from '@/utils/scheduleExport';
import type { Employee, Shift } from '@/types/scheduling';

function makeEmployee(overrides: Partial<Employee> & { name: string; position: string }): Employee {
  return {
    id: overrides.name.toLowerCase(),
    restaurant_id: 'rest-1',
    status: 'active',
    created_at: '',
    updated_at: '',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500,
    ...overrides,
  } as Employee;
}

function makeShift(employee: Employee, start: string, end: string, breakMin = 0): Shift {
  return {
    id: `${employee.id}-${start}`,
    restaurant_id: 'rest-1',
    employee_id: employee.id,
    start_time: start,
    end_time: end,
    break_duration: breakMin,
    position: employee.position,
    status: 'scheduled',
    is_published: true,
    locked: false,
    source: 'manual',
    created_at: '',
    updated_at: '',
    employee,
  } as Shift;
}

const DAY = new Date(2026, 5, 25);

const alice = makeEmployee({ name: 'Alice', position: 'Server', area: 'Front Store' });
const bob = makeEmployee({ name: 'Bob', position: 'Cook', area: 'Back Store' });
const carol = makeEmployee({ name: 'Carol', position: 'Server', area: 'Front Store' });
const dave = makeEmployee({ name: 'Dave', position: 'Prep' });
const employees = [alice, bob, carol, dave];

const thuShifts = [
  makeShift(carol, '2026-06-25T16:00:00', '2026-06-25T21:00:00'),
  makeShift(alice, '2026-06-25T06:00:00', '2026-06-25T14:00:00'),
  makeShift(dave, '2026-06-25T08:00:00', '2026-06-25T16:00:00'),
  makeShift(bob, '2026-06-25T07:00:00', '2026-06-25T15:00:00'),
];

const base = { shifts: thuShifts, employees, weekStart: DAY, weekEnd: DAY, restaurantName: 'Test' };

beforeEach(() => {
  mockAutoTable.mockClear();
  mockText.mockClear();
  mockSave.mockClear();
});

describe('generateRosterPDF', () => {
  it('renders one table for a single day with rows sorted by start time', () => {
    generateRosterPDF({ ...base, days: [DAY], sortBy: 'startTime', groupBy: 'none' });
    expect(mockAutoTable).toHaveBeenCalledTimes(1);
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body.map((r: any[]) => r[1])).toEqual(['Alice', 'Bob', 'Dave', 'Carol']);
  });

  it('inserts area section header rows when groupBy is area', () => {
    generateRosterPDF({ ...base, days: [DAY], sortBy: 'startTime', groupBy: 'area' });
    const body = mockAutoTable.mock.calls[0][1].body;
    const headerLabels = body
      .filter((r: any[]) => r.length === 1 && r[0].colSpan)
      .map((r: any[]) => r[0].content as string);
    expect(headerLabels.some(l => l.startsWith('Back Store'))).toBe(true);
    expect(headerLabels.some(l => l.startsWith('Front Store'))).toBe(true);
    expect(headerLabels.some(l => l.startsWith('Unassigned'))).toBe(true);
  });

  it('renders one table per day across a multi-day range', () => {
    const days = [DAY, new Date(2026, 5, 26), new Date(2026, 5, 27)];
    generateRosterPDF({ ...base, weekStart: days[0], weekEnd: days[2], days, sortBy: 'startTime', groupBy: 'none' });
    expect(mockAutoTable).toHaveBeenCalledTimes(3);
  });

  it('shows "No one scheduled" for an empty day', () => {
    generateRosterPDF({ ...base, shifts: [], days: [DAY], sortBy: 'startTime', groupBy: 'none' });
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body).toHaveLength(1);
    expect(body[0][0].content).toBe('No one scheduled');
  });

  it('emits a "Filtered: <area>" subtitle and narrows rows when areaFilter is active', () => {
    generateRosterPDF({ ...base, days: [DAY], sortBy: 'startTime', groupBy: 'none', areaFilter: 'Front Store' });
    const filtered = mockText.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('Filtered:'),
    );
    expect(filtered).toBeDefined();
    expect(filtered![0]).toContain('Front Store');
    const body = mockAutoTable.mock.calls[0][1].body;
    expect(body.map((r: any[]) => r[1])).toEqual(['Alice', 'Carol']);
  });

  it('includes an Hours column value when includeHoursSummary is set', () => {
    generateRosterPDF({
      ...base,
      days: [DAY],
      sortBy: 'startTime',
      groupBy: 'none',
      includePositions: false,
      includeHoursSummary: true,
    });
    const body = mockAutoTable.mock.calls[0][1].body;
    const aliceRow = body.find((r: any[]) => r[1] === 'Alice');
    expect(aliceRow[2]).toBe('8.0'); // columns: [time, name, hours]
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/scheduleRosterExport.test.ts`
Expected: FAIL — `generateRosterPDF` is not exported from `@/utils/scheduleExport`.

- [ ] **Step 3: Extend the scheduleRoster import**

In `src/utils/scheduleExport.ts`, change the Task 2 import line to also bring in `buildRoster` and `RosterSortBy`:

```ts
import { calculateShiftHours, buildRoster, type RosterSortBy } from "@/lib/scheduleRoster";

// Re-exported for backward compatibility; canonical home is @/lib/scheduleRoster.
export { calculateShiftHours };
```

- [ ] **Step 4: Add `RosterExportOptions` + `generateRosterPDF`**

Append to `src/utils/scheduleExport.ts` (after `generateSchedulePDF`, before `generateScheduleFilename`):

```ts
export interface RosterExportOptions {
  shifts: Shift[];
  employees: Employee[];
  days: Date[];
  weekStart: Date;
  weekEnd: Date;
  restaurantName?: string;
  sortBy?: RosterSortBy;
  groupBy?: GroupByMode;
  areaFilter?: string;
  positionFilter?: string;
  selectedEmployeeIds?: Set<string>;
  includePositions?: boolean;
  includeHoursSummary?: boolean;
}

/**
 * Generates a per-day roster PDF: one table per day, each listing the day's
 * shifts sorted by start time / name / hours, with area (or position)
 * sub-sections. Portrait orientation (a narrow, tall list).
 */
export const generateRosterPDF = (options: RosterExportOptions): void => {
  const {
    shifts,
    employees,
    days,
    weekStart,
    weekEnd,
    restaurantName = "Restaurant",
    sortBy = "startTime",
    groupBy = "none",
    areaFilter,
    positionFilter,
    selectedEmployeeIds,
    includePositions = true,
    includeHoursSummary = false,
  } = options;

  const active = (f?: string) => (f && f !== "all" ? f : null);
  const activeArea = active(areaFilter);
  const activePosition = active(positionFilter);

  // Pre-filter by area / position / selected employees (same semantics as the grid).
  const filteredShifts = shifts.filter(s => {
    const emp = employees.find(e => e.id === s.employee_id);
    if (!emp) return false;
    if (activeArea && emp.area !== activeArea) return false;
    if (activePosition && emp.position !== activePosition) return false;
    if (selectedEmployeeIds && !selectedEmployeeIds.has(emp.id)) return false;
    return true;
  });

  const rosterDays = buildRoster(filteredShifts, employees, days, sortBy, groupBy);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Title + week range
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(restaurantName.toUpperCase(), pageWidth / 2, margin, { align: "center" });
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Week of ${format(weekStart, "MMMM d")} - ${format(weekEnd, "MMMM d, yyyy")}`,
    pageWidth / 2,
    margin + 20,
    { align: "center" },
  );

  // Subtitles: active filters + sort indicator
  let subtitleY = margin + 35;
  const filterParts = [activeArea, activePosition].filter(Boolean) as string[];
  if (filterParts.length > 0) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Filtered: ${filterParts.join(" · ")}`, pageWidth / 2, subtitleY, { align: "center" });
    subtitleY += 14;
  }
  const sortLabel = sortBy === "name" ? "Name" : sortBy === "hours" ? "Hours" : "Start time";
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Sorted by: ${sortLabel}`, pageWidth / 2, subtitleY, { align: "center" });
  subtitleY += 14;
  doc.setTextColor(0);

  // Columns
  const columns = ["Time", "Employee"];
  if (includePositions) columns.push("Position");
  if (includeHoursSummary) columns.push("Hours");
  const colCount = columns.length;

  let cursorY = subtitleY + 5;

  for (const rosterDay of rosterDays) {
    const dayHeader = `${format(rosterDay.day, "EEEE · MMM d")}${
      rosterDay.totalStaff > 0
        ? `      ${rosterDay.totalStaff} staff · ${rosterDay.totalHours.toFixed(1)} hrs`
        : ""
    }`;

    const body: any[][] = [];

    if (rosterDay.totalStaff === 0) {
      body.push([{
        content: "No one scheduled",
        colSpan: colCount,
        styles: { halign: "center" as const, textColor: [150, 150, 150], fontStyle: "italic" as const },
      }]);
    } else {
      for (const section of rosterDay.sections) {
        if (groupBy !== "none" && section.label) {
          body.push([{
            content: `${section.label} (${section.rows.length})`,
            colSpan: colCount,
            styles: {
              halign: "left" as const,
              fontStyle: "bold" as const,
              fillColor: [230, 230, 230],
              textColor: [50, 50, 50],
              fontSize: 10,
            },
          }]);
        }
        for (const row of section.rows) {
          const cells: any[] = [
            formatKitchenTime(row.shift.start_time, row.shift.end_time),
            row.employee.name,
          ];
          if (includePositions) cells.push(row.shift.position || row.employee.position || "");
          if (includeHoursSummary) cells.push(row.hours.toFixed(1));
          body.push(cells);
        }
      }
    }

    autoTable(doc, {
      startY: cursorY,
      head: [
        [{
          content: dayHeader,
          colSpan: colCount,
          styles: {
            halign: "left" as const,
            fontStyle: "bold" as const,
            fillColor: [220, 220, 220],
            textColor: [20, 20, 20],
            fontSize: 11,
          },
        }],
        columns.map(c => ({ content: c, styles: { fontStyle: "bold" as const } })),
      ],
      body,
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 5, lineColor: [200, 200, 200], lineWidth: 0.5 },
      headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontSize: 9 },
      columnStyles: { 0: { cellWidth: 80 } },
      margin: { left: margin, right: margin },
    });

    cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY) + 18;
  }

  // Footer
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated ${format(new Date(), "MMM d, yyyy 'at' h:mm a")}`, margin, pageHeight - 24);

  const fileName =
    days.length === 1
      ? `roster_${format(days[0], "yyyy-MM-dd")}.pdf`
      : `roster_${format(weekStart, "yyyy-MM-dd")}_to_${format(weekEnd, "yyyy-MM-dd")}.pdf`;
  doc.save(fileName);
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/unit/scheduleRosterExport.test.ts`
Expected: PASS — all 6 `generateRosterPDF` tests green.

- [ ] **Step 6: Typecheck + re-run grid tests (no regression)**

Run: `npm run typecheck && npm run test -- tests/unit/scheduleExport.test.ts`
Expected: no type errors; grid tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/scheduleExport.ts tests/unit/scheduleRosterExport.test.ts
git commit -m "feat(scheduling): generateRosterPDF per-day roster PDF generator"
```

---

## Task 4: Dialog controls + dispatch

Adds the Layout toggle (default roster), Sort-by and Day selects (roster only), and routes Download to the roster or grid generator. No preview change yet (Task 5).

**Files:**
- Modify: `src/components/scheduling/ScheduleExportDialog.tsx`

- [ ] **Step 1: Add imports**

In `src/components/scheduling/ScheduleExportDialog.tsx`:

Change the scheduleExport import (line 15) to add `generateRosterPDF` (Task 5 adds `formatKitchenTime`):

```ts
import { generateSchedulePDF, generateRosterPDF } from "@/utils/scheduleExport";
```

Add after the `GroupByMode` type import (line 17) (Task 5 adds `buildRosterDay`):

```ts
import { type RosterSortBy } from "@/lib/scheduleRoster";
```

Add a `Select` import with the other UI imports (near the `Checkbox`/`Label` imports):

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

- [ ] **Step 2: Add state**

After the existing `selectedEmployeeIds` state (line 46), add:

```ts
  const [layout, setLayout] = useState<'grid' | 'roster'>('roster');
  const [sortBy, setSortBy] = useState<RosterSortBy>('startTime');
  const [rosterDay, setRosterDay] = useState<string>('all'); // 'all' or 'yyyy-MM-dd'
```

- [ ] **Step 3: Replace `handleExport` with a dispatcher**

Replace the existing `handleExport` (lines 132-147) with:

```ts
  const handleExport = () => {
    if (layout === 'roster') {
      const days =
        rosterDay === 'all'
          ? weekDays
          : weekDays.filter(d => format(d, 'yyyy-MM-dd') === rosterDay);
      generateRosterPDF({
        shifts,
        employees,
        days,
        weekStart,
        weekEnd,
        restaurantName,
        sortBy,
        groupBy,
        positionFilter,
        areaFilter,
        selectedEmployeeIds,
        includePositions,
        includeHoursSummary,
      });
    } else {
      generateSchedulePDF({
        shifts,
        employees,
        weekStart,
        weekEnd,
        restaurantName,
        includePositions,
        includeHoursSummary,
        positionFilter,
        areaFilter,
        groupBy,
        selectedEmployeeIds,
      });
    }
    onOpenChange(false);
  };
```

- [ ] **Step 4: Add the Layout / Sort / Day controls**

Immediately before the `{/* Options */}` comment block (line 294), insert:

```tsx
        {/* Layout + roster sorting */}
        <div className="space-y-3">
          <div>
            <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Layout
            </span>
            <div className="mt-1.5 inline-flex rounded-lg border border-border/40 p-0.5 bg-muted/30">
              <button
                type="button"
                onClick={() => setLayout('roster')}
                aria-pressed={layout === 'roster'}
                className={`h-8 px-3 rounded-md text-[13px] font-medium transition-colors ${
                  layout === 'roster'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Per-day roster
              </button>
              <button
                type="button"
                onClick={() => setLayout('grid')}
                aria-pressed={layout === 'grid'}
                className={`h-8 px-3 rounded-md text-[13px] font-medium transition-colors ${
                  layout === 'grid'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Weekly grid
              </button>
            </div>
          </div>

          {layout === 'roster' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Sort by
                </Label>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as RosterSortBy)}>
                  <SelectTrigger className="h-9 mt-1.5 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="startTime">Start time</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                    <SelectItem value="hours">Hours scheduled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Day
                </Label>
                <Select value={rosterDay} onValueChange={setRosterDay}>
                  <SelectTrigger className="h-9 mt-1.5 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Whole week</SelectItem>
                    {weekDays.map(d => (
                      <SelectItem key={d.toISOString()} value={format(d, 'yyyy-MM-dd')}>
                        {format(d, 'EEEE, MMM d')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/components/scheduling/ScheduleExportDialog.tsx`
Expected: no type errors; no new lint errors. (Only imports used in this task — `generateRosterPDF`, `Select*`, `RosterSortBy` — were added; `formatKitchenTime`/`buildRosterDay` come in Task 5 where they're first used.)

- [ ] **Step 6: Commit**

```bash
git add src/components/scheduling/ScheduleExportDialog.tsx
git commit -m "feat(scheduling): export dialog Layout/Sort/Day controls + roster dispatch"
```

---

## Task 5: Dialog roster preview

Switches the in-dialog preview to a per-day roster when the roster layout is selected; keeps the existing grid preview for the grid layout.

**Files:**
- Modify: `src/components/scheduling/ScheduleExportDialog.tsx`

- [ ] **Step 1: Extend imports for the preview**

Add `formatKitchenTime` to the scheduleExport import:

```ts
import { generateSchedulePDF, generateRosterPDF, formatKitchenTime } from "@/utils/scheduleExport";
```

Add `buildRosterDay` to the scheduleRoster import:

```ts
import { buildRosterDay, type RosterSortBy } from "@/lib/scheduleRoster";
```

- [ ] **Step 2: Add a `previewRosterDay` memo**

After the existing `previewEmployees` memo (lines 97-102), add:

```tsx
  // Roster preview for the selected day (or first day of the week when "Whole week")
  const previewRosterDay = useMemo(() => {
    if (layout !== 'roster' || weekDays.length === 0) return null;
    const day =
      rosterDay === 'all'
        ? weekDays[0]
        : weekDays.find(d => format(d, 'yyyy-MM-dd') === rosterDay) ?? weekDays[0];
    const selectedShifts = filteredShifts.filter(s => selectedEmployeeIds.has(s.employee_id));
    return buildRosterDay(selectedShifts, employees, day, sortBy, groupBy);
  }, [layout, rosterDay, weekDays, filteredShifts, selectedEmployeeIds, employees, sortBy, groupBy]);
```

- [ ] **Step 3: Render the roster preview conditionally**

In the preview card, the grid preview is the `<div className="overflow-x-auto">…</div>` block containing the mini `<table>` (lines 182-234). Wrap it so the roster preview shows instead when `layout === 'roster'`. Replace the opening of that block:

```tsx
          {/* Mini preview table */}
          <div className="overflow-x-auto">
```

with:

```tsx
          {/* Preview: roster (per-day) or grid */}
          {layout === 'roster' ? (
            <div className="overflow-hidden text-left">
              <div className="text-[13px] font-semibold text-foreground mb-1.5">
                {previewRosterDay ? format(previewRosterDay.day, 'EEEE, MMM d') : ''}
                {previewRosterDay && previewRosterDay.totalStaff > 0 && (
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    {previewRosterDay.totalStaff} staff · {previewRosterDay.totalHours.toFixed(1)} hrs
                  </span>
                )}
              </div>
              {previewRosterDay && previewRosterDay.totalStaff > 0 ? (
                <div className="space-y-2">
                  {previewRosterDay.sections.map(section => (
                    <div key={section.label || 'all'}>
                      {groupBy !== 'none' && section.label && (
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                          {section.label}
                        </div>
                      )}
                      {section.rows.slice(0, 6).map(row => (
                        <div key={row.shift.id} className="flex items-center gap-2 text-xs py-0.5">
                          <span className="font-medium tabular-nums w-16">
                            {formatKitchenTime(row.shift.start_time, row.shift.end_time)}
                          </span>
                          <span className="flex-1 truncate">{row.employee.name}</span>
                          {includePositions && (
                            <span className="text-muted-foreground text-[10px] truncate">{row.shift.position}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                  {previewRosterDay.totalStaff > 6 && (
                    <div className="text-[11px] text-muted-foreground italic">… more on the PDF</div>
                  )}
                </div>
              ) : (
                <div className="text-center p-4 text-muted-foreground italic text-xs">
                  No one scheduled
                </div>
              )}
            </div>
          ) : (
          <div className="overflow-x-auto">
```

Then close the conditional: find the matching closing `</div>` for that `overflow-x-auto` block (the `</div>` immediately before the `<div className="flex items-center justify-between mt-3 …">` footer, line 234) and change it from:

```tsx
            </table>
          </div>
```

to:

```tsx
            </table>
          </div>
          )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/components/scheduling/ScheduleExportDialog.tsx`
Expected: no type errors; no lint errors (now `formatKitchenTime` and `buildRosterDay` are used).

- [ ] **Step 5: Commit**

```bash
git add src/components/scheduling/ScheduleExportDialog.tsx
git commit -m "feat(scheduling): per-day roster preview in export dialog"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npm run test`
Expected: PASS — including `scheduleRoster`, `scheduleRosterExport`, `scheduleExport`, `scheduleExportHelpers`, `scheduleGrouping`.

- [ ] **Step 2: Typecheck + lint (whole project)**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (browser)**

Run `npm run dev`, open `/scheduling?week=2026-06-22`, click **Print**. Verify:
- Layout defaults to **Per-day roster**; **Sort by** = Start time; **Day** = Whole week.
- Preview shows the day's shifts, openers first; switching **Sort by** to Name / Hours reorders; switching **Day** to a single day updates the preview.
- With **Group by → Area** set on the page (and/or an **Area** filter for one store), each day shows area sub-sections.
- **Download PDF** produces a portrait roster (one section per day); switching **Layout → Weekly grid** still produces the original landscape grid.

- [ ] **Step 5: Commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(scheduling): verification fixes for per-day roster"
```

---

## Self-Review Notes (spec coverage)

- **Per-day roster artifact** → Tasks 1 (builder) + 3 (PDF).
- **Sort by start time / name / hours, within each section** → Task 1 `rowComparator` (+ tests); Task 4 control.
- **Area / position grouping, Unassigned last, reuses `groupBy`/`areaFilter`** → Task 1 grouping (+ tests); Task 3 filter + section headers.
- **Row = one shift; split shifts twice; totalStaff counts once** → Task 1 (+ split-shift test).
- **Whole-week default + single-day picker** → Task 3 `days`/filename; Task 4 Day select.
- **Keep weekly grid via Layout toggle (default roster)** → Task 4 dispatch.
- **Day header with staff count + total hours** → Task 1 totals; Task 3 `dayHeader`.
- **Empty day → "No one scheduled"** → Task 3 (+ test).
- **Portrait orientation; reuse `formatKitchenTime` / `calculateShiftHours`** → Tasks 2-3.
- **Unit tests for the pure helper** → Task 1 (`scheduleRoster.test.ts`) + Task 3 PDF tests.
- **No DB/edge changes** → confirmed; all client-side.
