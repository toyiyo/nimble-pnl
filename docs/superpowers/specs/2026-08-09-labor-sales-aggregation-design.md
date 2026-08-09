# Labor page: move sales aggregation into SQL

- **Date:** 2026-08-09
- **Author:** Jose M Delgado (with Claude)
- **Status:** Draft for review
- **Feature area:** `/labor` page performance
- **Scope:** Move the sales aggregation for the `/labor` page into SQL. Keep the
  punch → session → labor-cost math client-side. Remove the duplicate 18-week
  `time_punches` fetch and the duplicate `useEmployees` fetch.

This document uses STE-aligned Simplified Technical English. Code identifiers,
SQL, and file paths stay exact.

---

## 1. Problem

The `/labor` page loads slowly. The page fetches raw sales rows for a fixed
18-week window on every load. It then sums the rows in the browser.

### 1.1 Measured root cause

- The page fetches `unified_sales` rows for 18 weeks
  ([`useLaborPnlAnalytics.ts:21`](src/hooks/useLaborPnlAnalytics.ts:21),
  `WEEKS = 18`). For the busiest restaurant this is about 23,700 rows.
- The fetch stops at 20,000 rows
  ([`useSplhData.ts:12`](src/hooks/useSplhData.ts:12), `MAX_PAGES = 20` ×
  `PAGE = 1000` at [`useSplhData.ts:9`](src/hooks/useSplhData.ts:9)). That
  restaurant loses sales rows without any error. The daily series and the
  busy-hours grid under-count.
- The browser then aggregates the rows three ways: a daily series
  (`buildSplhTimeseries`, [`useLaborPnlCore.ts:109`](src/hooks/useLaborPnlCore.ts:109)),
  a day×hour grid (`buildSplhGrid`,
  [`useLaborPnlAnalytics.ts:108`](src/hooks/useLaborPnlAnalytics.ts:108)), and an
  hour-of-day check (`hasHourlyBreakdown`,
  [`useLaborPnlAnalytics.ts:105`](src/hooks/useLaborPnlAnalytics.ts:105)).

### 1.2 Duplicate fetches

- **Two 18-week `time_punches` fetches.** `useSplhData` fetches punches
  ([`useSplhData.ts:53`](src/hooks/useSplhData.ts:53), 5 columns) for the
  session math. `useLaborCostsFromTimeTracking` fetches punches again
  ([`useLaborCostsFromTimeTracking.tsx:96`](src/hooks/useLaborCostsFromTimeTracking.tsx:96),
  `select('*')`) for the labor cost. Both cover the same 18 weeks.
- **Two `useEmployees` fetches.** The page calls
  `useEmployees(restaurantId)` with the default `'active'` filter
  ([`useLaborPnlAnalytics.ts:66`](src/hooks/useLaborPnlAnalytics.ts:66)). The
  labor-cost hook calls `useEmployees(restaurantId, { status: 'all' })`
  ([`useLaborCostsFromTimeTracking.tsx:65`](src/hooks/useLaborCostsFromTimeTracking.tsx:65)).
  The query key includes `status`
  ([`useEmployees.tsx:36`](src/hooks/useEmployees.tsx:36)), so the two calls do
  not share a cache entry. React Query runs two fetches.

---

## 2. Goals and non-goals

### 2.1 Goals

1. Fix the slow load. Replace the 18-week raw sales fetch with one SQL
   aggregate.
2. Remove the 20,000-row cap for sales. SQL sums every row server-side.
3. Remove the duplicate 18-week punch fetch from the labor path.
4. Remove the duplicate `useEmployees` fetch.
5. Keep every displayed number correct. Reuse the existing pure transforms.

### 2.2 Non-goals

- Do not change the SPLH scheduling behavior. `useSplhData` keeps its fetch
  logic, its cap, and its output. It gets one behavior-preserving edit: its
  private `localWindow` moves to the shared helper `src/lib/localDateWindow.ts`
  and it imports it back (§6). `useSplhCore` does not change. The existing
  scheduling tests must stay green.
