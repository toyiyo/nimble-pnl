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

## 4. Data sources (the crux — revised after Phase 2.5)

> **Phase 2.5 correction (critical):** `usePnLAnalyticsFromSource` and
> `usePeriodMetrics` do **not** expose a real per-day revenue series —
> `usePnLAnalyticsFromSource` takes the period-total revenue and spreads it
> **evenly across days** (every day gets the same revenue) and drops days that
> have sales but no cost row. Building the daily/weekly chart on it would show a
> flat revenue line — the opposite of "how did my day happen." They are also
> gated behind `useRevenueBreakdown`'s 5-minute `staleTime`. **We therefore do
> not use them for the series or the KPIs.** The only genuinely per-day AND
> per-hour revenue in the codebase is the raw `unified_sales` rows that
> `useSplhData` already fetches (split-sale-guarded) and that
> `buildSplhTimeseries` / `buildSplhGrid` already bucket for real.

| Concern | Source | Why |
|---|---|---|
| **Revenue — every altitude & the hourly heatmap** (real per-day + per-hour) | `useSplhData` (existing 60s fetch) → `buildSplhTimeseries` (day/week) + new **month** bucket + `buildSplhGrid` (dow×hour) | Genuinely per-day/per-hour, split-sale-guarded, restaurant-tz. This is **gross sales** (`unified_sales.total_price`, top-line). |
| **Labor $ + hours — every altitude** (real per-day, payroll-grade) | `useLaborCostsFromTimeTracking` → daily `total_labor_cost` / `total_hours` (via `calculateActualLaborCost`, the Payroll engine). Aggregate to week/month. | Same engine as the Payroll page → labor dollars are the ones the owner already trusts. Handles OT / salary / contractor / open-shift "through now". |
| **KPI period totals** (labor %, rev/labor-hr, net sales, labor $) | Summed from the two **real series above**, not a separate hook | Guarantees the KPI headline equals the chart totals (internal consistency); no flat-average or 5-min-stale dependency. |
| **Target** | `useStaffingSettings` → `effectiveSettings.target_labor_pct`; write via `updateSettings({ target_labor_pct })` | Same setting scheduling already edits (`StaffingConfigPanel`) → the two surfaces stay consistent. **Default 22** (migration default `22.0`). |
| **Timezone / window** | Window boundaries from restaurant tz via `getTodayInTimezone` (`src/lib/timezone.ts`) — NOT `new Date()`; bucketing via `validateTimeZone` + `Intl` (existing) | Prevents the host-vs-restaurant-tz day-boundary bugs recorded in `memory/lessons.md` (PR #562/#587, the $2,246 ISO-week swing). |

**Honest framing (no false reconciliation claim):**
- **Labor $** here == Payroll's labor $ (same engine). We *do* claim that.
- **Revenue** here is **gross sales** from `unified_sales` (what "% of sales my
  team costs me" intuitively means), which is the same figure the scheduling SPLH
  card uses. It is **top-line and may differ from the P&L page's *net* revenue**
  (which nets discounts/comps and drops delivery pass-through). The card/page label
  the metric **"Labor % of sales"** (not "of net revenue") and a tooltip states the
  denominator, so it is never mistaken for the P&L's net-revenue labor %.
- **Day-boundary join:** the daily sales bucket (`unified_sales.sale_date`,
  restaurant-local DATE) and the daily labor bucket (`calculateActualLaborCost`
  day attribution) must use the same restaurant-tz day; §5 + tests pin this.
- **`capped`:** `useSplhData` caps at 20k rows/table and exposes `capped`. Propagate
  it to the heatmap + Month view as a "partial window" note (§6).

## 5. Architecture

Pure transforms in a new **`src/lib/laborPnlAnalytics.ts`** (a *measured* dir for
SonarCloud coverage). Hooks compose existing hooks + this lib; pure math never
mounts.

```
src/lib/laborPnlAnalytics.ts
  // Joins a real daily sales series (from buildSplhTimeseries 'day') with a real
  // daily labor series (from useLaborCostsFromTimeTracking) on restaurant-tz date,
  // then rolls up to the requested granularity.
  buildFinancialSeries(dailySales: SplhPoint[], dailyLabor: LaborCostData[],
                       granularity: 'day'|'week'|'month', tz, target)
     → FinancialPoint[] { bucketStart, label, sales, laborCost, laborHours, laborPct, balanceState }
  buildSalesVolumeGrid(gridCells: SplhGridCell[]) → per-(dow,hour) totalSales + intensity + peak flag + estimated passthrough
  classifyBalance(laborPct, targetPct, band) → 'over'|'balanced'|'under'
  summarizeLaborPnl(points | totals, targetPct) → { sales, laborCost, laborPct, revPerLaborHr, verdict, verdictTone, overWindows, underWindows }

src/hooks/useLaborPnlSummary.ts   → dashboard card (period totals + daily sparkline)
src/hooks/useLaborPnlAnalytics.ts → /labor page (day/week/month series + hourly grid + summary)
```

Reuses without modification: `useSplhData`, `buildSplhGrid`,
`buildSplhTimeseries`, `distributeWorkedHours`, `validateTimeZone`,
`getTodayInTimezone`, `useStaffingSettings`, `useLaborCostsFromTimeTracking`.
(Deliberately **not** `usePeriodMetrics` / `usePnLAnalyticsFromSource` — see §4.)
Month bucketing (calendar month) is added to the lib; week bucketing reuses the
Monday-start rule already in `splhAnalytics.mondayOf`.

### 5.1 Routing & nav
- `Labor.tsx` page (eager import, matching App.tsx convention):
  `<Route path="/labor" element={<ProtectedRoute><Labor /></ProtectedRoute>} />`.
  **Reachability:** `ProtectedRoute` only gates staff-vs-non-staff (`allowStaff`);
  plain `<ProtectedRoute>` (as here) is reachable by owner/manager/chef/
  collaborator — identical to `/payroll` and `/reports`, which also surface
  payroll-grade figures. This matches existing convention for sensitive financial
  pages; no finer role gate is added (documented, not a silent assumption).
- Dashboard card's "Open labor detail →" `navigate('/labor')`.

## 6. Edge cases & three states

- **Divide-by-zero:** `net_revenue = 0` → labor % is `—` / "no sales", never
  `Infinity`; `labor_hours = 0` → rev/labor-hr `—`.
- **No hourly breakdown** (sales lack `sold_at`/`sale_time`): heatmap uses the
  existing daily-spread fallback + an **"Estimated"** badge (inherited from
  `buildSplhGrid`); the day/week/month **financial timeline is unaffected**
  (date-level).
- **Capped fetch** (`useSplhData.capped` — >20k rows in either table, most likely
  in Month view): show a "partial window — narrow your range" note on the heatmap
  and Month timeline (mirrors `LaborEfficiencyPanel`'s existing `capped` treatment),
  so a truncated busy-hours read is never presented as complete.
- **Day-boundary mismatch:** sales are bucketed by `sale_date` (restaurant-local
  DATE); labor daily costs come from `calculateActualLaborCost`'s day attribution.
  Both windows are derived from the restaurant-tz "today" (§4); a unit test pins
  that a punch and a sale on the same restaurant-local day land in the same bucket.
- **Loading** → layout-shaped `<Skeleton>` (KPI row + chart + heatmap); **error**
  → inline retry; **empty** (no sales, or no punches anywhere in window) →
  `EmptyState` inviting POS connect / time-tracking enable.
- **Target write:** optimistic; on error, revert + destructive toast. Non-owner
  without permission: control is read-only (no write affordance).
- **Role/RLS:** `operations_manager` cannot currently SELECT `time_punches`
  (known gap from #611 §6) → labor shows "no labor logged" for that role; documented,
  owner/manager unaffected. No new RLS in this PR.

## 7. UI / styling

Apple/Notion tokens per CLAUDE.md. **Add new, dedicated financial-balance CSS
tokens** — `--labor-over` (warm/red), `--labor-under` (amber), `--labor-balanced`
(neutral/green) — in `src/index.css` (light + dark, contrast ≥4.5:1). We do **not**
reuse `--splh-lean/slack`: those are semantically **inverted** here (`--splh-lean`
= red = *understaffed*, `--splh-slack` = blue = *overstaffed*), and both cards can
be on-screen together, so sharing tokens would make red mean opposite things on
adjacent cards. Color is never the only signal: value text + legend + tooltip
always present.

- **Charts:** Recharts. **Two stacked charts sharing one x-axis** (net-sales area
  on top, labor-% line + target `ReferenceLine` below) — **not** a dual-axis
  single chart. Rationale: the codebase's own target-vs-actual precedent
  (`SplhTimelineChart`) uses single-axis + `ReferenceLine`, and a dual axis whose
  scales can be tuned to imply correlation is exactly the #611 lesson's failure
  mode — highest-risk here because the whole point is to correlate sales and
  labor. The staffing-balance ribbon sits between/under the stacked pair on the
  shared x-axis.
- **Heatmap:** CSS grid, `role="grid"`, focusable cells with per-cell
  `aria-label` (day, hour, sales), sticky day-label column, min cell size for WCAG
  2.5.8 — mirroring `SplhHeatmap`.
- **Segmented Day/Week/Month + editable target input:** keyboard-accessible
  (`aria-pressed`, labeled number input). Commit on blur **or** Enter, guarded by a
  **dirty check** (only write when the value actually changed) so Enter-then-blur
  can't fire `updateSettings` twice.
- **Card heading copy (two-card disambiguation):** the existing scheduling card's
  section is titled **"Labor efficiency"**; this financial card's section is titled
  **"Labor cost"** with subtitle "What your team costs against sales." Distinct
  heading + different dashboard cluster keep the two mental models separate.

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

## 10.5 Phase 7 (code-review) resolutions

- **[critical, fixed] Labor fetch window cut off at midday** (`useLaborPnlCore`):
  `windowEnd` was midnight-*start* of today; `lookaheadPunchFetchRange` widens
  only the fetch's end, so evening punches were dropped. Fixed to end-of-day
  (23:59:59.999) + regression test.
- **[major, fixed] Day/Week/Month toggle didn't change the period** — it only
  re-bucketed a fixed 12-week window, so KPIs/verdict were identical across
  toggles and "Day" plotted ~84 days. Fixed: the toggle now selects the period
  (today / this week / this month); KPIs + verdict come from the period's
  **payroll-grade daily** series; the chart shows the period's sub-buckets
  (Day = hour-of-day intraday, Week = by day, Month = by week). New pure lib
  (`currentPeriodWindow`, `dateInWindow`, `buildIntradayFinancialSeries`) + tests.
- **[major, ACCEPTED as documented limitation] Labor/sales day-boundary tz
  mismatch:** `buildFinancialSeries` joins sales (bucketed by
  `unified_sales.sale_date`, restaurant-local) with labor (bucketed by
  `calculateActualLaborCost`, which reads the JS runtime's local calendar day).
  When the **viewer's device tz differs from the restaurant tz** (traveling /
  multi-location owner), a punch or sale near local midnight can land in adjacent
  day buckets. **Accepted, not fixed here:** this is a *pre-existing* behavior
  shared with the Payroll page (same engine); making `calculateActualLaborCost`
  tz-aware changes payroll numbers app-wide and needs its own design + review.
  Fixing it here would break our own "labor $ == Payroll's labor $" guarantee
  (§4/§9). Tracked as a follow-up. Owner viewing from in-region (the common case)
  is unaffected.

## 11. Phase 2.5 design-review resolutions

- **[critical] Fake per-day revenue in `usePnLAnalyticsFromSource`** → dropped that
  source entirely; series revenue now from real `unified_sales` rows via
  `useSplhData`/`buildSplhTimeseries` (§4). Also removes the 5-min-staleTime
  `useRevenueBreakdown` dependency (a separate major).
- **[major] Timezone window boundaries** → restaurant-tz via `getTodayInTimezone`,
  not `new Date()` (§4/§6).
- **[major] Inverted `--splh-*` tokens** → new dedicated `--labor-over/under/balanced`
  tokens (§7).
- **[major] Dual-axis chart** → two stacked charts sharing an x-axis (§7).
- **[major] `capped` not propagated** → shown on heatmap + Month view (§6).
- **[minor] default target** 22, not 30 (§4). **[minor] route reachability** worded
  accurately (§5.1). **[minor] card heading** "Labor cost" pinned (§7). **[minor]
  Enter+blur double-commit** guarded by dirty check (§7).

## 12. Remaining user decision

- **Dashboard placement:** new "Labor cost" card in the financial cluster
  (near Performance Overview / Sales-vs-Break-even) — **recommended**, keeps it
  away from the scheduling "Labor efficiency" card. Alternative: adjacent to the
  existing card. Defaulting to the financial cluster unless told otherwise.
