# Availability Exceptions + Invoices: Date-Only UTC-Midnight Off-By-One Fix

**Status:** Approved
**Author:** Jose M Delgado (with Claude)
**Date:** 2026-05-10
**Sibling PR:** #489 (time-off, merged)

## Goal

Eliminate the same UTC-midnight DATE-render off-by-one bug from PR #489 in two more
feature areas: **availability exceptions** (display + dialog read/write) and
**invoices** (display + write defaults). Reuse `src/lib/dateOnly.ts` — no new helpers.

## Background (1-paragraph recap)

Postgres `date` columns are pure calendar days (no TZ). Supabase returns them as
`"YYYY-MM-DD"` strings. `new Date("YYYY-MM-DD")` parses as **UTC midnight** per
the ECMAScript spec, then `format(...)` reads local fields, so any browser
behind UTC (US, all of the Americas) renders the **previous day**. Symmetric
bug exists on the write path: `new Date().toISOString().split('T')[0]` produces
the **UTC-anchored** "today", which can be tomorrow's date for late-day Pacific
users.

PR #489 introduced and proved `src/lib/dateOnly.ts`:

- `parseDateOnly("YYYY-MM-DD")` → Date at LOCAL midnight
- `toDateOnlyString(Date)` → "YYYY-MM-DD" using LOCAL fields
- `formatDateOnly("YYYY-MM-DD", pattern?)` → formatted string

Schema verification (Supabase MCP, 2026-05-10):
- `availability_exceptions.date` → `date` (NOT NULL)
- `availability_exceptions.start_time` / `end_time` → `time without time zone`
- `invoices.invoice_date` → `date` (NOT NULL)
- `invoices.due_date` → `date` (NULLABLE)

## Scope

In scope (call sites that render a Postgres `date` value, or write one):

1. **`src/pages/EmployeePortal.tsx`** — availability exception display
   - line 351: `format(new Date(exception.date), 'MMM d, yyyy')`
   - line 360: `new Date(exception.date)` (TZ anchor for `formatTimeInRestaurantTz`)
2. **`src/components/AvailabilityExceptionDialog.tsx`** — read + write
   - lines 53, 55: read prefill via `new Date(exception.date)`
   - lines 73-75 (and call site 87): `formatDateToUTC` write helper using `fromZonedTime`
3. **`src/pages/InvoiceDetail.tsx`** — invoice display
   - line 513: `format(new Date(invoice.invoice_date), 'MMM d, yyyy')`
   - line 518: `format(new Date(invoice.due_date), 'MMM d, yyyy')`
4. **`src/components/invoicing/InvoicePreviewDialog.tsx`** — invoice display
   - line 62: `format(new Date(invoice.invoice_date), 'MMMM d, yyyy')`
   - line 66: `format(new Date(invoice.due_date), 'MMMM d, yyyy')`
5. **`src/pages/Invoices.tsx`** — invoice list due-date column
   - line 265: `new Date(invoice.due_date).toLocaleDateString()`
6. **`src/hooks/useInvoices.tsx`** — write-path default
   - line 325: `invoice_date: new Date().toISOString().split('T')[0]` → use local "today"

Out of scope (intentionally deferred — listed in PR description for follow-up):

- `src/components/PnLIntelligenceReport.tsx:864`, `ReconciliationVarianceReport.tsx:447`,
  `banking/Reconciliation*.tsx`, `Payroll.tsx:571`, `EmployeeTips.tsx:264, 374`,
  daily-pnl/cost analytics hooks. Each renders a `date` field that is *likely*
  a Postgres `date` column, but verifying schema for each requires touching
  unrelated features. We'll batch a separate audit pass.
- HTML `<input type="date">` flows in pending-outflows and `InvoiceForm.tsx`
  already handle dates as strings end-to-end — no Date object hop, no bug.

## Critical Nuance: AvailabilityExceptionDialog

