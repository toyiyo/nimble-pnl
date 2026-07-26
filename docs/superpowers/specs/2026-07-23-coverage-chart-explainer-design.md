# Coverage chart — explainer redesign

**Date:** 2026-07-23
**Branch:** `feature/coverage-chart-explainer`
**Primary component:** `src/components/scheduling/ShiftTimeline/CoverageChart.tsx`
**Supporting:** `coverageSummary.ts`, `staffingCalculator.ts`, `useStaffingSuggestions.ts`,
`ShiftTimelineTab.tsx`, `scheduling.ts`

## Problem

The Shift Timeline coverage panel tells a manager they are "short" without ever
showing **why** the number was produced or **which lever** moves it. Three
things collapse into one indistinguishable red block:

1. **Demand-short** — historical sales genuinely justify more people
   (`scheduled < demand`, where `demand = ceil(avgSales ÷ target_splh)`).
2. **Floor-short** — sales are already covered, but the `min_staff` policy floor
   is unmet (`scheduled ≥ demand` yet `scheduled < max(demand, min_staff)`).
3. **No sales history** — the hour had no sales in the lookback window, so there
   is no target at all. Today this renders as `N / 0`, which reads as
   "overstaffed for an hour that needs nobody" — the opposite of the truth.

The single knob that drives every "needed" number — the sales-per-labor-hour
target (`target_splh`) — lives in a Settings dialog three clicks away, so a
manager staring at "short 3" cannot see that the shortage is an artifact of a
target that contradicts their own labor-percent goal. (Identity:
`labor% = avg_hourly_wage ÷ target_splh`. A target set below
`avg_wage ÷ target_labor_pct` mechanically demands more staff than the labor
budget allows — a *lower* SPLH target demands *more* people, an inversion most
managers never feel.)

The panel also carries three competing UI surfaces — an Area/Delta toggle, the
chart, and a separate numeric status strip — that each render the same
under/over story in a different visual language.

