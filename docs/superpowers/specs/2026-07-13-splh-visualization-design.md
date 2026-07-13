# Sales-per-Labor-Hour (SPLH) Visualization — Design

**Date:** 2026-07-13
**Branch:** `feature/splh-visualization`
**Author:** Claude (dev workflow)

## 1. Problem & goal

Today SPLH exists only as a **target input** (`staffing_settings.target_splh`,
default `$60`) consumed forward by `staffingCalculator.calculateRecommendedStaff`
(`needed staff = projected hourly sales ÷ target SPLH`). The single computed
*actual* SPLH is a scalar in `useWeekStaffingSuggestions` (total sales ÷ total
hours over the lookback). There is **no historical or by-hour view**.

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

- **Both surfaces in one change**, sharing one data hook.
- **Labor hours = actual clocked hours** from `time_punches` (in/out pairs), not scheduled.
- **Timeline granularity: both** daily (~30 days) and weekly (~12 weeks), user-selectable.

### Dashboard (`src/pages/Index.tsx`)
A compact **collapsible "Labor efficiency" card** (`src/components/dashboard/LaborEfficiencyCard.tsx`):
actual SPLH vs target, labor-% of sales, a one-line plain-English verdict, a mini
sparkline of recent SPLH, and a click-through to Scheduling. Follows the existing
`<Collapsible open={x} onOpenChange={setX}>` + `<h2>` + chevron pattern (e.g. the
Cashflow section at `Index.tsx:853`). New state `laborEfficiencyOpen`.

### Scheduling (Planner tab)
A new **collapsible "Labor efficiency" panel** mounted in
`src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` (near the existing
`StaffingOverlay` mount), containing:
- **Day-of-week × hour-of-day heatmap** (`SplhHeatmap.tsx`) — diverging color:
  red = above target (lean/likely understaffed), blue = below target
  (slack/likely overstaffed), neutral = on target, muted = closed / no data.
  Cell tooltip shows the hour, actual SPLH, avg sales, avg labor hours.
- **Auto-computed callout** ("Hire these hours / trim these hours") derived from
  the persistently-hot and persistently-cold cells.
- **SPLH-vs-target timeline** (`SplhTimelineChart.tsx`, Recharts `LineChart` +
  `ReferenceLine` at target) with a **day/week toggle**.

## 3. Data sources (confirmed)

| Concern | Table / hook | Notes |
|---|---|---|
| Sales | `unified_sales` (`sale_date`, `sale_time`, `sold_at`, `total_price`, `item_type='sale'`) | Hour-of-day via `sold_at` (UTC → tz) else legacy `sale_time`; falls back to daily spread when neither exists. |
| Labor | `time_punches` (`punch_time`, `punch_type ∈ {in,out}`, `employee_id`) | Actual clocked hours. Pair in→out per employee. |
| Target | `staffing_settings.target_splh` via `useStaffingSettings` | Default `$60`. Also `lookback_weeks` (default 4). |
| Timezone | `selectedRestaurant?.restaurant?.timezone` | Defaults to `America/Chicago` in DB; `'UTC'` fallback in some call-sites. **Must be validated** (see §5). |

## 4. Architecture

Pure, deterministic transforms live in **`src/lib/splhAnalytics.ts`** (a *measured*
directory for SonarCloud coverage — see the `useTimelineModel` coverage lesson).
The React-Query hook **`src/hooks/useSplhAnalytics.ts`** does only fetching +
wiring; all math is delegated to the lib so it is unit-testable without mounting.

```
useSplhAnalytics(restaurantId)
  ├─ fetch unified_sales rows  (paginated — see §5 truncation note)
  ├─ fetch time_punches rows   (paginated)
  ├─ read target_splh + lookback via useStaffingSettings
  ├─ read restaurant tz via useRestaurantContext  → validateTimeZone()
  └─ derive (pure, from splitAnalytics.ts):
       • buildSplhGrid(sales, punches, tz, target)      → SplhGridCell[7][24]
       • buildSplhTimeseries(sales, punches, tz, 'day')  → SplhPoint[]
       • buildSplhTimeseries(sales, punches, tz, 'week') → SplhPoint[]
       • summarizeSplh(grid, timeseries, target)         → { actualSplh, laborPct?, verdict, hireHours[], trimHours[] }
```