- Do not change the payroll-grade labor cost math
  (`calculateActualLaborCost`, `useLaborCostsFromTimeTracking`).
- Do not change the `/labor` page UI or its chart components.
- Do not change the tz-boundary limitation between sales dates and labor dates
  (documented at [`laborPnlAnalytics.ts:168`](src/lib/laborPnlAnalytics.ts:168)).

---

## 3. Decisions (confirmed with the user)

1. **Adopt the authoritative revenue filter.** The new RPC filters
   `parent_sale_id IS NULL AND adjustment_type IS NULL AND item_type = 'sale'`.
   This matches `get_unified_sales_totals` and `get_sales_trends`
   ([`20260720010000_get_sales_trends.sql:86`](supabase/migrations/20260720010000_get_sales_trends.sql:86)).
   The current labor path omits `adjustment_type IS NULL`
   ([`useSplhData.ts:36`](src/hooks/useSplhData.ts:36)). Measured impact: 6 rows,
   −$88.40, 0.025% on one restaurant. The change removes void and adjustment
   rows from sales, which is correct.
2. **Keep intraday as a small client fetch.** The single-day (intraday) view
   fetches about 200 rows for one day and reuses the tested
   `buildIntradayFinancialSeries`. The performance problem is the 18-week
   window, not one day. Intraday needs no new SQL.

---

## 4. Architecture overview

### 4.1 Today

```
useLaborPnlCore(weeks)
├─ useSplhData(weeks) ──────────► sales[] + punches[]   (18-week raw fetch, 20k cap)
│    ├─ dailySales = buildSplhTimeseries(sales, sessions)
│    └─ sessions   = identifyWorkSessions(punches)
└─ useLaborCostsFromTimeTracking ► dailyLabor[]          (second 18-week punch fetch)

useLaborPnlAnalytics(page)  reads dailySales, dailyLabor, sales, sessions
├─ grid    = buildSalesVolumeGrid(buildSplhGrid(sales, sessions))
├─ intraday= buildIntradayFinancialSeries(sales, sessions, ...)
└─ useEmployees('active')   ► avgHourlyRateCents         (second employees fetch)
```

### 4.2 After

```
useLaborPnlCore(weeks)
├─ useLaborSalesAnalytics(weeks) ► { daily, grid, byWeekday, hasHourly }  (ONE SQL aggregate)
│    ├─ dailySales = dailySalesFromRpc(daily)            (pure map → SplhPoint[])
│    └─ (grid, byWeekday, hasHourly exposed to the page)
└─ useLaborCostsFromTimeTracking ► dailyLabor[]          (unchanged; the only punch fetch)

useLaborPnlAnalytics(page)  reads dailySales, dailyLabor, grid, byWeekday, hasHourly
├─ grid     = buildSalesVolumeGrid(salesGridCellsFromRpc(grid, byWeekday, hasHourly))
└─ series[intraday] = useLaborIntradaySeries(dateStr)    (tiny single-day fetch, lazy)

useLaborPnlSummary(card)   reads dailySales, dailyLabor   (unchanged contract)
```

`useLaborPnlCore` no longer returns `sales` or `sessions`. The card never used
them ([`useLaborPnlSummary.ts:23`](src/hooks/useLaborPnlSummary.ts:23)). The
page used them only for the grid and the intraday chart. The RPC replaces the
grid inputs. The new intraday hook replaces the intraday inputs.

---

## 5. Component 1 — RPC `get_labor_sales_analytics`

A new migration adds one function. It copies the proven `get_sales_trends`
pattern ([`20260720010000_get_sales_trends.sql`](supabase/migrations/20260720010000_get_sales_trends.sql)),
but returns only the buckets the labor page needs. It drops `pos_system` and
`by_product`. It adds a joint `grid` (day-of-week × hour).

### 5.1 Signature

