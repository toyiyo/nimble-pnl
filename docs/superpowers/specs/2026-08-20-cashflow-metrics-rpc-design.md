# Design: Cash flow metrics RPC for the Financial Pulse hero

Date: 2026-08-20
Branch: `feature/cashflow-metrics-rpc`
Approach: option 2, approved by the user ("Let's do option 2").

## Problem

The Financial Pulse hero and the Cash Flow section show different numbers
for the same period. Production data confirms three causes.

1. **The hero counts internal transfers.** The hero query has no
   `is_transfer` filter (`src/hooks/useCashFlowMetrics.tsx:33-39`). The
   Cash Flow section excludes transfers
   (`src/hooks/useCashFlowInsights.tsx:162`, `excludeTransfers: true`).
   For restaurant `7c0c76e3` this week, transfers add $927.30 to the hero.
2. **The hero drops the final day.** The end bound is
   `.lte('transaction_date', format(endDate, 'yyyy-MM-dd'))`
   (`src/hooks/useCashFlowMetrics.tsx:39`). The column `transaction_date`
   is `timestamptz`, so the bare date reads as midnight and excludes the
   rest of the final day. The section appends `T23:59:59.999Z`
   (`src/hooks/useCashFlowInsights.tsx:82`). The dropped day hid $24.00.
3. **PostgREST caps the query at 1,000 rows, with no error.** The hero
   fetches the period plus an equal comparison window in one unpaged query
   (`src/hooks/useCashFlowMetrics.tsx:33-46`). A "Last 90 Days" view
   fetches 180 days. Restaurant `7c0c76e3` has 1,637 posted rows in 90
   days, so the cap truncates the result silently.

The same unpaged scan pattern exists in three more hooks:

- `src/hooks/useRevenueHealth.tsx:47-52`
- `src/hooks/useExpenseHealth.tsx:51-57` (this one filters
  `is_transfer = false` at line 55)
- `src/hooks/usePredictableExpenses.tsx:38-44`

Not affected: `src/hooks/usePendingOutflows.tsx:163,204` read
`bank_transactions` by single `id` with `.single()`.
`src/hooks/useLiquidityMetrics.tsx:50-53,62-64` reads
`bank_account_balances` (one row per account) and `pending_outflows`
totals; both stay small.

## Approach (approved)

Move the hero aggregation into one SQL function. The client receives at
most a few hundred daily rows instead of thousands of transactions. No
row cap can apply, because the server aggregates.

### 1. New SQL function `get_cash_flow_metrics`

Model: `get_labor_sales_analytics`
(`supabase/migrations/20260809120000_get_labor_sales_analytics.sql:8-32`)
— `SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`, a
`user_restaurants` membership gate on `auth.uid()`, and a `JSONB` result.

```sql
CREATE OR REPLACE FUNCTION public.get_cash_flow_metrics(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_bank_account_id UUID DEFAULT NULL
) RETURNS JSONB
```

Filters, identical for both windows:

- `restaurant_id = p_restaurant_id`
- `status = 'posted'`
- `is_transfer = false`  ← fixes cause 1
- `connected_bank_id = p_bank_account_id` when the parameter is not null
  (the client passes null for "all"; column cited at
  `src/hooks/useCashFlowMetrics.tsx:43`)

Windows and day buckets, in the UTC frame:

- Period window: `transaction_date >= p_start_date::timestamp AT TIME
  ZONE 'UTC'` and `transaction_date < (p_end_date + 1)::timestamp AT TIME
  ZONE 'UTC'`. The half-open end bound includes the full final day
  ← fixes cause 2.
- Comparison window: the same length, directly before the period.
  `comparison_start = p_start_date - (p_end_date - p_start_date + 1)`.
  This matches `subDays(startDate, periodDays)` at
  `src/hooks/useCashFlowMetrics.tsx:29-30`.
- Day bucket: `(transaction_date AT TIME ZONE 'UTC')::date`.
- The UTC frame matches the section's fetch bounds
  (`src/hooks/useCashFlowInsights.tsx:82`). The restaurant timezone is
  out of scope; the section and the hero must agree, and both use UTC.

Result shape:

```json
{
  "daily": [
    { "day": "2026-08-19", "inflow": 13002.56, "outflow": 6326.10 }
  ],
  "comparison": { "inflow": 0, "outflow": 0 }
}
```

- `daily` covers only the period window. Days with no rows are absent;
  the client fills zeros, as it does today
  (`src/hooks/useCashFlowMetrics.tsx:110-114`).
- `inflow` = `SUM(amount) FILTER (WHERE amount > 0)`.
- `outflow` = `SUM(-amount) FILTER (WHERE amount < 0)` — a positive
  number, to match `Math.abs` at `src/hooks/useCashFlowMetrics.tsx:69-73`.
- `comparison` holds the totals for the comparison window. The client
  needs only `inflow` for the trend percentage
  (`src/hooks/useCashFlowMetrics.tsx:117-123`); `outflow` is included for
  completeness.
- Round every sum to 2 decimals, as the model function does
  (`20260809120000_get_labor_sales_analytics.sql:57`).

Grants: `GRANT EXECUTE ... TO authenticated`, and `REVOKE ALL ... FROM
PUBLIC, anon`. The revoke closes the default `PUBLIC` execute grant that
the model function leaves open.

Migration file: `supabase/migrations/20260820120000_get_cash_flow_metrics.sql`.
Add the function signature to `Database['public']['Functions']` in
`src/integrations/supabase/types.ts` (the repo edits this file by hand
for new RPCs; `get_labor_sales_analytics` sits at
`src/integrations/supabase/types.ts:11308-11316`).