### 4.1 Pure functions (in `src/lib/splhAnalytics.ts`)

- `pairPunchSessions(punches)` → `{ employee_id, inISO, outISO }[]`.
  Sort by employee then time; pair each `in` with the next `out` for the same
  employee. **Drop** unpaired `in` (open session, no clock-out) and stray `out`.
  **Drop** sessions with duration `≤ 0` or `≥ 24h` (matches the existing
  `hours > 0 && hours < 24` guard in `useWeekStaffingSuggestions`).
- `distributeSessionHours(session, tz)` → contributions
  `{ localDate, dow, hour, hours }[]`. Walk the session hour-by-hour in the
  restaurant tz; each bucket gets `overlap(bucketStart, bucketEnd, in, out)` in
  hours. Overnight shifts naturally split across two `localDate`/`dow` values.
- `buildSplhGrid(sales, punches, tz, target)`:
  - Sales side: reuse `aggregateHourlySales`-style bucketing keyed by
    `(dow, hour)` → **sum** `total_price`.
  - Labor side: sum `distributeSessionHours` contributions into `(dow, hour)`.
  - Cell `splh = totalSales / totalLaborHours` (see §6 divide-by-zero).
  - Cell state: `closed` (no sales & no labor), `no-labor` (sales but ~0 labor),
    `lean|balanced|slack` by band vs target.
- `buildSplhTimeseries(sales, punches, tz, 'day'|'week')`:
  per bucket `SPLH = Σsales / ΣlaborHours`; labor hours attributed per `localDate`
  from `distributeSessionHours`; weekly buckets group by ISO-week start in tz.
- `summarizeSplh(...)`: headline actual SPLH (Σsales/Σhours over the window),
  labor-% if an avg wage is available (reuse `computeAvgHourlyRateCents`; optional
  — degrade gracefully to null), a one-line verdict string, and the hire/trim hour
  lists (cells whose |SPLH−target|/target exceeds a band in ≥ N sampled weeks).

## 5. Correctness rules (from lessons)

- **Timezone discipline** (multiple TZ lessons): all hour/day/week bucketing uses
  the restaurant IANA tz, never host tz. Validate the stored tz once with a
  throwaway `new Intl.DateTimeFormat('en-US',{timeZone})` in try/catch; on
  `RangeError`, fall back to `'UTC'` and log. Reuse the module `Intl` formatter
  cache pattern from `useHourlySalesPattern`.
- **Row-cap truncation:** a 12-week window can exceed PostgREST's default 1000-row
  cap for both `unified_sales` (item-level) and `time_punches` (busy restaurants).
  The existing staffing hooks fetch without paging and silently truncate. **We
  paginate** via a `.range()` loop until a short page is returned, so aggregates
  are complete. (Trade-off in §9.)
- **React Query house style:** `enabled: !!restaurantId`; leave `data: undefined`
  while disabled (no synthetic `0`); `staleTime: 60000`, `refetchOnWindowFocus`.
- **Derived verdicts guard `isError`:** never render "overstaffed"/"understaffed"
  from `data === undefined` on an errored/loading query — guard `!isError && grid
  has samples`.
- **TZ-portable tests:** pin fixtures with `Date.UTC(...)`; assert on a fixed tz
  argument, never host-local `new Date(y,m,d)` clock strings.
- **No `any`** in component state / catch; typed interfaces, `catch (e: unknown)`.

## 6. Edge cases & three states

- **Divide-by-zero:** `totalLaborHours ≈ 0` with `sales > 0` → cell state
  `no-labor` (rendered muted with a "no labor logged" tooltip), **not** `Infinity`.
  Both zero → `closed`.