```sql
CREATE OR REPLACE FUNCTION public.get_labor_sales_analytics(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_time_zone TEXT DEFAULT 'America/Chicago'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
```

- `SECURITY DEFINER` with the `user_restaurants` / `auth.uid()` access check,
  copied from
  [`20260720010000_get_sales_trends.sql:52`](supabase/migrations/20260720010000_get_sales_trends.sql:52).
- `GRANT EXECUTE ... TO authenticated`, re-issued after `CREATE OR REPLACE`.
- `v_time_zone := COALESCE(p_time_zone, 'America/Chicago')` inside the body, so
  an explicit `NULL` does not empty the hour buckets (the `AT TIME ZONE NULL`
  trap noted at
  [`20260720010000_get_sales_trends.sql:17`](supabase/migrations/20260720010000_get_sales_trends.sql:17)).

### 5.2 Filter and hour bucket

A single `revenue_rows` CTE selects the rows once:

- Filter: `restaurant_id = p_restaurant_id AND parent_sale_id IS NULL AND
  adjustment_type IS NULL AND item_type = 'sale' AND sale_date BETWEEN
  p_start_date AND p_end_date`.
- `hour_bucket`: `EXTRACT(HOUR FROM (sold_at AT TIME ZONE v_time_zone))` when
  `sold_at` is present, else `EXTRACT(HOUR FROM sale_time)`, else `NULL`. This
  matches the client `hourOfSale` precedence
  ([`splhAnalytics.ts:153`](src/lib/splhAnalytics.ts:153)).
- `dow`: `EXTRACT(DOW FROM sale_date)::int` (0=Sun..6=Sat). This matches the
  client `dowOfDate` ([`splhAnalytics.ts:175`](src/lib/splhAnalytics.ts:175)).

The planner uses `idx_unified_sales_restaurant_date` for the range predicate,
the same index `get_sales_trends` relies on
([`20260720010000_get_sales_trends.sql:91`](supabase/migrations/20260720010000_get_sales_trends.sql:91)).
No new index is needed.

### 5.3 Return shape

```json
{
  "daily":      [{ "sale_date": "2026-04-01", "revenue": 1234.56 }],
  "grid":       [{ "dow": 1, "hour": 11, "revenue": 456.78 }],
  "by_weekday": [{ "dow": 1, "revenue": 8901.23 }],
  "has_hourly": true
}
```

- `daily` — `SUM(total_price) GROUP BY sale_date`. Drives the P&L series.
- `grid` — `SUM(total_price) GROUP BY dow, hour` where `hour_bucket IS NOT
  NULL`. Drives the busy-hours heatmap. Empty when `has_hourly` is false.
- `by_weekday` — `SUM(total_price) GROUP BY dow`. Drives the no-hour fallback
  spread.
- `has_hourly` — `COALESCE(bool_or(hour_bucket IS NOT NULL), false)`. True when
  at least one row carries a derivable hour. This distinguishes "no sales" from
  "sales without hour info".

All revenue values use `ROUND(rev, 2)`.

---

## 6. Component 2 — hook `useLaborSalesAnalytics`

A new hook wraps the RPC. It replaces the sales role of `useSplhData` inside
`useLaborPnlCore`.

```ts
// src/hooks/useLaborSalesAnalytics.ts
export interface LaborSalesAnalytics {
  daily: { sale_date: string; revenue: number }[];
  grid: { dow: number; hour: number; revenue: number }[];
  by_weekday: { dow: number; revenue: number }[];
  has_hourly: boolean;
}

export function useLaborSalesAnalytics(restaurantId: string | null, tz: string, weeks: number) {
  return useQuery({
    queryKey: ['labor-sales-analytics', restaurantId, tz, weeks],
    queryFn: async (): Promise<LaborSalesAnalytics> => {
      const { startStr, endStr } = localWindow(tz, weeks);
      const { data, error } = await supabase.rpc('get_labor_sales_analytics', {
        p_restaurant_id: restaurantId,
        p_start_date: startStr,
        p_end_date: endStr,
        p_time_zone: tz,
      });
      if (error) throw error;
      return data as LaborSalesAnalytics;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });
}
```

