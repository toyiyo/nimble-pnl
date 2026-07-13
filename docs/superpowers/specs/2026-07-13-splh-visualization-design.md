# Sales-per-Labor-Hour (SPLH) Visualization — Design

**Date:** 2026-07-13
**Branch:** `feature/splh-visualization`
**Author:** Claude (dev workflow)
**Status:** revised after Phase 2.5 design review (Supabase + Frontend). See §11.

## 1. Problem & goal

Today SPLH exists only as a **target input** (`staffing_settings.target_splh`,
default `$60`) consumed forward by `staffingCalculator.calculateRecommendedStaff`
(`needed staff = projected hourly sales ÷ target SPLH`). The single computed
*actual* SPLH is a scalar in `useWeekStaffingSuggestions` — and that value is
**silently always null in production today** because its punch query filters on
`punch_type ∈ {'in','out'}`, values that do not exist (see §11 C1). There is **no
historical or by-hour view**.

The owner wants to *see* SPLH so they can answer three questions:

1. **Am I over- or under-staffed?**
2. **How am I trending over time?** (timeline)
3. **What hours should I hire for / trim?**

**Interpretation contract (drives all coloring & verdicts):**
`SPLH = sales ÷ labor hours`.
- SPLH **above** target → running *lean* → **understaffed** candidate (add hours).
- SPLH **below** target → too much labor for the sales → **overstaffed** candidate (trim).
- SPLH **≈** target (within a band) → balanced.

## 2. Scope (locked with user)

- **Both surfaces in one change**, sharing pure lib logic.
- **Labor hours = actual clocked, break-excluded worked hours** from `time_punches`.
- **Timeline granularity: both** daily (~30 days) and weekly (~12 weeks), user-selectable.
- **Both new sections default to collapsed** (`= false`), matching the just-landed
  convention (`4d490f73`, "default staffing suggestions panel to collapsed").

### Dashboard (`src/pages/Index.tsx`)
A compact **collapsible "Labor efficiency" card** (`src/components/dashboard/LaborEfficiencyCard.tsx`):
actual SPLH vs target, labor-% of sales, a one-line verdict, a mini sparkline of
recent daily SPLH, and a "View in Scheduling" link. Follows the existing
`<Collapsible open={x} onOpenChange={setX}>` + `<h2>` + ghost-chevron trigger with
`aria-label={open ? "Collapse …" : "Expand …"}` pattern (`Index.tsx:853-861`). New
state `laborEfficiencyOpen = false`.

### Scheduling (Planner tab)
A new **collapsible "Labor efficiency" panel** in
`src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` (near the `StaffingOverlay`
mount), default collapsed, containing:
- **Day-of-week × hour-of-day heatmap** (`SplhHeatmap.tsx`) — diverging color (§7.1).
- **Auto-computed callout** ("Hire these hours / trim these hours"), neutral styling.
- **SPLH-vs-target timeline** (`SplhTimelineChart.tsx`, Recharts `LineChart` +
  `ReferenceLine` at target) with a **day/week toggle** reusing the existing
  `ToggleGroup`/`aria-pressed` idiom from `ShiftPlannerTab` (Plan|Timeline toggle).

## 3. Data sources (confirmed against schema)

| Concern | Table / hook | Notes |
|---|---|---|
| Sales | `unified_sales` (`sale_date`, `sale_time`, `sold_at`, `total_price`) | Filter `item_type='sale'` **AND `parent_sale_id IS NULL`** (split-sale guard, §11 S-M1). Hour-of-day via `sold_at` (UTC→tz) else legacy `sale_time`; daily-spread fallback otherwise. |
| Labor | `time_punches` (`punch_time`, `punch_type ∈ {clock_in,clock_out,break_start,break_end}`, `employee_id`) | Actual worked hours via `timePunchProcessing.identifyWorkSessions` (breaks excluded, anomaly-tolerant). |
| Target | `staffing_settings.target_splh` via `useStaffingSettings` | Default `$60`; also `lookback_weeks` (default 4). |
| Timezone | `selectedRestaurant?.restaurant?.timezone` | DB default `America/Chicago`; validated before use (§5). |

## 4. Architecture