### 2. Derive the metrics client-side from the daily series

New pure module `src/lib/cashFlowMetrics.ts` with one function:

```ts
deriveCashFlowMetrics(daily: DailyFlow[], comparisonInflow: number,
  startDate: Date, endDate: Date): CashFlowMetrics
```

It reproduces the current interface
(`src/hooks/useCashFlowMetrics.tsx:6-17`) unchanged:

- 7-day slices sum the last 7 days of the period
  (`useCashFlowMetrics.tsx:76-90`).
- `avgDailyCashFlow` divides the period net by the period day count
  (`useCashFlowMetrics.tsx:94`).
- Volatility is the population standard deviation over the days that
  have rows — not zero-filled days — which preserves
  `useCashFlowMetrics.tsx:97-106`.
- The trend array zero-fills the last `min(14, periodDays)` days
  (`useCashFlowMetrics.tsx:108-114`).
- `trailingTrendPercentage` compares period inflows to comparison
  inflows, with the `> 0` guard (`useCashFlowMetrics.tsx:117-123`).

`useCashFlowMetrics` then calls
`supabase.rpc('get_cash_flow_metrics', ...)` and passes the result to
`deriveCashFlowMetrics`. The hook keeps its query key, `staleTime:
30000`, and `enabled` guard (`useCashFlowMetrics.tsx:23,138-141`).
`FinancialPulseHero` needs no change; it consumes the hook interface
only (`src/components/banking/FinancialPulseHero.tsx:5`).

**Intended value changes** (these are the fix, not regressions):

- Transfers no longer count.
- The final day now counts.
- Day buckets move from the browser-local frame
  (`useCashFlowMetrics.tsx:99`) to UTC, which matches the section.

### 3. Shared paged fetch for the three remaining scan hooks

Extract the page loop from `src/hooks/useCashFlowInsights.tsx:71-107`
into `src/lib/paginatedBankQuery.ts`:

```ts
fetchAllPages<T>(buildPage: (from: number, to: number) =>
  PromiseLike<{ data: T[] | null; error: ... }>):
  Promise<{ rows: T[]; truncated: boolean }>
```

- `PAGE_SIZE = 1000`, `MAX_PAGES = 20`, same as
  `useCashFlowInsights.tsx:20-21`.
- Callers must order by `transaction_date`, then `id`, for a stable page
  order (`useCashFlowInsights.tsx:93-95` does this today).

Apply it to:

- `useCashFlowInsights` — replace the local loop, no behavior change.
- `useRevenueHealth`, `useExpenseHealth`, `usePredictableExpenses` —
  page the scan and change the end bound to `T23:59:59.999Z`. Do not
  change their filters or their aggregation. Their semantics stay as
  they are; only the silent truncation and the dropped final day go
  away.

Each caller receives `truncated` and passes it through its return value
for future surfacing. No UI change in this PR.

## Out of scope

- Moving `useRevenueHealth` / `useExpenseHealth` /
  `usePredictableExpenses` aggregation into SQL. Each needs its own
  result shape (category joins, payee grouping). Follow-up work.
- Transfer exclusion in `useRevenueHealth` and `usePredictableExpenses`.
  A semantic change there needs its own review of what each metric
  claims to show.
- Restaurant-local day buckets. The section uses UTC today; the hero
  must match the section first.
- `useLiquidityMetrics` and `usePendingOutflows` (not affected, see
  Problem).

## Tests

### pgTAP: `supabase/tests/get_cash_flow_metrics.sql`

Impersonate the caller with
`set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)` —
`auth.uid()` reads the JWT GUC and needs no role switch (lesson
2026-07-22). Cases:

1. A non-member caller gets `Access denied to restaurant` (`throws_ok`).
2. A transfer row (`is_transfer = true`) does not count.
3. A pending row (`status = 'pending'`) does not count.
4. A row at `23:30 UTC` on `p_end_date` counts (end-of-day bound).
5. A row on the day before `p_start_date` counts in `comparison`, not in
   `daily`.
6. The `p_bank_account_id` filter keeps only the matching account.
7. An empty window returns `{"daily": [], "comparison": {...}}` with
   zero totals, not NULL.
8. Inflow and outflow split by sign; outflow is positive.

### Unit: `tests/unit/cashFlowMetrics.test.ts`

Cover `deriveCashFlowMetrics`: 7-day slice, volatility over present days
only, trend zero-fill, trailing percentage with the zero guard, and the
day-count divisor. Add a hook wiring test with a mocked `rpc` response.
Cover `fetchAllPages`: multi-page assembly, `truncated` flag at the page
cap, error propagation.

### E2E: extend `tests/e2e/financial-intelligence-cashflow.spec.ts`

The change puts an RPC into a request path, so the E2E gate applies.
Seed rows that include one transfer and one final-day transaction. Load
`/financial-intelligence` and check that the hero net value equals the
Cash Flow section net value. That equality is the regression the user
reported.

## Decided trade-offs

- The RPC returns a daily series, and the client derives volatility,
  trend, and slices. The alternative — compute every metric in SQL —
  makes the pgTAP surface larger and duplicates date-math the client
  already owns. The daily series is bounded (≤ ~181 rows for the largest
  preset window), so the transfer-size goal holds either way.
- The three scan hooks keep client aggregation with pagination. A full
  RPC conversion for each is deferred; the cap and the final-day bugs
  are fixed now with a small, mechanical change.
