# Payroll Table — Sorting + Group/Show by Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable column-header sorting, a sortable "Area" column, and a group-by (None/Area/Position) control with collapsible sections and per-group subtotals to the `/payroll` table.

**Architecture:** All ordering/grouping/aggregation lives in a new pure, unit-tested module `src/utils/payrollTableView.ts`. `area` is threaded onto `EmployeePayroll` at its source so sort/group/CSV read one canonical field. `src/pages/Payroll.tsx` stays declarative: `useState` for sort/group/collapse + a `useMemo` that calls the pure helpers, then renders headers, the Area column, and (when grouped) one `<TableBody>` per group with section header + subtotal rows.

**Tech Stack:** React 18 + TypeScript, shadcn/ui `Table`/`Select`, lucide-react icons, Vitest.

**Design doc:** `docs/superpowers/specs/2026-06-23-payroll-sort-group-area-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/utils/payrollCalculations.ts` | Add `area` to `EmployeePayroll` + its construction; add `Area` column to `exportPayrollToCSV` | Modify |
| `src/utils/payrollTableView.ts` | Pure sort / group / totals + `regularPayDisplayValue` over `EmployeePayroll[]` | Create |
| `tests/unit/payrollTableView.test.ts` | Unit tests for the new module | Create |
| `tests/unit/payrollCalculations.test.ts` | Add tests: `area` threading + CSV `Area` column | Modify |
| `src/pages/Payroll.tsx` | Sort/group/collapse state, `useMemo`, sortable headers, Area column, group Select, grouped rendering, subtotals, CSV order | Modify |

---

## Task 1: Thread `area` onto `EmployeePayroll`

**Files:**
- Modify: `src/utils/payrollCalculations.ts` (interface ≈ line 44; return object ≈ line 520)
- Test: `tests/unit/payrollCalculations.test.ts`

- [ ] **Step 1: Write the failing test** — append inside the top-level `describe('payrollCalculations - Additional Coverage', () => { ... })` block in `tests/unit/payrollCalculations.test.ts` (the file already has `createEmployee(overrides)` and `createPunch` helpers):

```ts
  describe('area threading', () => {
    it('carries employee.area onto the payroll row', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Aaron', position: 'Server', area: 'Front of House' }),
      ];
      const punches = new Map<string, TimePunch[]>([['emp-1', []]]);
      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        employees,
        punches,
        new Map(),
      );
      expect(result.employees[0].area).toBe('Front of House');
    });

    it('defaults area to null when the employee has none', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Bea', position: 'Cook', area: undefined }),
      ];
      const punches = new Map<string, TimePunch[]>([['emp-1', []]]);
      const result = calculatePayrollPeriod(
        new Date('2024-01-01'),
        new Date('2024-01-31'),
        employees,
        punches,
        new Map(),
      );
      expect(result.employees[0].area).toBeNull();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollCalculations.test.ts -t "area threading"`
Expected: FAIL — `area` is `undefined` (property does not exist on the returned row).

- [ ] **Step 3: Add `area` to the interface.** In `src/utils/payrollCalculations.ts`, add to the `EmployeePayroll` interface (right after `position: string;`):

```ts
  area: string | null; // Work area (Front of House, Bar, …); null when unassigned
```

- [ ] **Step 4: Set `area` in the returned row.** In `calculateEmployeePayroll`'s returned object (right after `position: employee.position,`):

```ts
    area: employee.area ?? null,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollCalculations.test.ts -t "area threading"`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/utils/payrollCalculations.ts tests/unit/payrollCalculations.test.ts
