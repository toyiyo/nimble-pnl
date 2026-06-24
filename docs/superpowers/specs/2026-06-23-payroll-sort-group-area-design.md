# Design: Payroll table — column sorting + group/show by area

**Date:** 2026-06-23
**Route:** `/payroll` (`src/pages/Payroll.tsx`)
**Branch:** `feature/payroll-sort-group-area`

## Problem

The payroll table renders employees in a single fixed order (whatever
`usePayroll` returns, which is `useEmployees`' name order). Managers asked for
two capabilities:

1. **Sort by clicking the table column headers** (name, position, rate, hours,
   pay, tips, total).
2. **Show and group employees by their "area"** (Front of House, Back of House,
   Bar, Management, …), with a per-area subtotal.

## Current state (as explored)

- Table is rendered **inline** in `src/pages/Payroll.tsx` (≈ lines 512–693),
  using shadcn `Table` primitives, a plain `payrollPeriod.employees.map(...)`
  (not virtualized), followed by a grand **TOTAL** row.
- 12 columns today: Employee, Position, Rate, Regular Hrs, OT Hrs, Regular Pay,
  OT Pay, Tips Earned, Tips Paid, Tips Owed, Total Pay, Actions.
- Row data type is `EmployeePayroll` (`src/utils/payrollCalculations.ts`,
  ≈ lines 44–70). It is built per-employee by `calculateEmployeePayroll(employee,
  …)` directly from the `employee` object.
- `area` is a first-class, nullable, free-text column on `employees`
  (`area: string | null`). It is **not** currently carried onto `EmployeePayroll`.
  `useEmployees` selects `*`, so the `employee` object feeding the calc already
  has `area`.
- Existing grouping precedent lives in scheduling: `src/lib/scheduleGrouping.ts`
  (`groupEmployees(Employee[], 'none'|'area'|'position')`, Unassigned-last
  convention) and `AreaSectionHeader.tsx` (collapsible section header). These are
  shaped for `Employee[]`, not payroll rows, and force a name sort — informative
  precedent, not directly reusable here.
- No existing clickable-`<th>` sort precedent; the codebase's sort UIs (Inventory,
  ReconciliationSession) use a Select + direction toggle. The request is
  explicitly "order by the table headings", so we add clickable headers.

## Approach (chosen: pure tested utils + inline page wiring)

Keep all ordering/grouping/aggregation logic in small, pure, unit-tested
functions; keep `Payroll.tsx` declarative (state + `useMemo` + rendering).

### 1. Make `area` first-class on `EmployeePayroll`

- Add `area: string | null` to the `EmployeePayroll` interface.
- In `calculateEmployeePayroll`, set `area: employee.area ?? null` in the returned
  object (the `employee` param already carries it).
- Sorting, grouping, and CSV then read one canonical field.

### 2. New pure module `src/utils/payrollTableView.ts`

- `export type PayrollSortKey = 'name' | 'position' | 'area' | 'rate'
  | 'regularHours' | 'overtimeHours' | 'regularPay' | 'overtimePay'
  | 'totalTips' | 'tipsPaidOut' | 'tipsOwed' | 'totalPay';`
- `export type SortDirection = 'asc' | 'desc';`
- `sortPayrollRows(rows, key, dir): EmployeePayroll[]`
  - Pure, returns a new array (does not mutate input).
  - **Stable**: ties preserve input order (so a secondary name sort is achieved by
    sorting name first; primary sorts keep deterministic tie order).
  - String keys (`name`→`employeeName`, `position`, `area`) compare with
    `localeCompare`; a null/empty `area` sorts **last** regardless of direction is
    NOT applied here — for the flat sortable column, null area sorts as empty
    string (so it clusters predictably and flips with direction). Unassigned-last
    is a *grouping* concern, handled in `groupPayrollRows`.
  - Numeric keys compare numerically.
  - `rate` sorts by `hourlyRate` (the Rate cell is heterogeneous across
    compensation types; sorting by `hourlyRate` is the documented, predictable
    choice — most rows are hourly).
- `groupPayrollRows(rows, mode): PayrollGroup[]`
  - `type GroupByMode = 'none' | 'area' | 'position';`
  - `interface PayrollGroup { key: string; label: string; rows: EmployeePayroll[] }`
  - Preserves the **incoming row order** within each group (caller passes
    already-sorted rows, so within-group order honors the active column sort).
  - `'none'` → single group `{ key: '', label: '', rows }`.
  - For `'area'`/`'position'`: bucket by the trimmed field; empty/null →
    Unassigned bucket. Groups sorted alphabetically by label, **Unassigned last**
    (mirrors `scheduleGrouping`). `UNASSIGNED_LABEL = 'Unassigned'`.
- `computePayrollTotals(rows): PayrollTotals`
  - Returns `{ regularHours, overtimeHours, regularPay, overtimePay, totalTips,
    tipsPaidOut, tipsOwed, totalPay }`.
  - Uses the **same formulas as the current grand-TOTAL row** so per-group
    subtotals and the grand total reconcile and never drift:
    - `regularPay = Σ(regularPay + salaryPay + contractorPay + manualPaymentsTotal)`
    - `overtimePay = Σ overtimePay`
    - `totalPay = Σ totalPay` ( = `Σ(grossPay + tipsOwed)` )
    - hours/tips are straight sums.
  - Reused for each group's subtotal **and** the grand total. A unit test pins
    `computePayrollTotals(allEmployees)` equal to the existing
    `payrollPeriod.total*` aggregates so the refactor is provably behavior-preserving.

