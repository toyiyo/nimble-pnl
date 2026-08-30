# Dashboard "This Month" Performance — Design

Date: 2026-08-30
Branch: `perf/dashboard-this-month`
Base: `main` after PR #779 merges. Both change the same files.

## Problem

A click on "This Month" at Wetzel's fires ~76 Supabase requests. The last
~14.8 seconds is two serial page chains over `inventory_transactions`:

- Chain A: the performance pills. `useFoodCosts` pages 16,648 rows in 17
  serial requests through `fetchAllRows` (`src/utils/fetchAllRows.ts:41`).
- Chain B: the 14-day break-even section. `Index.tsx:281` runs a second
  `useUnifiedCOGS` for its own range, 6,612 rows in 7 serial requests.

The database computes the same sum in one ~300ms query. Two more problems
ride on the same fetch:

- `useMonthlyMetrics` pages the 12-month inventory rows through
  `fetchAllRows` with `maxPages: COGS_MAX_PAGES`
  (`src/hooks/useMonthlyMetrics.tsx:290-306`, post PR #779). That is up
  to 50 serial requests, and above 50,000 rows the figure goes
  incomplete with a warning.
- The whole dashboard unmounts into `<DashboardSkeleton/>` on every range
  change (`src/pages/Index.tsx:699-701`). No hook sets `placeholderData`,
  so the page goes blank while ~76 requests re-run.

## Design

### 1. Server RPC: `get_inventory_usage_by_day`

One migration adds:

```sql
CREATE OR REPLACE FUNCTION public.get_inventory_usage_by_day(
  p_restaurant_id UUID, p_start_date DATE, p_end_date DATE
)
RETURNS TABLE(day DATE, food_cost NUMERIC)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(it.transaction_date::date,
             (it.created_at AT TIME ZONE 'UTC')::date) AS day,
    SUM(ABS(COALESCE(it.total_cost, 0)))::NUMERIC AS food_cost
  FROM inventory_transactions it
  WHERE it.restaurant_id = p_restaurant_id
    AND it.transaction_type = 'usage'
    AND (
      (it.transaction_date IS NOT NULL
        AND it.transaction_date >= p_start_date
        AND it.transaction_date <= p_end_date)
      OR
      (it.transaction_date IS NULL
        AND it.created_at >= (p_start_date::timestamp AT TIME ZONE 'UTC')
        AND it.created_at <=
          ((p_end_date::timestamp AT TIME ZONE 'UTC')
            + interval '23:59:59.999'))
    )
  GROUP BY 1
  ORDER BY 1;
$$;
```

Rules for this function:

- It replicates `aggregateInventoryCOGSByDate`
  (`src/services/cogsCalculations.ts:64`) exactly: bucket by
  `COALESCE(transaction_date, created_at UTC date)`, `SUM(ABS(...))` per
  row. Totals must not move in this PR.
- The filter replicates the two `.or()` clauses in
  `src/hooks/useFoodCosts.tsx:53-54`, including the exact end bound. The
  client cuts at `created_at <= {toStr}T23:59:59.999Z`, so the RPC cuts
  at the same millisecond. An exclusive `< p_end_date + 1` bound would
  admit rows in the final microseconds the client rejects.
- No existing index covers the date-range predicate. The current
  indexes (`20250920123920_...sql:126-129`) let the planner reach every
  `'usage'` row for the restaurant, then check the dates row by row.
  Add a second migration file with:

  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS
    idx_inventory_transactions_usage_date
    ON public.inventory_transactions (restaurant_id, transaction_date)
    WHERE transaction_type = 'usage';
  ```

  `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so it
  needs its own file — the repo precedent is
  `supabase/migrations/20260708193107_idx_unified_sales_uncategorized_feed.sql`.
  The table holds 39,592 rows (19 MB) across 15 tenants today, so this
  is future-proofing, not a current bottleneck.
- Security follows the existing `get_inventory_usage_by_month` pattern
  (`supabase/migrations/20260814143000_get_inventory_usage_by_month.sql`):
  SECURITY INVOKER, `SET search_path TO 'public'`, REVOKE from PUBLIC and
  anon, GRANT to authenticated. RLS on `inventory_transactions` enforces
  tenant isolation.
- Production column types are confirmed: `transaction_date` is `date`,
  `created_at` is `timestamptz`, `total_cost` is `numeric`. The casts
  above are correct. A parity probe on production (2026-08-30, run
  twice) compared this filter against the client filter for Wetzel's
  Cold Stone (August 2026). The filters matched exactly on both runs.
  The second run, with the final `<=` bound: both filters select 16,682
  rows and both sum to $2,358.4342. The exact SQL is in the Appendix.
- `get_inventory_usage_by_month` has no frontend caller and buckets by
  `created_at` only. This PR does not touch it. A follow-up task decides
  its removal.

### 2. One data path for the three consumers

- New hook `useInventoryUsageByDay(restaurantId, from, to)` calls the RPC
  under the query key `['inventory-usage-by-day', restaurantId, fromStr,
  toStr]`.
- `useFoodCosts` becomes a thin wrapper over the new hook. Its public
  interface (`dailyCosts`, `totalCost`, `capped`, `isLoading`, `error`,
  `refetch`) does not change, so `useUnifiedCOGS` and its tests do not
  change. `capped` is now always `false` — the server has no row cap.
- `useMonthlyMetrics` replaces its paged inventory fetch
  (`inventoryCOGSPromise`, lines 290-306) with one RPC call over the
  12-month range. The existing day→month loop at line 550 consumes the
  RPC rows directly. The server aggregate has no row cap, so the
  inventory `pushCapWarning` call goes away.
- The break-even section (`Index.tsx:281`) keeps its `useUnifiedCOGS`
  call. The inventory side now costs one RPC round trip.

### 3. A range change keeps the previous data on screen

- Wrap the period change in `startTransition`. The only caller of
  `setSelectedPeriod` is `onPeriodChange={setSelectedPeriod}` at
  `src/pages/Index.tsx:767`. The edit:

  ```tsx
  onPeriodChange={(period) => startTransition(() => setSelectedPeriod(period))}
  ```
- Add `placeholderData` to the period-keyed leaf hooks. The guarded form
  is mandatory. An unguarded `(prev) => prev` shows tenant A's numbers
  under tenant B's name during a restaurant switch:

  ```typescript
  placeholderData: (prev, prevQuery) =>
    prevQuery?.queryKey[1] === restaurantId ? prev : undefined,
  ```

  `restaurantId` sits at index 1 in every target key. The repo pattern
  exists in `src/hooks/usePOSItems.tsx:52-53` and
  `src/hooks/useUnifiedSales.tsx:211-214`.
- The exact hooks: `useRevenueBreakdown`, `useCOGSFromFinancials`,
  `useLaborCostsFromTimeTracking`, `useLaborCostsFromTransactions`,
  `useInventoryPurchases`, `useMonthlyMetrics`, and the new
  `useInventoryUsageByDay`. `usePeriodMetrics` and `useCostsFromSource`
  are composite hooks without their own `useQuery` — they inherit the
  behavior. `useInventoryAlerts` is not React Query; its deps are
  `[restaurantId]` only, so a period change cannot re-fire it.
- Rewrite the skeleton gate (`src/pages/Index.tsx:699-701`) as a
  data-presence check:

  ```tsx
  {alertsLoading || (todaysLoading && !todaysData) ||
   (periodLoading && !periodData) ? (
    <DashboardSkeleton />
  ) : ( ... )}
  ```

  First mount has no data, so the skeleton shows. On a period change,
  `placeholderData` keeps the data present, so the page stays mounted.
  On a restaurant switch, the guard clears the data, so the skeleton
  shows again — correct for a tenant change.
- Show a freshness signal during the transition. `usePeriodMetrics`
  exposes a new `isFetching` flag, sourced from
  `useRevenueBreakdown.isFetching` (a period-keyed query that always
  refetches on a range change). While `isFetching` is true, the period
  sections render with `opacity-60 transition-opacity` so stale numbers
  read as stale.
- Announce the update for screen readers. Next to the period selector,
  render `<output aria-live="polite" className="sr-only">` with the text
  `Dashboard updated for {periodLabel}` when `isFetching` returns to
  false. Sighted users see the numbers change; this gives assistive
  tech the same signal.

### 4. Small confirmed wins

- `useMonthlyMetrics`: run the 12 `fetchMonthRevenueTotals` calls with
  `Promise.all`. A later sort fixes the order.
- `useMonthlyMetrics`: fetch `restaurant_financial_settings` concurrently
  with the revenue months. Its `await` at line 276 now blocks the start
  of the eight parallel fetches, and only the two COGS branches depend
  on it.
- `React.memo` on five section components: `LaborPnlCard`,
  `LaborEfficiencyCard`, `BankSnapshotSection`, `OperationsHealthCard`,
  `DashboardQuickActions`. Every call site passes primitives only, so
  plain `React.memo(Component)` with the default shallow comparison is
  enough. Do not add custom comparison functions.
- Keep `refetchOnWindowFocus: true` on the dashboard hooks. CLAUDE.md
  puts data accuracy first, and the RPC makes a focus refetch cheap:
  one request instead of 17. The earlier draft turned this off; the
  design review reversed that. The `useRevenueBreakdown` precedent does
  not transfer — its `staleTime` is 5 minutes, not 30 seconds.
- Lazy-load `ChatMessage` inside `AiChatPanel` with `React.lazy`.
  `ChatMessage.tsx:10` imports mermaid statically (~676 kB chunk,
  `dist/assets/mermaid-*.js`), and `App.tsx:13` mounts the panel on every
  page while it starts closed. The boundary: wrap only the message
  `.map()` (`AiChatPanel.tsx:274-276`) in `<Suspense>`, with a
  bubble-shaped fallback (a `bg-muted/30 rounded-lg` block, not a
  spinner). Prefetch the chunk when `isOpen` turns true, so the first
  message does not wait on the download.
- Delete `src/components/AiChat.tsx`. It is dead code — no route or
  component renders it — and its line 4 is a second static
  `ChatMessage` import that would keep mermaid in the main bundle.

## Out of scope

- Any change to `useUnifiedCOGS.tsx`, `cogsFetch.ts`, or
  `cogsCalculations.ts` function bodies. Two peer sessions own the
  combined-COGS work.
- The accuracy fixes: refund signs, the `Math.abs` sign filter, the
  restaurant-timezone day key. They wait on the peer scope answer.
- The duplicate pending-outflow links at Wetzel's.

## Error handling

RPC errors flow through the existing `useQuery` error paths. A missing
function (migration not applied) surfaces as an error state, not as a
silent zero.

## Testing

- pgTAP suite for the RPC: bucketing with `transaction_date` present and
  null, `SUM(ABS(...))` with a negative row, both boundary days including
  a late-UTC `created_at` row, a `purchase` row in range that produces
  zero `food_cost` rows, an empty date range that returns zero rows
  without an error, a cross-restaurant call that returns zero rows under
  RLS, and the anon grant revocation.
- `EXPLAIN` check after the index migration: a one-month window for one
  restaurant must show an index scan on
  `idx_inventory_transactions_usage_date`, not a full partition scan.
- Before the migration files exist: run `ls supabase/migrations | tail
  -3` and pick a strictly later timestamp. Two peer sessions work on the
  same COGS surface, so check again before merge. The unit test
  `tests/unit/migrationVersionUniqueness.test.ts` backstops a collision.
- Unit tests: the new hook maps RPC rows; `useFoodCosts` keeps its
  interface; the month derivation in `useMonthlyMetrics`; the skeleton
  renders only without data.
- Host timezone pinned in every date-bucketing test (PR #761 lesson).
- Check the generated RPC Args type against every call site (PR #771
  lesson).
- Parity probe before merge: re-run the Appendix query on production.
  Row counts and sums must match exactly between the two filters. The
  absolute numbers move as new rows arrive; the match is the assertion.

## Expected result

Click-to-settled at Wetzel's drops from ~15s to ~2-3s. Perceived delay
drops to near zero: the previous numbers stay on screen during the
transition.

## Appendix: parity probe SQL

Read-only. Run against production with any August-active restaurant id.
The `rpc_*` pair uses the RPC's `WHERE` expression. The `client_*` pair
uses the two `.or()` clauses from `useFoodCosts` in SQL form. All four
values must agree pairwise.

```sql
SELECT
  count(*) FILTER (WHERE
    (transaction_date IS NOT NULL
      AND transaction_date >= DATE '2026-08-01'
      AND transaction_date <= DATE '2026-08-31')
    OR
    (transaction_date IS NULL
      AND created_at >= (DATE '2026-08-01'::timestamp AT TIME ZONE 'UTC')
      AND created_at <= ((DATE '2026-08-31'::timestamp AT TIME ZONE 'UTC')
        + interval '23:59:59.999'))
  ) AS rpc_rows,
  sum(ABS(COALESCE(total_cost, 0))) FILTER (WHERE
    (transaction_date IS NOT NULL
      AND transaction_date >= DATE '2026-08-01'
      AND transaction_date <= DATE '2026-08-31')
    OR
    (transaction_date IS NULL
      AND created_at >= (DATE '2026-08-01'::timestamp AT TIME ZONE 'UTC')
      AND created_at <= ((DATE '2026-08-31'::timestamp AT TIME ZONE 'UTC')
        + interval '23:59:59.999'))
  ) AS rpc_sum,
  count(*) FILTER (WHERE
    (transaction_date >= DATE '2026-08-01'
      OR (transaction_date IS NULL
        AND created_at >= TIMESTAMPTZ '2026-08-01T00:00:00Z'))
    AND
    (transaction_date <= DATE '2026-08-31'
      OR (transaction_date IS NULL
        AND created_at <= TIMESTAMPTZ '2026-08-31T23:59:59.999Z'))
  ) AS client_rows,
  sum(ABS(COALESCE(total_cost, 0))) FILTER (WHERE
    (transaction_date >= DATE '2026-08-01'
      OR (transaction_date IS NULL
        AND created_at >= TIMESTAMPTZ '2026-08-01T00:00:00Z'))
    AND
    (transaction_date <= DATE '2026-08-31'
      OR (transaction_date IS NULL
        AND created_at <= TIMESTAMPTZ '2026-08-31T23:59:59.999Z'))
  ) AS client_sum
FROM inventory_transactions
WHERE restaurant_id = '7c0c76e3-e770-401b-a2a9-c1edd407efed'
  AND transaction_type = 'usage';
```

Result on 2026-08-30: `rpc_rows` = `client_rows` = 16,682 and
`rpc_sum` = `client_sum` = 2358.4342411081413782117284675.
