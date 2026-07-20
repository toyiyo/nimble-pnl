# Design: POS Sales Trends Panel

**Date:** 2026-07-20
**Author:** dev workflow
**Status:** Draft → Design Review

## 1. Problem

The POS Sales page (`src/pages/POSSales.tsx`) shows a detailed, virtualized list of
individual sales but no way to *see the shape* of sales over a period. Operators want
four questions answered visually, on the same screen as their detail:

1. **When are sales happening?** — revenue by calendar day across the selected range.
2. **What hours are sales accumulating?** — revenue by hour-of-day, with a cumulative
   overlay showing where the day's money piles up.
3. **What days sell the most?** — revenue ranked by day-of-week.
4. **What products sell best?** — top items for the period by revenue.

They run **two or more POS systems** (e.g. Toast + Square) and want every panel
filterable by POS via a single control that re-scopes all panels at once.

Approved visual prototype: the user reviewed and liked the interactive mock
(day-by-day stacked bars, hour bars + cumulative line, weekday ranking, top-product
list, one POS segmented control).

## 2. Goals / Non-goals

**Goals**
- A `SalesTrendsPanel` rendered full-width, collapsible, **above the "View Sales"
  list** inside the existing tab (user-approved placement).
- One POS segmented control re-scopes KPIs + all four charts instantly.
- POS list is **data-driven** — shows only the `pos_system` values actually present
  in the range, never hardcoded to Toast/Square.
- Server-side aggregation via a new RPC (mirrors `get_unified_sales_totals`), bucketed
  by `sold_at` in the restaurant timezone for hour-of-day.
- Recharts + the shadcn `chart.tsx` wrapper; POS systems color-coded consistently via
  `--chart-*` tokens.
- Trends respect the page's current `startDate`/`endDate` filter so they match the
  visible list range.

**Non-goals**
- No new date-range picker — reuse the page's existing range state.
- No per-item drill-down / category trends (future).
- No export of the trends (future).
- No changes to sync or ingestion.

## 3. Revenue contract (authoritative)

Mirror the corrected `get_unified_sales_totals`
(`20260302120002_fix_unified_sales_totals_adjustment_type.sql`,
`20260714000000_fix_collected_at_pos_exclude_void.sql`). **Sales revenue** for trends:

```
parent_sale_id IS NULL          -- exclude child splits (no double counting)
AND adjustment_type IS NULL     -- exclude tip / tax / service_charge / fee / discount / void
AND item_type = 'sale'          -- actual product sales only
```

This deliberately excludes voids (`adjustment_type='void'`), discounts, and all
pass-through adjustments — trends show **net product sales**, consistent with the
"Revenue" tile already on the page. (Lesson 2026-05-xx: never `WHERE adjustment_type
IS NOT NULL`; enumerate the contract and pin it with a test.)

## 4. Architecture

### 4.1 Backend — new RPC `get_sales_trends`

New migration `supabase/migrations/<ts>_get_sales_trends.sql`.

```
get_sales_trends(
  p_restaurant_id UUID,
  p_start_date    DATE DEFAULT NULL,
  p_end_date      DATE DEFAULT NULL,
  p_time_zone     TEXT DEFAULT 'America/Chicago'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

- **Access gate** identical to `get_unified_sales_totals`: `RAISE EXCEPTION 'Access
  denied to restaurant'` unless `auth.uid()` has a row in `user_restaurants`.
- Returns **one JSONB object** so the whole panel loads in a single round-trip and the
  POS filter re-scopes purely client-side (no refetch on toggle):

```jsonc
{
  "pos_systems": ["toast", "square"],                 // distinct systems present, revenue desc
  "by_day":     [{ "sale_date":"2026-07-01", "pos_system":"toast", "revenue":290.0, "orders":34 }],
  "by_hour":    [{ "hour":14, "pos_system":"toast", "revenue":300.0, "day_count":18 }],
  "by_weekday": [{ "dow":6, "pos_system":"toast", "revenue":1180.0 }],   // 0=Sun..6=Sat
  "by_product": [{ "item_name":"Original Pretzel", "pos_system":"toast", "revenue":1418.0, "quantity":612 }]
}
```