**User-approved scope:** implement the approved interactive prototype exactly —
the six changes below. The prototype was reviewed and signed off ("super clear,
let's implement it just like the prototype shows").

## Goals

| # | Change | Kind |
|---|--------|------|
| 1 | Split demand-short (solid) from floor-short (dashed) with distinct color/texture | design |
| 2 | On-chart SPLH target slider — live preview of the whole panel + manager-only Save | feature |
| 3 | Live implied-labor-% readout + red/green vs-target pill + labor-consistent notch on the track | design |
| 4 | Pinned arithmetic "receipt" panel replacing the floating tooltip | design |
| 5 | Hatched "no sales history" hours instead of the misleading `N / 0` | **bug/clarity** |
| 6 | Collapse Area/Delta toggle + numeric strip + separate verdict into ONE chart with a real people y-axis | design |

## Non-goals

- No change to the staffing math itself (`calculateRecommendedStaff` stays
  authoritative — `max(ceil(sales/splh), minStaff)`).
- No change to how `unified_sales` → `aggregateHourlySales` →
  `buildHourlyRecommendations` produces `projectedSales`/`recommendedStaff`.
- No new DB columns, RPC, or migration — `target_splh` already persists via the
  existing `useStaffingSettings.updateSettings` path.
- The per-area scheduled strips (`AreaCoverageStrips`) are unchanged; they carry
  no demand and are orthogonal to this redesign.
- Quick-add (gap-click → `handleGapClick`) keeps its existing behavior; only its
  entry point moves (see §D).

## Data model — the one real gap

The demand/floor split needs the **raw pre-floor demand** kept separate from the
folded `needed`. Today both are collapsed into `recommendedStaff`/`needed`.

The codebase already forbids re-deriving authoritative staffing numbers in the
view — see the existing tooltip comment in `CoverageChart.tsx`: *"Use h.needed
(the authoritative value… ) rather than re-dividing here, which would use
Math.round and produce a contradictory number."* So we **thread `demand`
through the model** rather than recomputing `ceil(sales/splh)` inside the chart.

### `scheduling.ts` — `HourlyStaffingRecommendation`

```ts
export interface HourlyStaffingRecommendation {
  hour: number;
  projectedSales: number;
  demand: number;          // NEW — raw ceil(sales/splh), pre-floor (0 when sales ≤ 0)
  recommendedStaff: number; // = max(demand, minStaff), unchanged meaning
  estimatedLaborCost: number;
  laborPct: number;
  overTarget: boolean;
}
```

### `staffingCalculator.ts` — `buildHourlyRecommendations`

Compute `demand` explicitly and derive `recommendedStaff` from it so the two can
never drift:

```ts
const demand = avgSales > 0 && params.targetSplh > 0
  ? Math.ceil(avgSales / params.targetSplh)
  : 0;
const recommendedStaff = Math.max(demand, params.minStaff);
```

This is behavior-preserving: `Math.max(Math.ceil(sales/splh), minStaff)` is
exactly what `calculateRecommendedStaff` returns for `sales > 0`, and `minStaff`
for `sales ≤ 0`. `calculateRecommendedStaff` stays as-is (other callers), but
`buildHourlyRecommendations` stops calling it so it can surface `demand`.

### `coverageSummary.ts` — `CoverageHour`

```ts
export interface CoverageHour {
  hour: number;
  startMin: number;
  scheduled: number;       // per-hour MIN headcount (conservative — unchanged)
  scheduledMax: number;    // NEW — per-hour MAX headcount, for the "moves X→Y mid-hour" note
  needed: number | null;
  demand: number | null;   // NEW — raw pre-floor; null when no rec / no sales history
  delta: number | null;
  projectedSales: number | null;
  laborPct: number | null;
}
```

`summarizeCoverageHours` copies `rec.demand` into `demand` (null when no rec) and
computes `scheduledMax = inHour.length ? Math.max(...counts) : 0`. `scheduledMax`
is cheap (same samples already gathered) and makes the receipt honest about why an
hour reads short — it is the only addition beyond the strict split. All existing
fields keep their exact current semantics, so `buildVerdict`,
`mergeUnderStaffedRange`, `CoverageStatusStrip`, and `summarizeAreaCoverage`
(which passes `demand=null`) are unaffected.

## Per-hour classification (authoritative — mirrors the prototype)

Given a `CoverageHour`:

- **`nodata`** — `demand === null` (no rec, or `projectedSales ≤ 0`): hatched
  column, no target, excluded from every shortfall count. Replaces `N / 0`.
- else with `demand`, `needed = max(demand, minStaff)`, `scheduled`:
  - **`crit` (short on demand)** — `scheduled < demand`
  - **`floor` (short on floor only)** — `scheduled ≥ demand && scheduled < needed`
  - **`spare`** — `scheduled > needed`
  - **`ok`** — `scheduled === needed`
- `gap = needed − scheduled` (people-hours short; ≤ 0 means covered).

Two shortfall segments stack in a `crit` column: the demand slice
(`y(demand) → y(scheduled)`, **solid** `--destructive`) and, above it, the floor
slice (`max(scheduled, demand) → needed`, **dashed/hatched** amber). A `floor`
column shows only the dashed amber slice.

## Component design

### A. `CoverageChart.tsx` — single SVG chart with a people y-axis

Replaces the two HTML-column views (`AreaColumn`/`DeltaColumn`) and the `Legend`
with **one** SVG chart, `role="img"`, semantic tokens only:

- **Y-axis** = people (0 … `peak = max(scheduledMax, needed, minStaff) + 1`),
  integer ticks. X-axis stays aligned to the hour grid via the existing
  `minToPct` scale so it lines up with `TimelineAxis`.
- Per hour: a **scheduled** bar (`--primary` fill) from 0 to `scheduled`; on top,
  the demand slice (solid `--destructive`) and/or floor slice (dashed amber);
  `nodata` hours render a hatched full-height ghost with no target line.
- A **`min_staff` floor rule** — horizontal line labeled `floor N` across the plot.
- **Selection**: clicking/focusing a column selects it (`selected` state lifted to
  the panel) and drives the receipt (§C). Keyboard: each column is a focusable
  `role="button"`/`tabIndex=0` with arrow-key navigation; `aria-label` carries the
  full one-line summary (unchanged accessibility contract, extended).
- New semantic color: floor-short needs a token distinct from `--destructive` and
  `--primary`. Introduce `--warning` usage (amber) via the existing token set (the
  break-even widget already uses `--warning`); **no raw hex** (CLAUDE.md rule).

Legend becomes four swatches: *short on demand* (solid red), *at the floor only*
(dashed amber), *covered* (primary), *no sales history* (hatch).

### B. On-chart SPLH slider + labor readout (feature #2, #3)

A slider (range **25–120, step 5**, bracketing the labor-consistent value with
headroom; the saved value is clamped only for *display* position, never for
persistence) sits above the chart:

- **Preview + Save** (user-selected). The slider value is held in
  `ShiftTimelineTab` state and passed as the `settingsOverrides` argument to
  `useWeekStaffingSuggestions` (currently hard-coded `null` at line 261):
  `{ target_splh: sliderValue }` when previewing, `null` when at the saved value.
  The hook already merges defined overrides into `activeSettings` and reruns the
  whole pipeline, so **the entire panel — chart, receipt, verdict — redraws live**
  as the slider moves, with one source of truth. No view-local recomputation.
- **Save** button persists via the hook's existing `updateSettings` (+ `isSaving`
  for the pending state). Gated to managers/owners — reuse the same role predicate
  that guards the staffing-settings surface (identify exact hook during build;
  candidate `useRestaurantContext` role / existing `canManage*`); non-managers see
  the live preview and slider but no Save (read-only), and Reset restores the saved
  value. **Confirm the role predicate before writing the gate — do not assume.**