- `localWindow(tz, weeks)` computes the same tz-local 18-week window as
  [`useSplhData.ts:92`](src/hooks/useSplhData.ts:92). The design reuses that
  exact logic so the daily series keeps the same window. Move `localWindow` into
  a shared helper `src/lib/localDateWindow.ts` and import it in both `useSplhData`
  and `useLaborSalesAnalytics`, so the two windows can never drift.
- `staleTime: 60000` matches `useSplhData`
  ([`useSplhData.ts:129`](src/hooks/useSplhData.ts:129)).
- The RPC returns aggregates, so there is no pagination and no cap.

---

## 7. Component 3 — pure mappers

Two pure functions map the RPC output into the shapes the existing transforms
already accept. Both go in `src/lib/laborPnlAnalytics.ts` next to their
consumers, and both get unit tests.

### 7.1 `dailySalesFromRpc`

```ts
export function dailySalesFromRpc(daily: { sale_date: string; revenue: number }[]): SplhPoint[] {
  return daily.map((d) => ({
    bucketStart: d.sale_date,
    label: d.sale_date,
    totalSales: d.revenue,
    totalHours: 0,
    splh: null,
  }));
}
```

`buildFinancialSeries` reads only `point.bucketStart` and `point.totalSales`
([`laborPnlAnalytics.ts:186`](src/lib/laborPnlAnalytics.ts:186)). It ignores
`totalHours`, `splh`, and `label`. So this map feeds `buildFinancialSeries`
unchanged, for both the card and the page.

### 7.2 `salesGridCellsFromRpc`

```ts
export function salesGridCellsFromRpc(
  grid: { dow: number; hour: number; revenue: number }[],
  byWeekday: { dow: number; revenue: number }[],
  hasHourly: boolean,
): SplhGridCell[] { /* returns all 7×24 = 168 cells */ }
```

- When `hasHourly` is true: fill each of the 168 cells from `grid[(dow,hour)]`,
  else 0.
- When `hasHourly` is false: spread each weekday's total across business hours,
  exactly as `buildSplhGrid`'s fallback does
  ([`splhAnalytics.ts:205`](src/lib/splhAnalytics.ts:205)):
  `perHour = byWeekday[dow].revenue / (FALLBACK_CLOSE_HOUR - FALLBACK_OPEN_HOUR)`
  for `hour` in `[FALLBACK_OPEN_HOUR, FALLBACK_CLOSE_HOUR)` (9 to 21). Reuse the
  same `FALLBACK_OPEN_HOUR = 9` / `FALLBACK_CLOSE_HOUR = 22` constants
  ([`splhAnalytics.ts:56`](src/lib/splhAnalytics.ts:56)).
- Set `totalHours: 0`, `splh: null`, `state: 'closed'`.
  `buildSalesVolumeGrid` reads only `cell.totalSales`, `cell.dow`, `cell.hour`
  ([`laborPnlAnalytics.ts:239`](src/lib/laborPnlAnalytics.ts:239)). It ignores
  the other three fields.

This map feeds `buildSalesVolumeGrid` unchanged. The heatmap component and the
`SALES_VOLUME_PEAK_THRESHOLD` logic do not change.

---

## 8. Component 4 — `useLaborPnlCore` changes

- Replace `useSplhData(restaurantId, tz, weeks)`
  ([`useLaborPnlCore.ts:83`](src/hooks/useLaborPnlCore.ts:83)) with
  `useLaborSalesAnalytics(restaurantId, tz, weeks)`.
- Set `dailySales = dailySalesFromRpc(data.daily)` (replaces
  `buildSplhTimeseries` at
  [`useLaborPnlCore.ts:109`](src/hooks/useLaborPnlCore.ts:109)).
