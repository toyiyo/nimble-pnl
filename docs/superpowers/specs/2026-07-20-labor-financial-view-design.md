# Labor Financial View — Dashboard card + `/labor` detail page — Design

**Date:** 2026-07-20
**Branch:** `feature/labor-financial-view`
**Author:** Claude (dev workflow)
**Status:** draft — awaiting user approval, then Phase 2.5 design review

## 1. Problem & goal

An owner wants to glance at the dashboard and immediately understand **how a
day/week/month of sales happened against what the team cost** — a *financial*
read:

1. **What % of sales is my team costing me?** (labor % of net sales)
2. **How much do they make me per hour worked?** (revenue per labor hour)
3. **When am I busy?** (sales volume by day-of-week × hour — "weekends in the afternoon")
4. **Where am I over- vs. under-staffed?** (labor % vs. target, per bucket)

…at **daily, weekly, and monthly** altitudes.

### 1.1 Why this is NOT the existing SPLH feature (#611)

PR #611 shipped a **scheduling** feature — `LaborEfficiencyCard` (dashboard) +
`LaborEfficiencyPanel` (Scheduling/Planner tab). It answers *"how do I build next
week's schedule"*: SPLH (`$sales ÷ labor-hours`) vs a `target_splh` goal, colored
for lean/slack, with hire/trim hour hints. Its labor is **worked-hours** and its
labor cost, where shown, uses an **average hourly rate** approximation
(`computeAvgHourlyRateCents`) — fine for a staffing heuristic.

This feature answers a **financial** question and therefore has different
requirements:

- Leads with **labor % of sales** (the P&L number), not SPLH.
- Labor **dollars must reconcile with Payroll/P&L** — payroll-grade
  (`calculateActualLaborCost`: OT, salary, contractor), not an avg-rate estimate.
- Adds a **monthly** altitude and a **sales-volume** busy-hours read the SPLH
  efficiency heatmap does not provide.
- Lives on the **dashboard + its own `/labor` page**, not inside Scheduling.

**The existing SPLH feature stays exactly as-is** (user-confirmed). The two
coexist: one is forward-looking scheduling, one is backward-looking financials.

## 2. Scope

### 2.1 Dashboard — `LaborPnlCard` (new, financial)
A compact collapsible card on `Index.tsx`, in the financial cluster near
`SalesVsBreakEvenChart` / Performance Overview (NOT adjacent to the existing
scheduling `LaborEfficiencyCard`, to keep the two mental models separate):

- **Hero: Labor % of sales** for the current period vs the `target_labor_pct`
  target, with a delta and tone (good/warn).
