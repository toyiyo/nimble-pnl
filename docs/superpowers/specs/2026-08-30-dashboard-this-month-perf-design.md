# Dashboard "This Month" Performance — Design

Date: 2026-08-30
Branch: `perf/dashboard-this-month`
Base: `main` after PR #779 merges. Both change the same files.

## Problem

A click on "This Month" at Wetzel's fires ~76 Supabase requests. The last
~14.8 seconds is two serial page chains over `inventory_transactions`:

- Chain A: the performance pills. `useFoodCosts` pages 16,648 rows in 17
  serial requests through `fetchAllRows` (`src/utils/fetchAllRows.ts:25`).
- Chain B: the 14-day break-even section. `Index.tsx:281` runs a second
  `useUnifiedCOGS` for its own range, 6,612 rows in 7 serial requests.

The database computes the same sum in one ~300ms query. Two more problems
ride on the same fetch:

- `useMonthlyMetrics` fetches the 12-month inventory rows with
  `.limit(10000)` and no order. Truncation drops arbitrary rows, and the
  current month can show $0.
- The whole dashboard unmounts into `<DashboardSkeleton/>` on every range
  change (`src/pages/Index.tsx:668`). No hook sets `placeholderData`, so
  the page goes blank while ~76 requests re-run.

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
        AND it.created_at < ((p_end_date + 1)::timestamp AT TIME ZONE 'UTC'))
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
  `src/hooks/useFoodCosts.tsx:52-53`. Plain column predicates keep the
  query on existing indexes.
- Security follows the existing `get_inventory_usage_by_month` pattern
  (`supabase/migrations/20260814143000_get_inventory_usage_by_month.sql`):
  SECURITY INVOKER, `SET search_path TO 'public'`, REVOKE from PUBLIC and
  anon, GRANT to authenticated. RLS on `inventory_transactions` enforces
  tenant isolation.
- The plan phase checks the real column type of `transaction_date` in
  production and adjusts the two casts to match the client's string
  comparison semantics.
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
- `useMonthlyMetrics` replaces its `.limit(10000)` inventory fetch with
  one RPC call over the 12-month range. It sums the day rows into month
  buckets. This deletes the truncation bug.
- The break-even section (`Index.tsx:281`) keeps its `useUnifiedCOGS`
  call. The inventory side now costs one RPC round trip.

### 3. A range change keeps the previous data on screen

- Wrap the period click in `startTransition`
  (`setSelectedPeriod`, `src/pages/Index.tsx:151`).
- Add `placeholderData: (prev) => prev` to the period-keyed dashboard
  hooks. The repo pattern exists in `src/hooks/usePOSItems.tsx:52` and
  `src/hooks/useUnifiedSales.tsx:206`. The plan lists the exact hooks.
- Scope the skeleton: `<DashboardSkeleton/>` renders only when the page
  has no data yet (first mount). On a range change, the sections stay
  mounted and show their own loading states.

### 4. Small confirmed wins

- `useMonthlyMetrics`: run the 12 `fetchMonthRevenueTotals` calls with
  `Promise.all`. A later sort fixes the order.
- `useMonthlyMetrics`: fetch `restaurant_financial_settings` concurrently
  with the revenue months. Only the COGS branches depend on it.
- `React.memo` on five section components: `LaborPnlCard`,
  `LaborEfficiencyCard`, `BankSnapshotSection`, `OperationsHealthCard`,
  `DashboardQuickActions`.
- `refetchOnWindowFocus: false` on the heavy dashboard hooks, aligned
  with `useRevenueBreakdown`. Trade-off: after a tab switch, data older
  than the 30s `staleTime` does not auto-refresh. Mount refetch and
  manual refetch stay. `staleTime` stays 30s.
- Lazy-load `ChatMessage` inside `AiChatPanel` with `React.lazy`.
  `ChatMessage.tsx:10` imports mermaid statically (~676 kB chunk,
  `dist/assets/mermaid-*.js`), and `App.tsx:13` mounts the panel on every
  page while it starts closed.

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
  a late-UTC `created_at` row, a cross-restaurant call that returns zero
  rows under RLS, and the anon grant revocation.
- Unit tests: the new hook maps RPC rows; `useFoodCosts` keeps its
  interface; the month derivation in `useMonthlyMetrics`; the skeleton
  renders only without data.
- Host timezone pinned in every date-bucketing test (PR #761 lesson).
- Check the generated RPC Args type against every call site (PR #771
  lesson).
- Parity probe before merge: one read-only production query compares the
  RPC expression against the client-side sum for Wetzel's, August 2026.
  The two totals must match to the cent.

## Expected result

Click-to-settled at Wetzel's drops from ~15s to ~2-3s. Perceived delay
drops to near zero: the previous numbers stay on screen during the
transition.