- **No hourly breakdown** (`hasHourlyBreakdown === false`, POS supplies no
  timestamps): sales are spread across business hours, so the *hour* axis of the
  heatmap is synthetic. Render the heatmap with an **"Estimated" badge** + note;
  the **timeline is unaffected** (date-level). Carry the flag through the hook.
- **Loading** → `<Skeleton/>`; **error** → inline error message; **empty**
  (no sales or no punches in window) → an `EmptyState` inviting the user to
  connect a POS / enable time tracking. (CLAUDE.md three-state rule.)
- Heatmap only renders hours that any day has activity in (trim dead early-AM
  columns) to stay compact; horizontal scroll on overflow.

## 7. UI / styling

- Apple/Notion tokens per CLAUDE.md: `border-border/40`, `bg-muted/30`,
  `rounded-xl` cards, the documented typography scale. Collapsible header matches
  the dashboard `<h2>` + chevron pattern.
- **Heatmap** is a CSS grid (like `CoverageChart.tsx`), not Recharts. Diverging
  color via `hsl(var(--...))` with opacity ramps. Because pure semantic tokens
  can't express a red↔blue diverging scale, the heatmap uses the **documented
  chart-color exception** (the same `hsl(...)` approach `SalesVsBreakEvenChart`
  already uses), with a legend + text labels so color is never the only signal
  (accessibility). Closed/no-data cells use `bg-muted`.
- **Timeline** uses Recharts `LineChart`, single y-axis (no dual axis — lesson),
  `ReferenceLine` at target, tooltip formatted `$/labor-hr`, axis ticks
  `hsl(var(--muted-foreground))`, `tickLine/axisLine={false}` — mirroring
  `SalesVsBreakEvenChart`.
- Day/week toggle: the CLAUDE.md Apple-underline-tab pattern or a small segmented
  control; keyboard-accessible, `aria-pressed`.
- Dashboard card is compact: hero SPLH number, target, labor-%, verdict line,
  sparkline (Recharts `<Line>` mini), and a "View in Scheduling" link
  (`navigate('/scheduling')`).

## 8. Testing plan

| Unit (Vitest, `tests/unit/splhAnalytics.test.ts`) |
|---|
| `pairPunchSessions`: pairs in/out; drops open `in`; drops stray `out`; drops ≥24h & ≤0. |
| `distributeSessionHours`: single-hour, multi-hour fractional split, **overnight split across two dow**, tz correctness (fixed tz, `Date.UTC` fixtures). |
| `buildSplhGrid`: ratio math; `no-labor` and `closed` states; band classification vs target. |
| `buildSplhTimeseries`: daily vs weekly bucketing; ISO-week grouping in tz; empty window. |
| `summarizeSplh`: verdict strings; hire/trim hour selection thresholds; `isError`/empty guards. |
| `validateTimeZone`: valid passes through; invalid → `'UTC'`. |

Components are optional per the testing table; a light render test asserts the
three states (skeleton/error/empty) by **role** (structural assertion lesson).

## 9. Decided trade-offs

- **Client-side aggregation (honoring the locked design) over a new SQL RPC.**
  Keeps all logic in testable TS, reuses `aggregateHourlySales`, and matches the
  existing staffing hooks. Cost: we pull raw rows to the client. Mitigation:
  pagination (avoids silent truncation) + React-Query caching + default 4-week
  grid; the 12-week weekly timeline is opt-in. **Follow-up path** if payloads are
  too large for 100+-item-per-service restaurants: move the aggregation into a
  `SECURITY INVOKER` RPC returning the pre-bucketed grid — noted, not built now.
- **Cell SPLH uses summed ratio** (`Σsales/Σhours`), not an average of per-day
  ratios — matches the existing `actualSplh` definition and avoids sampling-mismatch
  bias when sales-days and labor-days differ.
- **Labor-% is best-effort:** shown only when an avg hourly rate is derivable;
  otherwise omitted (no misleading zero).

## 10. Out of scope

- Scheduled-hours SPLH (actual-only for now; a toggle is a future add).
- Position-level SPLH (front vs back of house).
- Writing back suggested staffing changes (read-only analytics).
- Server-side RPC/migration (documented follow-up).