- Remove the `sessions` memo
  ([`useLaborPnlCore.ts:101`](src/hooks/useLaborPnlCore.ts:101)) and the
  `useNowTick` import used only by it
  ([`useLaborPnlCore.ts:100`](src/hooks/useLaborPnlCore.ts:100)). Sessions move
  to the intraday hook (§9).
- Stop returning `sales` and `sessions`
  ([`useLaborPnlCore.ts:127`](src/hooks/useLaborPnlCore.ts:127)).
- Add `grid`, `byWeekday`, and `hasHourly` (from the RPC) to the return, for the
  page grid.
- `capped`: the sales RPC never truncates. So `capped` now reflects only the
  labor-cost punch fetch (`laborCapped`,
  [`useLaborPnlCore.ts:133`](src/hooks/useLaborPnlCore.ts:133)).
- `hasData`: today this checks `sales.length > 0 && punches.length > 0`
  ([`useLaborPnlCore.ts:137`](src/hooks/useLaborPnlCore.ts:137)). After the
  change core has no raw sales or punches. Redefine as:
  `dailySales.some((p) => p.totalSales !== 0) && dailyLabor.length > 0`. This
  keeps the "sales but no time tracking" empty-state intent.

The `laborCostWindow` logic and the `useLaborCostsFromTimeTracking` call stay
unchanged.

---

## 9. Component 5 — hook `useLaborIntradaySeries`

The single-day chart needs one day's sales by hour, plus one day's sessions for
the labor shape line. A new hook owns this. It runs only when the page shows a
single day.

```ts
// src/hooks/useLaborIntradaySeries.ts
export function useLaborIntradaySeries(
  restaurantId: string | null,
  tz: string,
  dateStr: string,
  targetPct: number,
  enabled: boolean,
): { series: FinancialPoint[]; isLoading: boolean }
```

- **Sales:** fetch `unified_sales` for `sale_date = dateStr` only (about 200
  rows). Select `sale_date, sale_time, sold_at, total_price` — the `SplhSaleRow`
  shape ([`splhAnalytics.ts:39`](src/lib/splhAnalytics.ts:39)). Use the same
  authoritative filter as the RPC (§3.1).
- **Punches:** fetch `time_punches` for `dateStr` plus the overnight lookahead,
  reusing `lookaheadPunchFetchRange`
  ([`useLaborCostsFromTimeTracking.tsx:95`](src/hooks/useLaborCostsFromTimeTracking.tsx:95)).
  Derive sessions with the existing pipeline:
  `identifyWorkSessions(normalizePunches(appendOpenShiftClockOuts(punches, now)))`,
  the same call `useLaborPnlCore` uses today
  ([`useLaborPnlCore.ts:104`](src/hooks/useLaborPnlCore.ts:104)).
- **Average rate:** call `useEmployees(restaurantId, { status: 'all' })` and
  `computeAvgHourlyRateCents`. The `'all'` filter shares the query key with the
  labor-cost hook ([`useEmployees.tsx:36`](src/hooks/useEmployees.tsx:36)), so
  React Query serves both from one fetch.
- **Series:** return
  `buildIntradayFinancialSeries(sales, sessions, tz, dateStr, avgHourlyRateCents, targetPct, capHour)`,
  reused unchanged ([`laborPnlAnalytics.ts:462`](src/lib/laborPnlAnalytics.ts:462)).
  Compute `capHour` inside the hook: when `dateStr` is the restaurant-tz today,
  cap at the current hour; else leave it undefined. This preserves the "so far
  today" behavior ([`useLaborPnlAnalytics.ts:95`](src/hooks/useLaborPnlAnalytics.ts:95)).

The single-day punch fetch is not the duplicate this project removes. It is
tiny, it is lazy (single-day view only), and it serves a different need (the
hour-of-day labor shape). The removed duplicate is the 18-week `useSplhData`
punch fetch.

