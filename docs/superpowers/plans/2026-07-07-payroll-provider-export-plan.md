# Payroll Provider-Specific Export (Gusto) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Gusto-format payroll CSV export alongside the existing internal CSV, selectable from an "Export ▾" dropdown on the Payroll page.

**Architecture:** Two new pure util modules (`payrollGustoExport.ts` = the Gusto mapper; `payrollExportFormats.ts` = a small format registry) and one small presentational component (`PayrollExportMenu.tsx`) that renders a shadcn `DropdownMenu` and performs the blob download. `Payroll.tsx` swaps its single Export button for this component. No DB / edge-function / network surface — a pure client-side transform of data already on the page.

**Tech Stack:** React 18 + TypeScript, shadcn/ui (`DropdownMenu`), lucide icons, date-fns, Vitest + @testing-library/react + user-event.

**Design doc:** `docs/superpowers/specs/2026-07-07-payroll-provider-export-design.md`

**Source types (already exist, do not modify):** `EmployeePayroll` and `PayrollPeriod` in `src/utils/payrollCalculations.ts`. Money fields are in **cents**; hours are decimal. Relevant fields: `employeeName: string`, `position: string`, `regularHours`, `overtimeHours`, `doubleTimeHours`, `tipsOwed` (cents), `tipsPaidOut` (cents). `PayrollPeriod` has `{ startDate, endDate, employees, ... }`. `exportPayrollToCSV(period): string` is already exported (the internal format).

---

## Task 1: Gusto CSV headers + `splitEmployeeName`

**Files:**
- Create: `src/utils/payrollGustoExport.ts`
- Test: `tests/unit/payrollGustoExport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/payrollGustoExport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GUSTO_CSV_HEADERS, splitEmployeeName } from '@/utils/payrollGustoExport';

describe('GUSTO_CSV_HEADERS', () => {
  it('matches the Gusto import template exactly (16 columns, in order)', () => {
    expect(GUSTO_CSV_HEADERS.join(',')).toBe(
      'last_name,first_name,title,gusto_employee_id,regular_hours,overtime_hours,double_overtime_hours,missed_break_hours,owners_draw,bonus,commission,paycheck_tips,cash_tips,correction_payment,reimbursement,personal_note',
    );
  });
});

describe('splitEmployeeName', () => {
  it('splits "First Last" into first + last', () => {
    expect(splitEmployeeName('Jose Delgado')).toEqual({ firstName: 'Jose', lastName: 'Delgado' });
  });
  it('treats the last token as the last name and the rest as the first name', () => {
    expect(splitEmployeeName('Ana Maria Cruz')).toEqual({ firstName: 'Ana Maria', lastName: 'Cruz' });
  });
  it('preserves accented characters', () => {
    expect(splitEmployeeName('Javier Gutiérrez')).toEqual({ firstName: 'Javier', lastName: 'Gutiérrez' });
  });
  it('keeps original casing (does not normalize)', () => {
    expect(splitEmployeeName('Shy harrison')).toEqual({ firstName: 'Shy', lastName: 'harrison' });
  });
  it('collapses extra internal/leading/trailing whitespace', () => {
    expect(splitEmployeeName('  Colby   Mullaley  ')).toEqual({ firstName: 'Colby', lastName: 'Mullaley' });
  });
  it('puts a single token in firstName with a blank lastName', () => {
    expect(splitEmployeeName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });
  it('returns two blanks for empty/whitespace input', () => {
    expect(splitEmployeeName('   ')).toEqual({ firstName: '', lastName: '' });
    expect(splitEmployeeName('')).toEqual({ firstName: '', lastName: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollGustoExport.test.ts`
Expected: FAIL — cannot resolve `@/utils/payrollGustoExport`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/payrollGustoExport.ts`:

```ts
import type { PayrollPeriod } from '@/utils/payrollCalculations';

/**
 * Gusto timesheet-import column headers, in the exact order Gusto expects.
 * Pinned by test — do not reorder or rename without a matching Gusto template.
 */
export const GUSTO_CSV_HEADERS = [
  'last_name',
  'first_name',
  'title',
  'gusto_employee_id',
  'regular_hours',
  'overtime_hours',
  'double_overtime_hours',
  'missed_break_hours',
  'owners_draw',
  'bonus',
  'commission',
  'paycheck_tips',
  'cash_tips',
  'correction_payment',
  'reimbursement',
  'personal_note',
] as const;

