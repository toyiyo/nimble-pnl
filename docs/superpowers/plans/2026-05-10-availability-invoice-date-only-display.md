# Availability + Invoice Date-Only Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the PR #489 dateOnly fix to availability_exceptions display + dialog and to invoice display + write-default sites, eliminating the UTC-midnight off-by-one bug.

**Architecture:** Mechanical port of an established pattern. `src/lib/dateOnly.ts` already exists on `main` with battle-tested unit tests. Each task is a small, focused commit on `fix/availability-invoice-tz`.

**Tech Stack:** React 18 + TypeScript + date-fns. No new dependencies.

---

## File Structure

Files to modify (no new files):

- `src/pages/EmployeePortal.tsx` — availability exception display (display-only)
- `src/components/AvailabilityExceptionDialog.tsx` — read prefill + write path (keep RestaurantContext for time-of-day math)
- `src/pages/InvoiceDetail.tsx` — invoice_date and due_date display
- `src/components/invoicing/InvoicePreviewDialog.tsx` — invoice_date and due_date display
- `src/pages/Invoices.tsx` — due_date display in list
- `src/hooks/useInvoices.tsx` — replace UTC-anchored "today" default

The helper `src/lib/dateOnly.ts` is already on main and is imported as needed.

## Test Strategy

The helper's own unit tests (already on main, in `tests/unit/dateOnly.test.ts`)
already cover the relevant invariants TZ-independently:

- `parseDateOnly("2026-05-29")` preserves day 29
- `toDateOnlyString` uses LOCAL fields (not UTC)
- Round-trip identity holds

No new tests are needed for these mechanical swaps — passing those existing
tests is the contract that proves the bug class is gone. Each implementation
task ends with `npm run test -- dateOnly` to confirm the helper invariants
still hold, plus `npm run typecheck` and `npm run lint` on the touched files.

---

### Task 1: Fix availability display in EmployeePortal

**Files:**
- Modify: `src/pages/EmployeePortal.tsx` (around lines 351, 360)

- [ ] **Step 1: Confirm current bug shape**

Run: `grep -n "exception.date" src/pages/EmployeePortal.tsx`

Expected:
```
351:                {format(new Date(exception.date), 'MMM d, yyyy')}
360:                        {formatTimeInRestaurantTz(exception.start_time, new Date(exception.date))} - {formatTimeInRestaurantTz(exception.end_time, new Date(exception.date))}
```

- [ ] **Step 2: Update import**

Find the `parseDateOnly` import (already used in `TimeOffRequestDialog`); the
file does not yet import dateOnly helpers. Add:

```typescript
import { formatDateOnly, parseDateOnly } from '@/lib/dateOnly';
```

