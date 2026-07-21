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
- **Date-range clamp (safety).** `get_sales_trends` runs four grouped scans + a
  product sort, and is `GRANT`ed to all `authenticated` users, so an unbounded call is
  costlier than `get_unified_sales_totals`. When **both** `p_start_date` and
  `p_end_date` are `NULL`, default the window to the **last 90 days**
  (`CURRENT_DATE - 90` … `CURRENT_DATE`, matching the Toast initial-sync convention)
  rather than scanning all history. Explicit dates are honored as given. _(Supabase
  review, major.)_
- **Timezone hardening.** Use `COALESCE(p_time_zone, 'America/Chicago')` inside the
  body, not just the arg default — an explicit `null` from the client would otherwise
  make `AT TIME ZONE NULL` yield `NULL` and silently empty `by_hour`. _(review, minor.)_
- `orders` = `COUNT(DISTINCT COALESCE(us.external_order_id, us.id::text))` — manual /
  CSV rows often lack `external_order_id`; `COUNT(DISTINCT)` skips `NULL`s and would
  read 0 otherwise. _(review, minor.)_
- **Hour.** `unified_sales.sale_time` is a **`TIME` column** (base migration
  `20250925125415`, never altered — it only *looks* like text because PostgREST
  serializes `time` to a JSON `"HH:MM:SS"` string, which is why `useHourlySalesPattern`
  types it `string`). Postgres therefore guarantees every stored value is a valid
  time-of-day or `NULL`; garbage strings (`''`/`'N/A'`) are rejected at INSERT and can
  never reach the column, so **no regex/`split_part` guard is needed** — the earlier
  "guarded free-text parse" premise (from the design-review pass) was wrong about the
  schema. Bucket directly:
  ```sql
  CASE
    WHEN us.sold_at IS NOT NULL
      THEN EXTRACT(HOUR FROM (us.sold_at AT TIME ZONE COALESCE(p_time_zone,'America/Chicago')))::int
    WHEN us.sale_time IS NOT NULL
      THEN EXTRACT(HOUR FROM us.sale_time)::int
    ELSE NULL
  END
  ```
  A `NULL` hour (neither `sold_at` nor `sale_time`) is treated as "no time data" → the
  row is omitted from `by_hour` only (still counted in day/weekday/product). `day_count`
  = distinct `sale_date` in that hour bucket (enables avg-per-day if needed).
- **Weekday** = `EXTRACT(DOW FROM us.sale_date)::int` (0=Sun..6=Sat; DATE column, so
  timezone-unambiguous).
- **Day-of-truth note.** `by_day`/`by_weekday` bucket on `sale_date` (the POS business
  date set at ingestion, e.g. Toast `businessDate`), while `by_hour` buckets on
  `sold_at` converted to `p_time_zone`. At DST edges or if `restaurants.timezone`
  changes after ingestion these two can disagree at day boundaries — same assumption as
  the existing functions. Documented so it isn't rediscovered as a "Monday total ≠
  hourly sum" bug; a pgTAP boundary case pins current behavior. _(review, minor.)_
- `by_product` ordered by revenue desc and **capped at 300 (item_name, pos_system)
  rows** — a generous bound covering realistic menus; only top-7 is ever displayed, so
  the long tail never surfaces. Cap documented (no silent truncation of anything shown).
- Each sub-array built with `COALESCE(jsonb_agg(...), '[]'::jsonb)` so empty ranges
  return empty arrays, never `null`.
- `GRANT EXECUTE ... TO authenticated`. (Re-issued explicitly because `CREATE OR
  REPLACE` resets ACLs — see the comment in `20260714000000_...`.)