### 3. `Payroll.tsx` wiring

- New in-component state (no persistence — CLAUDE.md forbids localStorage):
  - `sortKey: PayrollSortKey` (default `'name'`)
  - `sortDir: SortDirection` (default `'asc'`)
  - `groupBy: GroupByMode` (default `'none'`)
  - `collapsedGroups: Set<string>` (default empty; toggled per group key — a Set,
    per the "Set not scalar for concurrent row state" lesson)
- `const groups = useMemo(() => groupPayrollRows(sortPayrollRows(rows, sortKey,
  sortDir), groupBy), [rows, sortKey, sortDir, groupBy])`.
- **Clickable sort headers**: extract a small `SortableHeader` helper (inside the
  page or a tiny local component) rendering a `<button>` with the label +
  `ArrowUpDown` (inactive) / `ChevronUp` / `ChevronDown` (active asc/desc). The
  enclosing `<th>` gets `aria-sort={active ? (dir==='asc'?'ascending':'descending')
  : 'none'}`. All 12 data columns are sortable; **Actions** is not.
- **Area column**: new header "Area" after Position; cell shows `area` or a muted
  `—`. Column count becomes 13.
- **Group control**: a shadcn `Select` (None / By area / By position) placed in the
  card header next to Export CSV, styled per the Apple/Notion tokens.
- **Grouped rendering** (`groupBy !== 'none'`): for each group render
  - a **section-header `TableRow`** — single `TableCell colSpan={13}`, a `<button>`
    with a `ChevronDown`/`ChevronRight`, the label, and a count badge;
    `role` handled by the button, `aria-expanded` reflects collapse state,
    keyboard-accessible. Clicking toggles `collapsedGroups`.
  - the group's rows (hidden when collapsed)
  - a **subtotal `TableRow`** (`computePayrollTotals(group.rows)`), label cell
    `colSpan={4}` (Employee+Position+Area+Rate), numeric columns filled, empty
    Actions cell.
- **Flat rendering** (`groupBy === 'none'`): the single group's sorted rows, no
  section headers/subtotals.
- The grand **TOTAL** row always renders at the bottom (now via
  `computePayrollTotals(payrollPeriod.employees)`), label `colSpan={4}`.

### 4. CSV export

- `exportPayrollToCSV` gains an **"Area"** column (after Position), value
  `ep.area ?? ''`. The TOTAL row's Area cell is blank.
- `handleExportCSV` passes the rows in **on-screen order** by flattening the
  computed groups: `exportPayrollToCSV({ ...payrollPeriod, employees: flatRows })`.

## Components / boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `payrollTableView.ts` | pure sort / group / totals over `EmployeePayroll[]` | types only |
| `payrollCalculations.ts` | adds `area` to row; CSV gains Area column | `Employee.area` |
| `Payroll.tsx` | state + `useMemo` + rendering (headers, area col, group/subtotal rows, group Select) | the two utils |

## Error / edge handling

- Loading/empty/error states are unchanged (existing three-state rendering stays).
- Empty employee list → `computePayrollTotals([])` returns all-zero; grouped view
  renders nothing but the grand total path is guarded by the existing
  `employees.length > 0` check.
- Null/empty `area` → "Unassigned" group (last) when grouping; muted `—` in the
  Area column when flat.
- Mixed compensation types: hours columns already render `-` for non-hourly; sort
  treats their numeric hours as `0`. "Rate" sort uses `hourlyRate` (documented).
- Sorting + grouping compose: sort orders rows **within** groups; group order stays
  alphabetical (Unassigned last), independent of the active column.

## Testing

Unit tests (Vitest) — the new logic lives in `src/utils/`, which is **not**
coverage-excluded, so these carry the SonarCloud ≥80% new-code gate
(`src/pages/**` is excluded):

- `payrollTableView.test.ts`:
  - `sortPayrollRows`: each key, both directions, stability of ties, string vs
    numeric comparison, null `area`.
  - `groupPayrollRows`: `'none'` single group; `'area'`/`'position'` bucketing;
    Unassigned-last; within-group order preserved from input; alphabetical group
    order.
  - `computePayrollTotals`: field sums; **equals** the legacy grand-total formulas
    over a fixture; empty-list → zeros.
- `payrollCalculations.test.ts` (extend existing): `calculateEmployeePayroll`
  threads `area` (set + null fallback); `exportPayrollToCSV` includes the Area
  column header and value.

UI component tests are optional per CLAUDE.md; the page is coverage-excluded.

## Decided trade-offs

- **"Rate" sort key = `hourlyRate`.** The Rate cell shows different units per
  compensation type (`$/hr`, `$/period`, "Per-Job"); a single numeric sort can't
  be perfectly meaningful across all of them. `hourlyRate` is predictable and
  covers the hourly majority. Documented in code.
- **Group order is fixed alphabetical (Unassigned last), not sortable by subtotal.**
  Matches the scheduling convention and the request ("group by area"); sorting
  groups themselves is YAGNI.
- **No persistence of sort/group choices.** CLAUDE.md forbids manual caching;
  in-session `useState` only.
- **Not generalizing `scheduleGrouping`.** A shared generic `groupBy<T>` would be
  nice but refactoring a tested scheduling primitive is out of scope and risky.