Pure, deterministic transforms live in **`src/lib/splhAnalytics.ts`** (a *measured*
directory for SonarCloud coverage — see the `useTimelineModel` coverage lesson).
Two hooks share that lib; the pure math never mounts.

```
src/hooks/useSplhAnalytics.ts        → full: grid + daily + weekly + hire/trim (Scheduling panel)
src/hooks/useSplhSummary.ts          → summary: headline SPLH + labor% + daily sparkline (dashboard card)
```

Splitting the hooks (rather than one hook building everything) prevents the
dashboard card from paying the full Scheduling-panel cost — the grid and the
weekly bucket are never built for the card (§11 F-M3). Both hooks reuse the same
fetch helpers and the same `src/lib/splhAnalytics.ts` functions.

### 4.1 Labor hours — reuse the authoritative punch processor

**Do not hand-roll in/out pairing.** `src/utils/timePunchProcessing.ts` already
provides tested logic that normalizes noise, pairs `clock_in`→`clock_out`,
**subtracts `break_start`→`break_end` intervals**, and tolerates a mid-sequence
missed clock-out without cascading (`fillSession` breaks on the next `clock_in`).
Labor pipeline:

```
identifyWorkSessions(normalizePunches(punches)) → WorkSession[]   // reused as-is
  then, in src/lib/splhAnalytics.ts:
  distributeWorkedHours(session, tz) → { localDate, dow, hour, hours }[]
```

`distributeWorkedHours` builds the session's worked intervals =
`[clock_in, clock_out]` **minus** each complete break, then buckets each worked
sub-interval across hour boundaries in the restaurant tz (overnight shifts split
across two `dow`/`localDate` values). Incomplete sessions (no `clock_out`) are
excluded (their `worked_minutes` is 0 / `is_complete=false`).

### 4.2 Pure functions (in `src/lib/splhAnalytics.ts`)

- `distributeWorkedHours(session, tz)` — as above.
- `buildSplhGrid(sales, sessions, tz, target)`:
  - Sales side: bucket `total_price` by `(dow, hour)` (reuse the
    `aggregateHourlySales` hour-derivation approach) → **sum**.
  - Labor side: sum `distributeWorkedHours` into `(dow, hour)`.
  - Cell `splh = Σsales / ΣworkedHours`; states: `closed` (no sales & no labor),
    `no-labor` (sales but ~0 labor → rendered muted, never `Infinity`),
    `lean|balanced|slack` by band vs target.
- `buildSplhTimeseries(sales, sessions, tz, 'day'|'week')` — per bucket
  `SPLH = Σsales / ΣworkedHours`; labor attributed per `localDate`; weekly buckets
  group by **Monday-start** week in tz (matches `getMondayOfWeek`, §11 S-min2).
- `summarizeSplh(...)` — headline actual SPLH (Σsales/Σhours over window),
  labor-% *only when* an avg wage is derivable (`computeAvgHourlyRateCents`;
  else null — no misleading zero), verdict string, and hire/trim hour lists.

### 4.3 Bundled fix (same domain)

Fix `useWeekStaffingSuggestions.ts` `actualSplh` to use the real punch flow
(reuse `identifyWorkSessions` / the shared lib) instead of the dead
`['in','out']` filter, with a regression test asserting the real `punch_type`
strings. This repairs the "Your actual: $X/hr" hint that is currently always blank.

## 5. Correctness rules (from lessons + review)

- **Timezone discipline:** all hour/day/week bucketing uses the restaurant IANA
  tz, never host tz. Validate once with a throwaway
  `new Intl.DateTimeFormat('en-US',{timeZone})` in try/catch; on `RangeError`
  fall back to `'UTC'` and log. Reuse the module formatter cache from
  `useHourlySalesPattern`. **Also** compute the query window boundaries
  ("today − N weeks" → "today") from the restaurant-local date, not UTC
  `new Date()` (§11 S-min1).
- **Split-sale guard:** sales query adds `.is('parent_sale_id', null)` so split
  parents + children don't double-count the numerator (§11 S-M1).
- **Deterministic pagination:** fetch both tables with a `.range()` loop using a
  fully-unique `ORDER BY` — sales `.order('sale_date').order('created_at').order('id')`
  (the `useUnifiedSales` pattern), punches `.order('employee_id').order('punch_time').order('id')`.
  Loop until a short page returns, with a **hard cap** (e.g. 20 pages / 20k rows);
  on cap, surface a "narrow your date range" notice rather than looping unbounded
  (§11 S-min3). This fixes the silent-truncation trap in the existing staffing hooks.