/**
 * Split our single `employeeName` ("First Last") into Gusto's separate
 * last_name / first_name columns. Heuristic: the last whitespace-delimited
 * token is the last name; everything before it is the first name. A lone token
 * is treated as a first name (Gusto still name-matches). Empty → two blanks.
 */
export function splitEmployeeName(full: string): { firstName: string; lastName: string } {
  const tokens = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: '', lastName: '' };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: '' };
  return {
    firstName: tokens.slice(0, -1).join(' '),
    lastName: tokens[tokens.length - 1],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollGustoExport.test.ts`
Expected: PASS (all 9 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/utils/payrollGustoExport.ts tests/unit/payrollGustoExport.test.ts
git commit -m "feat(payroll): Gusto CSV headers + employee name split"
```

---

## Task 2: `buildGustoCSV` mapper

**Files:**
- Modify: `src/utils/payrollGustoExport.ts`
- Test: `tests/unit/payrollGustoExport.test.ts` (add a describe block)

Helper context: values are formatted as **plain numbers** (no `$`, no separators).
Money = `cents / 100` to 2 decimals; hours to 2 decimals. Any zero value → **blank
cell** (mirrors Gusto's template). Free-text cells are formula-injection-safe and
quoted only when necessary.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/payrollGustoExport.test.ts`:

```ts
import { buildGustoCSV } from '@/utils/payrollGustoExport';
import type { EmployeePayroll, PayrollPeriod } from '@/utils/payrollCalculations';

function employee(overrides: Partial<EmployeePayroll> = {}): EmployeePayroll {
  return {
    employeeId: 'e1',
    employeeName: 'Oscar Estrada',
    position: 'Server',
    area: null,
    compensationType: 'hourly',
    hourlyRate: 1000,
    regularHours: 0,
    overtimeHours: 0,
    doubleTimeHours: 0,
    doubleTimePay: 0,
    dailyOvertimeHours: 0,
    weeklyOvertimeHours: 0,
    regularPay: 0,
    overtimePay: 0,
    salaryPay: 0,
    contractorPay: 0,
    dailyRatePay: 0,
    manualPayments: [],
    manualPaymentsTotal: 0,
    grossPay: 0,
    totalTips: 0,
    tipsPaidOut: 0,
    tipsOwed: 0,
    totalPay: 0,
    ...overrides,
  };
}

function period(employees: EmployeePayroll[]): PayrollPeriod {
  return {
    startDate: new Date(2026, 5, 8),
    endDate: new Date(2026, 5, 14),
    employees,
    totalRegularHours: 0,
    totalOvertimeHours: 0,
    totalDoubleTimeHours: 0,
    totalGrossPay: 0,
    totalTips: 0,
    totalTipsPaidOut: 0,
    totalTipsOwed: 0,
  };
}

describe('buildGustoCSV', () => {
  it('emits the exact Gusto header as the first line', () => {
    const csv = buildGustoCSV(period([]));
    expect(csv).toBe(GUSTO_CSV_HEADERS.join(','));
  });

  it('maps name, title, hours and leaves gusto_employee_id blank', () => {
    const csv = buildGustoCSV(period([employee({
      employeeName: 'Oscar Estrada',
      position: 'Server',
      regularHours: 2.23,
      overtimeHours: 1.5,
      doubleTimeHours: 0,
    })]));
    const row = csv.split('\n')[1];
    // last_name,first_name,title,gusto_employee_id,regular,ot,double,missed,draw,bonus,comm,paycheck_tips,cash_tips,corr,reimb,note
    expect(row).toBe('Estrada,Oscar,Server,,2.23,1.50,,,,,,,,,,');
  });

  it('routes owed tips to paycheck_tips and paid-out tips to cash_tips (cents -> dollars)', () => {
    const csv = buildGustoCSV(period([employee({
      employeeName: 'Aleah Holderread',
      position: 'Server',
      tipsOwed: 1250,     // $12.50 owed -> paycheck_tips
      tipsPaidOut: 500,   // $5.00 already cash -> cash_tips
    })]));
    const cols = csv.split('\n')[1].split(',');
    expect(cols[11]).toBe('12.50'); // paycheck_tips
    expect(cols[12]).toBe('5.00');  // cash_tips
  });

  it('renders zero numeric values as blank cells', () => {
    const csv = buildGustoCSV(period([employee({ employeeName: 'Jodi Montes', position: 'Server' })]));
    expect(csv.split('\n')[1]).toBe('Montes,Jodi,Server,,,,,,,,,,,,,');
  });

  it('has no TOTAL row and no blank separator line', () => {
    const csv = buildGustoCSV(period([employee(), employee({ employeeName: 'Jose Delgado' })]));
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 employees
    expect(lines.some((l) => l.startsWith('TOTAL') || l.startsWith('"TOTAL"'))).toBe(false);
    expect(lines.some((l) => l.trim() === '')).toBe(false);
  });

  it('neutralizes CSV/formula injection in free-text cells', () => {
    const csv = buildGustoCSV(period([employee({ employeeName: '=cmd|calc Regular', position: '@SUM(A1)' })]));
    const row = csv.split('\n')[1];
    // Leading formula chars are prefixed with a single quote; a comma-free value stays unquoted.
    expect(row.startsWith("Regular,'=cmd|calc,'@SUM(A1),")).toBe(true);
  });

  it('quotes and escapes values containing commas or double-quotes', () => {
    const csv = buildGustoCSV(period([employee({ employeeName: 'John Doe', position: 'Cook, "Line"' })]));
    const row = csv.split('\n')[1];
    expect(row).toBe('Doe,John,"Cook, ""Line""",,,,,,,,,,,,,');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollGustoExport.test.ts`
Expected: FAIL — `buildGustoCSV` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utils/payrollGustoExport.ts`:

```ts
/**
 * Format cents as a plain dollar amount ("1250" -> "12.50"), or blank when zero.
 * No currency symbol / thousands separator — Gusto parses these as numbers.
 * Blank-when-zero also neutralizes negative-zero ("-0.00").
 */
function gustoMoney(cents: number): string {
  const s = (cents / 100).toFixed(2);
  return s === '0.00' || s === '-0.00' ? '' : s;
}

/** Format decimal hours to 2 places, or blank when zero. */
function gustoHours(hours: number): string {
  const s = hours.toFixed(2);
  return s === '0.00' || s === '-0.00' ? '' : s;
}

/**
 * CSV-safe rendering of a free-text cell for the Gusto file.
 * Distinct from `escapeCsvCell` in payrollCalculations.ts (which quotes every
 * cell for the internal format): Gusto's template uses bare, unquoted values, so
 * we quote ONLY when a comma / double-quote is present, keeping the file visually
 * identical to Gusto's own export. Still guards against spreadsheet formula
 * injection by prefixing a leading = + - @ with a single quote, and strips
 * newlines so a value can't split a row.
 */
function gustoText(value: string | null | undefined): string {
  const noNewlines = (value ?? '').replace(/\r?\n/g, ' ');
  const neutralized = /^[=+\-@]/.test(noNewlines) ? `'${noNewlines}` : noNewlines;
  if (neutralized === '') return '';
  if (/[",]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/**
 * Build a Gusto timesheet-import CSV from a payroll period.
 * Header + one row per employee — no TOTAL row, no blank lines, no BOM.
 * Columns we don't track (missed_break_hours, owners_draw, bonus, commission,
 * correction_payment, reimbursement, personal_note) and gusto_employee_id are
 * left blank; Gusto name-matches employees.
 */
export function buildGustoCSV(period: PayrollPeriod): string {
  const rows = period.employees.map((ep) => {
    const { firstName, lastName } = splitEmployeeName(ep.employeeName);
    return [
      gustoText(lastName),              // last_name
      gustoText(firstName),             // first_name
      gustoText(ep.position),           // title
      '',                               // gusto_employee_id
      gustoHours(ep.regularHours),      // regular_hours
      gustoHours(ep.overtimeHours),     // overtime_hours
      gustoHours(ep.doubleTimeHours),   // double_overtime_hours
      '',                               // missed_break_hours
      '',                               // owners_draw
      '',                               // bonus
      '',                               // commission
      gustoMoney(ep.tipsOwed),          // paycheck_tips (owed -> paid via paycheck)
      gustoMoney(ep.tipsPaidOut),       // cash_tips (already received in cash)
      '',                               // correction_payment
      '',                               // reimbursement
      '',                               // personal_note
    ].join(',');
  });

  return [GUSTO_CSV_HEADERS.join(','), ...rows].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollGustoExport.test.ts`
Expected: PASS (all buildGustoCSV + Task 1 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/utils/payrollGustoExport.ts tests/unit/payrollGustoExport.test.ts
git commit -m "feat(payroll): buildGustoCSV mapper (tips split, zero->blank, injection-safe)"
```

---

## Task 3: Export-format registry

**Files:**
- Create: `src/utils/payrollExportFormats.ts`
- Test: `tests/unit/payrollExportFormats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/payrollExportFormats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PAYROLL_EXPORT_FORMATS } from '@/utils/payrollExportFormats';
import { GUSTO_CSV_HEADERS } from '@/utils/payrollGustoExport';
import type { PayrollPeriod } from '@/utils/payrollCalculations';

function emptyPeriod(): PayrollPeriod {
  return {
    startDate: new Date(2026, 5, 8),
    endDate: new Date(2026, 5, 14),
    employees: [],
    totalRegularHours: 0,
    totalOvertimeHours: 0,
    totalDoubleTimeHours: 0,
    totalGrossPay: 0,
    totalTips: 0,
    totalTipsPaidOut: 0,
    totalTipsOwed: 0,
  };
}

describe('PAYROLL_EXPORT_FORMATS', () => {
  it('exposes the internal and gusto formats in order', () => {
    expect(PAYROLL_EXPORT_FORMATS.map((f) => f.id)).toEqual(['internal', 'gusto']);
  });

  it('labels are human-readable', () => {
    const byId = Object.fromEntries(PAYROLL_EXPORT_FORMATS.map((f) => [f.id, f.label]));
    expect(byId.internal).toBe('Standard CSV');
    expect(byId.gusto).toBe('Gusto CSV');
  });

  it('builds filenames from the period date range', () => {
    const start = new Date(2026, 5, 8);
    const end = new Date(2026, 5, 14);
    const byId = Object.fromEntries(PAYROLL_EXPORT_FORMATS.map((f) => [f.id, f]));
    expect(byId.internal.filename(start, end)).toBe('payroll_2026-06-08_to_2026-06-14.csv');
    expect(byId.gusto.filename(start, end)).toBe('payroll_gusto_2026-06-08_to_2026-06-14.csv');
  });

  it('gusto.build produces the Gusto header; internal.build produces the internal header', () => {
    const byId = Object.fromEntries(PAYROLL_EXPORT_FORMATS.map((f) => [f.id, f]));
    expect(byId.gusto.build(emptyPeriod()).split('\n')[0]).toBe(GUSTO_CSV_HEADERS.join(','));
    expect(byId.internal.build(emptyPeriod()).split('\n')[0]).toContain('Employee Name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollExportFormats.test.ts`
Expected: FAIL — cannot resolve `@/utils/payrollExportFormats`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/payrollExportFormats.ts`:

```ts
import { format } from 'date-fns';

import type { PayrollPeriod } from '@/utils/payrollCalculations';
import { exportPayrollToCSV } from '@/utils/payrollCalculations';
import { buildGustoCSV } from '@/utils/payrollGustoExport';

/** A selectable payroll export format (internal or a payroll provider). */
export interface PayrollExportFormat {
  id: 'internal' | 'gusto';
  /** Menu label shown in the Export dropdown. */
  label: string;
  /** Serialize a payroll period to CSV text for this format. */
  build: (period: PayrollPeriod) => string;
  /** Download filename for a given period date range. */
  filename: (start: Date, end: Date) => string;
}

/** Shared so the internal and provider filenames can't drift in date formatting. */
function formatDateRange(start: Date, end: Date): string {
  return `${format(start, 'yyyy-MM-dd')}_to_${format(end, 'yyyy-MM-dd')}`;
}

export const PAYROLL_EXPORT_FORMATS: readonly PayrollExportFormat[] = [
  {
    id: 'internal',
    label: 'Standard CSV',
    build: exportPayrollToCSV,
    filename: (start, end) => `payroll_${formatDateRange(start, end)}.csv`,
  },
  {
    id: 'gusto',
    label: 'Gusto CSV',
    build: buildGustoCSV,
    filename: (start, end) => `payroll_gusto_${formatDateRange(start, end)}.csv`,
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollExportFormats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/payrollExportFormats.ts tests/unit/payrollExportFormats.test.ts
git commit -m "feat(payroll): export-format registry (internal + gusto)"
```

---

## Task 4: `PayrollExportMenu` component

**Files:**
- Create: `src/components/payroll/PayrollExportMenu.tsx`
- Test: `tests/unit/PayrollExportMenu.test.tsx`

Note: `src/components/**` is excluded from coverage (see `vitest.config.ts`), so this
test is for correctness, not coverage. `tests/setup.ts` already shims
`hasPointerCapture`/`scrollIntoView`, so Radix menus open under jsdom.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/PayrollExportMenu.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PayrollExportMenu } from '@/components/payroll/PayrollExportMenu';
import { GUSTO_CSV_HEADERS } from '@/utils/payrollGustoExport';
import type { EmployeePayroll, PayrollPeriod } from '@/utils/payrollCalculations';

function employee(overrides: Partial<EmployeePayroll> = {}): EmployeePayroll {
  return {
    employeeId: 'e1', employeeName: 'Oscar Estrada', position: 'Server', area: null,
    compensationType: 'hourly', hourlyRate: 1000, regularHours: 2.23, overtimeHours: 0,
    doubleTimeHours: 0, doubleTimePay: 0, dailyOvertimeHours: 0, weeklyOvertimeHours: 0,
    regularPay: 2227, overtimePay: 0, salaryPay: 0, contractorPay: 0, dailyRatePay: 0,
    manualPayments: [], manualPaymentsTotal: 0, grossPay: 2227, totalTips: 0,
    tipsPaidOut: 0, tipsOwed: 0, totalPay: 2227, ...overrides,
  };
}

function period(): PayrollPeriod {
  return {
    startDate: new Date(2026, 5, 8), endDate: new Date(2026, 5, 14),
    employees: [employee()], totalRegularHours: 2.23, totalOvertimeHours: 0,
    totalDoubleTimeHours: 0, totalGrossPay: 2227, totalTips: 0, totalTipsPaidOut: 0,
    totalTipsOwed: 0,
  };
}

/** Capture the downloaded blob + filename by stubbing URL + anchor.click. */
function stubDownload() {
  let blob: Blob | undefined;
  let download = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blob = b as Blob; return 'blob:mock'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    download = this.download;
  });
  return { getBlob: () => blob, getDownload: () => download };
}

afterEach(() => vi.restoreAllMocks());

describe('PayrollExportMenu', () => {
  it('exports the Gusto format with the gusto filename and header', async () => {
    const dl = stubDownload();
    const user = userEvent.setup();
    render(<PayrollExportMenu period={period()} start={new Date(2026, 5, 8)} end={new Date(2026, 5, 14)} />);

    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(await screen.findByText('Gusto CSV'));

    expect(dl.getDownload()).toBe('payroll_gusto_2026-06-08_to_2026-06-14.csv');
    const text = await dl.getBlob()!.text();
    expect(text.split('\n')[0]).toBe(GUSTO_CSV_HEADERS.join(','));
  });

  it('exports the Standard format with the standard filename and header', async () => {
    const dl = stubDownload();
    const user = userEvent.setup();
    render(<PayrollExportMenu period={period()} start={new Date(2026, 5, 8)} end={new Date(2026, 5, 14)} />);

    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(await screen.findByText('Standard CSV'));

    expect(dl.getDownload()).toBe('payroll_2026-06-08_to_2026-06-14.csv');
    const text = await dl.getBlob()!.text();
    expect(text.split('\n')[0]).toContain('Employee Name');
  });

  it('disables the trigger when there are no employees to export', () => {
    render(<PayrollExportMenu period={null} start={new Date(2026, 5, 8)} end={new Date(2026, 5, 14)} disabled />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/PayrollExportMenu.test.tsx`
Expected: FAIL — cannot resolve `@/components/payroll/PayrollExportMenu`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/payroll/PayrollExportMenu.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Download } from 'lucide-react';

import type { PayrollPeriod } from '@/utils/payrollCalculations';
import type { PayrollExportFormat } from '@/utils/payrollExportFormats';
import { PAYROLL_EXPORT_FORMATS } from '@/utils/payrollExportFormats';

interface PayrollExportMenuProps {
  /** The ordered/grouped period to export, or null while loading/empty. */
  period: PayrollPeriod | null;
  start: Date;
  end: Date;
  disabled?: boolean;
}

/**
 * "Export ▾" dropdown offering each registered payroll export format.
 * Mirrors the export-picker precedent in src/pages/Inventory.tsx.
 */
export function PayrollExportMenu({ period, start, end, disabled }: PayrollExportMenuProps) {
  const handleExport = (format: PayrollExportFormat) => {
    if (!period) return;
    const csv = format.build(period);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format.filename(start, end);
    a.click();
    // Revoke after a tick so the browser can schedule the download first.
    setTimeout(() => window.URL.revokeObjectURL(url), 100);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={disabled}>
          <Download className="h-4 w-4 mr-2" aria-hidden="true" />
          Export
          <ChevronDown className="h-4 w-4 ml-2" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-background z-50">
        {PAYROLL_EXPORT_FORMATS.map((format) => (
          <DropdownMenuItem
            key={format.id}
            className="cursor-pointer"
            onClick={() => handleExport(format)}
          >
            {format.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/PayrollExportMenu.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/payroll/PayrollExportMenu.tsx tests/unit/PayrollExportMenu.test.tsx
git commit -m "feat(payroll): PayrollExportMenu dropdown (Standard + Gusto)"
```

---

## Task 5: Wire `PayrollExportMenu` into the Payroll page

**Files:**
- Modify: `src/pages/Payroll.tsx`

Removes the single Export button + `handleExportCSV`, replacing them with
`<PayrollExportMenu>`. `src/pages/**` is coverage-excluded; correctness is covered
by Tasks 1–4 plus typecheck/lint/build in Phase 8.

- [ ] **Step 1: Add the import**

In the "custom hooks / utils" import area of `src/pages/Payroll.tsx`, add:

```tsx
import { PayrollExportMenu } from '@/components/payroll/PayrollExportMenu';
```

- [ ] **Step 2: Remove the now-unused internal-export import**

Delete `exportPayrollToCSV` from the existing import of `@/utils/payrollCalculations` (line ~20). Leave the rest of that import intact. (The registry now owns that call.)

- [ ] **Step 3: Add an ordered-period memo**

Immediately after the existing `payrollGroups` `useMemo` (around line 439-442), add:

```tsx
  const orderedPeriod = useMemo(
    () => (payrollPeriod ? { ...payrollPeriod, employees: payrollGroups.flatMap((g) => g.rows) } : null),
    [payrollPeriod, payrollGroups],
  );
```

- [ ] **Step 4: Delete the old `handleExportCSV` handler**

Remove the entire `handleExportCSV` function (lines ~425-437). It is replaced by `PayrollExportMenu`'s internal handler.

- [ ] **Step 5: Replace the Export button with the menu**

Replace the `<Button onClick={handleExportCSV} ...>...Export CSV</Button>` block (lines ~749-755) with:

```tsx
              <PayrollExportMenu
                period={orderedPeriod}
                start={start}
                end={end}
                disabled={!payrollPeriod || payrollPeriod.employees.length === 0}
              />
```

- [ ] **Step 6: Drop the now-unused `Download` import if unreferenced**

Check whether `Download` (from `lucide-react`) is still used elsewhere in `src/pages/Payroll.tsx`:

Run: `grep -n "Download" src/pages/Payroll.tsx`
If the only remaining reference is the import line, remove `Download` from that lucide import. (The icon now lives in `PayrollExportMenu`.)

- [ ] **Step 7: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass. Fix any unused-import / type errors surfaced (e.g. a stray `Download` or `exportPayrollToCSV` reference).

- [ ] **Step 8: Commit**

```bash
git add src/pages/Payroll.tsx
git commit -m "feat(payroll): swap Export button for provider-format dropdown"
```

---

## Final verification (Phase 8 preview)

- [ ] Run the full new-test set: `npx vitest run tests/unit/payrollGustoExport.test.ts tests/unit/payrollExportFormats.test.ts tests/unit/PayrollExportMenu.test.tsx`
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build` — all green.
- [ ] Preview: on the Payroll page, "Export ▾" opens a menu with **Standard CSV** and **Gusto CSV**; each downloads a correctly-named file; the Gusto file's first line matches the template header and tips land in `paycheck_tips`/`cash_tips`.

## Spec coverage self-check

- Gusto header (exact 16 cols) → Task 1 (pinned) + Task 2 (emitted).
- Name split → Task 1.
- Column mapping incl. tips split, title=position, blank id/untracked → Task 2.
- Plain numbers, zero→blank, no `$`, no TOTAL/blank lines, injection-safe, no BOM → Task 2.
- Registry shape (internal + gusto, shared date formatter) → Task 3.
- DropdownMenu UI (align=end, decorative chevron, disabled guard, Inventory precedent) → Task 4.
- UI-wiring test (menu → correct format → correct filename/header) → Task 4.
- Page integration → Task 5.