Bucketing detail:
- `orders` = `COUNT(DISTINCT external_order_id)` within the group.
- **Hour** = `EXTRACT(HOUR FROM (us.sold_at AT TIME ZONE p_time_zone))` when `sold_at`
  is present; else `split_part(us.sale_time, ':', 1)::int` (already-local text). Rows
  with neither are omitted from `by_hour` only (still counted in day/weekday/product).
  `day_count` = distinct `sale_date` in that hour bucket (enables avg-per-day if needed).
- **Weekday** = `EXTRACT(DOW FROM us.sale_date)::int`.
- `by_product` ordered by revenue desc and **capped at 300 (item_name, pos_system)
  rows** — a generous bound covering realistic menus; only top-7 is ever displayed, so
  the long tail never surfaces. Cap documented (no silent truncation of anything shown).
- Each sub-array built with `COALESCE(jsonb_agg(...), '[]'::jsonb)` so empty ranges
  return empty arrays, never `null`.
- `GRANT EXECUTE ... TO authenticated`.

Indexing: reads are already filtered by `restaurant_id` + `sale_date`; existing
indexes on `unified_sales(restaurant_id, sale_date)` cover the scan. No new index in
this PR (note as a follow-up if `EXPLAIN` shows a seq scan at scale).

### 4.2 Frontend

**`src/lib/posColors.ts`** — deterministic POS → color/label registry (pure).
- `POS_COLOR: Record<POSSystemType, string>` mapping to `hsl(var(--chart-N))`.
  Toast→`--chart-4` (amber, matches Toast brand), square→`--chart-3` (green),
  clover→`--chart-1`, revel→`--chart-2`, shift4→`--chart-5`, manual/manual_upload→
  `hsl(var(--muted-foreground))`.
- `posLabel(sys)` → display name ("Toast", "Square", "Manual", …).
- `posColor(sys)` with a stable fallback for unknown values.

