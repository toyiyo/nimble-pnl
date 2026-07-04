# Design: Timeline coverage panel redesign (are we meeting demand?)

**Date:** 2026-07-02
**Branch:** `feature/timeline-coverage-redesign` (stacked on `worktree-schedule-timeline-view` / PR #561)
**Status:** Approved via interactive mock → design

## Problem

The Timeline's top chart (`CoverageCurve`) is not intuitive. User feedback:
"I am currently not understanding the drawings on the top chart." It renders a
faint filled area (scheduled headcount), a gray dashed step line (demand), and a
10%-opacity full-height red rectangle behind gaps — with **no legend, no numbers,
no y-axis, and no plain-language verdict**. It also uses
`preserveAspectRatio="none"`, which stretches the chart and distorts every slope.

To answer the one question a manager actually asks — **"am I meeting demand?"** —
they currently have to decode whether one abstract shape sits above another.

## Goal

Make "are we covered?" readable in under a second, by (1) leading with a sentence,
(2) making the **shortfall itself** the loudest mark, and (3) adding the numbers,
legend, and axis that let the chart be decoded at all. Approved via the mock.

## Approach (all confirmed in the mock)

A single source of truth — a pure **hourly** summary — feeds a verdict line, a
chart with two toggleable views, and a per-hour status strip.

### 1. Hourly summary (pure logic, `src/lib/coverageSummary.ts`)

Demand is only hourly-resolution (expanded from `HourlyStaffingRecommendation`),
so the panel aggregates to hours for a clean, honest comparison.

```
summarizeCoverageHours(coverage, demand, window) → CoverageHour[]
  CoverageHour = { hour, startMin, scheduled, needed, delta }   // delta = scheduled - needed
```
- `scheduled` per hour = **min** of the 15-min coverage samples in that hour
  (conservative: if you dip below `needed` at any point in the hour, you're short).
- `needed` per hour = the hourly demand target (constant across the hour).
- When `demand` is null → `needed`/`delta` are null; the panel shows scheduled only.

```
buildVerdict(hours) → { shortHours, metAll, worst: { hour, delta } | null }
```

Both functions are pure and fully unit-tested (measured in `src/lib`).

### 2. Plain-language verdict (`CoverageVerdict.tsx`)

Above the chart: a status dot + sentence.
- Short: red dot — "Short-staffed 5 of 14 hours today" + subline "Biggest gap: 5 PM —
  3 scheduled, 5 needed (short 2)."
- Covered: green dot — "Meeting demand all day."
- No demand configured: neutral dot — "Add staffing targets to see demand."

### 3. Chart with two views (`CoverageChart.tsx`, replaces `CoverageCurve.tsx`)

Real `viewBox` with true proportions (**drop `preserveAspectRatio="none"`**),
y-axis gridlines + numeric labels (0…peak), and a legend (Scheduled · Needed · Short).

- **Area view (default):** scheduled = filled step area (primary/teal) + solid top
  line; needed = dashed step line, direct-labeled "Needed" at its right end;
  **shortfall = red wedge filled *between* scheduled and needed** for each hour where
  `scheduled < needed` (the wedge height literally = people short). The worst hour is
  labeled with its deficit (e.g. `-2`). This replaces the old full-height gap rects.
- **+/− bars view (toggle):** one diverging bar per hour = `delta` from a zero
  baseline; below zero = short (red), at/above zero = covered (teal/green), each
  labeled with its signed number.

A small segmented toggle (`Chart | +/− bars`) switches views (local state).

### 4. Per-hour status strip (`CoverageStatusStrip.tsx`)

A row of one cell per hour, colored green (covered) / red (short), each labeled with
the hour. This is the ultra-glanceable companion and the **color-is-not-the-only-cue**
accessibility alternative — it carries an `aria-label` per cell ("5 PM, short 2") and
a summarizing list, so it **replaces `CoverageGapList`** (folded in).

### 5. Wire-up (`ShiftTimelineTab.tsx`)

Replace the current `CoverageCurve` + `CoverageGapList` block with:
`CoverageVerdict` → view toggle → `CoverageChart` (aligned to the 120px lane column
as today) → `CoverageStatusStrip`. All fed from the one `summarizeCoverageHours`
result, memoized alongside the existing timeline model.

## Non-goals

- No change to `useTimelineModel`/`computeDayCoverage`/demand sourcing — this is a
  presentation change over the same data.
- No change to the gantt lanes/bars, now-line, or day/group controls.
- Amber "tight/exactly met" tier is out of scope; met-or-over reads as covered.

## Accessibility

- Chart: `role="img"` + `<title>`/`<desc>` summarizing the verdict.
- Status strip cells carry per-hour `aria-label`s; a visually-hidden list enumerates
  short windows (preserving the old `CoverageGapList` guarantee that meaning is never
  color-only).
- Colors via semantic tokens / the data-viz status ramp; text on colored fills uses
  the same-family dark stop (no plain black/gray).

## Testing

| Layer | Location | Covers |
|---|---|---|
| `summarizeCoverageHours` | `tests/unit/coverageSummary.test.ts` | hourly min aggregation, needed alignment, delta, demand-null path, TZ-portable via passed samples |
| `buildVerdict` | same | shortHours count, metAll, worst-hour selection, no-demand |
| Chart / strip render | `tests/unit/coverageChart.test.tsx` (optional per CLAUDE.md) | legend present, shortfall marks rendered, view toggle, aria |

## Decided trade-offs

- **Hourly aggregation** (not 15-min) for the whole panel — matches demand
  resolution, makes the red wedge exact, and reads cleaner. Documented.
- **`scheduled` = per-hour min** — conservative "covered throughout the hour"
  semantics; a mid-hour dip below target counts as short.
- **Folds `CoverageGapList` into the status strip** — one gap surface, not two.
