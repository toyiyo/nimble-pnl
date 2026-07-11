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
- **Zero handling — differs by column ownership (revised after CodeRabbit P1):**
  Gusto's Smart Import treats a **blank cell as "leave unchanged"** and an
  **explicit `0` as "set to 0"**.
  - **Columns we compute** (`regular_hours`, `overtime_hours`,
    `double_overtime_hours`, `paycheck_tips`, `cash_tips`) emit an explicit
    `0.00` even when zero, so that correcting a value down to zero and
    re-exporting **overwrites** the prior (stale) amount in Gusto rather than
    silently leaving it.
  - **Columns we never populate** (`gusto_employee_id`, `missed_break_hours`,
    `owners_draw`, `bonus`, `commission`, `correction_payment`, `reimbursement`,
    `personal_note`) stay **blank** (no-op) so a re-import never clobbers values
    the user manages directly in Gusto.
  - This split is robust under either interpretation of blank semantics, and
    supersedes the original "zero → blank everywhere" decision (which optimized
    for template-matching readability but risked stale values on re-import).
- **No TOTAL row, no blank lines.** A total row would import as a phantom
  employee. Output is header + exactly one row per employee.
- **All employees included** (roster parity with the template), even
  zero-activity ones.
- **CSV-injection safe.** Free-text cells (`last_name`, `first_name`, `title`)
  pass through a formula-neutralizing escaper: prefix any leading formula trigger
  character (`= + - @`) — **including when preceded by spaces or tabs** (e.g.
  `"\t=HYPERLINK(...)"`) — with `'`, and RFC-4180 quote/double-quote as needed.
  Numeric cells are emitted unquoted. (Reuses the existing `escapeCsvCell`
  pattern, whose neutralization matches `^\s*[=+\-@]`; an employee named
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
- Replace the single `Export CSV` button with a shadcn `DropdownMenu`, following
  the **existing precedent in `src/pages/Inventory.tsx`** (Export ▾ → CSV/PDF
  picker) so this stays consistent with the codebase rather than inventing a new
  pattern.
- Trigger: `DropdownMenuTrigger asChild` wrapping the existing `<Button>`, with
  visible text `Export` + a decorative `ChevronDown` icon (`aria-hidden`, matching
  the current `Download` icon usage). The button text self-labels it — no extra
  `aria-label`. Keep the existing `disabled={!payrollPeriod || employees.length === 0}`
  guard on the trigger.
- Content: `DropdownMenuContent align="end" className="bg-background z-50"`
  (matches Inventory exactly; prevents overflow past the right edge of the header
  row) with one `DropdownMenuItem` per entry in `PAYROLL_EXPORT_FORMATS`, labelled
  by `format.label` (items placed directly under the content, mirroring the
  Inventory precedent — no `DropdownMenuGroup` wrapper for a flat two-item menu).
- One shared handler `handleExport(format: PayrollExportFormat)`: build via the
  selected format against the page's grouped/ordered employees (same
  `orderedEmployees` the current handler uses), blob-download with
  `format.filename(start, end)`.
- **Interaction tradeoff (accepted):** today `Enter`/`Space` on the button exports
  immediately; after this change the same keystroke opens the menu and a second
  action (arrow + Enter, or type-ahead) performs the export. Radix
  `DropdownMenu` provides Escape-to-close, arrow-key navigation, type-ahead, and
  focus-return-to-trigger for free. The extra step is the deliberate cost of
  supporting multiple formats.
- **Filename date formatting** is centralized: both formats' `filename` functions
  call one shared `formatDateRange(start, end)` helper (or the same
  `format(d, 'yyyy-MM-dd')` call site) so the internal and Gusto filenames can't
  drift in date formatting if one is later edited.

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
  cents→dollars formatting; computed columns emit explicit `0.00` while untracked
  columns stay blank; **no** TOTAL row / no trailing blank line; injection
  escaping of a malicious name; hours formatting.
- `PAYROLL_EXPORT_FORMATS`: contains `internal` + `gusto`, filenames well-formed.

**UI wiring (RTL component test, `tests/unit`):** because `handleExportCSV` is
being forked into two `build` functions with two filenames, a wrong-wiring
regression (Gusto item calling the internal builder, or a filename collision)
would ship silently on payroll data. Add a test that renders the export
dropdown, opens the menu, clicks the **Gusto CSV** item, and asserts (a) the
triggered download's `download` attribute matches `payroll_gusto_<start>_to_<end>.csv`
and (b) the produced blob text starts with the exact Gusto header line. Do the
same for the Standard item. Mock the anchor click / `URL.createObjectURL` as
needed. This replaces the earlier vague "existing E2E covers it" deferral.

No DB / edge-function / RLS surface, so no pgTAP.

## Decided trade-offs

- **`gusto_employee_id` left blank** (per product owner): Gusto falls back to
  name matching. Accepted risk: employees whose name differs between systems (or
  duplicates) won't auto-match and need manual resolution in Gusto. A stored
  mapping is deferred to the API-integration effort.
- **`title = position`** (per product owner): our labels won't equal Gusto's
  titles, but `title` is informational only, so a mismatch is harmless.
- **Registry kept to two entries**: no speculative ADP/Paychex builders — the
  seam exists; providers are added when actually needed.