- **React Query house style:** `enabled: !!restaurantId`; `data: undefined` while
  disabled (no synthetic `0`); `staleTime: 60000`, `refetchOnWindowFocus`.
- **Derived verdicts guard `isError`:** never render a verdict from `undefined` on
  an errored/loading query — guard `!isError && hasSamples`.
- **TZ-portable tests:** `Date.UTC(...)` fixtures; assert against a fixed tz arg.
- **No `any`** in state/catch; typed interfaces, `catch (e: unknown)`.

## 6. Edge cases & three states

- **Divide-by-zero:** `ΣworkedHours ≈ 0` with `sales > 0` → `no-labor` (muted,
  "no labor logged" label), never `Infinity`. Both zero → `closed`.
- **No hourly breakdown** (`hasHourlyBreakdown === false`): sales spread across
  business hours, so the heatmap hour axis is synthetic — render with an
  **"Estimated" badge** + note; the **timeline is unaffected** (date-level). Flag
  carried through the hook.
- **Loading** → layout-shaped `<Skeleton/>` (grid + chart placeholders, mirroring
  `SalesVsBreakEvenChart`), **error** → inline message, **empty** (no sales or no
  punches) → `EmptyState` inviting POS connect / time-tracking enable.
- Heatmap trims dead early-AM columns; horizontal scroll on overflow.
- **Known limitation:** `operations_manager` currently cannot SELECT `time_punches`
  (RLS SELECT policy still `role IN ('owner','manager')`, never migrated to the
  capability fn), so the card/heatmap shows "no labor logged" for that role.
  Documented + filed as a separate follow-up (§11 S-M5); owner/manager (primary
  audience) are unaffected.

## 7. UI / styling

### 7.1 Heatmap color (concrete tokens)
`src/index.css` has no cold/blue or "balanced" token, and `SalesVsBreakEvenChart`
uses raw non-theme literals. We define **theme-aware CSS variables** in
`src/index.css` (light + dark, contrast-checked ≥ 4.5:1 for text-in-cell):

| State | Token | Meaning |
|---|---|---|
| lean (above target) | `--splh-lean` (red family) | likely understaffed |
| slack (below target) | `--splh-slack` (blue family) | likely overstaffed |
| balanced | `--splh-balanced` (neutral) | on target |
| closed / no-labor | `bg-muted` + `text-muted-foreground` | no data |

Intensity scales with distance from target via opacity ramps on the base token.
Color is **never the only signal**: the cell shows the SPLH value as text, and a
legend + tooltip accompany the grid.

### 7.2 Heatmap accessibility & structure
CSS grid (like `CoverageChart.tsx`), ~7×14 cells (no virtualization). `role="grid"`
with `role="row"`/`role="gridcell"`; **every cell is focusable** (`tabIndex={0}`)
with an `aria-label` naming day, hour, SPLH, and state (so keyboard/SR users get
the same per-cell data mouse users get on hover — mirroring `CoverageChart`'s
per-column `aria-label`). Day-of-week label column is `sticky left-0 z-10` with a
solid background so it stays pinned during horizontal scroll; cells use a stated
minimum size (`min-w-10 min-h-10`) that satisfies both legibility and the WCAG
2.5.8 touch target. Cell array + timeline `chartData` are `useMemo`-derived.

### 7.3 Timeline & card
Recharts `LineChart`, **single y-axis** (no dual axis — lesson), `ReferenceLine`
at target, tooltip `$/labor-hr`, ticks `hsl(var(--muted-foreground))`,
`tickLine/axisLine={false}` — mirroring `SalesVsBreakEvenChart`. Day/week toggle is
keyboard-accessible (`aria-pressed`). The hire/trim callout uses neutral
`bg-muted/30 border-border/40` (not the amber AI-suggestion pattern — this is
read-only, no apply affordance; §11 F-min2). Dashboard card: hero SPLH number,
target, labor-%, verdict line, Recharts mini `<Line>` sparkline, and a
`navigate('/scheduling')` link.

