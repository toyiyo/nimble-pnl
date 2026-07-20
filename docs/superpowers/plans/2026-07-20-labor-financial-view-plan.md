# Labor Financial View — Implementation Plan

**Design:** docs/superpowers/specs/2026-07-20-labor-financial-view-design.md
**Branch:** `feature/labor-financial-view`

TDD throughout: RED (failing test) → GREEN (minimal code) → REFACTOR → COMMIT.
Tasks are ordered by dependency; each is 2–5 min. Pure lib first, then hooks, then
UI, then wiring.

## Phase A — Pure analytics lib (`src/lib/laborPnlAnalytics.ts`)

A measured directory for SonarCloud coverage. No React, no fetch — pure functions,
TZ-portable tests with `Date.UTC` fixtures + fixed `tz` arg.

- [ ] **A1. Types + `classifyBalance`.** Define `FinancialPoint`, `SalesVolumeCell`,
  `LaborPnlSummary`, `BalanceState = 'over'|'balanced'|'under'`, `LABOR_BALANCE_BAND`
  (default 6, in pct-points). `classifyBalance(laborPct, targetPct, band)`:
  `>target+band`→`over`, `<target-band`→`under`, else `balanced`; guards
  `targetPct<=0`→`balanced`. Test: band edges (exactly target±band → balanced).
- [ ] **A2. `monthKeyOf(dateStr)`** (calendar month `YYYY-MM`) + reuse existing
  `mondayOf`/day passthrough. Test: month/week/day bucket keys; Dec→Jan boundary.
- [ ] **A3. `buildFinancialSeries(dailySales: SplhPoint[], dailyLabor: LaborCostData[],
  granularity, targetPct)`.** Join on date; bucket by granularity; per bucket
  `sales`, `laborCost`, `laborHours`, `laborPct = laborCost/sales*100` (null when
  `sales<=0` — never Infinity), `balanceState`. Tests: day passthrough; week
  Monday-start; month calendar; 0-sales bucket → null pct; a day with labor but no
  sales and vice-versa still appears (outer join).
- [ ] **A4. `buildSalesVolumeGrid(cells: SplhGridCell[])`** → `SalesVolumeCell[]`
  with `totalSales`, normalized `intensity` (0..1 vs window max), `peak` flag
  (≥72% of max, matching prototype), `estimated` passthrough. Test: intensity
  scaling, peak threshold, all-zero window (no NaN).
- [ ] **A5. `summarizeLaborPnl(points, targetPct)`** → totals (`sales`, `laborCost`,
  `laborPct`, `revPerLaborHr = sales/laborHours`), `verdict` string + `verdictTone`,
  and `overWindows`/`underWindows` (contiguous runs of over/under buckets, reusing
  a `groupHoursIntoRanges`-style merge for the hourly case). Tests: verdict strings
  per tone; revPerLaborHr; 0-hours guard; window extraction.
- [ ] **A6. Sort/format helpers** — any bucket sort uses locale-aware/numeric
  comparator (SonarCloud S2871 lesson). Verdict/tone→className helper reusing the
  new `--labor-*` tokens. Test: comparator correctness.

## Phase B — CSS tokens

- [ ] **B1.** Add `--labor-over` / `--labor-under` / `--labor-balanced` to
  `src/index.css` (light + dark blocks), contrast ≥4.5:1. Snapshot/token test in
  `tests/unit/laborBalanceTokens.test.ts` (mirror `splhColorTokens.test.ts`):
  assert the three vars are defined in both themes and distinct.

## Phase C — Hooks

- [ ] **C1. `useLaborPnlCore(restaurantId, weeks)`** — shared setup: tz
  (`validateTimeZone`), `targetPct` (`useStaffingSettings.effectiveSettings.target_labor_pct`),
  restaurant-tz window via `getTodayInTimezone`, `useSplhData` (sales+punches),
  `useLaborCostsFromTimeTracking(restaurantId, windowStart, windowEnd)` for daily
  labor. Derive `dailySales = buildSplhTimeseries(sales, sessions, tz, 'day')`.
  Expose `capped`, three-state flags, `hasData`. Test (mock composed hooks):
  window boundaries use restaurant tz; `hasData` requires sales AND punches.