Unlike `TimeOffRequestDialog` (where I removed `RestaurantContext` entirely),
`AvailabilityExceptionDialog` **must keep** `RestaurantContext` and the
`utcTimeToLocalTime` / `localTimeToUtcTime` calls. Reason: `start_time` and
`end_time` are `time without time zone` columns that the app stores as UTC
clock time. Converting these between display and storage *legitimately* needs
the restaurant timezone. Only the **date** field is the bug — replace
`formatDateToUTC` (which used `fromZonedTime`) with `toDateOnlyString`, and
swap the prefill `new Date(exception.date)` calls for `parseDateOnly`.

## Approach

Mechanical port of the PR #489 pattern, file by file:

- Display sites: replace `format(new Date(x.date_field), pattern)` with
  `formatDateOnly(x.date_field, pattern)`. For `toLocaleDateString()`, use
  `formatDateOnly(x.date_field)` with the default pattern.
- Date anchor for time formatters: replace `new Date(x.date)` with
  `parseDateOnly(x.date)`.
- Dialog write paths: replace `fromZonedTime(date, tz).toISOString().substring(0,10)`
  with `toDateOnlyString(date)`.
- "Today" defaults on the write path: replace
  `new Date().toISOString().split('T')[0]` with `toDateOnlyString(new Date())`.

## Tests

Reuse PR #489's TZ-independent technique: assert wall-clock fields, never ISO
strings. Cover:

1. **Round-trip identity:** `toDateOnlyString(parseDateOnly("2026-05-29"))` === `"2026-05-29"` (already covered by `dateOnly.test.ts` from PR #489 — no new test needed).
2. **AvailabilityExceptionDialog regression:** dialog opened on an existing
   exception with `date: "2026-05-29"` shows "May 29" in any browser TZ.
   Mock `parseDateOnly` boundary: confirm prefill calls receive the string and
   produce a local-midnight Date. Achievable via component test that asserts
   the formatted heading text.
3. **Invoice display regression:** same shape — `formatDateOnly("2026-05-29", 'MMM d, yyyy')` === `"May 29, 2026"`. Already covered by the helper's own test.
4. **Write-path "today":** `toDateOnlyString(new Date(2026, 4, 29, 22, 0))`
   (Pacific 10pm) returns `"2026-05-29"` regardless of test runner TZ. Add a
   single test in `dateOnly.test.ts` if not already present, asserting that
   `toDateOnlyString` reads local fields, not UTC.

We won't write component-level tests for every display site — the helper's
unit tests already prove the round-trip, and grepping for `new Date(.*\.date)`
in the touched files post-fix confirms coverage. PR #489 did the same.

## Risks / Migration

- **No schema change.** No data migration. No DB writes change semantics —
  `toDateOnlyString` produces the same string as the previous `fromZonedTime`
  path *in the restaurant's timezone*, but now the local picker calendar day
  the user clicked is always preserved verbatim.
- Edge case: in the old `formatDateToUTC` path, if the user's browser was in
  a different TZ from the restaurant's TZ, the calendar day they picked could
  be shifted on save. After this fix, the picked calendar day is always saved
  as-is. This is a behavior fix, not a regression.
- `useInvoices.tsx:325` "today" default now reflects the **user's local day**
  rather than UTC day. For a US user creating an invoice at 10pm, the
  invoice_date will now correctly be today (instead of tomorrow). Behavior
  fix, not a regression.

## Acceptance

- All seven call sites in scope use `dateOnly` helpers; zero `new Date(<DATE-column>)` patterns remain in the touched files.
- Typecheck, lint, build, unit tests all green.
- A graduation-day-style smoke test (creating an availability exception for a
  May 29 date in a PT browser) shows "May 29" in every render path: dialog
  field, list display, and on round-trip after save.

## Spec Self-Review

- **Placeholder scan:** none.
- **Internal consistency:** scope list, file list, and approach align. The
  AvailabilityExceptionDialog nuance is called out twice (once in scope, once
  in its own section) — intentional since it's the one spot where a careless
  mechanical port would break time-of-day handling.
- **Scope check:** small enough for a single PR (~7 sites, one helper-using
  pattern). Out-of-scope sites are explicitly enumerated for future audit.
- **Ambiguity:** none — every site has an exact line number and an exact swap.