## 8. Testing plan

| Unit (Vitest, `tests/unit/splhAnalytics.test.ts`) |
|---|
| `distributeWorkedHours`: single-hour, multi-hour fractional split, **break excluded from bucket totals**, **overnight split across two dow**, tz correctness (fixed tz, `Date.UTC`). |
| `buildSplhGrid`: ratio math; `no-labor`/`closed` states; band classification; split-sale rows excluded when `parent_sale_id` set (fixture). |
| `buildSplhTimeseries`: daily vs weekly (Monday-start) bucketing in tz; empty window. |
| `summarizeSplh`: verdict strings; hire/trim selection thresholds; `isError`/empty guards; labor-% null when no wage. |
| `validateTimeZone`: valid passes; invalid → `'UTC'`. |
| Regression: `useWeekStaffingSuggestions` uses real `punch_type` strings (was `['in','out']`). |

Reuse of `identifyWorkSessions` inherits its existing `timePunchProcessing.test.ts`
coverage (breaks, missed-clockout, noise). Component render tests assert the three
states by **role** (structural-assertion lesson).

## 9. Decided trade-offs

- **Client-side aggregation over a new SQL RPC** — reuses `aggregateHourlySales` +
  `timePunchProcessing`, keeps logic testable, matches existing hooks. Cost:
  pulling raw rows. Mitigation: paginated + capped fetch, React-Query caching,
  4-week grid default (12-week weekly timeline opt-in). Follow-up path if payloads
  are too large: a `SECURITY INVOKER` RPC returning the pre-bucketed grid (noted,
  not built). Review confirmed the correctness bugs found are independent of
  client-vs-server aggregation.
- **Cell SPLH = summed ratio** (`Σsales/Σhours`), not average-of-ratios — matches
  the existing `actualSplh` definition, avoids sampling-mismatch bias.
- **Labor-% is best-effort** — shown only when an avg hourly rate is derivable.

## 10. Out of scope

- Scheduled-hours SPLH (actual-only; toggle is future).
- Position-level SPLH (FOH vs BOH).
- Write-back of staffing changes (read-only analytics).
- `operations_manager` `time_punches` SELECT RLS fix (separate follow-up task).
- Server-side RPC/migration (documented follow-up).

## 11. Design review resolutions (Phase 2.5)

### Critical
- **C1 — `punch_type` values.** Real values are `clock_in/clock_out/break_start/break_end`,
  not `in/out`. **Resolved:** labor uses `timePunchProcessing.identifyWorkSessions`
  (correct values, break-aware); §3/§4.1/§8 updated; existing
  `useWeekStaffingSuggestions` bug fixed + regression test (§4.3).

### Major — Supabase
- **S-M1 split-sale double count** → sales query adds `.is('parent_sale_id', null)` (§3/§5/§8).
- **S-M2 non-deterministic pagination order** → unique `ORDER BY` per §5.
- **S-M3 break handling** → resolved by reusing `identifyWorkSessions` (subtracts breaks) (§4.1).
- **S-M4 cascading missed-clock-out desync** → resolved by reusing `identifyWorkSessions` (anomaly-tolerant) (§4.1).
- **S-M5 `operations_manager` SELECT RLS gap** → documented known limitation (§6) + separate follow-up task (§10).

### Major — Frontend
- **F-M1 undefined heatmap colors** → concrete theme-aware tokens defined (§7.1).
- **F-M2 no keyboard/SR story** → grid roles + focusable cells + per-cell `aria-label` (§7.2).
- **F-M3 shared-hook over-fetch** → split `useSplhSummary` (dashboard) / `useSplhAnalytics` (scheduling) (§4).
- **F-M4 mobile heatmap** → sticky day-label column + minimum cell size (§7.2).
- **F-M5 default open/collapsed unspecified** → both sections default collapsed (§2).

### Minor (accepted)
- Typo `splitAnalytics`→`splhAnalytics` fixed. Callout neutral not amber (§7.3).
  Collapsible trigger idiom stated (§2). Memoize cell array/chartData (§7.2).
  Layout-shaped skeleton (§6). Restaurant-tz window boundaries (§5, S-min1).
  Monday-start weeks (§4.2, S-min2). Range-loop hard cap (§5, S-min3).
