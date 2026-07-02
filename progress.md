# Progress: Schedule Timeline view

## Spec
docs/superpowers/specs/2026-07-01-schedule-timeline-view-design.md

## Plan
docs/superpowers/plans/2026-07-01-schedule-timeline-view.md

## Current Phase
Phase 4-9: Autonomous dev-build-and-ship workflow — in progress

## Completed Tasks

### Task 1: Extract POSITION_COLORS to shared positionColors module
- Commit: `58ff2ed4`
- Created: `src/lib/positionColors.ts` (exports `PositionColors`, `POSITION_COLORS`, `DEFAULT_POSITION_COLORS`, `getPositionColors`)
- Updated: `src/components/scheduling/ShiftPlanner/EmployeeChip.tsx` (removed local constants, imports `getPositionColors`)
- Test: `tests/unit/positionColors.test.ts` (3 tests, all pass)

### Task 2: Export isoToLocalMinutes + add computeDayCoverage
- Commit: `8e214663`
- Modified: `src/lib/shiftCoverage.ts` (added `export` to `isoToLocalMinutes`; appended `DayCoverageSample` interface and `computeDayCoverage` function)
- Test: `tests/unit/shiftCoverage.dayCoverage.test.ts` (4 tests, all pass under TZ=UTC and TZ=Asia/Tokyo)

### Task 3: Extract useWeekStaffingSuggestions into its own hook
- Commit: `995e64d9`
- Created: `src/hooks/useWeekStaffingSuggestions.ts` (exports `useWeekStaffingSuggestions`, `WeekStaffingSuggestions` type, `StaffingSuggestionsResult`)
- Updated: `src/components/scheduling/ShiftPlanner/StaffingOverlay.tsx` (removed local fn, imports from new hook)
- Test: behavior-preserving move; 13 existing StaffingOverlay tests pass; typecheck clean

### Task 4: useTimelineModel.ts with types + deriveWindow (window derivation + test)
- Commit: `0eb9e2c4`
- Created: `src/components/scheduling/ShiftTimeline/useTimelineModel.ts` (exports `TimelineWindow`, `TimelineBar`, `TimelineLane`, `TimelineGap`, `TimelineModel` interfaces and `deriveWindow` function)
- Test: `tests/unit/useTimelineModel.test.ts` (3 tests, pass under TZ=UTC and TZ=Asia/Tokyo)

### Task 5: Add buildLanes to useTimelineModel — grouping + overlap row-stacking
- Commit: `f642fa27`
- Modified: `src/components/scheduling/ShiftTimeline/useTimelineModel.ts` (added `buildLanes` export + `assignRows` helper; new imports: `minutesToCompact`, `getPositionColors`, `calculateShiftHours`, `UNASSIGNED_LABEL`, `GroupByMode`, `Employee`)
- Modified: `tests/unit/useTimelineModel.test.ts` (added `buildLanes` import, `emp` factory, and 3 new `buildLanes` tests)
- Test: 6 tests pass under TZ=UTC and TZ=Asia/Tokyo; typecheck clean
- Design note: implemented grouping/stacking without delegating to `buildRosterDay` to avoid host-TZ issues from its `isSameDay` date filter

### Task 6: Add expandDemand, computeGaps, and useTimelineModel hook
- Commit: `f8d2f037`
- Modified: `src/components/scheduling/ShiftTimeline/useTimelineModel.ts` (added `expandDemand`, `computeGaps`, and `useTimelineModel` hook exports; added imports for `useMemo`, `computeDayCoverage`, `HourlyStaffingRecommendation`)
- Modified: `tests/unit/useTimelineModel.test.ts` (added `expandDemand` and `computeGaps` imports, `rec` factory, and 4 new tests for `expandDemand` and `computeGaps`)
- Test: 10 tests pass under TZ=UTC and TZ=Asia/Tokyo; typecheck clean
- Note: `computeGaps` endMin semantics — the last under-staffed sample's minute value (not the next non-short sample)

### Task 7: Create TimelineAxis, CoverageCurve (SVG), and CoverageGapList presentational components (+ gap list test)
- Commit: `89c5f503`
- Created: `src/components/scheduling/ShiftTimeline/TimelineAxis.tsx` (hourly tick lines + labels across derived window, aria-hidden, uses `minutesToCompact`)
- Created: `src/components/scheduling/ShiftTimeline/CoverageCurve.tsx` (SVG area chart: coverage area path + dashed demand step-line + destructive/10 gap rects; `role="img"` + `<title>`/`<desc>`; all colors via semantic tokens)
- Created: `src/components/scheduling/ShiftTimeline/CoverageGapList.tsx` (accessible `<ul aria-label="Understaffed windows">` with red dot + time range per gap; returns null when empty)
- Test: `tests/unit/coverageGapList.test.tsx` (2 tests: lists gap text including "10a", renders nothing with empty gaps; passes TZ=UTC and TZ=Asia/Tokyo)
- TDD: RED (module-not-found) → GREEN (2/2 pass) → REFACTOR (no changes needed) → COMMIT

