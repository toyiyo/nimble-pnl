# Design: Provider-specific payroll export (Gusto first)

**Date:** 2026-07-07
**Branch:** `feature/payroll-provider-export`
**Status:** Approved

## Problem

The Payroll page (`src/pages/Payroll.tsx`) has a single "Export CSV" button that
emits our **internal** payroll format (`exportPayrollToCSV` in
`src/utils/payrollCalculations.ts`). Customers who run payroll through a provider
(starting with **Gusto**) need a CSV whose columns match the provider's import
template, so they can upload it directly instead of hand-transcribing hours and
tips.

This adds a **Gusto-format** export alongside the existing internal one, behind a
small format registry so additional providers (ADP, etc.) can be added later
without reworking the UI.

## Scope

- **In scope:** a pure client-side transform of the payroll data already loaded
  on the page into Gusto's CSV import layout; a format registry; a format
  picker in the Payroll page UI.
- **Out of scope:** any Gusto API / OAuth integration (a separate, much larger
  effort lives on `feature/gustopayroll`); storing a Gusto employee-id mapping;
  additional providers beyond Gusto.

## Gusto CSV template (target)

Header, exactly (16 columns), taken from a real Gusto timesheet import template:

```
last_name,first_name,title,gusto_employee_id,regular_hours,overtime_hours,double_overtime_hours,missed_break_hours,owners_draw,bonus,commission,paycheck_tips,cash_tips,correction_payment,reimbursement,personal_note
```

One row per employee. No total row, no blank lines.

## Column mapping

Source type is `EmployeePayroll` (`src/utils/payrollCalculations.ts`). Money
fields on that type are in **cents**; hours are decimal hours.

| Gusto column | Source | Notes |
|---|---|---|
| `last_name` | split from `employeeName` | last whitespace token |
| `first_name` | split from `employeeName` | everything before the last token |
| `title` | `position` | informational; not a Gusto match key |
| `gusto_employee_id` | **blank** | we have no mapping; Gusto name-matches |
| `regular_hours` | `regularHours` | decimal hours |
| `overtime_hours` | `overtimeHours` | decimal hours |
| `double_overtime_hours` | `doubleTimeHours` | decimal hours |
| `missed_break_hours` | **blank** | not tracked |
| `owners_draw` | **blank** | not tracked |
| `bonus` | **blank** | not tracked |
| `commission` | **blank** | not tracked |
| `paycheck_tips` | `tipsOwed` (cents → dollars) | tips still owed → paid via paycheck |
| `cash_tips` | `tipsPaidOut` (cents → dollars) | already handed out in cash; reported for tax, not re-paid |
| `correction_payment` | **blank** | not tracked |
| `reimbursement` | **blank** | not tracked |
| `personal_note` | **blank** | not tracked |

### Tips rationale (avoids double-pay)

Our model stores three figures: `totalTips` (earned), `tipsPaidOut` (already
handed to the employee in cash), and `tipsOwed = max(0, totalTips - tipsPaidOut)`
(still owed). Gusto's `paycheck_tips` is **added to net pay**; `cash_tips` is
**already received** (reported so tax is withheld, but not paid again). Mapping
`paycheck_tips ← tipsOwed` and `cash_tips ← tipsPaidOut` pays the unpaid portion
once and reports the cash portion for taxes — no employee is paid twice.

## Format rules (differ from the internal export)

- **Plain numbers only** — no `$`, no thousands separators. Gusto parses these
  as numbers. Money: `cents / 100` to 2 decimals (`1250 → "12.50"`). Hours: up to
  2 decimals (`2.23`).
- **Zero → blank cell.** Mirrors Gusto's own template (all-blank) and avoids
  filling the sheet with `0.00` for employees who didn't work in the period.
- **No TOTAL row, no blank lines.** A total row would import as a phantom
  employee. Output is header + exactly one row per employee.
- **All employees included** (roster parity with the template), even
  zero-activity ones.
- **CSV-injection safe.** Free-text cells (`last_name`, `first_name`, `title`)
  pass through a formula-neutralizing escaper: prefix a leading `= + - @` with
  `'` and RFC-4180 quote/double-quote as needed. Numeric cells are emitted
  unquoted. (Reuses the existing `escapeCsvCell` pattern; an employee named
  `=cmd|...` must not become a live formula in Excel/Sheets.)
