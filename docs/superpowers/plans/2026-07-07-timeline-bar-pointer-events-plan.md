# Plan: Timeline bar pointer-event theft fix

Design: `docs/superpowers/specs/2026-07-07-timeline-bar-pointer-events-design.md`

## Tasks

### T1 — RED: structural regression test (new file)
`tests/unit/timelineLanePointerEvents.test.tsx`
- Render `TimelineLane` with two abutting bars on the same `row` (0):
  bar A 10:00–14:00, bar B 14:00–21:30 (fictional fixture names), B rendered
  after A.
- Assert each full-width bar wrapper carries `pointer-events-none`.
- Assert each bar rect (button's positioned parent) carries `pointer-events-auto`.
- Run against unfixed code → expect FAIL (wrapper lacks the class).
Depends on: none.

### T2 — GREEN: scope pointer capture
- `TimelineLane.tsx`: add `pointer-events-none` to the `absolute left-0 right-0`
  bar wrapper.
- `TimelineBar.tsx`: add `pointer-events-auto` to the `absolute inset-y-0.5`
  bar rect.
- Re-run T1 → GREEN.
Depends on: T1.

### T3 — Regression guard: existing suites stay green
- Run `timelineLanePaint.test.tsx` (empty-space paint still works — wrapper
  none must not block the plot handlers) and `timelineBarDrag.test.tsx`
  (bar interaction still works — rect auto).
Depends on: T2.

## Verify (Phase 8)
`npm run test` (timeline suites) · `npm run typecheck` · `npm run lint` ·
`npm run build`.

## Out of scope
- `buildLanes` dropping inactive-employee shifts (separate latent bug).
- PostHog dead-click instrumentation (noted as follow-up, not code here).