---

## 10. Component 6 — `useLaborPnlAnalytics` changes

- Read `grid`, `byWeekday`, `hasHourly` from `useLaborPnlCore` instead of
  `sales`, `sessions`.
- `grid` memo ([`useLaborPnlAnalytics.ts:107`](src/hooks/useLaborPnlAnalytics.ts:107)):
  `buildSalesVolumeGrid(salesGridCellsFromRpc(grid, byWeekday, hasHourly), !hasHourly)`.
  This drops the client `buildSplhGrid` and `hasHourlyBreakdown` calls
  ([`useLaborPnlAnalytics.ts:105`](src/hooks/useLaborPnlAnalytics.ts:105)).
- Call `useLaborIntradaySeries(...)` unconditionally at the top of the page
  hook, with `enabled: granularity === 'intraday'`. A hook can not run inside a
  `useMemo`, so the hook always runs and its `enabled` flag gates the fetch. The
  `series` memo ([`useLaborPnlAnalytics.ts:93`](src/hooks/useLaborPnlAnalytics.ts:93))
  then selects: for `granularity === 'intraday'`, return the intraday hook's
  `series`; for `'day'` and `'week'`, keep `buildFinancialSeries` over
  `periodSales` / `periodLabor` unchanged.
- Remove the page's own `useEmployees(restaurantId)` call and the
  `computeAvgHourlyRateCents` memo
  ([`useLaborPnlAnalytics.ts:66`](src/hooks/useLaborPnlAnalytics.ts:66)). The
  average rate moves into `useLaborIntradaySeries`.
- `isLoading`: OR the intraday hook's `isLoading` when the intraday view is
  active, so the chart shows a loading state during the single-day fetch.

### 10.1 Accepted numeric change

The average hourly rate now comes from `{ status: 'all' }` employees, not
`'active'`. This changes only the intraday chart's labor **shape** line, which
is already a non-payroll estimate
([`laborPnlAnalytics.ts:445`](src/lib/laborPnlAnalytics.ts:445)). The KPI row
and the verdict use the payroll-grade daily series and do not change. The `'all'`
set matches the set the labor-cost engine uses
([`useLaborCostsFromTimeTracking.tsx:65`](src/hooks/useLaborCostsFromTimeTracking.tsx:65)),
so the change makes the shape more consistent, not less.

---

## 11. Data flow summary

| View | Sales source | Labor source | Grid source |
|------|--------------|--------------|-------------|
| Card (`useLaborPnlSummary`) | RPC `daily` → `dailySalesFromRpc` | `dailyLabor` | none |
| Page day / week | RPC `daily` → filter to range | `dailyLabor` → filter to range | RPC `grid` / `byWeekday` |
| Page intraday (one day) | single-day fetch | single-day sessions × avg rate | RPC `grid` / `byWeekday` |

The busy-hours grid spans the full 18-week window in every page view, as today
([`useLaborPnlAnalytics.ts:44`](src/hooks/useLaborPnlAnalytics.ts:44)).

---

## 12. Correctness notes

- **Filter parity plus one fix.** The RPC adds `adjustment_type IS NULL`
  (decision §3.1). Every other filter term matches
  [`useSplhData.ts:36`](src/hooks/useSplhData.ts:36).
- **Hour bucket parity.** RPC precedence `sold_at` then `sale_time` matches
  `hourOfSale` ([`splhAnalytics.ts:153`](src/lib/splhAnalytics.ts:153)).
  `sale_time` is a TIME column, so `EXTRACT` needs no string guard
  ([`20260720010000_get_sales_trends.sql:21`](supabase/migrations/20260720010000_get_sales_trends.sql:21)).
- **Day-of-week parity.** RPC `EXTRACT(DOW FROM sale_date)` (0=Sun) matches
  `dowOfDate` ([`splhAnalytics.ts:175`](src/lib/splhAnalytics.ts:175)).
