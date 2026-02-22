# Shift CSV Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow managers to import shift schedules from CSV files (Sling grid format + generic flat CSVs) with employee matching, duplicate detection, and published-week blocking.

**Architecture:** Multi-step sheet component (Upload → Mapping → Employee Review → Preview → Import) following the TimePunchUploadSheet pattern. Sling format auto-detected and parsed without column mapping; generic CSVs use the standard column mapping heuristics. Employee name matching reuses the `normalizeEmployeeKey` / `buildEmployeeLookup` patterns from `timePunchImport.ts`.

**Tech Stack:** React, TypeScript, Papa Parse, Vitest, Supabase, React Query, shadcn/ui Sheet

---

### Task 1: Sling CSV Parser — Tests

**Files:**
- Create: `tests/unit/slingCsvParser.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  isSlingFormat,
  parseSlingShiftCell,
  parseSlingCSV,
  type ParsedShift,
} from '@/utils/slingCsvParser';

describe('slingCsvParser', () => {
  describe('isSlingFormat', () => {
    it('detects Sling grid format from date headers', () => {
      const headers = ['', '2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01'];
      const rows = [
        { '': 'Unassigned shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
        { '': '', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
        { '': 'Scheduled shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
        { '': 'Abraham Dominguez', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '10:00 AM - 11:00 PM • 13h\nServer • San Antonio\n ', '2026-03-01': '' },
      ];
      expect(isSlingFormat(headers, rows)).toBe(true);
    });

    it('rejects non-Sling CSV with regular headers', () => {
      const headers = ['Employee', 'Date', 'Start Time', 'End Time', 'Position'];
      const rows = [{ Employee: 'John', Date: '2026-02-23', 'Start Time': '9:00 AM', 'End Time': '5:00 PM', Position: 'Server' }];
      expect(isSlingFormat(headers, rows)).toBe(false);
    });
  });

  describe('parseSlingShiftCell', () => {
    it('parses a single shift cell', () => {
      const cell = '10:00 AM - 11:00 PM • 13h\nServer • San Antonio\n ';
      const shifts = parseSlingShiftCell(cell, '2026-02-28');
      expect(shifts).toHaveLength(1);
      expect(shifts[0].startTime).toBe('2026-02-28T10:00:00.000');
      expect(shifts[0].endTime).toBe('2026-02-28T23:00:00.000');
      expect(shifts[0].position).toBe('Server');
    });

    it('parses multiple shifts in one cell', () => {
      const cell = '10:00 AM - 5:00 PM • 7h\nServer • San Antonio\n \n5:00 PM - 1:00 AM • 8h\nServer • San Antonio\n ';
      const shifts = parseSlingShiftCell(cell, '2026-02-28');
      expect(shifts).toHaveLength(2);
      expect(shifts[0].endTime).toBe('2026-02-28T17:00:00.000');
      expect(shifts[1].startTime).toBe('2026-02-28T17:00:00.000');
      // Overnight: 1:00 AM is next day
      expect(shifts[1].endTime).toBe('2026-03-01T01:00:00.000');
    });

    it('handles overnight shifts (end time before start time)', () => {
      const cell = '5:00 PM - 1:00 AM • 8h\nBartender • San Antonio\n ';
      const shifts = parseSlingShiftCell(cell, '2026-02-28');
      expect(shifts).toHaveLength(1);
      expect(shifts[0].startTime).toBe('2026-02-28T17:00:00.000');
      expect(shifts[0].endTime).toBe('2026-03-01T01:00:00.000');
      expect(shifts[0].position).toBe('Bartender');
    });

    it('returns empty array for empty cell', () => {
      expect(parseSlingShiftCell('', '2026-02-28')).toEqual([]);
      expect(parseSlingShiftCell('  ', '2026-02-28')).toEqual([]);
    });
  });

  describe('parseSlingCSV', () => {
    const slingHeaders = ['', '2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01'];
    const slingRows = [
      { '': 'Unassigned shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': '', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': 'Available shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': '', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      { '': 'Scheduled shifts', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      {
        '': 'Abraham Dominguez',
        '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '',
        '2026-02-28': '10:00 AM - 11:00 PM • 13h\nServer • San Antonio\n ',
        '2026-03-01': '5:00 PM - 11:00 PM • 6h\nServer • San Antonio\n ',
      },
      {
        '': 'Gaspar Chef  Vidanez',
        '2026-02-23': '9:30 AM - 10:00 PM • 12h 30min\nKitchen Manager • San Antonio\n ',
        '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '',
      },
    ];

    it('parses all scheduled shifts from Sling grid', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      expect(result).toHaveLength(3);
    });

    it('extracts employee names correctly', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      const names = [...new Set(result.map(s => s.employeeName))];
      expect(names).toContain('Abraham Dominguez');
      expect(names).toContain('Gaspar Chef  Vidanez');
    });

    it('skips section header rows', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      const names = result.map(s => s.employeeName);
      expect(names).not.toContain('Unassigned shifts');
      expect(names).not.toContain('Available shifts');
      expect(names).not.toContain('Scheduled shifts');
    });

    it('skips employees with no shifts in any column', () => {
      const rowsWithEmpty = [
        ...slingRows,
        { '': 'Angel Hernandez', '2026-02-23': '', '2026-02-24': '', '2026-02-25': '', '2026-02-26': '', '2026-02-27': '', '2026-02-28': '', '2026-03-01': '' },
      ];
      const result = parseSlingCSV(slingHeaders, rowsWithEmpty);
      const names = result.map(s => s.employeeName);
      expect(names).not.toContain('Angel Hernandez');
    });

    it('associates correct dates with shifts', () => {
      const result = parseSlingCSV(slingHeaders, slingRows);
      const abrahamShifts = result.filter(s => s.employeeName === 'Abraham Dominguez');
      expect(abrahamShifts[0].startTime).toContain('2026-02-28');
      expect(abrahamShifts[1].startTime).toContain('2026-03-01');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/slingCsvParser.test.ts`