- [ ] **C2. `useLaborPnlSummary(restaurantId)`** (dashboard card) — 4-week window;
  returns period `summary` (via `summarizeLaborPnl` over daily series), daily
  `sparkline`, `targetPct`, states. No hourly grid built. Test: reconciliation
  (summary totals == sum of daily series); labor% null when no sales.
- [ ] **C3. `useLaborPnlAnalytics(restaurantId, granularity)`** (page) — builds
  `series` (day/week/month via `buildFinancialSeries`), hourly `grid`
  (`buildSplhGrid` → `buildSalesVolumeGrid`), `summary`, `targetPct`, `capped`,
  states, plus `updateTarget` (wraps `useStaffingSettings.updateSettings`,
  dirty-checked). Test: granularity switch rebuilds series; updateTarget calls
  `updateSettings({ target_labor_pct })` only when changed.

## Phase D — Presentational components

- [ ] **D1. `LaborBalanceRibbon`** (`src/components/labor/`) — pure SVG/flex strip
  of per-bucket balance chips using `--labor-*` tokens; `aria-label` per segment.
  Test: renders one chip per point with correct state class.
- [ ] **D2. `SalesVolumeHeatmap`** — dow×hour grid, `role="grid"`, focusable cells,
  per-cell `aria-label` (day, hour, sales), sticky day column, `min-w-10 min-h-10`,
  intensity via `--labor-balanced`/green ramp, peak outline, "Estimated"/"partial
  window" badges. Mirror `SplhHeatmap` a11y. Test: 7 rows, per-cell aria, estimated
  badge when flagged.
- [ ] **D3. `DemandVsStaffingChart`** — two stacked Recharts (sales area top;
  labor-% line + target `ReferenceLine` bottom) sharing x-axis, with the ribbon
  between. Single y per chart. Three-state safe. Test (role/img + data length).
- [ ] **D4. `EditableLaborTarget`** — labeled number input, commit on blur/Enter
  with dirty check, optimistic + toast on error, read-only affordance kept simple.
  Test: change→commit calls handler once; Enter+blur fires once; no-op when equal.
- [ ] **D5. `LaborVerdict`** — tone dot + sentence from summary. Test: tone class +
  guards on null summary.

## Phase E — Dashboard card + page

- [ ] **E1. `LaborPnlCard`** (`src/components/dashboard/`) — composes
  `useLaborPnlSummary`; hero labor%, rev/labor-hr, verdict, sparkline (Recharts
  mini `Line`), "Open labor detail →" → `navigate('/labor')`. Loading/error/empty
  states mirroring `LaborEfficiencyCard`. Test: three states by role; link.
- [ ] **E2. `Labor.tsx` page** (`src/pages/`) — composes `useLaborPnlAnalytics`;
  Day/Week/Month `ToggleGroup`, KPI row, `DemandVsStaffingChart`,
  `SalesVolumeHeatmap`, callouts (over/under windows), `EditableLaborTarget`.
  Three states. Test: renders KPIs + toggle; granularity change; empty state.

## Phase F — Wiring

- [ ] **F1. Route:** add `/labor` (`<ProtectedRoute><Labor/></ProtectedRoute>`) to
  `src/App.tsx` (eager import beside `/payroll`).
- [ ] **F2. Dashboard mount:** add a collapsible **"Labor cost"** section in
  `src/pages/Index.tsx` (financial cluster, `laborCostOpen` state default `false`),
  mounting `LaborPnlCard`, matching the existing `<Collapsible>`+`<h2>` idiom.
- [ ] **F3. Nav link (if a nav registry exists):** add "Labor" where `/payroll`/
  `/reports` live; otherwise the dashboard card + `/labor` route suffice.

## Phase G — Verify & ship (workflow Phases 5–9)

- [ ] UI review (Phase 5), simplify (Phase 6), multi-model + CodeRabbit (Phase 7).
- [ ] Verify (Phase 8): `npm run test && npm run typecheck && npm run lint && npm run build`.
- [ ] Ship + CI loop + comment triage (Phase 9).

## Dependency notes
- A → C → (D, E). B before D. F after E. D2/D3 depend on A4/A3 shapes.
- Reconciliation invariant (test in C2/C3): KPI totals === Σ series buckets.
- TZ invariant (test in C1): sales `sale_date` day and labor cost day share the
  restaurant-tz "today"-derived window.
