# Design: Schedule Timeline view (day gantt + coverage curve)

**Date:** 2026-07-01
**Branch:** `worktree-schedule-timeline-view`
**Status:** Approved mockup → design → design-reviewed (Phase 2.5 concerns folded in)

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
4. **Reuse the planner's existing primitives** for coverage math, hours, grouping,
   colors, TZ conversion, and staffing recommendations — this is a new
   *rendering*, not new business logic.

## Non-goals (v1 scope — explicitly deferred)

- **Week coverage heatmap** — the 7-row coverage-intensity strip from the mockup.
  Natural fast-follow (same `useTimelineModel`, new presentation); ships as a
  **separate PR**.
- **Drag-to-edit / deep-link into planner** — v1 Timeline is read-only. Clicking a
  bar opens a read-only detail popover; it does not navigate to the planner cell.
- **Demand editing** — the demand line is *read* from existing staffing
  recommendations; configuring staffing stays in `StaffingOverlay`.

## Prerequisite refactors (behavior-preserving; first plan tasks)

Phase 2.5 review found that three symbols the Timeline needs are currently not
consumable. Each is a small, behavior-preserving extraction done **before** the
Timeline components, each with its own test:

1. **Export `isoToLocalMinutes` + add `computeDayCoverage`** in `src/lib/shiftCoverage.ts`.
   `isoToLocalMinutes` (currently a private helper, line 60, using `toZonedTime`
   from `date-fns-tz`) is exported. A new `computeDayCoverage(shifts, dateStr, tz,
   stepMin)` sweeps *all* shifts (no template-slot/position/area filter) to a
   minute-grid headcount array. `computeSlotCoverage` (line 112) is slot-scoped
   and **cannot** produce a whole-day curve — this is the correct primitive to add.

2. **Extract `POSITION_COLORS` → `src/lib/positionColors.ts`.** Currently a
   non-exported `const` in `EmployeeChip.tsx` (line 21). Move it to a shared module
   (with the existing `DEFAULT_COLORS` and the `getPositionColors(position)`
   lookup); `EmployeeChip` re-imports. No visual change. Both the chip and
   `TimelineBar` then consume one source of truth.

3. **Extract `useWeekStaffingSuggestions` → `src/hooks/useWeekStaffingSuggestions.ts`.**
   Currently internal to `StaffingOverlay.tsx` (used at line 212). Move it verbatim
   to its own hook file; `StaffingOverlay` imports it. The Timeline derives the
   selected day's `HourlyStaffingRecommendation[]` from the same week result — no
   second, divergent staffing query.

## Architecture

New folder `src/components/scheduling/ShiftTimeline/`, mounted inside
`ShiftPlannerTab.tsx` behind a shadcn `ToggleGroup` (`Plan | Timeline`) that
switches presentation while both modes consume the same `useShiftPlanner` state.

| Unit | Responsibility | Depends on |
|---|---|---|
| `useTimelineModel.ts` | **Pure** transform: `(shifts, employees, day, groupBy, tz, recommendations) → TimelineModel`. The whole brain. Fully unit-tested, TZ-portable. | `buildRosterDay`, `ShiftInterval`, `computeDayCoverage`, `calculateShiftHours` |
| `ShiftTimelineTab.tsx` | Container: day-within-week selector, group-by `ToggleGroup`, three-state rendering (loading / error / empty), single `TimelineShiftPopover` instance. | `useShiftPlanner`, `useTimelineModel`, `useWeekStaffingSuggestions` |
| `CoverageCurve.tsx` | SVG staffing area + dashed demand line + red gap shading. `role="img"` + `<title>`/`<desc>`. | model.coverage / demand / gaps |
| `CoverageGapList.tsx` | Visible + screen-reader list of understaffed windows by start–end time (the non-color-only alternative to the curve). | model.gaps |
| `TimelineAxis.tsx` | Hour tick lines + labels across the derived window. | model.window |
| `TimelineLane.tsx` | One area/position band: sticky label (name · count · hours) + stacked bar rows. | model.lanes |
| `TimelineBar.tsx` | One shift as a focusable `<button>`: position color, name label, `aria-label`, click → sets active shift. | `getPositionColors` |
| `NowIndicator.tsx` | Vertical "now" line; owns its own 60 s tick; renders only when the selected day is today. | model.window |
| `TimelineShiftPopover.tsx` | Single read-only shadcn `Popover` showing the active shift's details. | active shift state |