Indexing: reads are already filtered by `restaurant_id` + `sale_date`; existing
`idx_unified_sales_restaurant_date (restaurant_id, sale_date)` covers the scan. No new
index in this PR (note as a follow-up if `EXPLAIN` shows a seq scan at scale).

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
  - `buildDailySeries` → **flat, top-level POS keys** so Recharts `dataKey` + shadcn
    `ChartConfig` resolve directly: `[{ date, toast: 120, square: 80, total: 200 }]`.
    (NOT a nested `byPos` object — a nested `dataKey="byPos.toast"` breaks
    `ChartTooltipContent`'s `getPayloadConfigFromPayload` config lookup.) _(FE review,
    major.)_ Same flat shape for the hourly stacked bars.
  - `buildHourlySeries` → `[{ hour, <pos>: n, …, total, cumulativePct }]` — cumulative %
    of the day's revenue, for the right-axis line.
  - `buildWeekdaySeries` → `[{ dow, label, total, isPeak }]` (Mon-first display order;
    `isPeak` flags the top day for a non-color cue).
  - `buildTopProducts(data, pos, n=7)` → merges by `item_name` across POS for "all",
    ranks by revenue, returns share % + sparkline points (from that item's daily rev).
  - `computeKpis` → net sales, orders, avg order, busiest day, peak hour, per-POS split.
  - `deriveInsights` → plain-language callouts (peak day ×avg, "half the day's revenue
    by X", strongest weekday ratio, top product). **Reused as chart `aria-label`s**
    (see a11y below) so the same computation satisfies WCAG 1.1.1.
  - `hourCoverage` → fraction of revenue that carried a usable hour, for the
    "hour data partial" note (mirrors `useHourlySalesPattern`'s `hasHourlyBreakdown`).

**`src/hooks/useSalesTrends.ts`** — React Query hook:
- `useSalesTrends(restaurantId, { startDate, endDate, timeZone })`.
- Calls `supabase.rpc('get_sales_trends', {...})`, `staleTime: 60_000`,
  `refetchOnWindowFocus: true`. Returns `{ data: SalesTrendsData, isLoading, error }`.
- Timezone from `selectedRestaurant.timezone` (fallback `'America/Chicago'`, matching
  `useHourlySalesPattern`).

**`src/components/pos-sales/SalesTrendsPanel.tsx`** — the panel (memoized sub-charts):
- Container `rounded-xl border border-border/40`; header with title + chevron toggle +
  `PosFilterControl`.
- **Collapse via conditional render, NOT Radix animated height.** `ResponsiveContainer`
  measures its parent via `ResizeObserver` at mount; Radix `CollapsibleContent` animates
  from `height:0`, so charts mounted inside it render 0×0 and never re-measure (blank
  panel on the expanded-by-default first paint). Use plain `{expanded && <Charts/>}`
  conditional rendering so charts mount into an already-sized parent, and give each
  `ChartContainer` an explicit `min-h-[220px]` (+ `aspect-video`/fixed height) so it
  never depends on auto-height. _(FE review, critical.)_
- `PosFilterControl`: **plain-button segmented control** (matching the existing
  `categorizationFilter`/`recipeFilter`/`View` pills in `POSSales.tsx`, not an
  incomplete `role="tablist"`): "All POS" + one pill per present `pos_system`, each with
  a color dot. `aria-pressed` on each, keyboard-focusable. Rendered only when
  `pos_systems.length > 1` (single-POS shops see no redundant control). _(FE review,
  minor — avoids a half-implemented tablist.)_
- Three-state rendering per CLAUDE.md: `Skeleton` while loading, error message,
  `EmptyState` ("No sales in this range") — the whole panel and each chart.
- Charts (all via `ChartContainer` + Recharts; `ChartConfig` keyed by `pos_system`):
  - **Sales by day** — stacked `BarChart`, one `<Bar dataKey="<pos>" stackId="day"
    fill="var(--color-<pos>)">` per present POS. **Every bar shares `stackId` (else
    Recharts groups instead of stacks)**; include `<ChartLegend content={<ChartLegendContent/>}/>`
    so the POS→color mapping is always visible, not hover-only. _(FE review, major+minor.)_
  - **Time of day** — `ComposedChart` with **two axes**: `<YAxis yAxisId="rev"/>`
    (revenue) + `<YAxis yAxisId="pct" orientation="right" domain={[0,100]}/>`
    (cumulative %). Bars carry `yAxisId="rev"`, the cumulative `<Line yAxisId="pct"/>`.
    Omitting the split axes/`domain` collapses both series onto one scale. _(FE review, major.)_
  - **Day of week** — horizontal `BarChart` (Mon-first); peak day carries a text
    **"Peak" badge** (not color-only) via `isPeak`. _(FE review, minor.)_
  - **Top products** — list rows (item, POS **text badge** + color dot, revenue, share
    bar, memoized mini sparkline).
- **Layout:** the four charts in `grid grid-cols-1 lg:grid-cols-2 gap-4`; single column
  on mobile. POS pills + chevron stay reachable/unclipped at 375px. _(FE review, major.)_
- **Accessibility:** each chart wrapped with `role="img" aria-label={<insight text>}`
  (reusing `deriveInsights`); chevron button gets `aria-label` ("Collapse/Expand sales
  trends") + `aria-expanded`/`aria-controls`. _(FE review, major+minor.)_
- **Typography (CLAUDE.md scale):** panel title `text-[17px] font-semibold`; chart
  captions/section labels `text-[12px] font-medium uppercase tracking-wider
  text-muted-foreground`; KPI numbers `text-[22px]/[23px] font-semibold tabular-nums`;
  secondary `text-[13px] text-muted-foreground`. _(FE review, minor.)_
- All numbers formatted with `Intl.NumberFormat` currency; `tabular-nums`.
- Sub-charts + product-row sparklines are `React.memo`'d; POS toggle only swaps the
  selected series, not the whole tree.

**Wire-in (`src/pages/POSSales.tsx`)** — render `<SalesTrendsPanel>` inside the
`TabsContent value="manual"` (View Sales), above the existing filter bar/list, passing
`restaurantId`, the page's `startDate`/`endDate`, and `selectedRestaurant.timezone`.
**Default expanded on `lg`+ screens, collapsed on mobile** (initialize from a
`matchMedia('(min-width: 1024px)')` check) — an expanded stack of charts above the
list's `calc(100vh-180px)` mobile height would push the list far below the fold. _(FE
review, major.)_ One import + ~6 lines of JSX; no change to the list/virtualization
(the virtualizer scrolls its own `salesListRef` container, unaffected by content above).

### 4.3 Types

After the migration, regenerate the RPC signature into
`src/integrations/supabase/types.ts` via `generate_typescript_types` (RPC returns
`Json`). The parsed shape is owned by explicit interfaces in `salesTrends.ts` with a
`parseSalesTrends` runtime guard (RPC `Json` is cast, then validated) — avoids the
`as unknown as` blind-cast trap (lesson 2026-04-xx).

## 5. Testing

| Layer | File | Covers |
|---|---|---|
| pgTAP | `supabase/tests/get_sales_trends.sql` | access-denied throws; revenue excludes adjustment_type (tip/tax/void/discount) + child splits; groups by pos_system; hour from `sold_at` bucketed by `p_time_zone`; **`sale_time`-only row (`sold_at IS NULL`) buckets via `EXTRACT(HOUR FROM sale_time)`**; **both-NULL time row dropped from `by_hour` only** (other charts intact); **day-boundary tz case** (`sale_date` vs `sold_at`-hour); manual row with NULL `external_order_id` still counted in `orders`; weekday via DOW; product quantities; NULL-both-dates → 90-day clamp; empty range → empty arrays |
| Unit | `tests/unit/salesTrends.test.ts` | every pure selector: POS re-scope, flat POS-keyed daily/hourly rows, cumulative %, weekday order + `isPeak`, top-product merge/rank + sparkline, KPIs (busiest day, peak hour, split), insights, `hourCoverage`, empty data, `parseSalesTrends` guard rejects malformed |
| Unit | `tests/unit/posColors.test.ts` | every `POSSystemType` → color + label; unknown → fallback; stability |
| Component | `tests/unit/SalesTrendsPanel.test.tsx` | mock `useSalesTrends`; three states; POS control appears only when >1 system; toggling filter changes rendered totals; single-POS hides control; **charts are in the DOM when expanded and absent when collapsed** (conditional-render contract); chevron `aria-expanded` toggles |

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

Phase 2.5 ran the Supabase + Frontend reviewers. No `critical` Supabase concerns; one
`critical` Frontend concern (chart sizing in a collapsible). All majors + actionable
minors are folded into §4.1/§4.2/§5 above. Explicitly decided:

- **Charts collapse via conditional render, not Radix animated height** (FE critical) —
  adopted; guarantees non-zero measurement on the expanded-by-default first paint.
- **Flat POS-keyed chart rows + explicit `stackId`/dual `yAxisId`** (FE major) — adopted
  as the canonical Recharts/shadcn shape.
- **Panel defaults collapsed on mobile, expanded on `lg`+** (FE major) — adopted, to
  avoid burying the list below a tall chart stack on small screens.
- **Plain-button segmented control, not `role="tablist"`** (FE minor) — adopted for
  consistency with the sibling pills in `POSSales.tsx` and to avoid a half-APG tablist.
- **90-day NULL-date clamp + `COALESCE(p_time_zone,…)` + `orders` COALESCE** (Supabase
  majors/minors) — all adopted in the RPC contract.
- **`sale_time` is a `TIME` column, not free text** (discovered at Build) — the
  design-review's "guard the free-text parse" concern rested on a wrong schema premise.
  Corrected to a direct `EXTRACT(HOUR FROM sale_time)`; no garbage-string guard needed
  (the column type rejects invalid values at INSERT), and the pgTAP "garbage sale_time"
  case is replaced by a schema-realistic both-NULL-time case.
- **Accepted as-is (documented, not fixed):** `by_day`/`by_weekday` bucket on
  `sale_date` while `by_hour` buckets on `sold_at` — a known day-boundary/DST edge shared
  with existing functions; pinned by a pgTAP boundary test rather than reconciled, since
  reconciling would diverge the panel from every other sales aggregation in the app.
- **Product cap at 300 (item, pos) rows** — accepted; only the never-displayed long tail
  is affected, top-7 is exact.