- **Reset** restores `sliderValue` to the saved `target_splh` (clears the override).
- **Implied-labor readout**: `pct = avgWage ÷ target_splh × 100`, rendered
  `→ X% labor at $W/hr`, with a pill: `bad` (`--destructive`) when
  `pct > target_labor_pct + 0.05`, else `good` (`--primary`/success). `avgWage =
  computeAvgHourlyRateCents(employees)/100`; `target_labor_pct` from settings.
- **Notch** on the track at the labor-consistent target
  `consistent = avgWage ÷ (target_labor_pct / 100)`, labeled e.g.
  `$W · TL% labor`, so the manager can see where their own labor goal puts the knob.

All of `avgWage`, `target_labor_pct`, `lookback_weeks`, `min_staff`/`min_crew` come
from real settings/employees — **nothing hardcoded** (the prototype's
`WAGE/TARGET_LABOR/LOOKBACK` constants map to these).

### C. Pinned "receipt" panel (feature #4)

Replaces the floating Radix tooltip with a panel pinned beside the chart, driven
by the selected column (defaults to the worst `crit` hour, else first hour). It
survives slider drags (selection is independent state). Ledger rows, exactly as
the prototype:

```
Avg {weekday} sales   $503
÷ target              $30/hr
= demand              17 people      (red when scheduled < demand)
min staff             4              (amber when demand < minStaff)
needed                17
scheduled             14
Short on demand       −3             (colored by kind)
```

Plus an aside: implied SPLH at the scheduled count
(`sales/scheduled` → `round(wage ÷ splhAt × 100)% labor`), the "headcount moves
from `scheduledMax` to `scheduled` mid-hour; the chart counts the lower figure"
note when `scheduledMax !== scheduled`, and for `floor` hours "Sales only justify
`demand` here — the rest is your minimum-staff rule." `nodata` hours get the
"no sales in the last N {weekday}s… the old chart printed this as N / 0" copy.

### D. Quick-add preservation

The removed `CoverageStatusStrip` currently owns the gap-click → `handleGapClick`
quick-add. The receipt panel gains an **"Add shift for this hour"** button on
`crit`/`floor` hours that calls the same `handleGapClick(h.startMin)` — behavior
identical, entry point relocated. (Optionally the selected short column is itself
clickable to add; the receipt button is the primary affordance.)

### E. `ShiftTimelineTab.tsx` wiring

- Add `sliderTarget` state; pass `{ target_splh: sliderTarget }` (or `null`) to
  `useWeekStaffingSuggestions`.
- Destructure `updateSettings`, `isSaving`, `employees` (for `avgWage`) and the
  effective `minStaff = computeMinStaffFromCrew(min_crew, min_staff)` from the
  hook / existing data.
- Delete the `coverageView` state + Area/Delta `ToggleGroup` and the
  `CoverageStatusStrip` render; `CoverageVerdict`/`CoverageDemandInfo` fold into
  the single chart's header/legend.
- Keep feeding the chart `hours={hourlySummary}` — it already incorporates
  `liveCoverage` (drag-draft), so live-drag gap-fill keeps working untouched.

## States

- **Loading** — settings/sales loading: skeleton chart (existing `isLoading`).
- **No demand configured** (`demand` null for all hours) — scheduled-only bars,
  slider + labor readout hidden (no target to preview), verdict "set staffing
  targets".
- **No sales history for the day** — all `nodata`, hatched, receipt explains.
- **Non-manager** — slider live-preview + Reset, no Save.

## Accessibility

- Chart `role="img"` with a computed `aria-label` describing the split
  (`"3 hours short on demand, 2 at the floor, over N hours"`).
- Each column focusable, arrow-navigable, `aria-label` = its one-line summary;
  selecting updates the receipt (which is an `aria-live="polite"` region).
- Slider = native `<input type="range">` with `aria-label`
  "Sales per labor hour target, in dollars" and `aria-valuetext` including the
  implied labor %.
- Pill/notch states never rely on color alone — each carries text.

## Testing

| Unit | Assertion |
|------|-----------|
| `staffingCalculator` | `buildHourlyRecommendations` emits `demand`; `recommendedStaff === max(demand, minStaff)`; `demand === 0` when sales ≤ 0 |
| `coverageSummary` | `summarizeCoverageHours` threads `demand`/`scheduledMax`; `demand` null when no rec; `demand=null` path (area coverage) unchanged |
| classify helper | crit/floor/spare/ok/nodata boundaries incl. `scheduled === demand`, `scheduled === needed`, `demand < minStaff` |
| labor readout helper | `pct` and pill threshold at `target_labor_pct + 0.05`; notch `consistent` value |
| receipt builder | ledger rows + asides per kind; `nodata` copy; mid-hour range note only when `scheduledMax !== scheduled` |

