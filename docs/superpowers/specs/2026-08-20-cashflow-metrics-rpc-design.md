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

The same unpaged scan pattern exists in four more hooks:

- `src/hooks/useRevenueHealth.tsx:47-52`
- `src/hooks/useExpenseHealth.tsx:51-57` (this one filters
  `is_transfer = false` at line 55)
- `src/hooks/usePredictableExpenses.tsx:38-44`
- `src/hooks/useLiquidityMetrics.tsx:73-88` — the period scan that
  feeds `avgDailyOutflow`, `cashBurnRate`, `daysOfCash`, and the runway
  text. It has the bare-date `.lte` bug too (line 81). (Phase 2.5
  frontend review found this scan; the first draft missed it.)

Not affected: `src/hooks/usePendingOutflows.tsx` touches
`bank_transactions` only by single `id` — a `.single()` read at line
163 and an `.update()` by `id` at lines 203-206. Neither is a scan.
The other `useLiquidityMetrics` queries (`bank_account_balances` at
lines 50-53, `pending_outflows` at lines 62-64) stay small.

## Approach (approved)

Move the hero aggregation into one SQL function. The client receives at
most a few hundred daily rows instead of thousands of transactions. No
row cap can apply, because the server aggregates.

### 1. New SQL function `get_cash_flow_metrics`

Model: `get_labor_sales_analytics`
(`supabase/migrations/20260809120000_get_labor_sales_analytics.sql:8-32`)
— `SECURITY DEFINER`, `STABLE`, `SET search_path = public, pg_temp`, and a
`JSONB` result.

**Access gate — do not copy the model's gate.** The model gates on bare
`user_restaurants` membership, which mirrors the RLS of its own table
(`unified_sales`). The RLS of `bank_transactions` is capability-based:
`USING (user_has_capability(restaurant_id, 'view:transactions'))`
(`supabase/migrations/20260120100100_update_rls_for_collaborators.sql:165-168`),
and `view:transactions` maps to `owner`, `manager`,
`collaborator_accountant` only
(`supabase/migrations/20260120100200_add_missing_capabilities_to_function.sql:43`).
A bare membership gate would let `chef`, `staff`, `kiosk`,
`collaborator_inventory`, and `collaborator_chef` members read cash flow
totals that RLS blocks for them (Phase 2.5 Supabase review, critical;
lesson `memory/lessons.md:1395-1398`). Gate:

```sql
IF NOT public.user_has_capability(p_restaurant_id, 'view:transactions') THEN
  RAISE EXCEPTION 'Access denied to restaurant';
END IF;
```

The gate calls the same function as the table's RLS policy
(`user_has_capability(p_restaurant_id UUID, p_capability TEXT)`,
`supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:27-31`),
so the role set cannot drift from the policy. The reviewer also offered
`SECURITY INVOKER`. The design keeps `SECURITY DEFINER` with this gate
because: the gate runs once, not once per row; the caller gets an
explicit error instead of silent empty data; and the pgTAP tests keep
the simple JWT-claims impersonation without a role switch.

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
- The category heuristic from `isInternalTransfer`
  (`src/lib/cashflowInsights.ts:116-121`): exclude a row when its
  `chart_of_accounts` category (via `category_id`) has `account_type IN
  ('asset', 'liability', 'equity')` AND (`account_subtype = 'cash'` OR
  `account_name ~* 'transfer'`). The `categorize_bank_transaction` RPC
  assigns transfer categories without the `is_transfer` flag (see
  `docs/superpowers/specs/2026-04-26-transfer-category-classification-design.md`),
  so the flag alone leaves a hero/section gap. A row with no category
  counts. A non-P&L category outside the cash/transfer set (a loan
  payment, an owner contribution) counts — that is real external cash.
  The SQL copy of this heuristic must stay identical to the TypeScript
  copy in `isInternalTransfer`; the SQL is authoritative for the hero.
  Source of the change: the Codex review finding on PR #771.
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
  Bounds, in the same half-open style: `transaction_date >=
  comparison_start::timestamp AT TIME ZONE 'UTC'` and `transaction_date
  < p_start_date::timestamp AT TIME ZONE 'UTC'`. This matches
  `subDays(startDate, periodDays)` at
  `src/hooks/useCashFlowMetrics.tsx:29-30`.
- Day bucket: `(transaction_date AT TIME ZONE 'UTC')::date`.
- Index: the query filters on `restaurant_id` equality plus a
  `transaction_date` range, which
  `idx_bank_transactions_restaurant_date` on
  `(restaurant_id, transaction_date)` covers
  (`supabase/migrations/20260814148000_idx_bank_transactions_restaurant_date.sql`).
  Check the plan with one `EXPLAIN` during implementation.
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

Day-key convention: the RPC returns `daily[].day` as `YYYY-MM-DD`
strings. The derive module keys its map on those strings directly. When
it must turn a JS `Date` into a key (the 7-day cut and the trend fill),
it uses `toDateOnlyString()` from `src/lib/dateOnly.ts` — local
calendar fields, never `toISOString()`. The custom lint rule
`restaurant-clock` bans `format(instant, 'yyyy-MM-dd')` for this
purpose.