- **Revenue per labor hour** (`net revenue ÷ labor hours`).
- Net sales, Labor $ (secondary).
- A **plain-English verdict** line ("Labor ran 25.8% of sales this week — 0.2pt
  under target. Team earned $73/labor-hour.").
- A slim **sales-vs-labor sparkline**.
- **"Open labor detail →"** link to `/labor`.

### 2.2 `/labor` page — `Labor.tsx` (new)
The prototype the user approved, financially grounded:

- **Day / Week / Month** segmented control + a period navigator.
- **One-line verdict** (tone dot + sentence).
- **KPI row (4):** Labor % of sales · Revenue per labor hour · Net sales · Labor $ —
  each with a delta vs. the prior comparable period.
- **Demand-vs-staffing chart** (the signature): net-sales area + labor-% line +
  target reference, with a **staffing-balance ribbon** under the axis
  (over / balanced / under). X-axis granularity follows the toggle:
  hour-of-day (Day), day (Week), week (Month).
- **Busy-hours heatmap:** day-of-week × hour, colored by **sales volume**
  (a distinct read from the SPLH efficiency heatmap).
- **Staffing callouts:** auto-generated over/under windows with a $ estimate.
- **Editable target:** the target-% control writes `target_labor_pct` to
  `staffing_settings` (permission-gated), with optimistic UI + toast.

## 3. Definitions (drive all coloring & verdicts)

- `labor % of sales = labor_cost ÷ net_revenue` (the P&L definition).
- `revenue per labor hour = net_revenue ÷ labor_hours`.
- **Balance vs. `target_labor_pct` (T), band ±BAND (default 6pt, configurable
  constant):**
  - `labor% > T + BAND` → **overstaffed** (labor outran sales).
  - `labor% < T − BAND` → **understaffed** (sales outran the floor; revenue
    opportunity / service risk).
  - within band → **balanced**.
- The in-progress day assumes clock-in-through-**now** (open shifts counted to the
  current instant) — inherited from `calculateActualLaborCost`'s open-session
  handling; documented, not re-implemented.

## 4. Data sources (reconciled — the crux)

| Concern | Source | Why |
|---|---|---|
| **Period KPI totals** (net sales, labor $, labor %, rev/labor-hr) | `usePeriodMetrics(restaurantId, from, to)` | The *correct* combined hook: revenue from `unified_sales`, costs from source tables. Explicitly supersedes `useDailyPnL`/`usePnLAnalytics`. |
| **Daily/weekly/monthly financial series** (timeline + verdict + deltas) | `usePnLAnalyticsFromSource` → `DailyPnLData[]` (`date`, `net_revenue`, `labor_cost`, `labor_cost_percentage`) | Already reconciled daily series from source; weekly/monthly by aggregating days (mirrors `useDailyPnL.getWeekly/MonthlyData` ISO-week / calendar-month grouping, but over the *source-based* series). |
| **Labor hours** (for rev/labor-hr, and open-day "through now") | `useLaborCostsFromTimeTracking` → `LaborCostData.total_hours` / `total_labor_cost` (payroll-grade `calculateActualLaborCost`) | Same engine as Payroll → dollars/hours reconcile with what the owner already trusts. |
| **Hourly busy-hours heatmap** (sales volume by dow×hour) + **intraday (Day-view) demand shape** | `useSplhData` + `buildSplhGrid` (existing) → per-cell `totalSales`, `totalHours` | The only surface needing hour-of-day granularity. Reuses the #611 fetch/aggregation layer. This is **pattern/shape**, explicitly separate from the authoritative period $. |
| **Target** | `useStaffingSettings` → `effectiveSettings.target_labor_pct`; write via `updateSettings({ target_labor_pct })` | Same setting scheduling already edits (`StaffingConfigPanel`) → the two surfaces stay consistent. Default 30 (existing default). |
| **Timezone** | `selectedRestaurant?.restaurant?.timezone` via `validateTimeZone` | Reused; all day/hour/week bucketing in restaurant tz, never host tz. |

**Reconciliation guarantee:** the KPI headline and timeline use the same
source-based revenue + payroll-grade labor as the P&L page, so the labor % shown
here equals the labor % on P&L for the same window. The hourly heatmap/intraday
labor-% line is a **shape overlay** (worked-hours × avg-rate for per-hour coloring
only) and is visually distinguished + labeled so it is never read as the
authoritative dollar figure.

## 5. Architecture

Pure transforms in a new **`src/lib/laborPnlAnalytics.ts`** (a *measured* dir for
SonarCloud coverage). Hooks compose existing hooks + this lib; pure math never
mounts.

```
src/lib/laborPnlAnalytics.ts
  aggregateFinancialSeries(daily: DailyPnLData[], granularity: 'day'|'week'|'month', tz)
     → FinancialPoint[]  { bucketStart, label, netRevenue, laborCost, laborPct, balanceState }
  buildSalesVolumeGrid(gridCells: SplhGridCell[]) → reuses buildSplhGrid output; exposes totalSales per (dow,hour) + intensity scaling
  classifyBalance(laborPct, target, band) → 'over'|'balanced'|'under'
  summarizeLaborPnl(totals, target) → { laborPct, revPerLaborHr, verdict, verdictTone, overWindows, underWindows }

src/hooks/useLaborPnlSummary.ts   → dashboard card (period totals + sparkline)
src/hooks/useLaborPnlAnalytics.ts → /labor page (series for day/week/month + hourly grid + summary)
```

Reuses without modification: `useSplhData`, `buildSplhGrid`,
`distributeWorkedHours`, `validateTimeZone`, `useStaffingSettings`,
`useLaborCostsFromTimeTracking`, `usePeriodMetrics`, `usePnLAnalyticsFromSource`.

### 5.1 Routing & nav
- `Labor.tsx` page (eager import, matching App.tsx convention):
  `<Route path="/labor" element={<ProtectedRoute><Labor /></ProtectedRoute>} />`.
  Owner/manager only (financial). Not `allowStaff`.
- Dashboard card's "Open labor detail →" `navigate('/labor')`.

## 6. Edge cases & three states

- **Divide-by-zero:** `net_revenue = 0` → labor % is `—` / "no sales", never
  `Infinity`; `labor_hours = 0` → rev/labor-hr `—`.
- **No hourly breakdown** (sales lack `sold_at`/`sale_time`): heatmap uses the
  existing daily-spread fallback + an **"Estimated"** badge (inherited from
  `buildSplhGrid`); the day/week/month **financial timeline is unaffected**
  (date-level).
- **Loading** → layout-shaped `<Skeleton>` (KPI row + chart + heatmap); **error**
  → inline retry; **empty** (no sales, or no punches anywhere in window) →
  `EmptyState` inviting POS connect / time-tracking enable.
- **Target write:** optimistic; on error, revert + destructive toast. Non-owner
  without permission: control is read-only (no write affordance).
- **Role/RLS:** `operations_manager` cannot currently SELECT `time_punches`
  (known gap from #611 §6) → labor shows "no labor logged" for that role; documented,
  owner/manager unaffected. No new RLS in this PR.

## 7. UI / styling

Apple/Notion tokens per CLAUDE.md. Reuse the existing theme-aware SPLH tokens
where semantics match; **add financial balance tokens** only if the existing
`--splh-lean/slack/balanced` don't map cleanly (over = warm/red, under = amber,
balanced = neutral/green — contrast-checked ≥4.5:1, color never the only signal:
value text + legend + tooltip always present).

- **Charts:** Recharts, single y per axis (no dual-axis — lesson §7.3 #611):
  net-sales area on the value axis, labor-% line on a secondary %-axis is
  acceptable *only* because they are different units and both are labeled; if the
  design reviewer objects, fall back to two stacked mini-charts sharing an x-axis.
- **Heatmap:** CSS grid, `role="grid"`, focusable cells with per-cell
  `aria-label` (day, hour, sales), sticky day-label column, min cell size for WCAG
  2.5.8 — mirroring `SplhHeatmap`.
- **Segmented Day/Week/Month + editable target input:** keyboard-accessible
  (`aria-pressed`, labeled number input, Enter/blur commits).

## 8. Testing plan

| Unit (Vitest, `tests/unit/laborPnlAnalytics.test.ts`) |
|---|
| `aggregateFinancialSeries`: day passthrough; week = Monday-start tz grouping; month = calendar month; empty window; labor% = laborCost/netRevenue with 0-revenue → null. |
| `classifyBalance`: over/under/balanced band edges (T±BAND boundaries). |
| `summarizeLaborPnl`: verdict strings per tone; revPerLaborHr; over/under window extraction; 0-sales / 0-hours guards. |
| `buildSalesVolumeGrid`: intensity scaling; peak flag; estimated flag passthrough. |
| TZ-portable: `Date.UTC` fixtures, fixed tz arg. |
| Sort comparators use locale-aware / numeric comparators (SonarCloud S2871 lesson). |

Hooks: `useLaborPnlSummary` / `useLaborPnlAnalytics` — mock the composed hooks,
assert three states + reconciliation (KPI labor% == usePeriodMetrics labor%).
Components: render tests assert states by **role** (structural-assertion lesson);
target-edit write calls `updateSettings` with `{ target_labor_pct }`.

## 9. Decided trade-offs

- **Reuse `usePnLAnalyticsFromSource` daily series over a new SQL RPC** — already
  reconciled from source; aggregate client-side for week/month. Cost: pulls the
  daily series. Acceptable (≤~90–180 rows); React-Query cached.
- **Two labor cards on the dashboard** (existing scheduling SPLH + new financial)
  — accepted, placed in different clusters with distinct titles/framing. Rejected
  alternative: merging them (would conflate scheduling vs. financial mental models
  the user explicitly wants separate).
- **Hourly labor-% is shape-only (avg-rate);** period labor-% is payroll-grade.
  Labeling + visual separation prevent misreading. Rejected: hour-level
  payroll-grade attribution (payroll engine is day-level; not worth the complexity
  for a heatmap-shape overlay).

## 10. Out of scope

- Position-level (FOH/BOH) labor.
- Write-back of staffing changes (read-only analytics + target edit only).
- New RLS / `operations_manager` `time_punches` fix (separate follow-up).
- Server-side aggregation RPC (documented follow-up if payloads grow).
- Forecasting (usePnLAnalyticsFromSource has it; not surfaced here yet).

## 11. Open questions for user

1. **Target semantics:** edit `target_labor_pct` (labor % target — recommended,
   matches this view's hero metric) — confirmed as the financial target, shared
   with scheduling's existing labor-% target. (SPLH target stays separate.)
2. **Dashboard placement:** new card in the financial cluster (recommended) vs.
   replacing / next to the existing scheduling card.
