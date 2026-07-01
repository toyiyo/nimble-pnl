# Design: Schedule Timeline view (day gantt + coverage curve)

**Date:** 2026-07-01
**Branch:** `worktree-schedule-timeline-view`
**Status:** Approved mockup → design

## Problem

Managers build schedules in the **planner** — a static week × template grid where
they drag employees into the time windows they need to fill. The planner is a
great *editing* surface, but it answers only "who is assigned to which template
slot." It does **not** answer the question a manager actually asks when they step
back:

> "What shape does my day take — where is coverage thin, where am I stacked up,
> and do I actually have enough people on at the dinner rush?"

Shifts are stored as `start_time` / `end_time` timestamps. To reason about
coverage, a manager today has to mentally sum overlapping template chips across
the grid. There is no view that plots shifts on a real time axis, and no view
that shows the **coverage curve** (how many people are on the floor at each
moment) against **demand** (how many the store needs).

An approved mockup demonstrated the fix: a **day gantt** (one bar per shift,
positioned by real start/end, grouped into station bands) with a **coverage-vs-
demand curve** laid over the same time axis, so understaffed windows read as
"the curve dips under the demand line" without counting a single bar.

## Goals

1. **Timeline view mode** beside the planner — a read-only visualization sharing
   the planner's week/shifts data.
2. **Day gantt** — shifts as bars on a real local-time axis, grouped by area or
   position, with overnight (cross-midnight) shifts handled correctly.
3. **Coverage curve** — staffing headcount over time, overlaid with a demand line
   sourced from the existing staffing recommendations, with understaffed windows
   highlighted.
4. **Reuse the planner's existing primitives** for coverage, hours, grouping,
   colors, and time conversion — this is a new *rendering*, not new business
   logic.

## Non-goals (v1 scope — explicitly deferred)

- **Week coverage heatmap** — the 7-row coverage-intensity strip from the mockup.
  Natural fast-follow (same `useTimelineModel`, new presentation); ships as a
  **separate PR**.
- **Drag-to-edit / deep-link into planner** — v1 Timeline is read-only. Clicking a
  bar opens the existing shift detail; it does not navigate to the planner cell.
- **Demand editing** — the demand line is *read* from existing staffing
  recommendations; configuring staffing stays in its current surface.

## Architecture

New folder `src/components/scheduling/ShiftTimeline/`, mounted inside
`ShiftPlannerTab.tsx` behind a `Plan | Timeline` segmented control that toggles
the presentation while both modes consume the same `useShiftPlanner` state
(week, `shifts`, `employees`, navigation).

| Unit | Responsibility | Depends on |
|---|---|---|
| `useTimelineModel.ts` | **Pure** transform: `(shifts, day, groupBy, tz, demand) → TimelineModel`. The whole brain of the feature. Fully unit-tested, TZ-portable. | `calculateShiftHours`, `ShiftInterval`, `scheduleGrouping`, `shiftCoverage` |
| `ShiftTimelineTab.tsx` | Container: day-within-week selector, group-by toggle, three-state rendering (loading / error / empty). | `useShiftPlanner`, `useTimelineModel` |
| `CoverageCurve.tsx` | SVG: staffing area + dashed demand line + red gap shading. `role="img"` + `<title>`/`<desc>`. | model.coverage / demand / gaps |
| `TimelineAxis.tsx` | Hour tick lines + labels across the derived day window. | model.window |
| `TimelineLane.tsx` | One area/position band: header (label · count · hours) + stacked bar rows. | model.lanes |
| `TimelineBar.tsx` | One shift as a focusable button: position/area color, name label, `aria-label`, click → shift detail. | POSITION_COLORS |
| `NowIndicator.tsx` | Vertical "now" line; renders only when the selected day is today. | model.window |

