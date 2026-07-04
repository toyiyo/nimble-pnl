# Design: Coverage chart — grid alignment, hover insight, and #569 recovery

**Date:** 2026-07-03
**Branch:** `worktree-timeline-chart-fixes`
**Status:** Fix-forward of twice-approved mock designs + recovery of lost merged work

## Problem (live user feedback on main)

1. **PR #569 never reached `main`.** It merged into its stale base branch
   (`feature/timeline-coverage-redesign`) after #566 had already squash-merged —
   GitHub does not retarget a stacked PR unless the base branch is deleted first.
   The branch was then deleted in cleanup. Result: the demand explainer
   (`CoverageDemandInfo`), per-area strips (`AreaCoverageStrips`), and
   `have/needed` cells are missing from the app. **Recovered in this branch** via
   merge of the surviving commit `314f276c` (verified: main was byte-identical to
   the 569 base for every conflicted file; 46 recovered tests pass).
2. **The chart renders narrow.** `CoverageChart` draws into a fixed
   `viewBox="0 0 400 h"` SVG with `w-full`; default `preserveAspectRatio`
   letterboxes the 400-unit drawing in the center of the wide, horizontally-
   scrollable plot. It does not line up with the hour grid the lanes/axis use.
3. **Hover tells you nothing.** The chart has no interactivity, and
   `summarizeCoverageHours` discards everything except headcount — even though
   `HourlyStaffingRecommendation` carries `projectedSales`, `estimatedLaborCost`,
   `laborPct`, and settings carry `target_splh`. A user cannot learn what the
   graph is *about* from the screen.

## Approach

### A. Rebuild `CoverageChart` as positioned HTML columns (kills #2, enables #3)

Drop the fixed-viewBox SVG. A step chart is made entirely of horizontal
segments, so per-hour absolutely-positioned divs reproduce it exactly — the same
technique `TimelineBar`/`TimelineAxis` already use:

- The chart root is `relative`, full width of the scrollable plot (which already
  has `minWidth: max(100%, spanHours × MIN_PX_PER_HOUR)`), inside the existing
  `pl-[120px]` gutter.
- Each hour column is positioned with the **shared `minToPct`** scale:
  `left = minToPct(h.startMin)%`, `width = minToPct(h.startMin+60) − minToPct(h.startMin)%`.
  Columns therefore sit exactly under their axis ticks and over their shifts —
  at every viewport width, including horizontal scroll.
- **Area view** per column: a bottom-anchored scheduled block
  (`bg-primary/15` + `border-t border-primary` top edge, height
  `scheduled/peak × 100%`), a dashed "needed" tick (`border-t border-dashed
  border-muted-foreground` positioned at `needed/peak`), and when short, a red
  block (`bg-destructive/70`) filling between scheduled and needed heights.
- **Delta (+/−) view** per column: a diverging bar from a mid-height zero line —
  `bg-success` above for surplus, `bg-destructive` below for short, `delta`
  number label; no-demand hours show a neutral `bg-muted` scheduled bar scaled
  by headcount peak (preserves the #566 review fix).
- A slim y-gutter (absolute, left-aligned inside the 120px label column) renders
  the 0…peak (or −n…+n) reference numbers so values are readable without hover.
- Chart region keeps `role="img"` + an `aria-label` summarizing the verdict;
  each column is a focusable element (see C).

`CoverageChart.tsx` is replaced; `CoverageChartColumn` stays internal. The
existing tests asserting shortfall marks / delta bars / no-demand scaling are
updated from SVG selectors to `data-*` selectors — same behavioral contracts.

### B. Thread sales/SPLH context into the model (enables #3)

- `summarizeCoverageHours` gains an optional `recs?: HourlyStaffingRecommendation[]`
  parameter; `CoverageHour` gains `projectedSales: number | null` and
  `laborPct: number | null` (null when no recommendation for that hour).
  Backward compatible — existing callers unchanged.
- `ShiftTimelineTab` already holds `dayRecommendations`; pass them through. Also
  destructure `activeSettings` from `useWeekStaffingSuggestions` and pass
  `targetSplh: activeSettings.target_splh ?? null` to the chart.

### C. Per-hour hover/focus tooltip (fixes #3)

Single shadcn `Tooltip` per column (they mount lazily on hover — cheap), or one
shared tooltip driven by `hoveredHour` state; use shadcn `Tooltip` for built-in
keyboard/focus behavior. Trigger = the hour column (`tabIndex=0`,
`role="img"`, `aria-label` = the same sentence as the tooltip). Content, in the
CLAUDE.md type scale:

```
5–6 PM
3 scheduled · 5 needed        ← have vs needed, the verdict for the hour
Projected sales $480          ← the WHY (only when recs exist)
÷ $95/labor-hr target ≈ 5     ← the math that produced "needed"
Short 2 — add staff           ← action (or "Covered · +1 spare")
```

When demand/recs are absent: "4 scheduled · no demand target — set staffing
targets to see needed staff."

### D. Recovery of #569 (already done in this branch)

Merge commit `1c470b95` restores `CoverageDemandInfo` (explainer popover),
`AreaCoverageStrips`, `have/needed` strip cells, and their tests, mounted in
`ShiftTimelineTab`. No re-design — it shipped review-clean in #569.

## Non-goals

- Per-area demand targets (unchanged follow-up).
- Any change to `useTimelineModel`, lanes, axis, or the demand math itself.

## Accessibility

- Columns: `tabIndex=0` + `aria-label` mirroring the tooltip sentence; tooltip
  opens on focus (shadcn default).
- Y-gutter values + the `have/needed` status strip remain the non-hover,
  non-color path to the same information.
- Delta/short encodings remain paired with numeric labels (not color-only).

## Testing

| Layer | File | Covers |
|---|---|---|
| `summarizeCoverageHours` + recs | `tests/unit/coverageSummary.test.ts` (extend) | `projectedSales`/`laborPct` threading, null when absent (CRITICAL-prefixed) |
| Chart columns | `tests/unit/coverageChart.test.tsx` (rewrite selectors) | per-hour column count, shortfall block presence, delta bars, no-demand scaling, aria-labels |
| Tooltip content | `tests/unit/coverageChart.test.tsx` | focus a column → tooltip shows scheduled/needed/sales/SPLH sentence; no-demand variant |
| Recovery intact | existing recovered suites | explainer, area strips, have/needed (already passing) |

## Retrospective note (lesson to record)

Stacked-PR loss: a child PR merged into a stale base is silently diverted off
`main`; "MERGED" ≠ "on main". Rule: after merging any stacked parent, immediately
retarget the child (`gh pr edit N --base main`) and, before deleting any branch,
verify `git branch --contains` / PR base. Verify features on `main` post-merge.