### Task 8: Create TimelineBar, TimelineLane, TimelineShiftPopover, and NowIndicator components
- Commit: `8f65b15b`
- Created: `src/components/scheduling/ShiftTimeline/TimelineBar.tsx` (focusable `<button>`, position color classes, truncated label, comma-separated `aria-label`)
- Created: `src/components/scheduling/ShiftTimeline/TimelineLane.tsx` (sticky-left label column with shift count + hours, relative plot region with stacked bar rows at `top: row × 28px`)
- Created: `src/components/scheduling/ShiftTimeline/TimelineShiftPopover.tsx` (single read-only shadcn `Popover` instance controlled by `activeShift` state; shows position, time range, hours, status)
- Created: `src/components/scheduling/ShiftTimeline/NowIndicator.tsx` (scoped 60 s `setInterval` tick; hides outside the visible window)
- Test: `tests/unit/timelineBarLabel.test.tsx` (4 tests: aria-label, click→onSelect, label text, color classes; all pass)
- TDD: RED (module-not-found) → GREEN (4/4 pass) → typecheck clean → lint clean (no new errors) → COMMIT

### Task 9: ShiftTimelineTab container (day selector, group-by toggle, states, layout)
- Commit: `d1fdc2d1`
- Created: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`
  - Props: `{ shifts, employees, weekDays, restaurantId, tz, loading, error }`
  - Local state: `selectedDay` (default today-in-week or `weekDays[0]`), `groupBy: 'area' | 'position'`, `activeShift: Shift | null`
  - Calls `useWeekStaffingSuggestions(restaurantId, weekDays, null)` and slices the selected day's `HourlyStaffingRecommendation[]`
  - Calls `useTimelineModel` (pure transform) → `window / lanes / coverage / demand / gaps`
  - Three-state rendering: `loading` → skeleton bands; `error` → inline message; `lanes.length === 0` → empty "No shifts scheduled" state
  - Full data layout: day selector buttons row + `ToggleGroup type="single"` (Area/Position), then horizontally-scrollable plot at `min-width: max(100%, span×80px)` containing `CoverageCurve` + `TimelineAxis` + `TimelineLane[]` with `NowIndicator` overlay, then `CoverageGapList` and single `TimelineShiftPopover` instance
- Test: `tests/unit/shiftTimelineTab.test.tsx` (6 tests: day selector, group-by toggle, empty/loading/error/data states; TZ-portable UTC+Asia/Tokyo)
- TDD: RED (module-not-found) → GREEN (6/6 pass) → typecheck clean → lint clean (no new errors) → COMMIT

### Task 10: Wire Plan|Timeline ToggleGroup into ShiftPlannerTab — mount/unmount editing tree, hide FAB
- Commit: `cc5ad8f7`
- Modified: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`
  - Added `ToggleGroup` + `ToggleGroupItem` import from `@/components/ui/toggle-group`
  - Added `ShiftTimelineTab` import from `../ShiftTimeline/ShiftTimelineTab`
  - Added `view: 'plan' | 'timeline'` state (defaults to `'plan'`)
  - Rendered `Plan | Timeline` ToggleGroup in a shared div below `PlannerHeader`
  - Branched body: `view === 'timeline'` mounts `<ShiftTimelineTab>` only; `view === 'plan'` mounts the full `DndContext` / `EmployeeSidebar` / `TemplateGrid` / `StaffingOverlay` editing tree — each in a separate `{view === ... && ...}` conditional so the editing tree is not mounted in Timeline mode
  - Mobile add-shift FAB (`Show team members` button) is inside the `view === 'plan'` branch so it is hidden in Timeline mode
- Test: `tests/unit/shiftPlannerTab.viewToggle.test.tsx` (6 tests: toggle renders, defaults to plan, switching to timeline, editing tree hidden in timeline, mobile FAB hidden, switching back; all pass)
- TDD: RED (module renders but toggle absent) → GREEN (6/6 pass) → REFACTOR (none needed) → typecheck clean → lint clean (no new errors) → build clean → COMMIT

### Task 11: Mobile layout pass — sticky lane labels, shared horizontal scroll, full verification
- Commit: `6345a1b6`
- Test file: `tests/unit/shiftTimelineTab.mobileLayout.test.tsx` (3 tests, all pass under TZ=UTC and TZ=Asia/Tokyo)
  - Lane label has `sticky left-0 z-10` — stays pinned during horizontal scroll
  - Coverage curve (`role="img"`) and sticky lane label share the same `overflow-x-auto` scroll container
  - Lane label has `z-10` — renders above bars during horizontal scroll