(insert near the other `@/lib/...` imports in import-order group #6).

- [ ] **Step 3: Replace the display call (line 351)**

```typescript
{formatDateOnly(exception.date, 'MMM d, yyyy')}
```

(replace `format(new Date(exception.date), 'MMM d, yyyy')`).

- [ ] **Step 4: Replace the time-anchor call (line 360)**

To avoid computing the same Date twice, lift it once and reuse:

```typescript
const exceptionDate = parseDateOnly(exception.date);
// ...
{formatTimeInRestaurantTz(exception.start_time, exceptionDate)} - {formatTimeInRestaurantTz(exception.end_time, exceptionDate)}
```

If the surrounding JSX makes lifting awkward, two `parseDateOnly(exception.date)` calls are acceptable — the helper is cheap.

- [ ] **Step 5: Verify**

Run:
- `npm run typecheck` → expect: clean
- `npm run lint -- src/pages/EmployeePortal.tsx` → expect: clean
- `grep -n "new Date(exception.date)" src/pages/EmployeePortal.tsx` → expect: no matches

- [ ] **Step 6: Commit**

```bash
git add src/pages/EmployeePortal.tsx
git commit -m "fix(availability): use formatDateOnly + parseDateOnly for exception display

Sibling fix to PR #489 — same UTC-midnight DATE-render trap.
exception.date is a Postgres date; parsing via new Date() rendered
the previous day in any non-UTC browser. Use the dateOnly helpers
to preserve the calendar day verbatim."
```

---

### Task 2: Fix AvailabilityExceptionDialog read + write

**Files:**
- Modify: `src/components/AvailabilityExceptionDialog.tsx` (around lines 53, 55, 73-87)

**Critical:** Keep `RestaurantContext` and `utcTimeToLocalTime` / `localTimeToUtcTime`. Only the **date** round-trip is replaced.

- [ ] **Step 1: Confirm current shape**

Run: `grep -n "exception.date\|formatDateToUTC\|fromZonedTime" src/components/AvailabilityExceptionDialog.tsx`

Expected: matches at lines 53, 55, 73-75, and an import of `fromZonedTime`.

- [ ] **Step 2: Replace read prefill (lines 53, 55)**

```typescript
setDate(parseDateOnly(exception.date));
// ...
const exceptionDate = parseDateOnly(exception.date);
```

- [ ] **Step 3: Replace write helper (lines 73-75) and its call site (line 87)**

Delete the `formatDateToUTC` helper. At its call site, use:

```typescript
date: toDateOnlyString(date),
```

- [ ] **Step 4: Update imports**

Add (near other `@/lib/...` imports):

```typescript
import { parseDateOnly, toDateOnlyString } from '@/lib/dateOnly';
```

Remove the `fromZonedTime` import from `date-fns-tz` IF it's no longer used in the file. Re-grep to check.

Run: `grep -n "fromZonedTime" src/components/AvailabilityExceptionDialog.tsx`

If no matches, remove the import. If still used (unlikely — the date helper was the only user), leave it.

- [ ] **Step 5: Verify**

Run:
- `grep -n "new Date(exception.date)" src/components/AvailabilityExceptionDialog.tsx` → expect: no matches
- `grep -n "formatDateToUTC" src/components/AvailabilityExceptionDialog.tsx` → expect: no matches
- `npm run typecheck` → clean
- `npm run lint -- src/components/AvailabilityExceptionDialog.tsx` → clean
- `npm run test -- dateOnly` → all pass (sanity check on the helper)

- [ ] **Step 6: Commit**

```bash
git add src/components/AvailabilityExceptionDialog.tsx
git commit -m "fix(availability-dialog): use dateOnly helpers for date round-trip

RestaurantContext stays — start_time/end_time are 'time without time
zone' columns and legitimately need restaurant TZ math via
utcTimeToLocalTime/localTimeToUtcTime. Only the date field had the
UTC-midnight bug. Replace formatDateToUTC (which used fromZonedTime)
with toDateOnlyString and the prefill new Date(exception.date) calls
with parseDateOnly."
```

---

### Task 3: Fix invoice display + write-default sites

**Files:**
- Modify: `src/pages/InvoiceDetail.tsx` (lines 513, 518)
- Modify: `src/components/invoicing/InvoicePreviewDialog.tsx` (lines 62, 66)
- Modify: `src/pages/Invoices.tsx` (line 265)
- Modify: `src/hooks/useInvoices.tsx` (line 325)

- [ ] **Step 1: InvoiceDetail — lines 513, 518**

Add to imports: `import { formatDateOnly } from '@/lib/dateOnly';`

Replace:
```typescript
<span>{formatDateOnly(invoice.invoice_date, 'MMM d, yyyy')}</span>
// ...
<span>{formatDateOnly(invoice.due_date, 'MMM d, yyyy')}</span>
```

(Note: `due_date` is nullable; the existing `{invoice.due_date && ...}` guard
on line 515 already handles null, so passing it to `formatDateOnly` only
happens when it's a defined string.)

- [ ] **Step 2: InvoicePreviewDialog — lines 62, 66**

Add to imports: `import { formatDateOnly } from '@/lib/dateOnly';`

Replace:
```typescript
{formatDateOnly(invoice.invoice_date, 'MMMM d, yyyy')}
// ...
Due: {formatDateOnly(invoice.due_date, 'MMMM d, yyyy')}
```

- [ ] **Step 3: Invoices.tsx — line 265**

Add to imports: `import { formatDateOnly } from '@/lib/dateOnly';`

Replace `new Date(invoice.due_date).toLocaleDateString()` with
`formatDateOnly(invoice.due_date)` (default pattern is `'MMM d, yyyy'`, which
is consistent with the rest of the app — slight format change from
locale-default but more uniform).

If exact `toLocaleDateString()` parity is required, instead pass a custom
pattern like `'M/d/yyyy'`. Recommend the default for consistency.

- [ ] **Step 4: useInvoices.tsx — line 325**

Add to imports: `import { toDateOnlyString } from '@/lib/dateOnly';`

Replace:
```typescript
invoice_date: toDateOnlyString(new Date()),
```

(was `new Date().toISOString().split('T')[0]` which is UTC-anchored).

- [ ] **Step 5: Verify**

Run:
- `grep -n "new Date(invoice\\.invoice_date\\|new Date(invoice\\.due_date" src/` → no matches
- `grep -n 'new Date().toISOString().split' src/hooks/useInvoices.tsx` → no matches
- `npm run typecheck` → clean
- `npm run lint -- src/pages/InvoiceDetail.tsx src/components/invoicing/InvoicePreviewDialog.tsx src/pages/Invoices.tsx src/hooks/useInvoices.tsx` → clean

- [ ] **Step 6: Commit**

```bash
git add src/pages/InvoiceDetail.tsx src/components/invoicing/InvoicePreviewDialog.tsx src/pages/Invoices.tsx src/hooks/useInvoices.tsx
git commit -m "fix(invoices): use dateOnly helpers for date-column render and 'today' default

invoice_date and due_date are Postgres date columns; new Date(string)
parsed them as UTC-midnight, rendering as the previous day in any
non-UTC browser. Replace the four display sites with formatDateOnly.
Also replace the UTC-anchored 'today' default in createInvoice
(new Date().toISOString().split('T')[0]) with toDateOnlyString to
preserve the user's local calendar day."
```

---

### Task 4: Final verify

- [ ] **Step 1: Full test/lint/build/typecheck**

Run, in order:
- `npm run typecheck` → clean
- `npm run lint` → clean (or only pre-existing warnings)
- `npm run test` → all pass
- `npm run build` → success

- [ ] **Step 2: Audit for any leftover offending patterns in scope**

Run:
```bash
grep -n "new Date(.*\.date\|new Date(.*invoice_date\|new Date(.*due_date)" \
  src/pages/EmployeePortal.tsx \
  src/components/AvailabilityExceptionDialog.tsx \
  src/pages/InvoiceDetail.tsx \
  src/components/invoicing/InvoicePreviewDialog.tsx \
  src/pages/Invoices.tsx \
  src/hooks/useInvoices.tsx
```

Expected: no matches.

- [ ] **Step 3: Audit for the symmetric UTC-anchored-today pattern in scope**

Run:
```bash
grep -n 'new Date().toISOString().split' src/hooks/useInvoices.tsx
```

Expected: no matches.

- [ ] **Step 4: No commit required**

(Verification only — proceed to PR.)

---

## Self-Review

- **Spec coverage:** All seven scoped sites are addressed across Tasks 1-3.
  Out-of-scope sites are documented in the spec under "Out of scope" with a
  rationale.
- **Placeholder scan:** None.
- **Type consistency:** All replacements use the existing exported helpers
  (`formatDateOnly`, `parseDateOnly`, `toDateOnlyString`). No new symbols.