**`src/lib/salesTrends.ts`** — pure selectors (fully unit-tested; the aggregation lives
here so tests never render `POSSales`, per lesson 2026-05-xx on that page's ~30 hooks):
- `SalesTrendsData` types for the parsed RPC payload + a `parseSalesTrends(json)` guard.
- `filterByPos(data, pos | 'all')` and per-chart builders:
  - `buildDailySeries` → `[{ date, byPos: {toast, square,…}, total }]`
  - `buildHourlySeries` → `[{ hour, total, cumulativePct }]` (cumulative over the day)
  - `buildWeekdaySeries` → `[{ dow, label, total }]` (Mon-first display order)
  - `buildTopProducts(data, pos, n=7)` → merges by `item_name` across POS for "all",
    ranks by revenue, returns share % + sparkline points (from that item's daily rev).
  - `computeKpis` → net sales, orders, avg order, busiest day, peak hour, per-POS split.
  - `deriveInsights` → the plain-language callouts (peak day ×avg, "half the day's
    revenue by X", strongest weekday ratio, top product).

**`src/hooks/useSalesTrends.ts`** — React Query hook:
- `useSalesTrends(restaurantId, { startDate, endDate, timeZone })`.
- Calls `supabase.rpc('get_sales_trends', {...})`, `staleTime: 60_000`,
  `refetchOnWindowFocus: true`. Returns `{ data: SalesTrendsData, isLoading, error }`.
- Timezone from `selectedRestaurant.timezone` (fallback `'America/Chicago'`, matching
  `useHourlySalesPattern`).

**`src/components/pos-sales/SalesTrendsPanel.tsx`** — the panel (memoized sub-charts):
- Collapsible container (`rounded-xl border border-border/40`), header with title +
  chevron toggle + `PosFilterControl`.
- `PosFilterControl`: "All POS" + one pill per present `pos_system`, color dot each.
  Rendered only when `pos_systems.length > 1` (single-POS shops see no redundant
  control). Keyboard-accessible, `role="tablist"`, `aria-selected`.
- Three-state rendering per CLAUDE.md: `Skeleton` while loading, error message,
  `EmptyState` ("No sales in this range") — the whole panel and each chart.
- Charts (all via `ChartContainer` + Recharts):
  - **Sales by day** — stacked `BarChart`, one `<Bar>` per present POS, colored via
    registry; `ChartTooltip`.
  - **Time of day** — `ComposedChart`: stacked `Bar`s (revenue/hr) + `Line` (cumulative
    %, right `YAxis` 0–100%).
  - **Day of week** — horizontal `BarChart` (Mon-first), top day emphasized.
  - **Top products** — list rows (item, POS badge, revenue, share bar, mini sparkline).
- All numbers formatted with `Intl.NumberFormat` currency; `tabular-nums`.

**Wire-in (`src/pages/POSSales.tsx`)** — render `<SalesTrendsPanel>` inside the
`TabsContent value="manual"` (View Sales), above the existing filter bar/list, passing
`restaurantId`, the page's `startDate`/`endDate`, and `selectedRestaurant.timezone`.
Default collapsed state: **expanded** on first load. One import + ~5 lines of JSX; no
change to the list/virtualization.

### 4.3 Types

After the migration, regenerate the RPC signature into
`src/integrations/supabase/types.ts` via `generate_typescript_types` (RPC returns
`Json`). The parsed shape is owned by explicit interfaces in `salesTrends.ts` with a
`parseSalesTrends` runtime guard (RPC `Json` is cast, then validated) — avoids the
`as unknown as` blind-cast trap (lesson 2026-04-xx).

## 5. Testing

| Layer | File | Covers |
|---|---|---|
| pgTAP | `supabase/tests/get_sales_trends.sql` | access-denied throws; revenue excludes adjustment_type (tip/tax/void/discount) + child splits; groups by pos_system; hour bucketed by `p_time_zone`; weekday via DOW; product quantities; empty range → empty arrays |
| Unit | `tests/unit/salesTrends.test.ts` | every pure selector: POS re-scope, cumulative %, weekday order, top-product merge/rank + sparkline, KPIs (busiest day, peak hour, split), insights, empty data, `parseSalesTrends` guard rejects malformed |
| Unit | `tests/unit/posColors.test.ts` | every `POSSystemType` → color + label; unknown → fallback; stability |
| Component | `tests/unit/SalesTrendsPanel.test.tsx` | mock `useSalesTrends`; assert three states, POS control appears only when >1 system, toggling filter changes rendered totals, single-POS hides control |

Coverage target: ≥80% new-code (SonarCloud gate). Pure libs + hook + component
branches carry it; pgTAP covers the SQL.

## 6. Risks & trade-offs

- **JSONB payload size** — ~600 small rows worst case (20 days × 6 POS + 24h × 6 +
  7 × 6 + 300 products). Acceptable for one request; smaller than a page of raw sales.
- **Client-side re-scope** requires per-POS rows in every bucket; chosen deliberately
  for instant toggle UX (matches prototype) at a modest payload cost vs. re-querying.
- **`sold_at` coverage** — historical rows may lack `sold_at`; hour falls back to
  `sale_time` text, and rows with neither drop out of the hour chart only. The panel
  surfaces a subtle "hour data partial" note when a chunk of revenue lacks a time,
  mirroring `useHourlySalesPattern`'s `hasHourlyBreakdown` flag.
- **Product cap (300 rows)** — only affects the untold long tail; top-7 is exact.
- **Timezone** — bucketing depends on `restaurants.timezone`; when unset we use
  `America/Chicago` (same default as the existing hourly hook), documented.

## 7. Decided trade-offs (folded from design review)

_(to be completed after Phase 2.5)_