git commit -m "feat(payroll): thread employee area onto EmployeePayroll row"
```

---

## Task 2: Add `Area` column to CSV export

**Files:**
- Modify: `src/utils/payrollCalculations.ts` (`exportPayrollToCSV`, ≈ lines 647–710)
- Test: `tests/unit/payrollCalculations.test.ts`

- [ ] **Step 1: Write the failing test** — append a new `describe` inside the top-level block:

```ts
  describe('exportPayrollToCSV area column', () => {
    it('includes an Area header and the row value after Position', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Aaron', position: 'Server', area: 'Bar' }),
      ];
      const punches = new Map<string, TimePunch[]>([['emp-1', []]]);
      const period = calculatePayrollPeriod(
        new Date('2024-01-01'), new Date('2024-01-31'), employees, punches, new Map(),
      );
      const csv = exportPayrollToCSV(period);
      const lines = csv.split('\n');
      const header = lines[0].split(',');
      // Header: Employee Name, Position, Area, Hourly Rate, ...
      expect(header[1]).toBe('Position');
      expect(header[2]).toBe('Area');
      const dataCells = lines[1].split(',');
      expect(dataCells[2]).toBe('"Bar"');
    });

    it('emits an empty Area cell when area is null', () => {
      const employees: Employee[] = [
        createEmployee({ id: 'emp-1', name: 'Bea', position: 'Cook', area: undefined }),
      ];
      const punches = new Map<string, TimePunch[]>([['emp-1', []]]);
      const period = calculatePayrollPeriod(
        new Date('2024-01-01'), new Date('2024-01-31'), employees, punches, new Map(),
      );
      const csv = exportPayrollToCSV(period);
      expect(csv.split('\n')[1].split(',')[2]).toBe('""');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollCalculations.test.ts -t "exportPayrollToCSV area column"`
Expected: FAIL — `header[2]` is `'Hourly Rate'`, not `'Area'`.

- [ ] **Step 3: Add `Area` to the CSV headers.** In `exportPayrollToCSV`, insert `'Area',` into the `headers` array immediately after `'Position',`.

- [ ] **Step 4: Add the Area value to each row.** In the `rows = payrollPeriod.employees.map(ep => [ ... ])` array, insert immediately after the `` `"${ep.position}"` `` entry:

```ts
    `"${ep.area ?? ''}"`,
```

- [ ] **Step 5: Add an empty Area cell to the TOTAL row.** In the `totalRow` array, insert one more `'""'` immediately after the existing Position placeholder (the second `'""'`), so the TOTAL row keeps the same column count as the header.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollCalculations.test.ts -t "exportPayrollToCSV area column"`
Expected: PASS (both cases).

- [ ] **Step 7: Commit**

```bash
git add src/utils/payrollCalculations.ts tests/unit/payrollCalculations.test.ts
git commit -m "feat(payroll): add Area column to CSV export"
```

---

## Task 3: Create `payrollTableView.ts` — types, `regularPayDisplayValue`, `sortPayrollRows`

**Files:**
- Create: `src/utils/payrollTableView.ts`
- Test: `tests/unit/payrollTableView.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/unit/payrollTableView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  sortPayrollRows,
  regularPayDisplayValue,
  type PayrollSortKey,
} from '@/utils/payrollTableView';
import type { EmployeePayroll } from '@/utils/payrollCalculations';

// Minimal builder — only fields the view layer reads matter; rest are zeroed.
function row(overrides: Partial<EmployeePayroll>): EmployeePayroll {
  return {
    employeeId: 'e', employeeName: '', position: '', area: null,
    compensationType: 'hourly', hourlyRate: 0,
    regularHours: 0, overtimeHours: 0, doubleTimeHours: 0, doubleTimePay: 0,
    dailyOvertimeHours: 0, weeklyOvertimeHours: 0,
    regularPay: 0, overtimePay: 0, salaryPay: 0, contractorPay: 0, dailyRatePay: 0,
    manualPayments: [], manualPaymentsTotal: 0,
    grossPay: 0, totalTips: 0, tipsPaidOut: 0, tipsOwed: 0, totalPay: 0,
    ...overrides,
  };
}

describe('regularPayDisplayValue', () => {
  it('uses regularPay for hourly', () => {
    expect(regularPayDisplayValue(row({ compensationType: 'hourly', regularPay: 500 }))).toBe(500);
  });
  it('uses salaryPay for salary', () => {
    expect(regularPayDisplayValue(row({ compensationType: 'salary', salaryPay: 900 }))).toBe(900);
  });
  it('uses contractorPay + manual for contractor', () => {
    expect(regularPayDisplayValue(row({ compensationType: 'contractor', contractorPay: 700, manualPaymentsTotal: 50 }))).toBe(750);
  });
});

describe('sortPayrollRows', () => {
  it('sorts by name ascending and descending', () => {
    const rows = [row({ employeeName: 'Carol' }), row({ employeeName: 'Alice' }), row({ employeeName: 'Bob' })];
    expect(sortPayrollRows(rows, 'name', 'asc').map(r => r.employeeName)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(sortPayrollRows(rows, 'name', 'desc').map(r => r.employeeName)).toEqual(['Carol', 'Bob', 'Alice']);
  });

  it('sorts numeric columns numerically (not lexically)', () => {
    const rows = [row({ employeeName: 'a', totalPay: 9 }), row({ employeeName: 'b', totalPay: 100 }), row({ employeeName: 'c', totalPay: 20 })];
    expect(sortPayrollRows(rows, 'totalPay', 'asc').map(r => r.totalPay)).toEqual([9, 20, 100]);
  });

  it('sorts the Regular Pay column by the displayed value across comp types', () => {
    const hourly = row({ employeeName: 'h', compensationType: 'hourly', regularPay: 300 });
    const salary = row({ employeeName: 's', compensationType: 'salary', salaryPay: 1000 });
    expect(sortPayrollRows([hourly, salary], 'regularPay', 'asc').map(r => r.employeeName)).toEqual(['h', 's']);
  });

  it('sorts the Rate column by hourlyRate', () => {
    const rows = [row({ employeeName: 'a', hourlyRate: 2500 }), row({ employeeName: 'b', hourlyRate: 1500 })];
    expect(sortPayrollRows(rows, 'rate', 'asc').map(r => r.hourlyRate)).toEqual([1500, 2500]);
  });

  it('treats null area as empty string when sorting the Area column', () => {
    const rows = [row({ employeeName: 'a', area: 'Bar' }), row({ employeeName: 'b', area: null })];
    // null -> '' sorts first ascending
    expect(sortPayrollRows(rows, 'area', 'asc').map(r => r.employeeName)).toEqual(['b', 'a']);
  });

  it('is stable — equal keys keep input order', () => {
    const rows = [row({ employeeName: 'x', position: 'Server' }), row({ employeeName: 'y', position: 'Server' })];
    expect(sortPayrollRows(rows, 'position', 'asc').map(r => r.employeeName)).toEqual(['x', 'y']);
  });

  it('does not mutate the input array', () => {
    const rows = [row({ employeeName: 'b' }), row({ employeeName: 'a' })];
    const snapshot = rows.map(r => r.employeeName);
    sortPayrollRows(rows, 'name', 'asc');
    expect(rows.map(r => r.employeeName)).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollTableView.test.ts`
Expected: FAIL — module `@/utils/payrollTableView` not found.

- [ ] **Step 3: Create the module** `src/utils/payrollTableView.ts`:

```ts
import type { EmployeePayroll } from '@/utils/payrollCalculations';

export type PayrollSortKey =
  | 'name' | 'position' | 'area' | 'rate'
  | 'regularHours' | 'overtimeHours' | 'regularPay' | 'overtimePay'
  | 'totalTips' | 'tipsPaidOut' | 'tipsOwed' | 'totalPay';

export type SortDirection = 'asc' | 'desc';

/**
 * The numeric value the "Regular Pay" cell displays for a row, which depends on
 * compensation type. Shared by the page's cell formatter and the sort comparator
 * so the column sorts by exactly what the user sees.
 */
export function regularPayDisplayValue(row: EmployeePayroll): number {
  if (row.compensationType === 'hourly') return row.regularPay;
  if (row.compensationType === 'salary') return row.salaryPay;
  return row.contractorPay + row.manualPaymentsTotal; // contractor / daily / per-job
}

// String-valued sort keys → accessor. null area sorts as '' (clusters predictably,
// flips with direction). "Unassigned last" is a grouping concern, not a sort one.
const STRING_ACCESSORS: Partial<Record<PayrollSortKey, (r: EmployeePayroll) => string>> = {
  name: (r) => r.employeeName,
  position: (r) => r.position,
  area: (r) => r.area ?? '',
};

// Numeric-valued sort keys → accessor.
// NOTE: "rate" sorts by hourlyRate — the Rate cell is heterogeneous across
// compensation types ($/hr, $/period, "Per-Job"); hourlyRate is the deliberate,
// documented choice covering the hourly majority (see design doc trade-offs).
const NUMBER_ACCESSORS: Partial<Record<PayrollSortKey, (r: EmployeePayroll) => number>> = {
  rate: (r) => r.hourlyRate,
  regularHours: (r) => r.regularHours,
  overtimeHours: (r) => r.overtimeHours,
  regularPay: regularPayDisplayValue,
  overtimePay: (r) => r.overtimePay,
  totalTips: (r) => r.totalTips,
  tipsPaidOut: (r) => r.tipsPaidOut,
  tipsOwed: (r) => r.tipsOwed,
  totalPay: (r) => r.totalPay,
};

/**
 * Returns a new array sorted by the given column. Stable (ties keep input order).
 * Does not mutate the input.
 */
export function sortPayrollRows(
  rows: EmployeePayroll[],
  key: PayrollSortKey,
  dir: SortDirection,
): EmployeePayroll[] {
  const factor = dir === 'asc' ? 1 : -1;
  const stringAccessor = STRING_ACCESSORS[key];
  const numberAccessor = NUMBER_ACCESSORS[key];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const cmp = stringAccessor
        ? stringAccessor(a.row).localeCompare(stringAccessor(b.row))
        : numberAccessor!(a.row) - numberAccessor!(b.row);
      if (cmp !== 0) return cmp * factor;
      return a.index - b.index; // stable tie-break
    })
    .map((d) => d.row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollTableView.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/payrollTableView.ts tests/unit/payrollTableView.test.ts
git commit -m "feat(payroll): pure sort helper + regularPayDisplayValue for payroll table"
```

---

## Task 4: Add `groupPayrollRows`

**Files:**
- Modify: `src/utils/payrollTableView.ts`
- Test: `tests/unit/payrollTableView.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/unit/payrollTableView.test.ts` (add the imports `groupPayrollRows, UNASSIGNED_LABEL, type PayrollGroupMode` to the existing import from `@/utils/payrollTableView`):

```ts
describe('groupPayrollRows', () => {
  it('none → a single group containing all rows in input order', () => {
    const rows = [row({ employeeName: 'b' }), row({ employeeName: 'a' })];
    const groups = groupPayrollRows(rows, 'none');
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map(r => r.employeeName)).toEqual(['b', 'a']);
  });

  it('groups by area, alphabetically, Unassigned last', () => {
    const rows = [
      row({ employeeName: 'a', area: 'Front of House' }),
      row({ employeeName: 'b', area: 'Bar' }),
      row({ employeeName: 'c', area: null }),
      row({ employeeName: 'd', area: 'Bar' }),
    ];
    const groups = groupPayrollRows(rows, 'area');
    expect(groups.map(g => g.label)).toEqual(['Bar', 'Front of House', UNASSIGNED_LABEL]);
    expect(groups[0].rows.map(r => r.employeeName)).toEqual(['b', 'd']);
    expect(groups[2].label).toBe(UNASSIGNED_LABEL);
  });

  it('preserves the incoming (already-sorted) order within each group', () => {
    const rows = [
      row({ employeeName: 'Zoe', area: 'Bar' }),
      row({ employeeName: 'Amy', area: 'Bar' }),
    ];
    const groups = groupPayrollRows(rows, 'area');
    expect(groups[0].rows.map(r => r.employeeName)).toEqual(['Zoe', 'Amy']);
  });

  it('groups by position', () => {
    const rows = [row({ employeeName: 'a', position: 'Server' }), row({ employeeName: 'b', position: 'Cook' })];
    const groups = groupPayrollRows(rows, 'position');
    expect(groups.map(g => g.label)).toEqual(['Cook', 'Server']);
  });

  it('buckets blank/whitespace area into Unassigned', () => {
    const groups = groupPayrollRows([row({ employeeName: 'a', area: '   ' })], 'area');
    expect(groups[0].label).toBe(UNASSIGNED_LABEL);
  });

  it('gives every group a non-empty stable key', () => {
    const groups = groupPayrollRows([row({ area: null }), row({ area: 'Bar' })], 'area');
    expect(groups.every(g => g.key.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollTableView.test.ts -t "groupPayrollRows"`
Expected: FAIL — `groupPayrollRows` is not exported.

- [ ] **Step 3: Implement.** Append to `src/utils/payrollTableView.ts`:

```ts
export type PayrollGroupMode = 'none' | 'area' | 'position';

export interface PayrollGroup {
  key: string;   // stable, non-empty id (used for collapse Set + DOM aria)
  label: string; // display label ('' for the 'none' group)
  rows: EmployeePayroll[];
}

const UNASSIGNED_KEY = '';
export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * Buckets already-sorted rows into groups, preserving input order within each
 * group. Groups are ordered alphabetically by label with Unassigned last —
 * matching src/lib/scheduleGrouping.ts so the same data groups identically on
 * the schedule grid and the payroll table. 'none' returns one unlabeled group.
 */
export function groupPayrollRows(
  rows: EmployeePayroll[],
  mode: PayrollGroupMode,
): PayrollGroup[] {
  if (mode === 'none') {
    return [{ key: 'all', label: '', rows: [...rows] }];
  }

  const map = new Map<string, EmployeePayroll[]>();
  for (const r of rows) {
    const raw = (mode === 'area' ? r.area : r.position) || '';
    const key = raw.trim() || UNASSIGNED_KEY;
    const bucket = map.get(key);
    if (bucket) bucket.push(r);
    else map.set(key, [r]);
  }

  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === UNASSIGNED_KEY) return 1;
    if (b === UNASSIGNED_KEY) return -1;
    return a.localeCompare(b);
  });

  return keys.map((key) => ({
    key: key || UNASSIGNED_LABEL, // never '' so it's a valid Set/DOM id
    label: key || UNASSIGNED_LABEL,
    rows: map.get(key) ?? [],
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollTableView.test.ts -t "groupPayrollRows"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/payrollTableView.ts tests/unit/payrollTableView.test.ts
git commit -m "feat(payroll): groupPayrollRows (area/position, Unassigned last)"
```

---

## Task 5: Add `computePayrollTotals`

**Files:**
- Modify: `src/utils/payrollTableView.ts`
- Test: `tests/unit/payrollTableView.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/unit/payrollTableView.test.ts` (add `computePayrollTotals` to the module import; also add `import { calculatePayrollPeriod } from '@/utils/payrollCalculations';` and `import type { Employee } from '@/types/scheduling';` and `import type { TimePunch } from '@/types/timeTracking';` at the top):

```ts
describe('computePayrollTotals', () => {
  it('returns all-zero totals for an empty list', () => {
    expect(computePayrollTotals([])).toEqual({
      regularHours: 0, overtimeHours: 0, regularPay: 0, overtimePay: 0,
      totalTips: 0, tipsPaidOut: 0, tipsOwed: 0, totalPay: 0,
    });
  });

  it('sums money/hours fields with the grand-total formulas', () => {
    const rows = [
      row({ regularHours: 10, overtimeHours: 2, regularPay: 1000, overtimePay: 300, totalTips: 500, tipsPaidOut: 100, tipsOwed: 400, totalPay: 2000, salaryPay: 0, contractorPay: 0, manualPaymentsTotal: 0 }),
      row({ regularHours: 5, overtimeHours: 0, regularPay: 0, overtimePay: 0, totalTips: 0, tipsPaidOut: 0, tipsOwed: 0, totalPay: 1500, salaryPay: 1500, contractorPay: 0, manualPaymentsTotal: 0 }),
    ];
    const t = computePayrollTotals(rows);
    expect(t.regularHours).toBe(15);
    expect(t.overtimeHours).toBe(2);
    expect(t.regularPay).toBe(2500);   // 1000 + (salaryPay 1500)
    expect(t.overtimePay).toBe(300);
    expect(t.totalTips).toBe(500);
    expect(t.tipsOwed).toBe(400);
    expect(t.totalPay).toBe(3500);
  });

  it('reconciles exactly with the calculatePayrollPeriod grand totals', () => {
    const employees: Employee[] = [
      { id: 'emp-1', restaurant_id: 'r', name: 'Aaron', position: 'Server', area: 'Bar',
        compensation_type: 'hourly', hourly_rate: 2000, is_active: true } as unknown as Employee,
      { id: 'emp-2', restaurant_id: 'r', name: 'Bea', position: 'Cook', area: null,
        compensation_type: 'hourly', hourly_rate: 1800, is_active: true } as unknown as Employee,
    ];
    const punches = new Map<string, TimePunch[]>([['emp-1', []], ['emp-2', []]]);
    const period = calculatePayrollPeriod(new Date('2024-01-01'), new Date('2024-01-31'), employees, punches, new Map());
    const t = computePayrollTotals(period.employees);
    expect(t.regularHours).toBe(period.totalRegularHours);
    expect(t.overtimeHours).toBe(period.totalOvertimeHours);
    expect(t.totalTips).toBe(period.totalTips);
    expect(t.tipsPaidOut).toBe(period.totalTipsPaidOut);
    expect(t.tipsOwed).toBe(period.totalTipsOwed);
    expect(t.totalPay).toBe(period.totalGrossPay + period.totalTipsOwed);
    const legacyRegularPay = period.employees.reduce((s, e) => s + e.regularPay + e.salaryPay + e.contractorPay + e.manualPaymentsTotal, 0);
    const legacyOvertimePay = period.employees.reduce((s, e) => s + e.overtimePay, 0);
    expect(t.regularPay).toBe(legacyRegularPay);
    expect(t.overtimePay).toBe(legacyOvertimePay);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payrollTableView.test.ts -t "computePayrollTotals"`
Expected: FAIL — `computePayrollTotals` is not exported.

- [ ] **Step 3: Implement.** Append to `src/utils/payrollTableView.ts`:

```ts
export interface PayrollTotals {
  regularHours: number;
  overtimeHours: number;
  regularPay: number;   // Σ(regularPay + salaryPay + contractorPay + manualPaymentsTotal)
  overtimePay: number;
  totalTips: number;
  tipsPaidOut: number;
  tipsOwed: number;
  totalPay: number;     // Σ totalPay  ( = Σ(grossPay + tipsOwed) )
}

/**
 * Aggregates rows using the SAME formulas as the page's grand-TOTAL row, so
 * per-group subtotals and the grand total reconcile and never drift.
 */
export function computePayrollTotals(rows: EmployeePayroll[]): PayrollTotals {
  return rows.reduce<PayrollTotals>((acc, r) => {
    acc.regularHours += r.regularHours;
    acc.overtimeHours += r.overtimeHours;
    acc.regularPay += r.regularPay + r.salaryPay + r.contractorPay + r.manualPaymentsTotal;
    acc.overtimePay += r.overtimePay;
    acc.totalTips += r.totalTips;
    acc.tipsPaidOut += r.tipsPaidOut;
    acc.tipsOwed += r.tipsOwed;
    acc.totalPay += r.totalPay;
    return acc;
  }, { regularHours: 0, overtimeHours: 0, regularPay: 0, overtimePay: 0, totalTips: 0, tipsPaidOut: 0, tipsOwed: 0, totalPay: 0 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payrollTableView.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add src/utils/payrollTableView.ts tests/unit/payrollTableView.test.ts
git commit -m "feat(payroll): computePayrollTotals shared by subtotals + grand total"
```

---

## Task 6: Wire sorting + Area column into `Payroll.tsx`

**Files:**
- Modify: `src/pages/Payroll.tsx`

> `src/pages/**` is coverage-excluded (per the SonarCloud lesson), so this task is verified by `npm run typecheck` + `npm run lint` + `npm run build`. The sortable logic itself is already covered by Task 3.

- [ ] **Step 1: Add imports.** At the top of `src/pages/Payroll.tsx`:
  - From lucide-react (extend the existing import): add `ArrowUpDown, ChevronUp, ChevronDown`.
  - Add: `import { sortPayrollRows, regularPayDisplayValue, type PayrollSortKey, type SortDirection } from '@/utils/payrollTableView';` (the grouping helpers are added in Task 7).
  - Add `useMemo` to the existing `import { useState } from 'react';` → `import { useMemo, useState } from 'react';`.

- [ ] **Step 2: Add sort state + handler.** Inside the `Payroll` component, near the other `useState` calls (after line ≈135):

```tsx
  const [sortKey, setSortKey] = useState<PayrollSortKey>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const handleSort = (key: PayrollSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };
```

- [ ] **Step 3: Compute the sorted rows.** After `payrollPeriod` is available (it comes from `usePayroll`), add:

```tsx
  const sortedEmployees = useMemo(
    () => (payrollPeriod ? sortPayrollRows(payrollPeriod.employees, sortKey, sortDir) : []),
    [payrollPeriod, sortKey, sortDir],
  );

  const SORT_LABELS: Record<PayrollSortKey, string> = {
    name: 'Employee', position: 'Position', area: 'Area', rate: 'Rate',
    regularHours: 'Regular Hours', overtimeHours: 'Overtime Hours',
    regularPay: 'Regular Pay', overtimePay: 'Overtime Pay',
    totalTips: 'Tips Earned', tipsPaidOut: 'Tips Paid', tipsOwed: 'Tips Owed', totalPay: 'Total Pay',
  };
  const sortAnnouncement = `Sorted by ${SORT_LABELS[sortKey]}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`;
```

- [ ] **Step 4: Add the `SortableHeader` sub-component.** Define it OUTSIDE the `Payroll` component (top-level in the file, after imports) so it is not re-created each render:

```tsx
function SortableHeader({
  columnKey, label, align = 'left', sortKey, sortDir, onSort,
}: {
  columnKey: PayrollSortKey;
  label: string;
  align?: 'left' | 'right';
  sortKey: PayrollSortKey;
  sortDir: SortDirection;
  onSort: (key: PayrollSortKey) => void;
}) {
  const isActive = sortKey === columnKey;
  const Icon = !isActive ? ArrowUpDown : sortDir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <TableHead
      className={align === 'right' ? 'text-right' : undefined}
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`inline-flex items-center gap-1 min-h-[24px] hover:text-foreground transition-colors ${
          align === 'right' ? 'flex-row-reverse ml-auto' : ''
        } ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </TableHead>
  );
}
```

- [ ] **Step 5: Replace the static header row** (current `src/pages/Payroll.tsx` lines 516–529) with sortable headers + the new Area column:

```tsx
                  <TableRow>
                    <SortableHeader columnKey="name" label="Employee" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="position" label="Position" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="area" label="Area" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="rate" label="Rate" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="regularHours" label="Regular Hrs" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="overtimeHours" label="OT Hrs" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="regularPay" label="Regular Pay" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="overtimePay" label="OT Pay" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="totalTips" label="Tips Earned" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="tipsPaidOut" label="Tips Paid" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="tipsOwed" label="Tips Owed" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader columnKey="totalPay" label="Total Pay" align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
