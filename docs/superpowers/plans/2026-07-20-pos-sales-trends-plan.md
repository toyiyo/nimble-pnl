# Plan: POS Sales Trends Panel

Design: `docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md`

Each task is TDD (RED → GREEN → REFACTOR → COMMIT) and 2–5 min. Ordered by dependency.

## Task 1 — RPC `get_sales_trends` (migration + pgTAP)
- **RED:** `supabase/tests/get_sales_trends.sql` (pgTAP). Cases: access-denied throws;
  revenue = `parent_sale_id IS NULL AND adjustment_type IS NULL AND item_type='sale'`
  (fixtures include tip/tax/void/discount/child-split rows that must be excluded);
  groups by `pos_system`; hour from `sold_at` bucketed by `p_time_zone`; **`sale_time`-only
  row (`sold_at IS NULL`) buckets via `EXTRACT(HOUR FROM sale_time)`**; **both-NULL-time
  row dropped from `by_hour` only** (other charts intact); manual row with NULL
  `external_order_id` still counted in `orders`; weekday via DOW; NULL-both-dates →
  90-day clamp; empty range → `[]` arrays.
  NOTE: `unified_sales.sale_time` is a **`TIME`** column (not text) — fixtures use real
  `TIME`/`NULL` values; a "garbage string" case is impossible (rejected at INSERT).
- **GREEN:** `supabase/migrations/<ts>_get_sales_trends.sql` — `CREATE OR REPLACE
  FUNCTION` returning JSONB per §4.1; hour via `EXTRACT(HOUR FROM sold_at AT TIME ZONE …)`
  with `EXTRACT(HOUR FROM sale_time)` fallback (no string parse — column is `TIME`),
  `COALESCE(p_time_zone, 'America/Chicago')`, `COUNT(DISTINCT COALESCE(external_order_id,
  id::text))`, 90-day clamp, `GRANT EXECUTE ... TO authenticated`.
- **COMMIT:** `feat(sql): get_sales_trends RPC — per-POS day/hour/weekday/product buckets`
- Deps: none.

## Task 2 — Regenerate Supabase types
- Apply migration to local DB, run `generate_typescript_types`; commit the
  `src/integrations/supabase/types.ts` diff (adds the `get_sales_trends` RPC signature).
- **COMMIT:** `chore(types): regenerate for get_sales_trends`
- Deps: Task 1.

## Task 3 — `src/lib/posColors.ts` (POS → color/label registry)
- **RED:** `tests/unit/posColors.test.ts` — every `POSSystemType` maps to an
  `hsl(var(--chart-N))` token + human label; unknown → `muted-foreground` fallback;
  `posLabel`/`posColor` stable.
- **GREEN:** implement the pure registry.
- **COMMIT:** `feat(pos): POS color + label registry`
- Deps: none (parallelizable with Task 1).

## Task 4 — `src/lib/salesTrends.ts` (pure selectors)
- **RED:** `tests/unit/salesTrends.test.ts` — `parseSalesTrends` guard (rejects
  malformed), `filterByPos`, `buildDailySeries` (flat POS keys + total),
  `buildHourlySeries` (flat + `cumulativePct`), `buildWeekdaySeries` (Mon-first +
  `isPeak`), `buildTopProducts` (cross-POS merge, rank, share %, sparkline),
  `computeKpis` (net, orders, avg, busiest day, peak hour, per-POS split),
  `deriveInsights`, `hourCoverage`, empty-data paths.
- **GREEN:** implement selectors + `SalesTrendsData` types.
- **COMMIT:** `feat(trends): pure sales-trends selectors`
- Deps: Task 3 (labels/colors used by product rows/insights) — soft; can stub.

## Task 5 — `src/hooks/useSalesTrends.ts`
- **RED:** `tests/unit/useSalesTrends.test.ts` — mocks `supabase.rpc`; asserts correct
  RPC name + params (restaurantId, dates, timeZone), returns parsed data, disabled when
  `restaurantId` null, error propagation, `staleTime` config.
- **GREEN:** implement React Query hook calling `get_sales_trends`, `parseSalesTrends`
  on the result, tz from arg (fallback `America/Chicago`).
- **COMMIT:** `feat(trends): useSalesTrends hook`
- Deps: Tasks 2, 4.

## Task 6 — `SalesTrendsPanel` + sub-charts + `PosFilterControl`
- **RED:** `tests/unit/SalesTrendsPanel.test.tsx` — mock `useSalesTrends`; three states;
  POS control only when >1 system; toggling filter changes rendered totals; single-POS
  hides control; charts present in DOM when expanded, absent when collapsed; chevron
  `aria-expanded` toggles.
- **GREEN:** `src/components/pos-sales/SalesTrendsPanel.tsx` (+ small memoized sub-chart
  components: `SalesByDayChart`, `TimeOfDayChart`, `WeekdayChart`, `TopProductsList`,
  `PosFilterControl`, `TrendKpiRow`). Conditional-render charts (not Radix height),
  `ChartContainer min-h`, `stackId`, dual `yAxisId` + `domain=[0,100]`, `ChartLegend`,
  `role="img"` + `aria-label` from insights, plain-button segmented control with
  `aria-pressed`, `grid-cols-1 lg:grid-cols-2`, CLAUDE.md type scale.
- **COMMIT:** `feat(trends): SalesTrendsPanel with per-POS filterable charts`
- Deps: Task 5.

## Task 7 — Wire into `POSSales.tsx`
- **RED:** source-text test `tests/unit/posSalesTrendsWireup.test.ts` — asserts
  `POSSales.tsx` imports and renders `<SalesTrendsPanel` inside the `manual` tab,
  passing `restaurantId`/`startDate`/`endDate`/timezone (per the "read source as text"
  lesson for this 30-hook page — no full render).
- **GREEN:** add the import + `<SalesTrendsPanel>` above the View Sales filter bar;
  default expanded on `lg`+, collapsed on mobile via `matchMedia`.
- **COMMIT:** `feat(pos): mount SalesTrendsPanel above the detailed sales list`
- Deps: Task 6.

## Task 8 — Verify & polish
- Run typecheck, lint, unit + db tests, build. Fix fallout. (Phase 8 of workflow.)
- Deps: all.

## Notes for executors
- Revenue filter is the authoritative one from `20260302120002` — do NOT reuse
  `is_pass_through`.
- Don't render `POSSales` in tests; use source-text (Task 7) + isolated panel (Task 6).
- Colors only via `--chart-*` / semantic tokens; no raw hex/`bg-white`.
- Three-state rendering everywhere (loading/error/empty).