Component render tests optional per CLAUDE.md; keep the pure helpers (classify,
labor, receipt-line builders) exported and covered so the SonarCloud gate counts
them.

## Rollout / risk

- Pure additive model fields — no migration, no RLS surface.
- Behavior-preserving calculator refactor guarded by the unit test above.
- The slider→override→Save path reuses the audited `updateSettings` write; the
  only new authz surface is the Save gate, which must match the existing staffing
  settings permission (verified in build, not assumed).
- All figures in this doc are illustrative; no customer name or real wage is
  committed. PII sweep (`grep -niE`) runs before push.

## Design-review resolutions (Phase 2.5)

Incorporated from the frontend-design review of commit `46f5ab1a`.

1. **ARIA structure (was: `role="img"` + focusable columns conflict).** The chart
   container is **not** `role="img"`. Use `role="toolbar"` (or `role="listbox"`)
   with **roving tabindex** children: the selected column is `role="option"`/
   button with `tabIndex=0`, all others `tabIndex=-1`; ArrowLeft/Right move
   selection and focus. A visually-hidden (`sr-only`) `<p>` carries the rolled-up
   "N short on demand, M at the floor over K hours" summary. No `role="img"`
   flattening of the interactive subtree.

2. **Screen-reader enumeration of all gaps.** Port `CoverageStatusStrip`'s
   `sr-only <ul aria-label="Understaffed windows">` (one `<li>` per short hour)
   into the new chart so SR users still get the full gap list without arrow-keying
   through every column. This is a hard requirement, not optional.

3. **Receipt placement / sticky y-axis.** The receipt panel renders **outside**
   the existing `overflow-x-auto` plot wrapper (a flex row: scrollable chart on the
   left, pinned receipt on the right on ≥`md`, stacked below on mobile) so "pinned"
   holds and it never scrolls with the plot. The SVG **y-axis lives in the sticky
   `pl-[120px]` left gutter** (mirroring `TimelineLane`'s `sticky left-0 z-10
   w-[120px]` label column) so the people axis stays visible during horizontal
   scroll on wide days. The plot area keeps the shared `minToPct` x-scale for axis
   alignment.

4. **`aria-live` debounce.** The receipt is `aria-live="polite"` but its text is
   updated for SR announcement **only on slider commit** (`pointerup`/`keyup`), not
   on every drag frame. The slider's own native `aria-valuenow`/`aria-valuetext`
   update continuously; the visual receipt/chart still redraw live each frame.

5. **Quick-add parity (one-click preserved).** Do **not** regress to two clicks.
   Short (`crit`/`floor`) columns keep a **one-click** hover-revealed "+" quick-add
   affordance calling `handleGapClick(h.startMin)` — identical to today's strip
   button — *in addition to* selection driving the receipt (whose "Add shift for
   this hour" button is the secondary, discoverable path). `mergeUnderStaffedRange`
   already handles `floor` hours (delta < 0 for both kinds), confirmed.

6. **Save-gate authz (no clean precedent — define deliberately).** `StaffingOverlay`
   calls `updateSettings` with **no** role check; other surfaces use ad-hoc inline
   checks like `['owner','manager','operations_manager'].includes(role)`. Build
   step: adopt that inline predicate for the Save button
   (`selectedRestaurant?.role`), **explicitly including `operations_manager`** and
   **excluding** view-only collaborator roles; live preview + Reset stay available
   to everyone. Document the chosen role set in the PR. Do not skip this — there is
   no gate to copy.

7. **Styling conventions (explicit).** Receipt ledger, slider label, labor pill,
   and notch use the CLAUDE.md scale: labels `text-[12px] font-medium
   text-muted-foreground uppercase tracking-wider`; ledger rows `text-[13px]`/
   `text-[14px] font-medium`; containers `rounded-xl border border-border/40
   bg-muted/30`; pill `text-[11px] px-1.5 py-0.5 rounded-md`. `tabular-nums` on all
   aligned figures.

8. **SVG hatch = token-compliant.** `<pattern>`/`<rect>` fills reference
   `hsl(var(--muted-foreground))` / `hsl(var(--warning))` via inline `style` or a
   bound CSS custom property — never a raw hex. Dashed floor slice uses
   `stroke-dasharray`, hatch `nodata` uses a diagonal-line `<pattern>` — texture,
   not color alone.

9. **Loading skeleton reshape.** Replace the current generic bar skeleton with one
   mirroring the new layout (slider row + axis + chart + adjacent receipt block).

10. **Preserve settings deep-link.** `CoverageDemandInfo`'s "Adjust targets in
    Staffing settings →" link to `/settings` is retained in the new chart header so
    the full-settings path isn't lost when the popover folds in.
