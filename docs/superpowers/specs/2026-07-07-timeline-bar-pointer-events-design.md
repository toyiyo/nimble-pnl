# Design: Fix Timeline shift bars that can't be hovered/edited when they share a row

**Date:** 2026-07-07
**Branch:** `fix/timeline-bar-pointer-events`
**Type:** Bug fix (rendering / pointer events)

## Problem

In the Timeline view (Planner → Timeline), some shift bars cannot be
edited: hovering shows no grab cursor and clicks/drags do nothing. Reported
concretely for two employees at one franchise location (details verified
in the production DB; omitted here — no PII in the repo).

### What it is NOT

The initial hypothesis was that the shifts were `locked` (published). This
was **disproven via the production DB**: every shift for both employees in
the affected week is `is_published: false, locked: false`. The schedule is
unpublished; nothing in the data model blocks editing.

Telemetry was inconclusive: `$dead_click` is not instrumented in this
project, and recent `$rageclick`s on the scheduling page landed on the
staffing suggestions toggle and week-nav arrows, not the bars. (Follow-up:
consider enabling dead-click autocapture — it is the exact signal for this
class of bug.)

## Root cause

`TimelineLane` renders each bar inside a **full-width** wrapper:

```tsx
// src/components/scheduling/ShiftTimeline/TimelineLane.tsx
<div className="absolute left-0 right-0" style={{ top: bar.row * ROW_HEIGHT_PX, height: ROW_HEIGHT_PX }}>
  <TimelineBar ... />   // inner rect is absolutely positioned via left%/width%
</div>
```

The wrapper spans the **entire lane width** at its row's vertical band, and
(default `pointer-events: auto`) captures pointer events across that whole
band — even though it is visually empty except for the narrow inner bar rect.

When two shifts share a row (the first-fit `assignRows` packer places a
later-starting, non-overlapping shift on the same row), the **later-rendered
bar's full-width wrapper paints on top of the earlier bar's rect** and
swallows all hover/click/drag over it. The earlier bar becomes inert.

The production data confirms the two affected bars are each the *earlier*
bar in a shared row — an abutting later shift lands on the same row:

| Inert bar | Shares row with | Relationship |
|---|---|---|
| Bar A 10:00–16:00 | Bar B 16:00–22:30 | abut → same row; B's wrapper covers A |
| Bar A 10:00–14:00 | Bar B 14:00–21:30 | same row; B's wrapper covers A |

This is a **pre-existing rendering bug** in the #587 timeline; it only became
user-visible once bars became interactive (edit/drag).

## Fix

Scope pointer capture to the actual bar rectangle instead of the full-width
wrapper. Two class changes, no JS / geometry / layout change:

1. **`TimelineLane.tsx`** — full-width bar wrapper gains `pointer-events-none`
   so the empty band no longer intercepts events.
2. **`TimelineBar.tsx`** — the positioned bar rect (`absolute inset-y-0.5`,
   scoped by `left%`/`width%`) gains `pointer-events-auto` so the real bar
   still receives hover/click/drag.

### Why this is correct and complete

- Only the bar's real rect (its `left`/`width` extent) captures events →
  sibling bars on the same row no longer overlap in the hit-test region.
- Empty row space now falls through `pointer-events-none` to the lane plot's
  own `onPointerDown` handlers — which is the **desired** behavior (paint-to-
  create a new shift on empty space).
- Resize handles and the drag-readout live *inside* the bar rect, so they
  inherit `pointer-events-auto` (the readout keeps its own explicit
  `pointer-events-none`). Keyboard activation is unaffected.

### Alternatives considered

- **Give each wrapper the bar's `left`/`width` instead of full-width.** Also
  works, but duplicates geometry already computed inside `TimelineBar` and
  risks drift with the drag-draft offsets. Rejected as more invasive.
- **z-index juggling.** Doesn't fix the root cause — a higher bar still
  captures events over its full width. Rejected.

## Test plan

jsdom has no layout/hit-testing, so a literal "the click lands on the right
bar" test is not possible. Assert the **structural invariant** that prevents
the bug instead:

- Render a lane with two abutting bars on the same row.
- Assert every full-width bar wrapper has `pointer-events-none`.
- Assert every bar rect has `pointer-events-auto`.

Removing either class (regressing the bug) fails the test. Existing
paint-layer and bar-drag tests guard that empty-space paint and bar
interaction still work.

## Scope / risk

- Files: `TimelineLane.tsx`, `TimelineBar.tsx` (2 className edits) + 1 new
  test file. Both components are under `src/components/**` (coverage-excluded
  in vitest + Sonar), so no new-code-coverage regression.
- No DB, RLS, edge-function, or API surface touched → Supabase design review
  N/A. Frontend surface is a pure pointer-events class change.
- **Privacy:** no employee names, restaurant names, or other PII are recorded
  in this doc, the plan, the tests, or commit messages — fixtures use
  fictional names.