`useTimelineModel` is the only unit with logic; every component below it is
presentational and driven by props (mirrors the planner's memoized-row pattern).

## Data flow

```
useShiftPlanner (existing)
  ├─ shifts[]  (UTC ISO start/end, position, area, employee.area, status)
  ├─ employees[]
  └─ week nav
        │
        ▼
useTimelineModel(shifts, selectedDay, groupBy, restaurantTz, demand)
        │  pure transform
        ▼
TimelineModel {
  window:   { startMin, endMin }              // derived, not hardcoded
  lanes:    [{ key, label, color, hours, bars:[{ shift, row, leftPct, widthPct, label, ariaLabel }] }]
  coverage: [{ min, count }]                   // from shiftCoverage primitives
  demand:   [{ min, target }] | null           // null when staffing not configured
  gaps:     [{ startMin, endMin, short }]      // coverage < demand windows
}
        │
        ▼
ShiftTimelineTab → CoverageCurve + TimelineAxis + TimelineLane* + NowIndicator
```

### `TimelineModel` derivations

- **window** — `startMin = floor(min(localStart) to the hour)`,
  `endMin = ceil(max(localEnd) to the hour)`, clamped to sane defaults if the day
  is sparse. Overnight shifts push `endMin` past 1440 (see below). **Not**
  hardcoded to 10A–12A like the throwaway mock.
- **lanes** — group the day's shifts via `scheduleGrouping` (`'area' | 'position'`).
  Within a lane, assign each shift a `row` by first-fit over `ShiftInterval.overlapsWith`
  so overlapping shifts stack instead of colliding. Lane `hours` = Σ
  `calculateShiftHours`.
- **coverage** — reuse the minute-resolution coverage helpers in `shiftCoverage.ts`
  that already back `CoverageStrip`; sample at a fixed step (15 min) for the curve.
- **demand** — read the same staffing-recommendation data source
  `StaffingOverlay` / `StaffingDayColumn` consume. If the store has no staffing
  config for the day, `demand = null` and no demand line / gaps render.
- **gaps** — contiguous windows where `coverage.count < demand.target`.

## The three correctness traps (from `memory/lessons.md`)

These are pre-committed decisions, each traceable to a prior scheduling bug.

### 1. Timezone — position bars in the restaurant's local wall-clock, never host TZ

Shifts are UTC ISO strings. A bar's x-position is a function of local
hour-of-day, so the conversion **must** use the restaurant's IANA timezone, not
the host process TZ. We reuse the planner's existing `formatLocalTime`
conversion (the same one that already renders correct chip times).
- Lessons: `[2026-05-03] Local-TZ startOfWeek makes ISO-week ... CI-flaky`,
  `[2026-05-10] Switching a Date's anchoring convention ...`.
- **Tests are TZ-portable:** fixtures built with `new Date(y, m, d, h, mm)` (local
  midnight anchor), suite asserted under `TZ=UTC` **and** a non-UTC zone
  (`America/Chicago` or `Asia/Tokyo`). Never rely on the host TZ agreeing with the
  restaurant TZ.

### 2. Cross-midnight shifts — absolute-minute math, extend the window

An overnight shift (e.g. 22:00→02:00) has `localEnd <= localStart`. The model
adds 1440 to `endMin` for that shift and lets the day window extend past midnight
so the bar renders as one continuous block.
- Lesson: `[2026-05-18] Day-aware overlap needs absolute-time math, not a wider
  "day predicate"`. Overlap/row-stacking uses absolute minutes, not a same-day
  predicate.
- Tests cover: a normal day shift, an overnight shift crossing midnight, and two
  overlapping shifts on the same lane stacking into two rows.

### 3. Area grouping — orphan keys + sentinel consistency with the planner

Grouping by `area` must stay byte-for-byte consistent with the planner's
`groupTemplatesByArea` / off-template handling: the `'Unassigned'` sentinel, and
`shift.area || 'Unassigned'` (matching the sibling helper's `||`, **not** `??`).
Any area value present on a shift but absent from the grouping key-set must still
render (no silently dropped orphan lanes).
- Lesson: `[2026-06-27] Grouping by a derived key against a different key-set drops
  "orphan" keys; string '' sentinel can win a min tie-break` (PR #556). If any
  min-comparison tie-break on a string is needed, the sentinel must sort to the
  **losing** end (`'\xFF'`), never `''`.

### 4. Sonar new-code coverage — count conditions, not lines

The model is where branching concentrates (group mode, demand-present, overnight,
empty day). New-code coverage ≥80% counts *conditions*, so every branch gets a
test, preferring single fixtures that exercise several branches at once.
- Lesson: `[2026-05-24] Sonar "Coverage on New Code" counts conditions ...`.

## States & accessibility

- **Loading** — skeleton bands (mirrors the planner's loading treatment).
- **Error** — inline error message, no crash.
- **Empty** — no shifts on the selected day → empty state: "No shifts scheduled —
  switch to Plan to add coverage."
- **Bars** — rendered as `<button>` with
  `aria-label="Carolina Sanchez · Front counter · 10:00 AM–4:00 PM · 6h"`, keyboard
  focusable; Enter/click opens the existing shift detail popover.
- **Coverage curve** — `role="img"` with a `<desc>` summarizing peak coverage and
  understaffed windows; gap windows are **also** surfaced as text so meaning is
  never color-only.
- **Styling** — semantic tokens only (no direct colors), Apple/Notion type scale
  per `CLAUDE.md`. Bar colors reuse `POSITION_COLORS`.

## Performance

A day has few shifts (tens, not hundreds) → no virtualization needed. The SVG
curve is a single path pair. `useTimelineModel` is memoized on
`(shifts, selectedDay, groupBy, tz, demand)`. React Query staleTime is inherited
from `useShiftPlanner` — no new fetching, no manual caching. The now-line reads a
render-synced `now` (refreshed on a 60s tick via a ref, per
`[2026-06-19] A long-lived loop must call its prop callback through a render-synced
ref`) so it never holds a stale closure.

## Testing

| Layer | Location | Covers |
|---|---|---|
| `useTimelineModel` | `tests/unit/useTimelineModel.test.ts` | window derivation, lane grouping (area + position), overnight, overlap-stacking, coverage sampling, demand-null path, gap detection, orphan-area lane, TZ portability |
| Bar a11y / label formatting | `tests/unit/timelineBarLabel.test.ts` | `aria-label` composition across branches (single fixture, multiple flags) |
| Component render | optional (per CLAUDE.md UI tests optional) | three-state rendering smoke |

No DB / edge-function / migration changes — this is a pure frontend feature over
existing data. (Supabase design review is therefore not applicable.)

## Reuse map (existing code this feature leans on)

| Need | Existing source |
|---|---|
| Net shift hours | `src/lib/scheduleRoster.ts` `calculateShiftHours` |
| UTC→local time | `src/hooks/useShiftPlanner.ts` `formatLocalTime` |
| Compact time labels | `src/lib/openShiftHelpers.ts` `formatCompactTime` |
| Overlap / duration | `src/lib/shiftInterval.ts` `ShiftInterval` |
| Group mode | `src/lib/scheduleGrouping.ts` `GroupByMode` |
| Area grouping + sentinel | `src/lib/templateAreaGrouping.ts` |
| Coverage over time | `src/lib/shiftCoverage.ts`, `src/hooks/usePlannerShiftsIndex.ts` |
| Position colors | `src/components/scheduling/ShiftPlanner/EmployeeChip.tsx` `POSITION_COLORS` |
| Demand / staffing recs | `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` (+ `StaffingDayColumn`) |
| Shift/week data | `src/hooks/useShiftPlanner.ts` |

## Decided trade-offs

- **Week heatmap deferred to a second PR** — keeps this PR's diff and CI loop
  small and reviewable; the model is designed so the week view is a pure
  presentational add later.
- **Read-only v1** — no planner deep-link; clicking a bar opens the existing shift
  detail. Avoids cross-component navigation state until the read surface proves
  its value.
- **Demand line degrades to absent** — when a store hasn't configured staffing,
  we show the coverage curve alone rather than inventing a target (mirrors the
  `[2026-05-03]` allow-list discipline: don't fabricate data the source didn't
  give us).