- **Fallback spread parity.** The client fallback uses the same 9–22 window and
  the same per-hour math as `buildSplhGrid`
  ([`splhAnalytics.ts:210`](src/lib/splhAnalytics.ts:210)).
- **Rounding parity.** RPC uses `ROUND(rev, 2)`. The client transforms
  re-round with `round2` ([`laborPnlAnalytics.ts:201`](src/lib/laborPnlAnalytics.ts:201)).

---

## 13. States

- **Loading:** core `isLoading` covers the RPC and the labor-cost fetch. The
  page ORs the intraday hook's `isLoading` for the single-day view.
- **Empty:** `hasData` uses the daily series and the daily labor series (§8).
- **Error:** the RPC hook throws on `error`, and core surfaces it through the
  existing `isError` / `error` path
  ([`useLaborPnlCore.ts:139`](src/hooks/useLaborPnlCore.ts:139)).

---

## 14. Testing

### 14.1 pgTAP (`supabase/tests/`)

Test `get_labor_sales_analytics`:

1. Access check: a non-member `auth.uid()` gets `Access denied to restaurant`.
2. Filter: rows with `adjustment_type` set, `parent_sale_id` set, or
   `item_type <> 'sale'` never contribute to any bucket.
3. Hour bucket: `sold_at` wins over `sale_time`; a row with neither is absent
   from `grid` but present in `daily` and `by_weekday`.
4. `daily`, `grid`, `by_weekday` sums are correct for a small fixture.
5. `has_hourly`: true when any row has an hour; false when none do; false for
   zero rows (via `COALESCE`).
6. Shape and foreign-key tests (per the project lessons): the function returns
   the documented JSONB keys, and the fixture respects the `unified_sales`
   foreign keys.

### 14.2 Unit tests (`tests/unit/`)

- `dailySalesFromRpc`: maps fields, keeps order, handles an empty array.
- `salesGridCellsFromRpc`: returns 168 cells; real path fills from `grid`;
  fallback path spreads `by_weekday` across hours 9–21; a weekday absent from
  `by_weekday` yields zero cells.
- `useLaborIntradaySeries`: given fixed sales and sessions, returns the same
  series as a direct `buildIntradayFinancialSeries` call.

### 14.3 Regression

- The existing `laborPnlAnalytics` and `splhAnalytics` unit tests stay green.
  The transforms do not change.
- Confirm the Dashboard card (`useLaborPnlSummary`) still renders. Its contract
  (`dailySales`, `dailyLabor`) is unchanged.

---

## 15. Rollout and risk

- **Blast radius.** The change touches the labor feature only: the RPC (new),
  `useLaborSalesAnalytics` (new), `useLaborIntradaySeries` (new), two mappers
  (new), the shared `localDateWindow` helper (new), `useLaborPnlCore`, and
  `useLaborPnlAnalytics`. `useSplhData` gets one behavior-preserving edit (the
  `localWindow` extraction, §2.2). `useSplhCore` and
  `useLaborCostsFromTimeTracking` do not change.
- **Shared-hook safety.** The card reads only `dailySales` / `dailyLabor`, which
  the change preserves ([`useLaborPnlSummary.ts:23`](src/hooks/useLaborPnlSummary.ts:23)).
- **Rollback.** The RPC is additive. If the client change regresses, revert the
  client commits; the RPC can stay.
- **Verification.** Compare the daily totals, the grid, and the KPI values for
  the busiest restaurant before and after, using a production SELECT for the
  ground truth.

---

## 16. Out of scope

- Splitting `useSplhData` into separate sales and punch fetches.
- Narrowing the labor-cost punch fetch columns (`select('*')`,
  [`useLaborCostsFromTimeTracking.tsx:99`](src/hooks/useLaborCostsFromTimeTracking.tsx:99)).
- The sales-date vs labor-date tz boundary
  ([`laborPnlAnalytics.ts:168`](src/lib/laborPnlAnalytics.ts:168)).