- Layout was already correct from Task 9 (sticky labels in TimelineLane.tsx; plot in single overflow-x-auto in ShiftTimelineTab.tsx); tests confirmed and documented
- Full verification:
  - `npm run typecheck` — clean (no errors)
  - Lint of feature files — clean (no new errors in ShiftTimeline/, positionColors.ts, useWeekStaffingSuggestions.ts, ShiftPlannerTab.tsx)
  - `TZ=UTC npm run test` — 388 test files pass, 1 skipped (pre-existing), 5124 tests pass
  - `npm run build` — successful in 18.74s (chunk size warning is pre-existing)

### Phase 5: UI Review
- Commit: `ac5c758d`
- Reviewed all changed UI/component files (ShiftTimeline/, EmployeeChip.tsx, StaffingOverlay.tsx, ShiftPlannerTab.tsx) against CLAUDE.md Apple/Notion guidelines
- Typography scale: all compliant (`text-[11px]`–`text-[15px]`)
- Semantic tokens: all compliant; blue/amber colors in StaffingOverlay pre-exist the branch (no new violations)
- Three-state rendering: loading/error/empty/data all handled in ShiftTimelineTab
- Accessibility fixes applied:
  - `ToggleGroup` for groupBy in ShiftTimelineTab → `aria-label="Group shifts by"`
  - Day-selector wrapper in ShiftTimelineTab → `role="group" aria-label="Select day"`
  - `ToggleGroup` for view in ShiftPlannerTab → `aria-label="Schedule view"`
- TypeScript typecheck: clean after fixes

### Phase 6: Simplify
- Commit: `4e175fd1`
- Ran 4 cleanup review angles (reuse, simplification, efficiency, altitude)
- Fixes applied:
  - `TimelineShiftPopover`: merged two separate `shiftCoverage` import lines into one; removed never-used `trigger?: React.ReactNode` prop
  - `TimelineBar`: removed dead `window: TimelineWindow` prop (and its import) — `minToPct` already encodes the window geometry
  - `TimelineLane`: stopped threading `window` through to `TimelineBar`
  - `ShiftTimelineTab`: replaced `handleShiftSelect = useCallback((shift) => setActiveShift(shift), [])` with direct `setActiveShift` (stable React setter)
  - `CoverageCurve`: removed unreachable inner `coverage.length === 0` guard inside the `coveragePath` IIFE (outer early-return already handles it)
- Skipped: `todayStr()` in ShiftTimelineTab intentionally uses host-TZ (not restaurant TZ) per the existing comment — matches planner header convention; no reuse opportunity
- All 38 timeline unit tests pass; typecheck clean

### Phase 7a: Codex adversarial review
- Output: `dev-tools/codex-review-output.md`
- Finding: severity=major in `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx` line 75
  - `filterToDay` uses `start_time.startsWith(dayStr)` which compares UTC ISO date prefix against the local `dayStr`. For restaurants behind UTC (e.g. America/Chicago), a shift starting at 22:00 local time is stored as the next UTC day, so it gets filtered out before `useTimelineModel` can apply `isoToLocalMinutes` — results in missing bars and false understaffing on the cross-midnight case.

### Phase 7b: Fold review findings
- Commit: `e2cf2ddf`
- Critical/major findings addressed (3 total):
  1. **filterToDay UTC prefix bug** (sound-logic + ocr-rules + codex — severity=major): replaced `start_time.startsWith(dayStr)` UTC prefix match with `isoToLocalMinutes`-based local-date check so late-evening shifts in timezones west of UTC are correctly attributed to their local calendar day. Added cross-midnight regression test to `shiftTimelineTab.test.tsx`.
  2. **CoverageGapList end time off-by-step** (sound-logic — severity=major): exported `STEP_MIN` from `useTimelineModel.ts` and added it to `g.endMin` in `CoverageGapList` so the text end time matches the SVG shading extent. Updated `coverageGapList.test.tsx` to verify the corrected time.
  3. **Dead `window` prop in timelineBarLabel tests** (ocr-rules — severity=major): removed dead prop from all four `TimelineBar` render calls and dropped the shadowed `const window` variable.
- Minor findings skipped (per instructions — CodeRabbit catches style/nits in 7c):
  - Performance: redundant `peakCount` map in CoverageCurve, `spanHours`/`plotMinWidth` not memoized
  - Maintainability: hardcoded loading/error props, import order, redundant wrapper div, unnecessary `handlePopoverClose` useCallback
  - No finding required design doc changes
- Verification: `TZ=UTC npx vitest run` — 5125 tests pass (388 files); typecheck clean

## CI Status
- PR: not yet created
- Iteration: 0/5
