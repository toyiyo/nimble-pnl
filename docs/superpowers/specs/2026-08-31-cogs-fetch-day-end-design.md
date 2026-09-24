# Design: inclusive day-end bound for COGS bank queries

Date: 2026-08-31
Branch: claude/quirky-davinci-ab3b81

## Problem

`fetchFinancialCOGSRows` filters `bank_transactions.transaction_date` with a
bare `yyyy-MM-dd` upper bound. The column is `timestamptz`. Postgres reads the
bare date as midnight UTC. The filter then drops every transaction later than
midnight on the last day of the period.

Two query sites carry the bug:

- The bank query: `.lte('transaction_date', endDateStr)`
  (`src/services/cogsFetch.ts:61`).
- The split-parent query: `.lte('transaction_date', endDateStr)`
  (`src/services/cogsFetch.ts:78`).

Confirmed production impact (2026-08-31): for one production restaurant,
August 2026, the filter drops one `food_cost` transaction. The transaction
timestamp is after midnight UTC on the last day of the period. The
dashboard shows a COGS total that is low by the amount of that
transaction. The tenant identifier and the exact values stay out of this
public repository.

## Facts about the current code

- Callers pass bare day strings. `cogsFinancialsKey` builds `fromStr` and
  `toStr` with `toDateOnlyString` (`src/hooks/useCOGSFromFinancials.tsx:42`).
  `useMonthlyMetrics` passes the same strings
  (`src/hooks/useMonthlyMetrics.tsx:313`).
- The helper `toInclusiveDayEnd` exists and returns
  `` `${dateOnly}T23:59:59.999Z` `` (`src/lib/dateOnly.ts:60`).
- `useLiquidityMetrics` already applies the helper to the same column:
  `.lte('transaction_date', toInclusiveDayEnd(format(endDate, 'yyyy-MM-dd')))`
  (`src/hooks/useLiquidityMetrics.tsx:92`).
- The `pending_outflows` query filters `issue_date`
  (`src/services/cogsFetch.ts:94`). `issue_date` is a `DATE` column. A bare
  day string is correct there. Do not change it.
- The existing unit test mock records every filter call in a `calls` array
  (`tests/unit/cogsFetch.test.ts:40`). A test can assert the exact `.lte`
  argument.

## Change

Change `src/services/cogsFetch.ts` only:

1. Import `toInclusiveDayEnd` from `@/lib/dateOnly`.
2. Change line 61 to `.lte('transaction_date', toInclusiveDayEnd(endDateStr))`.
3. Change line 78 to `.lte('transaction_date', toInclusiveDayEnd(endDateStr))`.

Keep the `pending_outflows` bound and both `.gte` bounds as bare day strings.
The `.gte` lower bound reads as midnight UTC, which is the correct inclusive
start of the first day.

## Test

Add one test to `tests/unit/cogsFetch.test.ts`. The test asserts:

- The bank query calls `['lte', 'transaction_date', '2026-08-31T23:59:59.999Z']`.
- The split-parent query calls the same bound.
- The `pending_outflows` query keeps `['lte', 'issue_date', '2026-08-31']`.

The test fails with the bare-date filter. It passes with `toInclusiveDayEnd`.

## Out of scope

- `get_inventory_usage_by_day` uses `DATE` bounds. Not affected.
- The `pending_outflows` query uses `issue_date`, a `DATE` column. Not
  affected.
- No migration, no RLS change, no edge-function change, no UI change.

## Decided trade-offs (Phase 2.5 review)

The supabase-design-reviewer confirmed every premise and the production row.
It reported two scope findings:

- **Major, deferred:** `src/hooks/useMonthlyMetrics.tsx:331-332` filters the
  same `timestamptz` column with a bare `.lte('transaction_date', toStr)` in
  the labor-cost query. The task scope is `src/services/cogsFetch.ts` only,
  per the confirmed COGS impact. A follow-up task covers the labor query.
- **Minor, deferred:** the same bare-date pattern exists in
  `src/hooks/useLaborCostsFromTransactions.tsx:58`,
  `src/hooks/usePredictiveMetrics.tsx:61`, `src/hooks/useTopVendors.tsx:43`,
  `src/hooks/useUncategorizedTotals.tsx:41`,
  `src/lib/expenseDataFetcher.ts:116`, and
  `supabase/functions/ai-execute-tool/index.ts:321` and `:923`. The same
  follow-up task covers the sweep.

## Trade-offs

- `T23:59:59.999Z` leaves a 1-millisecond gap before midnight. Supabase
  `timestamptz` values carry microsecond precision, so a value in
  `23:59:59.9991` to `23:59:59.9999` would escape the filter. The codebase
  standard is this helper (`src/lib/dateOnly.ts:60`), and bank transaction
  timestamps come from bank feeds with second precision. Accept the gap for
  consistency with `useLiquidityMetrics`.