`useTimelineModel` is the only unit with logic; everything below is presentational
and prop-driven (mirrors the planner's memoized-row pattern).

## Data flow

```
useShiftPlanner (existing)          useWeekStaffingSuggestions (extracted)
  ├─ shifts[] (UTC ISO, position,     └─ HourlyStaffingRecommendation[] per day
  │   area, employee, status)             (hour:0–23, recommendedStaff:int)
  ├─ employees[]                                    │
  └─ week nav                                       │
        │                                           │
        ▼                                           ▼
useTimelineModel(shifts, employees, selectedDay, groupBy, restaurantTz, dayRecommendations)
        │  pure transform
        ▼
TimelineModel {
  window:   { startMin, endMin }               // derived, may exceed 1440 (overnight)
  lanes:    [{ key, label, hours, bars:[{ shift, row, leftMin, endMin, label, ariaLabel, color }] }]
  coverage: [{ min, count }]                    // computeDayCoverage, 15-min grid
  demand:   [{ min, target }] | null            // hourly recs expanded to 15-min grid; null if none
  gaps:     [{ startMin, endMin }]              // coverage.count < demand.target on the shared grid
}
        │
        ▼
ShiftTimelineTab → (horizontally-scrollable plot) CoverageCurve + TimelineAxis + TimelineLane*
                 + NowIndicator + CoverageGapList + single TimelineShiftPopover
```

### `TimelineModel` derivations

- **window** — `startMin = floor(min(localStart)/60)*60`,
  `endMin = ceil(max(localEnd)/60)*60`, clamped to a sane default span if the day
  is sparse. Overnight shifts push `endMin` past 1440 (below). **Not** hardcoded
  to 10A–12A like the throwaway mock.
- **lanes** — group the day's shifts with the **`buildRosterDay`** pattern from
  `scheduleRoster.ts` (groups `Shift[]` by `GroupByMode`, sorts each section,
  emits `label: key || UNASSIGNED_LABEL`). v1 groups by the same keys the roster
  print uses (`employee.area` / `employee.position`) for cross-surface
  consistency. Within a lane, assign each shift a `row` by first-fit over
  `ShiftInterval.overlapsWith` (absolute-minute overlap) so overlapping shifts
  stack. Lane `hours` = Σ `calculateShiftHours`.
- **coverage** — `computeDayCoverage(shifts, dateStr, tz, 15)` → count at each
  15-min sample.
- **demand** — expand each `HourlyStaffingRecommendation` (integer hour →
  `recommendedStaff`) into a **15-min step function** aligned to the coverage grid
  (`demand[i].target = rec[floor(min/60)].recommendedStaff`). If the store has no
  hourly-sales / staffing config for the day, `dayRecommendations` is empty →
  `demand = null` and no demand line / gaps render.
- **gaps** — contiguous windows on the shared 15-min grid where
  `coverage.count < demand.target`. Gap boundaries snap to 15 min (documented
  trade-off; hourly demand resolution makes finer boundaries meaningless).

## The correctness traps (from `memory/lessons.md`, confirmed against code)

### 1. Timezone — use `isoToLocalMinutes` (date-fns-tz), NOT `formatLocalTime`

Bar x-position is a function of local hour-of-day, so conversion **must** use the
restaurant's IANA timezone. `formatLocalTime` in `useShiftPlanner.ts` (line 42)
uses host-process `Date.getHours()` — it returns the *host machine's* local time,
wrong in prod. The correct primitive is `isoToLocalMinutes` in `shiftCoverage.ts`
(line 60, `toZonedTime(new Date(iso), tz)`), which we export in refactor #1.
- Lessons: `[2026-05-03] Local-TZ startOfWeek ... CI-flaky`,
  `[2026-05-10] Switching a Date's anchoring convention ...`.
- **Tests are TZ-portable:** fixtures built with UTC ISO strings + an explicit
  restaurant `tz`, suite asserted under `TZ=UTC` **and** a non-UTC host
  (`Asia/Tokyo`) — the position must depend only on the passed `tz`, never the host.

### 2. Cross-midnight shifts — absolute-minute math, extend the window

An overnight shift (22:00→02:00) has `localEnd <= localStart`; the model adds 1440
to its `endMin` and extends the day window so the bar is one continuous block.
- Lesson: `[2026-05-18] Day-aware overlap needs absolute-time math, not a wider
  "day predicate"`. Row-stacking overlap is absolute minutes.
- Tests: normal shift, overnight crossing midnight, two overlapping same-lane
  shifts stacking into two rows.

### 3. Grouping — reuse `buildRosterDay`; keep the sentinel consistent

Grouping goes through `buildRosterDay` (already groups `Shift[]` with
`UNASSIGNED_LABEL` and `key || UNASSIGNED_LABEL`, line 104/120) — the same helper
the roster print uses. This inherits the sentinel discipline and avoids the
`scheduleGrouping.groupEmployees` mismatch (that helper groups `Employee[]`, not
shifts). Orphan-key risk is moot because `buildRosterDay` derives keys from the
shifts themselves.
- Lesson: `[2026-06-27] Grouping by a derived key against a different key-set drops
  orphan keys; '' sentinel wins a min tie-break` (PR #556). No new `''` tie-break
  is introduced; sort is via the existing `RosterSortBy`.

### 4. Sonar new-code coverage — count conditions, not lines

Branching concentrates in `useTimelineModel` (group mode, demand-present,
overnight, empty day) and `computeDayCoverage`. New-code coverage ≥80% counts
*conditions*, so every branch gets a test, preferring single fixtures that hit
several branches at once.
- Lesson: `[2026-05-24] Sonar "Coverage on New Code" counts conditions ...`.

## Mounting, view switching & mobile

- **Toggle placement** — the `Plan | Timeline` `ToggleGroup` renders in the
  planner header row, inside the **loaded** branch of `ShiftPlannerTab` (after the
  skeleton/error/empty-employees early returns at lines 494–530), so it never
  competes with loading states. Day nav / week nav in `PlannerHeader` is shared by
  both modes.
- **What Timeline replaces** — in Timeline mode the planner's editing tree
  (`DndContext`, `EmployeeSidebar`, `TemplateGrid`, `StaffingOverlay`,
  `AssignmentPopover`) is **not mounted**; the timeline region renders in its
  place. This avoids double focus-traps/portals and the DnD sensors running under
  a read-only view.
- **Mobile** — single column. The plot region (curve + axis + lanes) lives in one
  horizontally-scrollable container of width `max(100%, span × minPxPerHour)` so
  the axis, curve, and bars stay aligned under a shared scroll; lane labels are
  `position: sticky; left: 0`. The coverage curve pins above the lanes and shares
  the same horizontal scroll. The planner's add-shift FAB (`bottom-20`) is hidden
  in Timeline mode (nothing to add in a read-only view); any residual overlay is
  z-indexed below the timeline content. Verified target: iPhone SE (375×667).

## States & accessibility

- **Loading** — skeleton bands (mirrors the planner's loading treatment).
- **Error** — inline error message, no crash.
- **Empty** — no shifts on the selected day → "No shifts scheduled — switch to
  Plan to add coverage."
- **Bars** — `<button>` with comma-separated `aria-label` for reliable screen-reader
  pronunciation: `"Carolina Sanchez, Front counter, 10:00 AM to 4:00 PM, 6 hours"`
  (the visible label may use an interpunct; the `aria-label` does not). Keyboard
  focusable; Enter/click sets the active shift → opens `TimelineShiftPopover`.
- **Coverage curve** — `role="img"` + `<title>`/`<desc>` summarizing peak coverage
  and understaffed count. `CoverageGapList` renders each gap's start–end time as a
  visible + screen-reader list below the curve, so the understaffed windows are
  actionable without reading color (WCAG 1.4.1).
- **Styling** — semantic tokens for chrome; bar colors reuse `getPositionColors`.
- **Group-by control** — shadcn `ToggleGroup type="single"` (handles `aria` +
  arrow-key nav). Options: **Area** and **Position** only (`'none'` excluded — a
  flat single band defeats the station-shape purpose).

## Performance

A day has tens of shifts → no virtualization. The SVG curve is one path pair.
`useTimelineModel` is memoized on `(shifts, employees, selectedDay, groupBy, tz,
dayRecommendations)`; `now` is **not** a dependency. `NowIndicator` owns a local
`useState<Date>` updated by a `setInterval(60_000)` in its own `useEffect`, so the
60 s repaint is scoped to that one small component and never busts the model memo
or re-renders the lanes (per `[2026-06-19]` render-synced-tick lesson).
`dayRecommendations` resolving from `null`→data causes one extra model recompute on
mount — expected, not an error state. No new manual caching; any staffing query is
React Query with `staleTime ≤ 60s` per CLAUDE.md.

## Testing

| Layer | Location | Covers |
|---|---|---|
| `computeDayCoverage` + `isoToLocalMinutes` export | `tests/unit/shiftCoverage.dayCoverage.test.ts` | whole-day sweep, TZ portability (UTC + Tokyo), overnight |
| `getPositionColors` extraction | `tests/unit/positionColors.test.ts` | known positions, default fallback (parity with prior chip behavior) |
| `useTimelineModel` | `tests/unit/useTimelineModel.test.ts` | window derivation, area+position grouping, overnight, overlap-stacking, coverage sampling, demand expansion (hourly→15-min), demand-null path, gap detection, TZ portability |
| Bar a11y / label | `tests/unit/timelineBarLabel.test.ts` | comma-separated `aria-label` across branches (single fixture, multiple flags) |
| Component render | optional (CLAUDE.md UI tests optional) | three-state smoke |

No DB / edge-function / migration changes — pure frontend over existing data.
(Supabase design review not applicable.)

## Reuse map (corrected against source)

| Need | Existing source | Access |
|---|---|---|
| Net shift hours | `scheduleRoster.ts` `calculateShiftHours` | exported ✓ |
| UTC→local **minutes** | `shiftCoverage.ts` `isoToLocalMinutes` | **export in refactor #1** |
| Whole-day coverage | `shiftCoverage.ts` | **add `computeDayCoverage` in refactor #1** |
| Overlap / duration | `shiftInterval.ts` `ShiftInterval` | exported ✓ |
| Shift[] grouping + sentinel | `scheduleRoster.ts` `buildRosterDay`, `UNASSIGNED_LABEL` | exported ✓ |
| Group mode type | `scheduleGrouping.ts` `GroupByMode` | exported ✓ (type only) |
| Position colors | `EmployeeChip.tsx` `POSITION_COLORS` | **extract to `positionColors.ts` in refactor #2** |
| Demand / staffing recs | `useStaffingSuggestions.ts` `computeStaffingSuggestions`; `useStaffingSettings` | via **extracted `useWeekStaffingSuggestions` (refactor #3)** |
| Shift/week data | `useShiftPlanner.ts` | exported ✓ |
| Compact time labels | `shiftCoverage.ts` `minutesToCompact` / `openShiftHelpers.ts` `formatCompactTime` | exported ✓ |

## Decided trade-offs

- **Week heatmap deferred to a second PR** — keeps this PR's diff and CI loop small.
- **Read-only v1** — no planner deep-link; a bar opens a read-only detail popover
  (`TimelineShiftPopover`; no pre-existing shift-detail component exists, so this
  is new but minimal, single-instance).
- **Demand degrades to absent** — no fabricated target when staffing isn't
  configured (mirrors the `[2026-05-03]` allow-list discipline).
- **Gap boundaries snap to 15 min** — demand is hourly-resolution; finer gap edges
  would be false precision.
- **`POSITION_COLORS` keeps Tailwind-palette classes + manual `dark:` variants** —
  reused verbatim from the existing chip (an established codebase pattern, not a
  new violation). Called out here so Phase 7a doesn't re-flag; migrating to CSS
  variables is out of scope for this PR.

## Phase 2.5 design-review resolutions

| Concern (severity) | Resolution |
|---|---|
| `formatLocalTime` is host-TZ (critical) | Switched to `isoToLocalMinutes` (date-fns-tz); refactor #1 exports it. |
| `scheduleGrouping` groups employees not shifts (critical) | Grouping now via `buildRosterDay` (Shift[]). |
| Demand is hour-keyed, not minute (major) | Model expands hourly recs to a 15-min step grid; gaps snap to 15 min. |
| Demand not accessible from UI components (major) | Refactor #3 extracts `useWeekStaffingSuggestions`; Timeline reads the day slice. |
| `computeSlotCoverage` is slot-scoped (major) | Refactor #1 adds `computeDayCoverage`. |
| `POSITION_COLORS` not exported (major) | Refactor #2 extracts to `positionColors.ts`. |
| Toggle mount / DnD interaction unspecified (major) | "Mounting, view switching & mobile" section: toggle in loaded branch; editing tree unmounted in Timeline mode. |
| Now-line re-render storm (major) | `NowIndicator` owns a scoped `useState`+`useEffect` tick; `now` not a model dep. |
| Gap text alternative location (major) | `CoverageGapList` — visible + SR list of gap times below the curve. |
| Mobile unspecified (major) | Mobile subsection: single-column, horizontally-scrollable aligned plot, sticky lane labels, FAB hidden. |
| Use `ToggleGroup` (minor) | Adopted for both view toggle and group-by. |
| Interpunct in `aria-label` (minor) | `aria-label` uses commas; visible label may keep `·`. |
| Name the shift-detail component (minor) | `TimelineShiftPopover` (new, minimal, single-instance). |
| `'none'` group option (minor) | Excluded from the toggle; documented. |
| `staleTime` on new queries (minor) | Any staffing query inherits/sets `staleTime ≤ 60s`. |
| Memo double-compute on demand null→data (minor) | Documented as expected. |
