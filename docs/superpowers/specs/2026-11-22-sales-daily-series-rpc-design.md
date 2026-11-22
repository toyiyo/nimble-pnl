# Sales daily series RPC — design

Stacks on PR 879 (`feature/sales-period-comparison`).

## Problem

The POS Sales trends panel runs `useSalesTrends` two times. The second call
gets the prior period (`src/components/pos-sales/SalesTrendsPanel.tsx:81-90`).
Each call runs the full `get_sales_trends` RPC
(`src/hooks/useSalesTrends.ts:44`). That RPC builds five aggregates:
`pos_systems`, `by_day`, `by_hour`, `by_weekday`, and `by_product`
(`supabase/migrations/20260720010000_get_sales_trends.sql:95-176`).

The panel reads only `by_day` and `pos_systems` from the prior result
(`SalesTrendsPanel.tsx:108-119`). `computeKpis` also reads `by_hour`
(`src/lib/salesTrends.ts:491-498`), but the panel uses only `netSales`,
`orders`, and `avgOrder` from the prior KPIs (`SalesTrendsPanel.tsx:129-136`).
These three values come from `by_day` only (`src/lib/salesTrends.ts:478-480`).

The hour, weekday, and product scans are wasted work. The prior range has no
length cap.

## Decision

Add `public.get_sales_daily_series(p_restaurant_id UUID, p_start_date DATE,
p_end_date DATE) RETURNS JSONB`.

- Return `{ "pos_systems": [...], "by_day": [...] }`. The keys, the row
  shape, the sort order, and the `ROUND(..., 2)` are the same as in
  `get_sales_trends` (`20260720010000_get_sales_trends.sql:99-123`). The
  client then reuses the existing `parseDayRow` guard.
- Copy the revenue predicate exactly: `restaurant_id = p_restaurant_id`,
  `parent_sale_id IS NULL`, `adjustment_type IS NULL`, `item_type = 'sale'`,
  `sale_date` between the two dates (`20260720010000_get_sales_trends.sql:84-93`).
- Copy the security model: `LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public`, and the `user_restaurants` membership check on
  `auth.uid()` that raises `Access denied to restaurant`
  (`20260720010000_get_sales_trends.sql:42-58`).
- No time zone parameter. `by_day` groups on the `sale_date` column. The time
  zone affects only `by_hour` (`20260720010000_get_sales_trends.sql:76-83`).
- Both dates are required. The prior range always has two dates
  (`SalesTrendsPanel.tsx:77-80`). A NULL date raises SQLSTATE `22023`.
- Cap the range at 731 days (two years, inclusive). A longer range raises
  SQLSTATE `22023`. The panel then shows the existing "comparison not
  available" state (`priorFailed`, `SalesTrendsPanel.tsx:128`).
- `p_end_date < p_start_date` returns empty arrays. It does not raise.
- `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO authenticated`.
- The range scan can use `idx_unified_sales_restaurant_keyset`
  `(restaurant_id, sale_date, created_at, id)`. The old
  `idx_unified_sales_restaurant_date` is deleted
  (`supabase/migrations/20260720120001_bulk_deduction_keyset_batching.sql:158-160`).
  A pgTAP `has_index` check pins the index. The function does one grouped
  scan, not five.
- Order of checks: the membership check runs first. The NULL-date check and
  the cap check run after it. A non-member learns nothing about the arguments.
- Role scope: any member of the restaurant can call the function, the same as
  `get_sales_trends`. The check does not read `role`
  (`20260720010000_get_sales_trends.sql:52-58`). This is intended.
- Cap edge case: `get_sales_trends` has no cap. A current range of more than
  731 days gives a prior range of the same length, and the prior call raises
  `22023`. The panel then shows "comparison not available". The hook does not
  retry a `22023` error, because a retry cannot succeed.

## Client

- `src/lib/salesTrends.ts`: add `SalesDailySeriesData` (`pos_systems`,
  `by_day`) and `parseSalesDailySeries`. Add `toTrendsData(series)`. It fills
  the three other arrays with `[]`, so `filterByPos` and `computeKpis` work
  with no change.
- `src/integrations/supabase/types.ts` and `src/types/supabase.ts`: add the
  new function to the generated types.
- `src/hooks/useSalesDailySeries.ts`: React Query hook. Query key
  `['sales-daily-series', restaurantId, start, end]`. `staleTime: 60_000`,
  `retry: 1`, `refetchOnWindowFocus: true`. It runs only when `enabled`,
  `restaurantId`, `startDate`, and `endDate` are all set.
- `SalesTrendsPanel.tsx`: the prior query uses the new hook. This is the last
  step, after a rebase on PR 879.

## Tests

- pgTAP `supabase/tests/get_sales_daily_series.sql`: `by_day` and
  `pos_systems` equal the `get_sales_trends` result for the same seed and
  range. Exclusion rows do not count. A non-member gets `Access denied`.
  Rows of a second restaurant do not appear. An empty range returns empty
  arrays. A NULL date and a range over 731 days raise `22023`. Exactly 731
  days passes. A `staff` member can call it. A call with no `auth.uid()`
  raises `Access denied`. `anon` has no EXECUTE grant.
- Vitest: parser, `toTrendsData`, and the hook (RPC name and arguments,
  `enabled` gate, error path).

## Rejected options

- `RETURNS TABLE`: the client must then rebuild `pos_systems` and keep two
  row contracts. JSONB keeps one contract for both RPCs.
- A flag on `get_sales_trends` to skip aggregates: it changes a shared RPC
  signature and makes the hot RPC body more complex.