- **No BOM.** A UTF-8 BOM can corrupt Gusto's header parse (`﻿last_name`).
  Matches the current internal export's blob (which also omits the BOM).
- **Line endings:** `\n`.

## Name split

`splitEmployeeName(full): { firstName, lastName }`

- Trim, collapse internal whitespace runs to single spaces.
- 2+ tokens → `lastName` = last token, `firstName` = the rest joined by space
  (e.g. `"Javier Gutiérrez" → {first: "Javier", last: "Gutiérrez"}`;
  `"Ana Maria Cruz" → {first: "Ana Maria", last: "Cruz"}`).
- 1 token → `firstName` = the token, `lastName` = `''` (a lone word is most
  likely a given name; edge case, unlikely in real data).
- Empty/whitespace → both `''`.

## Architecture

Two small new modules; no change to `payrollCalculations.ts` other than possibly
exporting a helper.

### `src/utils/payrollGustoExport.ts`
- `GUSTO_CSV_HEADERS: readonly string[]` — the 16 column names above.
- `splitEmployeeName(full: string)` — as specified.
- `buildGustoCSV(period: PayrollPeriod): string` — the mapper. Reuses the
  cents/number formatting and the injection-safe text escaper.

### `src/utils/payrollExportFormats.ts`
```ts
export interface PayrollExportFormat {
  id: 'internal' | 'gusto';
  label: string;                                   // menu label
  build: (period: PayrollPeriod) => string;        // CSV text
  filename: (start: Date, end: Date) => string;    // download name
}
export const PAYROLL_EXPORT_FORMATS: readonly PayrollExportFormat[];
```
- `internal` wraps the existing `exportPayrollToCSV`; filename
  `payroll_<start>_to_<end>.csv` (unchanged).
- `gusto` uses `buildGustoCSV`; filename `payroll_gusto_<start>_to_<end>.csv`.

### `src/pages/Payroll.tsx`
- Replace the single `Export CSV` button with a shadcn `DropdownMenu`
  ("Export ▾") whose items come from `PAYROLL_EXPORT_FORMATS`.
- One shared handler: build via the selected format against the
  page's grouped/ordered employees (same `orderedEmployees` the current handler
  uses), blob-download with the format's filename. Keep the existing
  disabled-when-no-employees guard.

## Data flow

Page state (`payrollPeriod` + sort/group) → `orderedEmployees` (already computed)
→ `format.build({ ...payrollPeriod, employees: orderedEmployees })` → CSV string
→ `Blob` → anchor download. No network, no persistence.

## Error handling

- Guarded by the existing `disabled={!payrollPeriod || employees.length === 0}`.
- `build` is total over any `EmployeePayroll[]` (empty → header only for Gusto;
  header + empty + TOTAL for internal, unchanged). No throw paths introduced.

## Testing

Unit (Vitest):
- `splitEmployeeName`: multi-token, single-token, accented, lowercase, extra
  spaces, empty.
- `buildGustoCSV`: exact header line; tips split (`paycheck_tips=tipsOwed`,
  `cash_tips=tipsPaidOut`); `title` = position; `gusto_employee_id` blank;
  cents→dollars formatting; zero→blank; **no** TOTAL row / no trailing blank
  line; injection escaping of a malicious name; hours formatting.
- `PAYROLL_EXPORT_FORMATS`: contains `internal` + `gusto`, filenames well-formed.

No DB / edge-function / RLS surface, so no pgTAP. UI wiring covered by the
existing Payroll page E2E path (button → dropdown is a minor structural change).

## Decided trade-offs

- **`gusto_employee_id` left blank** (per product owner): Gusto falls back to
  name matching. Accepted risk: employees whose name differs between systems (or
  duplicates) won't auto-match and need manual resolution in Gusto. A stored
  mapping is deferred to the API-integration effort.
- **`title = position`** (per product owner): our labels won't equal Gusto's
  titles, but `title` is informational only, so a mismatch is harmless.
- **Registry kept to two entries**: no speculative ADP/Paychex builders — the
  seam exists; providers are added when actually needed.