Expected: FAIL — module `@/utils/slingCsvParser` not found

**Step 3: Commit the failing test**

```bash
git add tests/unit/slingCsvParser.test.ts
git commit -m "test: add Sling CSV parser tests (red)"
```

---

### Task 2: Sling CSV Parser — Implementation

**Files:**
- Create: `src/utils/slingCsvParser.ts`

**Step 1: Implement the parser**

```typescript
export interface ParsedShift {
  employeeName: string;
  startTime: string;  // Local ISO without timezone: 2026-02-28T10:00:00.000
  endTime: string;
  position: string;
  location?: string;
  breakDuration?: number;
  notes?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_HEADERS = ['unassigned shifts', 'available shifts', 'scheduled shifts'];

// Regex to extract: "10:00 AM - 11:00 PM • 13h" line followed by "Server • San Antonio" line
const SHIFT_BLOCK_PATTERN = /(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*•\s*[\d]+h(?:\s*\d+min)?\n([^•\n]+?)•\s*([^\n]+)/g;

export function isSlingFormat(headers: string[], rows: Record<string, string>[]): boolean {
  // Check: at least 3 of columns 1-7 look like YYYY-MM-DD dates
  const dateColumns = headers.slice(1).filter(h => DATE_PATTERN.test(h.trim()));
  if (dateColumns.length < 3) return false;

  // Check: some row contains multi-line shift pattern
  return rows.some(row =>
    Object.values(row).some(cell =>
      typeof cell === 'string' && /\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M/.test(cell)
    )
  );
}

function parseTime12h(timeStr: string): { hours: number; minutes: number } {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return { hours: 0, minutes: 0 };
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
}

function buildLocalISO(dateStr: string, hours: number, minutes: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
  // Format as local ISO without timezone
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000`;
}

function addOneDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day + 1);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseSlingShiftCell(cell: string, dateStr: string): ParsedShift[] {
  if (!cell || !cell.trim()) return [];

  const shifts: ParsedShift[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(SHIFT_BLOCK_PATTERN.source, 'g');

  while ((match = regex.exec(cell)) !== null) {
    const startTimeStr = match[1];
    const endTimeStr = match[2];
    const position = match[3].trim();
    const location = match[4].trim();

    const start = parseTime12h(startTimeStr);
    const end = parseTime12h(endTimeStr);

    const startISO = buildLocalISO(dateStr, start.hours, start.minutes);

    // Overnight detection: if end hour < start hour, shift crosses midnight
    let endDateStr = dateStr;
    if (end.hours < start.hours || (end.hours === start.hours && end.minutes < start.minutes)) {
      endDateStr = addOneDay(dateStr);
    }
    const endISO = buildLocalISO(endDateStr, end.hours, end.minutes);

    shifts.push({
      employeeName: '', // Set by caller
      startTime: startISO,
      endTime: endISO,
      position,
      location,
    });
  }

  return shifts;
}

export function parseSlingCSV(headers: string[], rows: Record<string, string>[]): ParsedShift[] {
  // Extract date columns (skip first empty header)
  const dateColumns = headers.slice(1).filter(h => DATE_PATTERN.test(h.trim()));
  const nameColumn = headers[0]; // First column is employee name

  const allShifts: ParsedShift[] = [];

  for (const row of rows) {
    const name = row[nameColumn]?.trim();
    if (!name) continue;

    // Skip section headers
    if (SECTION_HEADERS.includes(name.toLowerCase())) continue;

    // Check if this row has any shift data
    const hasShifts = dateColumns.some(dateCol => {
      const cell = row[dateCol];
      return cell && /\d{1,2}:\d{2}\s*[AP]M/.test(cell);
    });
    if (!hasShifts) continue;

    for (const dateCol of dateColumns) {
      const cell = row[dateCol];
      if (!cell) continue;

      const shifts = parseSlingShiftCell(cell, dateCol.trim());
      for (const shift of shifts) {
        shift.employeeName = name;
        allShifts.push(shift);
      }
    }
  }

  return allShifts;
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/slingCsvParser.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/utils/slingCsvParser.ts tests/unit/slingCsvParser.test.ts
git commit -m "feat: add Sling CSV parser with grid format detection"
```

---

### Task 3: Shift Column Mapping — Tests

**Files:**
- Create: `tests/unit/shiftColumnMapping.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import {
  suggestShiftMappings,
  type ShiftColumnMapping,
  type ShiftTargetField,
} from '@/utils/shiftColumnMapping';

describe('shiftColumnMapping', () => {
  it('maps common shift CSV headers with high confidence', () => {
    const headers = ['Employee Name', 'Date', 'Start Time', 'End Time', 'Position', 'Break Duration'];
    const sampleData = [{ 'Employee Name': 'John', Date: '2026-02-23', 'Start Time': '9:00 AM', 'End Time': '5:00 PM', Position: 'Server', 'Break Duration': '30' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    const findMapping = (field: ShiftTargetField) => mappings.find(m => m.targetField === field);
    expect(findMapping('employee_name')?.confidence).toBe('high');
    expect(findMapping('date')?.confidence).toBe('high');
    expect(findMapping('start_time')?.confidence).toBe('high');
    expect(findMapping('end_time')?.confidence).toBe('high');
    expect(findMapping('position')?.confidence).toBe('high');
    expect(findMapping('break_duration')).toBeDefined();
  });

  it('maps aliased headers like employee_id, shift_date', () => {
    const headers = ['employee_id', 'shift_date', 'clock_in', 'clock_out'];
    const sampleData = [{ employee_id: 'emp-1', shift_date: '2026-02-23', clock_in: '09:00', clock_out: '17:00' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    expect(mappings.find(m => m.targetField === 'employee_id')).toBeDefined();
    expect(mappings.find(m => m.targetField === 'date')).toBeDefined();
    expect(mappings.find(m => m.targetField === 'start_time')).toBeDefined();
    expect(mappings.find(m => m.targetField === 'end_time')).toBeDefined();
  });

  it('does not map the same field twice', () => {
    const headers = ['Name', 'Employee Name', 'Date', 'Start', 'End'];
    const sampleData = [{ Name: 'John', 'Employee Name': 'John Smith', Date: '2026-02-23', Start: '9:00 AM', End: '5:00 PM' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    const employeeNameMappings = mappings.filter(m => m.targetField === 'employee_name');
    expect(employeeNameMappings).toHaveLength(1);
  });

  it('falls back to first text column for employee_name if no keyword match', () => {
    const headers = ['Col A', 'Col B', 'Col C'];
    const sampleData = [{ 'Col A': 'John Smith', 'Col B': '2026-02-23', 'Col C': '09:00' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    expect(mappings.find(m => m.targetField === 'employee_name')?.csvColumn).toBe('Col A');
    expect(mappings.find(m => m.targetField === 'employee_name')?.confidence).toBe('low');
  });

  it('sets null targetField for unrecognized columns', () => {
    const headers = ['Employee Name', 'Favorite Color'];
    const sampleData = [{ 'Employee Name': 'John', 'Favorite Color': 'Blue' }];
    const mappings = suggestShiftMappings(headers, sampleData);

    expect(mappings.find(m => m.csvColumn === 'Favorite Color')?.targetField).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/shiftColumnMapping.test.ts`
Expected: FAIL — module not found

**Step 3: Commit**

```bash
git add tests/unit/shiftColumnMapping.test.ts
git commit -m "test: add shift column mapping tests (red)"
```

---

### Task 4: Shift Column Mapping — Implementation

**Files:**
- Create: `src/utils/shiftColumnMapping.ts`

**Step 1: Implement the mapping heuristics**

Follow the exact pattern from `src/utils/timePunchImport.ts` lines 44-350 (the `KeywordPattern`, `FIELD_PATTERNS`, `calculateConfidence`, and `suggestTimePunchMappings` functions), adapted for shift fields:

```typescript
import { normalizeEmployeeKey } from '@/utils/timePunchImport';

export type ShiftTargetField =
  | 'employee_name'
  | 'employee_id'
  | 'date'
  | 'start_time'
  | 'end_time'
  | 'start_datetime'
  | 'end_datetime'
  | 'position'
  | 'break_duration'
  | 'notes';

export interface ShiftColumnMapping {
  csvColumn: string;
  targetField: ShiftTargetField | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface ShiftFieldOption {
  value: ShiftTargetField | 'ignore';
  label: string;
  required?: boolean;
}

export const SHIFT_FIELD_OPTIONS: ShiftFieldOption[] = [
  { value: 'employee_name', label: 'Employee Name', required: true },
  { value: 'employee_id', label: 'Employee ID' },
  { value: 'date', label: 'Date' },
  { value: 'start_time', label: 'Start Time', required: true },
  { value: 'end_time', label: 'End Time', required: true },
  { value: 'start_datetime', label: 'Start Date/Time' },
  { value: 'end_datetime', label: 'End Date/Time' },
  { value: 'position', label: 'Position / Role' },
  { value: 'break_duration', label: 'Break Duration (min)' },
  { value: 'notes', label: 'Notes' },
  { value: 'ignore', label: '(Ignore this column)' },
];

interface KeywordPattern {
  keywords: string[];
  aliases?: string[];
  weight: number;
}

const FIELD_PATTERNS: Record<ShiftTargetField, KeywordPattern> = {
  employee_name: {
    keywords: ['employee', 'employee name', 'name', 'staff', 'team member', 'worker'],
    aliases: ['employee_name', 'staff_name'],
    weight: 10,
  },
  employee_id: {
    keywords: ['employee id', 'emp id', 'staff id', 'employee number'],
    aliases: ['employee_id', 'empid'],
    weight: 8,
  },
  date: {
    keywords: ['date', 'work date', 'shift date', 'day'],
    aliases: ['shift_date', 'work_date'],
    weight: 8,
  },
  start_time: {
    keywords: ['start time', 'time in', 'clock in', 'in time', 'start', 'begin', 'shift start'],
    aliases: ['start_time', 'clock_in', 'time_in'],
    weight: 9,
  },
  end_time: {
    keywords: ['end time', 'time out', 'clock out', 'out time', 'end', 'finish', 'shift end'],
    aliases: ['end_time', 'clock_out', 'time_out'],
    weight: 9,
  },
  start_datetime: {
    keywords: ['start datetime', 'shift start datetime'],
    aliases: ['start_datetime'],
    weight: 7,
  },
  end_datetime: {
    keywords: ['end datetime', 'shift end datetime'],
    aliases: ['end_datetime'],
    weight: 7,
  },
  position: {
    keywords: ['position', 'role', 'job', 'job title', 'department', 'station', 'title'],
    aliases: ['job_title', 'dept'],
    weight: 6,
  },
  break_duration: {
    keywords: ['break', 'break duration', 'break length', 'meal break', 'lunch', 'rest'],
    aliases: ['break_duration', 'break_minutes'],
    weight: 7,
  },
  notes: {
    keywords: ['notes', 'note', 'comments', 'comment', 'memo'],
    aliases: ['remarks'],
    weight: 5,
  },
};

const calculateConfidence = (csvColumn: string, targetField: ShiftTargetField) => {
  const pattern = FIELD_PATTERNS[targetField];
  const normalizedColumn = normalizeEmployeeKey(csvColumn);
  let score = 0;

  if (pattern.keywords.some(kw => normalizeEmployeeKey(kw) === normalizedColumn)) {
    score = pattern.weight * 10;
  } else if (pattern.aliases?.some(alias => normalizeEmployeeKey(alias) === normalizedColumn)) {
    score = pattern.weight * 9;
  } else if (pattern.keywords.some(kw => normalizedColumn.includes(normalizeEmployeeKey(kw)))) {
    score = pattern.weight * 7;
  }

  const confidence: ShiftColumnMapping['confidence'] =
    score >= 70 ? 'high' :
    score >= 40 ? 'medium' :
    score >= 20 ? 'low' :
    'none';

  return { score, confidence };
};

export const suggestShiftMappings = (
  headers: string[],
  sampleData: Record<string, string>[],
): ShiftColumnMapping[] => {
  const mappings: ShiftColumnMapping[] = [];
  const mappedFields = new Set<ShiftTargetField>();

  headers.forEach(csvColumn => {
    let bestMatch: { field: ShiftTargetField; score: number; confidence: ShiftColumnMapping['confidence'] } | null = null;

    (Object.keys(FIELD_PATTERNS) as ShiftTargetField[]).forEach(targetField => {
      const { score, confidence } = calculateConfidence(csvColumn, targetField);
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        if (!mappedFields.has(targetField)) {
          bestMatch = { field: targetField, score, confidence };
        }
      }
    });

    if (bestMatch && bestMatch.confidence !== 'none') {
      mappedFields.add(bestMatch.field);
      mappings.push({
        csvColumn,
        targetField: bestMatch.field,
        confidence: bestMatch.confidence,
      });
    } else {
      mappings.push({
        csvColumn,
        targetField: null,
        confidence: 'none',
      });
    }
  });

  // Fallback: if no employee_name mapped, use first text column
  const hasEmployee = mappings.some(m => m.targetField === 'employee_name');
  if (!hasEmployee) {
    const firstTextColumn = mappings.find(m => {
      const samples = sampleData.slice(0, 5).map(row => row[m.csvColumn]);
      return samples.some(v => v && Number.isNaN(Number.parseFloat(v)));
    });
    if (firstTextColumn) {
      firstTextColumn.targetField = 'employee_name';
      firstTextColumn.confidence = 'low';
    }
  }

  return mappings;
};
```

**Step 2: Run tests**

Run: `npx vitest run tests/unit/shiftColumnMapping.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/utils/shiftColumnMapping.ts tests/unit/shiftColumnMapping.test.ts
git commit -m "feat: add shift column mapping heuristics"
```

---

### Task 5: Employee Matching Utility — Tests

**Files:**
- Create: `tests/unit/shiftEmployeeMatching.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import type { Employee } from '@/types/scheduling';
import {
  matchEmployees,
  type ShiftImportEmployee,
} from '@/utils/shiftEmployeeMatching';

const makeEmployee = (id: string, name: string, position: string): Employee =>
  ({ id, name, position, status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 0 } as Employee);

describe('shiftEmployeeMatching', () => {
  const employees = [
    makeEmployee('emp-1', 'Abraham Dominguez', 'Server'),
    makeEmployee('emp-2', 'Gaspar Vidanez', 'Kitchen Manager'),
    makeEmployee('emp-3', 'Alfonso Moya', 'Owner'),
  ];

  it('matches exact names', () => {
    const csvNames = [
      { name: 'Abraham Dominguez', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBe('emp-1');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('matches case-insensitively with extra spaces', () => {
    const csvNames = [
      { name: 'abraham   dominguez', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBe('emp-1');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('matches reversed name order', () => {
    const csvNames = [
      { name: 'Dominguez, Abraham', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBe('emp-1');
    expect(result[0].matchConfidence).toBe('exact');
  });

  it('marks unmatched names with none confidence', () => {
    const csvNames = [
      { name: 'Gaspar Chef  Vidanez', position: 'Kitchen Manager' },
    ];
    const result = matchEmployees(csvNames, employees);
    // "gaspar chef vidanez" != "gaspar vidanez" — no exact match
    expect(result[0].matchConfidence).toBe('partial');
    // Should suggest Gaspar Vidanez as partial match
    expect(result[0].matchedEmployeeId).toBe('emp-2');
  });

  it('reports completely unknown employees as none', () => {
    const csvNames = [
      { name: 'Totally Unknown Person', position: 'Server' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result[0].matchedEmployeeId).toBeNull();
    expect(result[0].matchConfidence).toBe('none');
    expect(result[0].action).toBe('create');
  });

  it('deduplicates CSV names and uses most frequent position', () => {
    const csvNames = [
      { name: 'Abraham Dominguez', position: 'Server' },
      { name: 'Abraham Dominguez', position: 'Server' },
      { name: 'Abraham Dominguez', position: 'Bartender' },
    ];
    const result = matchEmployees(csvNames, employees);
    // Should only have one entry for Abraham
    expect(result).toHaveLength(1);
    expect(result[0].csvPosition).toBe('Server'); // Most frequent
  });

  it('sets action to link for exact matches, create for none', () => {
    const csvNames = [
      { name: 'Abraham Dominguez', position: 'Server' },
      { name: 'Unknown Person', position: 'Cook' },
    ];
    const result = matchEmployees(csvNames, employees);
    expect(result.find(r => r.csvName === 'Abraham Dominguez')?.action).toBe('link');
    expect(result.find(r => r.csvName === 'Unknown Person')?.action).toBe('create');
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/shiftEmployeeMatching.test.ts`
Expected: FAIL — module not found

**Step 3: Commit**

```bash
git add tests/unit/shiftEmployeeMatching.test.ts
git commit -m "test: add shift employee matching tests (red)"
```

---

### Task 6: Employee Matching Utility — Implementation

**Files:**
- Create: `src/utils/shiftEmployeeMatching.ts`

**Step 1: Implement**

```typescript
import { Employee } from '@/types/scheduling';
import { normalizeEmployeeKey } from '@/utils/timePunchImport';

export interface ShiftImportEmployee {
  csvName: string;
  normalizedName: string;
  matchedEmployeeId: string | null;
  matchedEmployeeName: string | null;
  matchConfidence: 'exact' | 'partial' | 'none';
  csvPosition: string;
  action: 'link' | 'create' | 'skip';
}

function buildEmployeeLookup(employees: Employee[]) {
  const lookup = new Map<string, Employee>();

  const add = (name: string, employee: Employee) => {
    const normalized = normalizeEmployeeKey(name);
    if (normalized) lookup.set(normalized, employee);
  };

  employees.forEach(employee => {
    add(employee.name, employee);

    const commaParts = employee.name.split(',').map(p => p.trim()).filter(Boolean);
    if (commaParts.length === 2) {
      const [last, first] = commaParts;
      add(`${first} ${last}`, employee);
      add(`${last} ${first}`, employee);
    } else {
      const words = employee.name.trim().split(/\s+/);
      if (words.length >= 2) {
        const first = words[0];
        const last = words[words.length - 1];
        add(`${last}, ${first}`, employee);
        add(`${last} ${first}`, employee);
      }
    }
  });

  return lookup;
}

function findPartialMatch(normalizedName: string, employees: Employee[]): Employee | null {
  const csvWords = normalizedName.split(' ').filter(w => w.length > 1);
  if (csvWords.length === 0) return null;

  let bestMatch: Employee | null = null;
  let bestScore = 0;

  for (const emp of employees) {
    const empWords = normalizeEmployeeKey(emp.name).split(' ').filter(w => w.length > 1);
    // Count how many CSV words appear in the employee name
    const matchingWords = csvWords.filter(w => empWords.includes(w));
    const score = matchingWords.length / Math.max(csvWords.length, empWords.length);
    if (score > bestScore && matchingWords.length >= 2) {
      bestScore = score;
      bestMatch = emp;
    }
  }

  return bestMatch;
}

function getMostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = values[0] || '';
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) { best = value; bestCount = count; }
  });
  return best;
}

export function matchEmployees(
  csvNames: Array<{ name: string; position: string }>,
  employees: Employee[],
): ShiftImportEmployee[] {
  const lookup = buildEmployeeLookup(employees);

  // Deduplicate by normalized name, collecting positions
  const grouped = new Map<string, { originalNames: string[]; positions: string[] }>();
  for (const { name, position } of csvNames) {
    const normalized = normalizeEmployeeKey(name);
    if (!normalized) continue;
    const entry = grouped.get(normalized) || { originalNames: [], positions: [] };
    if (!entry.originalNames.includes(name)) entry.originalNames.push(name);
    entry.positions.push(position);
    grouped.set(normalized, entry);
  }

  const results: ShiftImportEmployee[] = [];

  grouped.forEach((group, normalizedName) => {
    const csvName = group.originalNames[0];
    const csvPosition = getMostFrequent(group.positions.filter(Boolean)) || '';

    // Try exact lookup
    const exactMatch = lookup.get(normalizedName);
    if (exactMatch) {
      results.push({
        csvName,
        normalizedName,
        matchedEmployeeId: exactMatch.id,
        matchedEmployeeName: exactMatch.name,
        matchConfidence: 'exact',
        csvPosition,
        action: 'link',
      });
      return;
    }

    // Try partial match (at least 2 words in common)
    const partialMatch = findPartialMatch(normalizedName, employees);
    if (partialMatch) {
      results.push({
        csvName,
        normalizedName,
        matchedEmployeeId: partialMatch.id,
        matchedEmployeeName: partialMatch.name,
        matchConfidence: 'partial',
        csvPosition,
        action: 'link',
      });
      return;
    }

    // No match
    results.push({
      csvName,
      normalizedName,
      matchedEmployeeId: null,
      matchedEmployeeName: null,
      matchConfidence: 'none',
      csvPosition,
      action: 'create',
    });
  });

  return results.sort((a, b) => a.csvName.localeCompare(b.csvName));
}
```

**Step 2: Run tests**

Run: `npx vitest run tests/unit/shiftEmployeeMatching.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/utils/shiftEmployeeMatching.ts tests/unit/shiftEmployeeMatching.test.ts
git commit -m "feat: add shift employee matching with fuzzy name lookup"
```

---

### Task 7: Shift Import Preview Builder — Tests

**Files:**
- Create: `tests/unit/shiftImportPreview.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import type { Employee } from '@/types/scheduling';
import type { Shift } from '@/types/scheduling';
import {
  buildShiftImportPreview,
  type ShiftImportPreviewResult,
} from '@/utils/shiftImportPreview';
import type { ParsedShift } from '@/utils/slingCsvParser';

const makeEmployee = (id: string, name: string): Employee =>
  ({ id, name, position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 0 } as Employee);

const makeShift = (id: string, employeeId: string, start: string, end: string): Shift =>
  ({ id, restaurant_id: 'rest-1', employee_id: employeeId, start_time: start, end_time: end, break_duration: 0, position: 'Server', status: 'scheduled', is_published: false, locked: false } as Shift);

describe('buildShiftImportPreview', () => {
  const employees = [makeEmployee('emp-1', 'Abraham Dominguez')];
  const employeeMap = { 'Abraham Dominguez': 'emp-1' };

  it('builds preview from parsed shifts with matched employees', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: [],
      restaurantId: 'rest-1',
    });
    expect(result.summary.totalShifts).toBe(1);
    expect(result.summary.readyCount).toBe(1);
    expect(result.shifts[0].status).toBe('ready');
    expect(result.shifts[0].employeeId).toBe('emp-1');
  });

  it('marks shifts as duplicate when overlapping with existing', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    const existingShifts: Shift[] = [
      makeShift('shift-1', 'emp-1', '2026-02-28T10:00:00.000', '2026-02-28T23:00:00.000'),
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts,
      publishedWeeks: [],
      restaurantId: 'rest-1',
    });
    expect(result.summary.duplicateCount).toBe(1);
    expect(result.shifts[0].status).toBe('duplicate');
  });

  it('marks shifts as published when target week is locked', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    // publishedWeeks contains the Monday of the week containing Feb 28 (a Saturday)
    // Feb 23 is the Monday of that week
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: ['2026-02-23'],
      restaurantId: 'rest-1',
    });
    expect(result.summary.publishedCount).toBe(1);
    expect(result.shifts[0].status).toBe('published');
  });

  it('marks shifts as skipped when employee not in employeeMap', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Unknown Person', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap: {},
      existingShifts: [],
      publishedWeeks: [],
      restaurantId: 'rest-1',
    });
    expect(result.summary.skippedCount).toBe(1);
    expect(result.shifts[0].status).toBe('skipped');
  });

  it('calculates total hours correctly', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T18:00:00.000', position: 'Server' },
      { employeeName: 'Abraham Dominguez', startTime: '2026-03-01T17:00:00.000', endTime: '2026-03-01T23:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: [],
      restaurantId: 'rest-1',
    });
    expect(result.summary.totalHours).toBe(14); // 8 + 6
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/shiftImportPreview.test.ts`
Expected: FAIL — module not found

**Step 3: Commit**

```bash
git add tests/unit/shiftImportPreview.test.ts
git commit -m "test: add shift import preview builder tests (red)"
```

---

### Task 8: Shift Import Preview Builder — Implementation

**Files:**
- Create: `src/utils/shiftImportPreview.ts`

**Step 1: Implement**

```typescript
import type { Shift } from '@/types/scheduling';
import type { ParsedShift } from '@/utils/slingCsvParser';

export interface PreviewShift extends ParsedShift {
  employeeId: string | null;
  status: 'ready' | 'duplicate' | 'published' | 'skipped';
  existingShiftId?: string;
}

export interface ShiftImportPreviewResult {
  shifts: PreviewShift[];
  summary: {
    totalShifts: number;
    totalHours: number;
    readyCount: number;
    duplicateCount: number;
    publishedCount: number;
    skippedCount: number;
    newEmployeesCount: number;
  };
}

function getWeekMonday(dateStr: string): string {
  // Parse the local date portion
  const date = new Date(dateStr);
  const day = date.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // Monday offset
  const monday = new Date(date);
  monday.setDate(monday.getDate() + diff);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function shiftsOverlap(
  aStart: string, aEnd: string,
  bStart: string, bEnd: string,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function hoursBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

export function buildShiftImportPreview({
  parsedShifts,
  employeeMap,
  existingShifts,
  publishedWeeks,
  restaurantId,
}: {
  parsedShifts: ParsedShift[];
  employeeMap: Record<string, string>; // csvName -> employeeId
  existingShifts: Shift[];
  publishedWeeks: string[]; // Array of Monday date strings for published weeks
  restaurantId: string;
}): ShiftImportPreviewResult {
  const publishedSet = new Set(publishedWeeks);
  let readyCount = 0;
  let duplicateCount = 0;
  let publishedCount = 0;
  let skippedCount = 0;
  let totalHours = 0;

  const shifts: PreviewShift[] = parsedShifts.map(parsed => {
    const employeeId = employeeMap[parsed.employeeName] || null;

    if (!employeeId) {
      skippedCount++;
      return { ...parsed, employeeId, status: 'skipped' as const };
    }

    // Check published week
    const weekMonday = getWeekMonday(parsed.startTime);
    if (publishedSet.has(weekMonday)) {
      publishedCount++;
      return { ...parsed, employeeId, status: 'published' as const };
    }

    // Check for duplicate/overlap with existing shifts for this employee
    const existingForEmployee = existingShifts.filter(s => s.employee_id === employeeId);
    const overlapping = existingForEmployee.find(existing =>
      shiftsOverlap(parsed.startTime, parsed.endTime, existing.start_time, existing.end_time)
    );
    if (overlapping) {
      duplicateCount++;
      return { ...parsed, employeeId, status: 'duplicate' as const, existingShiftId: overlapping.id };
    }

    // Ready to import
    readyCount++;
    totalHours += hoursBetween(parsed.startTime, parsed.endTime);
    return { ...parsed, employeeId, status: 'ready' as const };
  });

  return {
    shifts,
    summary: {
      totalShifts: parsedShifts.length,
      totalHours: Math.round(totalHours * 10) / 10,
      readyCount,
      duplicateCount,
      publishedCount,
      skippedCount,
      newEmployeesCount: 0, // Set by caller based on employee review
    },
  };
}
```

**Step 2: Run tests**

Run: `npx vitest run tests/unit/shiftImportPreview.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/utils/shiftImportPreview.ts tests/unit/shiftImportPreview.test.ts
git commit -m "feat: add shift import preview builder with duplicate/published detection"
```

---

### Task 9: Bulk Create Shifts Hook

**Files:**
- Create: `src/hooks/useBulkCreateShifts.ts`

**Step 1: Implement the mutation hook**

Reference: `src/hooks/useShifts.tsx` for the `useCreateShift` pattern and Supabase client import. Reference: `src/hooks/useTimePunches.tsx` for the bulk chunking pattern.

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BulkShiftInsert {
  restaurant_id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  notes?: string | null;
  status: 'scheduled';
  is_published: boolean;
  locked: boolean;
}

export function useBulkCreateShifts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (shifts: BulkShiftInsert[]) => {
      if (!shifts.length) return [];

      const chunkSize = 500;
      const allCreated: unknown[] = [];

      for (let i = 0; i < shifts.length; i += chunkSize) {
        const chunk = shifts.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from('shifts')
          .insert(chunk)
          .select();

        if (error) throw error;
        if (data) allCreated.push(...data);
      }

      return allCreated;
    },
    onSuccess: (data) => {
      // Invalidate shifts queries for all date ranges
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
```

**Step 2: Commit**

```bash
git add src/hooks/useBulkCreateShifts.ts
git commit -m "feat: add useBulkCreateShifts hook for batch shift insertion"
```

---

### Task 10: ShiftImportSheet Component — Main Multi-Step Flow

**Files:**
- Create: `src/components/scheduling/ShiftImportSheet.tsx`

**Step 1: Build the component**

This is the largest file. Follow `src/components/time-tracking/TimePunchUploadSheet.tsx` for structure. Key differences:
- Step 1 (upload): Parse CSV, auto-detect Sling vs generic format
- Step 2 (mapping): Only shown for generic CSVs. Sling skips to step 3.
- Step 3 (employee review): Show `ShiftImportEmployeeReview` sub-component
- Step 4 (preview): Show `ShiftImportPreview` sub-component
- Step 5 (importing): Execute bulk insert

Reference files to study:
- `src/components/time-tracking/TimePunchUploadSheet.tsx` — multi-step sheet structure, Papa Parse usage, employee override handling
- `src/components/ColumnMappingDialog.tsx` — column mapping UI pattern (Select dropdowns with confidence badges)
- `src/utils/slingCsvParser.ts` — `isSlingFormat`, `parseSlingCSV` (Task 2)
- `src/utils/shiftColumnMapping.ts` — `suggestShiftMappings`, `SHIFT_FIELD_OPTIONS` (Task 4)
- `src/utils/shiftEmployeeMatching.ts` — `matchEmployees` (Task 6)
- `src/utils/shiftImportPreview.ts` — `buildShiftImportPreview` (Task 8)
- `src/hooks/useBulkCreateShifts.ts` — bulk insert mutation (Task 9)

Component structure (pseudocode):

```typescript
type ImportStep = 'upload' | 'mapping' | 'employees' | 'preview' | 'importing';

// State:
// - step: ImportStep
// - parsedShifts: ParsedShift[] (from Sling or generic parser)
// - headers/rows (for generic CSV mapping)
// - mappings: ShiftColumnMapping[]
// - employeeMatches: ShiftImportEmployee[]
// - employeeMap: Record<string, string> (csvName → employeeId, updated by review)
// - preview: ShiftImportPreviewResult
// - isSling: boolean

// Flow:
// Upload → Papa.parse → if isSlingFormat → parseSlingCSV → skip to 'employees'
//                        else → suggestShiftMappings → show 'mapping'
// Mapping → user adjusts → parse rows into ParsedShift[] → 'employees'
// Employees → matchEmployees → user reviews → update employeeMap → 'preview'
// Preview → buildShiftImportPreview → show table → 'importing'
// Importing → create new employees → useBulkCreateShifts → close sheet

// UI: Sheet with SheetContent, progress steps at top, step-specific content, footer with Back/Next/Import buttons
```

Follow Apple/Notion design system from CLAUDE.md:
- Sheet header: text-[17px] font-semibold, icon box with Upload icon
- Progress: Apple-style step indicators
- Tables: text-[14px] body, text-[13px] secondary
- Badges: text-[11px] for confidence/status
- Buttons: h-9 rounded-lg text-[13px] font-medium

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftImportSheet.tsx
git commit -m "feat: add ShiftImportSheet multi-step upload component"
```

---

### Task 11: ShiftImportEmployeeReview Sub-Component

**Files:**
- Create: `src/components/scheduling/ShiftImportEmployeeReview.tsx`

**Step 1: Build the employee review table**

Props:
```typescript
interface ShiftImportEmployeeReviewProps {
  employeeMatches: ShiftImportEmployee[];
  existingEmployees: Employee[];
  onUpdateMatch: (csvName: string, employeeId: string | null, action: 'link' | 'create' | 'skip') => void;
  onBulkCreateAll: () => void;
  isCreating: boolean;
}
```

Features:
- Table with: CSV Name | Status Badge | Matched To | Position | Action buttons
- Status badges: green "Matched" / amber "Partial" / gray "Unmatched"
- For matched: "Change" dropdown showing all employees
- For unmatched: "Link Existing" dropdown + "Create New" button
- Bulk "Create All Unmatched" button at top-right
- Show count: "X of Y employees matched"

Follow Apple/Notion styling:
- Table rows: `group flex items-center justify-between p-4 rounded-xl border border-border/40`
- Status badges: `text-[11px] px-1.5 py-0.5 rounded-md`
- Green: `bg-green-500/10 text-green-600`
- Amber: `bg-amber-500/10 text-amber-600`
- Gray: `bg-muted text-muted-foreground`

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftImportEmployeeReview.tsx
git commit -m "feat: add ShiftImportEmployeeReview component"
```

---

### Task 12: ShiftImportPreview Sub-Component

**Files:**
- Create: `src/components/scheduling/ShiftImportPreview.tsx`

**Step 1: Build the preview table**

Props:
```typescript
interface ShiftImportPreviewProps {
  preview: ShiftImportPreviewResult;
  onToggleForceImport?: (index: number) => void;
}
```

Features:
- Summary cards at top: Total shifts, Total hours, Ready (green), Duplicates (amber), Published blocks (red), Skipped (gray)
- Table grouped by date, sorted chronologically
- Columns: Employee | Date | Time | Duration | Position | Status
- Status badges same color coding as summary
- For "duplicate" rows: checkbox to force-import anyway

Follow Apple/Notion styling:
- Summary grid: `grid grid-cols-2 md:grid-cols-4 gap-3`
- Each metric: `rounded-xl border border-border/40 p-3`
- Table: standard shadcn Table with text-[14px] body

**Step 2: Commit**

```bash
git add src/components/scheduling/ShiftImportPreview.tsx
git commit -m "feat: add ShiftImportPreview component with summary cards"
```

---

### Task 13: Integrate into Scheduling Page

**Files:**
- Modify: `src/pages/Scheduling.tsx`

**Step 1: Add import button and sheet**

Find the toolbar area in `Scheduling.tsx` (look for the row of action buttons near the top — likely near `<Button>` components for adding shifts or employees).

Add:
1. Import for `ShiftImportSheet` and `Upload` icon at top of file
2. State: `const [shiftImportOpen, setShiftImportOpen] = useState(false);`
3. Button in toolbar: `<Button variant="outline" onClick={() => setShiftImportOpen(true)}><Upload className="h-3.5 w-3.5 mr-1.5" /> Import</Button>`
4. Sheet at bottom of JSX: `<ShiftImportSheet open={shiftImportOpen} onOpenChange={setShiftImportOpen} restaurantId={restaurantId} employees={employees} />`

Reference the existing button styling in Scheduling.tsx for consistency.

**Step 2: Run build to verify no type errors**

Run: `npx vite build 2>&1 | head -50`
Expected: Build succeeds or only pre-existing errors

**Step 3: Commit**

```bash
git add src/pages/Scheduling.tsx
git commit -m "feat: add Import button to Scheduling page toolbar"
```

---

### Task 14: End-to-End Manual Test & Polish

**Step 1: Run the dev server**

Run: `npm run dev`

**Step 2: Manual test checklist**

1. Navigate to Scheduling page
2. Click "Import" button — verify sheet opens
3. Upload the sample Sling CSV (`shifts-export (2).csv`)
4. Verify Sling format auto-detected, skips to employee review
5. Review employee matches — verify exact matches linked, unmatched shown
6. Click "Create All Unmatched" — verify new employees created
7. Proceed to preview — verify shifts listed with correct dates/times
8. Check duplicate detection against any existing shifts
9. Click Import — verify shifts appear on schedule
10. Test with a generic CSV (create a simple test file with headers: Employee, Date, Start, End, Position)
11. Verify column mapping step appears for generic CSV
12. Verify template save/load works

**Step 3: Fix any issues found during testing**

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: polish shift import flow based on manual testing"
```

---

### Task 15: Create PR

**Step 1: Push branch and create PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: shift CSV import with Sling support" --body "$(cat <<'EOF'
## Summary
- Add shift schedule import from CSV files
- Auto-detect Sling weekly grid format with smart parsing
- Generic flat CSV support with column mapping heuristics
- Fuzzy employee name matching with manual override
- Auto-create new employees for unmatched names
- Duplicate shift detection and published-week blocking
- Multi-step flow: Upload → Mapping → Employee Review → Preview → Import

## New Files
- `src/utils/slingCsvParser.ts` — Sling grid format parser
- `src/utils/shiftColumnMapping.ts` — Generic CSV column mapping
- `src/utils/shiftEmployeeMatching.ts` — Employee name matching
- `src/utils/shiftImportPreview.ts` — Preview builder with validation
- `src/hooks/useBulkCreateShifts.ts` — Bulk shift insert mutation
- `src/components/scheduling/ShiftImportSheet.tsx` — Main upload flow
- `src/components/scheduling/ShiftImportEmployeeReview.tsx` — Employee review
- `src/components/scheduling/ShiftImportPreview.tsx` — Import preview

## Test plan
- [x] Unit tests for Sling parser (format detection, cell parsing, overnight shifts)
- [x] Unit tests for column mapping heuristics
- [x] Unit tests for employee matching (exact, partial, none)
- [x] Unit tests for preview builder (duplicates, published weeks, hours calc)
- [ ] Manual test with real Sling CSV export
- [ ] Manual test with generic flat CSV
- [ ] Verify published-week blocking works

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