`useCashFlowMetrics` then calls
`supabase.rpc('get_cash_flow_metrics', ...)` and passes the result to
`deriveCashFlowMetrics`. Parameter conversion: the hook's local
sentinel `'all'` becomes `p_bank_account_id: null`; a literal `'all'`
string fails the UUID cast. The hook keeps its query key, `staleTime:
30000`, and `enabled` guard (`useCashFlowMetrics.tsx:23,138-141`).

Error path: the RPC raises `Access denied to restaurant`, so the query
can now error where RLS gave silent empty data before.
`FinancialPulseHero` reads no `error` today
(`src/components/banking/FinancialPulseHero.tsx:17`). Change it to
read `error` from the hook and show a short muted line ("Cannot load
cash flow data") in place of the metric grid. This follows the
"Always Handle States" rule in CLAUDE.md.

**Intended value changes** (these are the fix, not regressions):

- Transfers no longer count.
- The final day now counts.
- Day buckets move from the browser-local frame
  (`useCashFlowMetrics.tsx:99`) to UTC, which matches the section.

### 3. Shared paged fetch for the four remaining scan hooks

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
  order (`useCashFlowInsights.tsx:93-95` does this today). Two of the
  hooks lack this today and must add it: `useExpenseHealth.tsx:63` has
  no `.order()` at all, and `useRevenueHealth.tsx:59` orders by
  `transaction_date` without the `id` tiebreaker. Without a total
  order, pages can skip or repeat rows.

Apply it to:

- `useCashFlowInsights` — replace the local loop, no behavior change.
- `useRevenueHealth`, `useExpenseHealth`, `useLiquidityMetrics` — page
  the scan, add the double order, and change the end bound to
  `T23:59:59.999Z`. Do not change their filters or their aggregation.
  Only the silent truncation and the dropped final day go away.
- `usePredictableExpenses` — this hook has no `endDate` parameter. It
  builds its own window: `today = new Date()` and `lookbackStart =
  addDays(today, -120)` (`usePredictableExpenses.tsx:32-34`). Apply
  the end bound to the formatted `today` value:
  `.lte('transaction_date', `${toDateOnlyString(today)}T23:59:59.999Z`)`.
  Page the scan the same way as the others.

Each caller receives `truncated` and passes it through its return value
for future surfacing. No UI change for the `truncated` flag in this PR.
Consumer check (Phase 2.5 frontend review): no consumer of the four
hooks destructures a strict object shape, so the added field breaks
nothing.

Test impact: `tests/unit/useExpenseHealth.test.tsx` builds a mock query
object without an `order` method (~lines 70-84). Add `order` to that
mock, or the new `.order()` call throws in CI.

## Out of scope

- Moving `useRevenueHealth` / `useExpenseHealth` /
  `usePredictableExpenses` aggregation into SQL. Each needs its own
  result shape (category joins, payee grouping). Follow-up work.
- Transfer exclusion in `useRevenueHealth` and `usePredictableExpenses`.
  A semantic change there needs its own review of what each metric
  claims to show.
- Restaurant-local day buckets. The section uses UTC today; the hero
  must match the section first.
- `usePendingOutflows` (not affected, see Problem).

## Tests

### pgTAP: `supabase/tests/get_cash_flow_metrics.sql`

Impersonate the caller with
`set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)` —
`auth.uid()` reads the JWT GUC and needs no role switch (lesson
2026-07-22). Cases:

1. A non-member caller gets `Access denied to restaurant` (`throws_ok`).
2. A member with the role `staff` (outside `{owner, manager,
   collaborator_accountant}`) gets `Access denied to restaurant`.
3. A member with the role `collaborator_accountant` gets a result.
4. A transfer row (`is_transfer = true`) does not count.
5. A pending row (`status = 'pending'`) does not count.
6. A row at `23:30 UTC` on `p_end_date` counts (end-of-day bound).
7. A row on the day before `p_start_date` counts in `comparison`, not in
   `daily`.
8. The `p_bank_account_id` filter keeps only the matching account.
9. An empty window returns `{"daily": [], "comparison": {...}}` with
   zero totals, not NULL.
10. Inflow and outflow split by sign; outflow is positive.
11. A flagless row (`is_transfer = false`) with a transfer-type category
    does not count. Cover both branches: subtype `cash`, and a name
    that matches `~* 'transfer'`.
12. A flagless row with a non-P&L category outside the cash/transfer
    set (a loan account) counts.

### Unit: `tests/unit/cashFlowMetrics.test.ts`

Cover `deriveCashFlowMetrics`: 7-day slice, volatility over present days
only, trend zero-fill, trailing percentage with the zero guard, and the
day-count divisor. Add a hook wiring test with a mocked `rpc` response,
plus one case where the mocked `rpc` rejects with `Access denied to
restaurant` and the hook surfaces the error. Cover `fetchAllPages`:
multi-page assembly, `truncated` flag at the page cap, error
propagation. Change the mock builder in
`tests/unit/useExpenseHealth.test.tsx` to accept `.order()`.

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