```

- [ ] **Step 6: Add the Area cell to each employee row.** In the row body (after the `<TableCell>{employee.position}</TableCell>` at line ≈580) insert:

```tsx
                      <TableCell className="text-muted-foreground">
                        {employee.area || <span aria-hidden="true">—</span>}
                      </TableCell>
```

- [ ] **Step 7: Refactor `formatRegularPayDisplay` to reuse the shared value** (keeps sort + display consistent). Replace the body of `formatRegularPayDisplay` (lines ≈181–190) with:

```tsx
  const formatRegularPayDisplay = (employee: EmployeePayroll): string =>
    formatCurrency(regularPayDisplayValue(employee));
```

- [ ] **Step 8: Add the visually-hidden live region.** Immediately inside the `<div className="rounded-md border">` that wraps the table (just before `<Table>`), add:

```tsx
              <span className="sr-only" aria-live="polite">{sortAnnouncement}</span>
```

- [ ] **Step 9: Render the sorted rows + fix the TOTAL colSpan.** In the table body, change the row source from `payrollPeriod.employees.map((employee) => (` to `sortedEmployees.map((employee) => (`. Then, in the inline TOTAL row, change `<TableCell colSpan={3}>TOTAL</TableCell>` (line ≈647) to `<TableCell colSpan={4}>TOTAL</TableCell>` — Area now sits under the label span alongside Rate. Leave the rest of the TOTAL row as-is (Task 7 swaps it for the shared `computePayrollTotals` renderer).

- [ ] **Step 10: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass. (`sr-only` is an existing Tailwind utility in this repo.) Sorting + the Area column are now live and the table is internally consistent (13 columns; TOTAL label colSpan 4). Grouping arrives in Task 7.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Payroll.tsx
git commit -m "feat(payroll): clickable sort headers + Area column + live region"
```

---

## Task 7: Wire grouping, subtotals, and CSV order into `Payroll.tsx`

**Files:**
- Modify: `src/pages/Payroll.tsx`

- [ ] **Step 1: Add grouping imports, state, and swap the memo.**
  - From lucide-react, also add `ChevronRight`.
  - Extend the `payrollTableView` import to: `import { sortPayrollRows, groupPayrollRows, computePayrollTotals, regularPayDisplayValue, type PayrollSortKey, type SortDirection, type PayrollGroupMode } from '@/utils/payrollTableView';`
  - Add state next to `sortKey`/`sortDir`:

```tsx
  const [groupBy, setGroupBy] = useState<PayrollGroupMode>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
```

  - Replace the Task 6 `sortedEmployees` memo with a grouped one (this removes the now-unused `sortedEmployees`):

```tsx
  const payrollGroups = useMemo(
    () => (payrollPeriod ? groupPayrollRows(sortPayrollRows(payrollPeriod.employees, sortKey, sortDir), groupBy) : []),
    [payrollPeriod, sortKey, sortDir, groupBy],
  );
```

- [ ] **Step 2: Add the group-by `Select` control.** In the card header, next to the Export CSV button (the `<Button onClick={handleExportCSV}>` block ≈ lines 496–502), add before it:

```tsx
            <div className="flex items-center gap-2">
              <label htmlFor="payroll-group-by" className="text-[13px] text-muted-foreground">Group</label>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as PayrollGroupMode)}>
                <SelectTrigger id="payroll-group-by" aria-label="Group by" className="h-9 w-[150px] text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No grouping</SelectItem>
                  <SelectItem value="area">By area</SelectItem>
                  <SelectItem value="position">By position</SelectItem>
                </SelectContent>
              </Select>
            </div>
```

(The shadcn `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` are already imported on this page for the pay-period picker.)

- [ ] **Step 3: Extract a `renderEmployeeRow` helper** to avoid duplicating the (large) row JSX across groups. Inside the `Payroll` component, define `const renderEmployeeRow = (employee: EmployeePayroll) => ( ... )` whose body is the EXISTING `<TableRow key={employee.employeeId} ...> ... </TableRow>` block currently at lines ≈533–643 — moved verbatim, plus the Area `<TableCell>` from Task 6 Step 6. (No logic change; this is a pure extraction so both grouped and flat paths share one row renderer.)

- [ ] **Step 4: Add a subtotal/total row renderer.** Inside the component:

```tsx
  const TOTAL_LABEL_COLSPAN = 4; // Employee + Position + Area + Rate

  const renderTotalsRow = (
    totals: ReturnType<typeof computePayrollTotals>,
    label: string,
    opts?: { scope?: 'row'; labelClassName?: string },
  ) => (
    <TableRow className="bg-muted/50 font-semibold">
      <TableHead scope={opts?.scope ?? 'row'} colSpan={TOTAL_LABEL_COLSPAN} className={opts?.labelClassName}>
        {label}
      </TableHead>
      <TableCell className="text-right">{formatHours(totals.regularHours)}</TableCell>
      <TableCell className="text-right">{formatHours(totals.overtimeHours)}</TableCell>
      <TableCell className="text-right">{formatCurrency(totals.regularPay)}</TableCell>
      <TableCell className="text-right">{formatCurrency(totals.overtimePay)}</TableCell>
      <TableCell className="text-right">{formatCurrency(totals.totalTips)}</TableCell>
      <TableCell className="text-right">{formatCurrency(totals.tipsPaidOut)}</TableCell>
      <TableCell className="text-right">{formatCurrency(totals.tipsOwed)}</TableCell>
      <TableCell className="text-right">{formatCurrency(totals.totalPay)}</TableCell>
      <TableCell />
    </TableRow>
  );
```

- [ ] **Step 5: Replace the `<TableBody>…</TableBody>`** (current lines ≈531–680, i.e. the employee `.map` plus the inline TOTAL row) with one `<TableBody>` per group followed by a grand-total `<TableBody>`:

```tsx
                {payrollGroups.map((group, gi) => {
                  const domId = `payroll-group-${gi}`;
                  const collapsed = collapsedGroups.has(group.key);
                  const grouped = groupBy !== 'none';
                  return (
                    <TableBody key={group.key} id={domId}>
                      {grouped && (
                        <TableRow className="bg-muted/30">
                          <TableHead colSpan={13} scope="colgroup" className="py-2">
                            <button
                              type="button"
                              onClick={() => toggleGroup(group.key)}
                              aria-expanded={!collapsed}
                              aria-controls={domId}
                              className="inline-flex items-center gap-2 min-h-[24px] font-semibold text-foreground"
                            >
                              {collapsed
                                ? <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                              <span>{group.label}</span>
                              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted font-normal text-muted-foreground">
                                {group.rows.length}
                              </span>
                            </button>
                          </TableHead>
                        </TableRow>
                      )}
                      {!collapsed && group.rows.map(renderEmployeeRow)}
                      {grouped && renderTotalsRow(
                        computePayrollTotals(group.rows),
                        `${group.label} subtotal`,
                        { labelClassName: 'text-[12px] font-medium uppercase tracking-wider text-muted-foreground' },
                      )}
                    </TableBody>
                  );
                })}
                <TableBody>
                  {renderTotalsRow(computePayrollTotals(payrollPeriod.employees), 'TOTAL')}
                </TableBody>
```

- [ ] **Step 6: Make CSV export follow the on-screen order.** Replace the body of `handleExportCSV` (lines ≈225–236) so it flattens the grouped view:

```tsx
  const handleExportCSV = () => {
    if (!payrollPeriod) return;
    const orderedEmployees = payrollGroups.flatMap((g) => g.rows);
    const csv = exportPayrollToCSV({ ...payrollPeriod, employees: orderedEmployees });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${format(start, 'yyyy-MM-dd')}_to_${format(end, 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 8: Manual smoke (reasoned).** Confirm: 13 column headers render; clicking a header toggles the chevron + reorders rows; the Area column shows values / `—`; the group Select switches between flat and grouped; collapsing a group hides its rows but keeps header + subtotal; subtotals + grand TOTAL align under the numeric columns (label colSpan 4); Export CSV downloads with an `Area` column in on-screen order.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Payroll.tsx
git commit -m "feat(payroll): group by area/position with collapsible sections + subtotals"
```

---

## Self-Review notes (author)

- **Spec coverage:** sortable headers (T6), Area column (T1 data, T6 UI), group by area+position (T4, T7), per-group subtotals (T5, T7), CSV Area + order (T2, T7), a11y (T6/T7), no-persistence (T6 useState), reconciling totals (T5). ✔
- **Type consistency:** `PayrollSortKey`, `SortDirection`, `PayrollGroupMode`, `PayrollGroup`, `PayrollTotals`, `regularPayDisplayValue`, `sortPayrollRows`, `groupPayrollRows`, `computePayrollTotals` are defined in Task 3–5 and consumed with identical names/signatures in Task 6–7. ✔
- **colSpan:** header/rows = 13 columns; totals label colSpan = 4; 8 numeric + 1 Actions = 13. ✔
- **No placeholders.** Every code step is concrete.
