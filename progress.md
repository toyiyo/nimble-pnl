# Timeline Chart Fixes — Progress

## Phase 4: Build (strict TDD)

### Task 1a — Add failing tests for projectedSales/laborPct in summarizeCoverageHours
- Status: DONE
- Commit: 7f758089
- Files changed:
  - `src/lib/coverageSummary.ts` — extended `CoverageHour` interface with `projectedSales: number | null` and `laborPct: number | null`; added optional `recs?: HourlyStaffingRecommendation[]` parameter to `summarizeCoverageHours`; built `recByHour` map inside the function body; enriched each `out.push` with rec data.
  - `tests/unit/coverageSummary.test.ts` — imported `HourlyStaffingRecommendation`; added `recFull` helper; added `summarizeCoverageHours — sales context` describe block with 2 CRITICAL tests.
- TDD cycle: RED (2 new tests fail, 11 pass) → GREEN (13 pass) → typecheck clean → commit
- Related suites confirmed green: coverageChart (12), areaCoverageStrips (6), coverageStatusStrip (8)

### Task 1c — Update existing CoverageHour fixtures and run/pass all coverage-related suites
- Status: DONE
- Commit: 94441676
- Files changed:
  - `tests/unit/coverageChart.test.tsx` — added `projectedSales: null, laborPct: null` to all CoverageHour object literals (top-level `hours`, `hoursNoDemand`, and inline `coveredHours`).
  - `tests/unit/areaCoverageStrips.test.tsx` — added `projectedSales: null, laborPct: null` to all CoverageHour object literals in `makeAreas()` and inline Unassigned test.
  - `tests/unit/coverageStatusStrip.test.tsx` — added `projectedSales: null, laborPct: null` to all CoverageHour object literals (top-level `hours`, and all inline fixtures).
- TDD cycle: fixtures updated → all 60 coverage-related tests pass → typecheck clean → commit
- Suites confirmed green: coverageSummary (13), coverageChart (12), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (16)

### Task 2b — Rewrite CoverageChart as absolutely-positioned HTML columns using minToPct prop (area + delta views)
- Status: DONE
- Commit: a8fc33ee
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageChart.tsx` — added `buildColumnAriaLabel` helper; imported shadcn `Tooltip`/`TooltipProvider`/`TooltipTrigger`/`TooltipContent`; added `ariaLabel` prop to `AreaColumn` and `DeltaColumn` (all three `data-hour-col` return paths); added `tabIndex={0}`, `aria-label`, and focus-visible ring styles on each column div; wrapped each column in `Tooltip`/`TooltipTrigger asChild`/`TooltipContent` (shell — content extended in task 3); wrapped chart root in `TooltipProvider`.
  - `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx` — destructured `activeSettings` from `useWeekStaffingSuggestions`; computed `targetSplh = activeSettings?.target_splh ?? null`; passed `dayRecommendations` as 4th arg to `summarizeCoverageHours`; passed `minToPct` and `targetSplh` props to `CoverageChart`.
  - `tests/unit/coverageChart.test.tsx` — added `CoverageChart — accessibility (tooltip shell)` describe block with 2 tests: `each hour column is keyboard-focusable (tabIndex=0)` and `each hour column has a descriptive aria-label`.
- TDD cycle: RED (2 new tests fail — tabIndex and aria-label not on columns) → GREEN (13 tests pass) → typecheck clean → commit
- Suites confirmed green: coverageSummary (13), coverageChart (13), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (16)

### Task 2a — Update CoverageChart tests for grid-aligned HTML column selectors (data-hour-col, data-shortfall, data-bar)
- Status: DONE
- Commit: ccb83054
- Files changed:
  - `tests/unit/coverageChart.test.tsx` — rewrote from SVG selectors to HTML `data-hour-col` / `data-shortfall` / `data-bar` attribute selectors; added `minToPct` prop (10:00-14:00 window) and `targetSplh` to all render calls; added `renders one positioned column per hour, aligned to minToPct` test checking `style.left` / `style.width`; added `scales no-demand bars by headcount peak` test checking `style.height` proportionality; removed SVG-only tests (title/desc elements); preserved all behavioral contracts (11 tests total).
  - `src/components/scheduling/ShiftTimeline/CoverageChart.tsx` — replaced fixed-viewBox SVG with per-hour absolutely-positioned HTML columns using `minToPct` scale; `AreaColumn` with bottom-anchored scheduled block + `data-shortfall` fill + dashed needed tick; `DeltaColumn` with `data-bar={short|covered|no-demand}` + `style.height` for proportional scaling; backward-compatible fallback `minToPct` for callers that don't yet pass it; `role="img"` + `aria-label` on container div.
- TDD cycle: RED (2 new tests fail — `[data-hour-col]` returns 0 elements, `style.height` is NaN for SVG bars) → GREEN (11 tests pass) → typecheck clean → commit
- Suites confirmed green: coverageSummary (13), coverageChart (11), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (16)

### Task 2c — Add shadcn Tooltip shell to each HourColumn (TooltipProvider at root, tabIndex + aria-label on columns)
- Status: DONE
- Commit: d02ea41c
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageChart.tsx` — converted `AreaColumn` and `DeltaColumn` from plain function components to `forwardRef` components so Radix UI's `Slot` (used by `TooltipTrigger asChild`) can wire the ref correctly and silence the "Function components cannot be given refs" React warning; added `ref={ref}` to all three root div paths in `DeltaColumn` (no-demand, zero, and short/covered branches); imported `forwardRef` from react.
  - `tests/unit/coverageChart.test.tsx` — added `beforeEach`/`afterEach` console.error spy; added `renders tooltip shell without React ref-forwarding warnings (area view)` and `renders tooltip shell without React ref-forwarding warnings (delta view)` tests to `CoverageChart — accessibility (tooltip shell)` describe block; imported `vi, beforeEach, afterEach` from vitest.
- TDD cycle: RED (1 new test fails — `console.error` spy detects forwardRef warning) → GREEN (15 tests pass, no warnings) → typecheck clean → commit
- Note: The `TooltipProvider`, `Tooltip`, `TooltipTrigger asChild`, `TooltipContent` shell was already placed in commit a8fc33ee; this task fixed the forwardRef regression that prevented correct Radix Slot wiring.
- Suites confirmed green: coverageSummary (13), coverageChart (15), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (16)

### Task 2d — Update ShiftTimelineTab call site: pass minToPct, targetSplh, and dayRecommendations into summarizeCoverageHours
- Status: DONE
- Commit: c4cd08e9
- Files changed:
  - `tests/unit/shiftTimelineTab.test.tsx` — refactored `vi.mock` to use a named `mockUseWeekStaffingSuggestions` fn variable so tests can override return values per-test; added `afterEach` import; added `ShiftTimelineTab — call-site wiring (Task 2d)` describe block with 3 tests: confirms hook is called with correct args, confirms columns render when recommendations exist, confirms `style.left` is set (minToPct wired).
- Context: The ShiftTimelineTab implementation was already complete (wired in commit a8fc33ee as part of task 2b, step 5 of the task 2 plan). This task adds the missing tests that specifically validate the wiring contract.
- TDD cycle: GREEN (3 new tests pass immediately since implementation pre-existed) → typecheck clean → commit
- Suites confirmed green: coverageSummary (13), coverageChart (15), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (19)

### Task 2e — Run chart + tab suites, typecheck + lint, then commit grid-aligned coverage chart
- Status: DONE
- Commit: fcc995ae (no new code commit needed — verification-only task; all code already committed in 2a–2d)
- Verification results:
  - `coverageChart` suite: 15 tests pass
  - `shiftTimelineTab` suite: 19 tests pass
  - All 6 coverage-related suites: 66 tests pass (coverageSummary 13, coverageChart 15, areaCoverageStrips 6, coverageStatusStrip 8, coverageDemandInfo 5, shiftTimelineTab 19)
  - Typecheck: clean (no errors)
  - Lint: no errors in modified files (src/components/scheduling/ShiftTimeline/CoverageChart.tsx, ShiftTimelineTab.tsx, src/lib/coverageSummary.ts, tests/unit/coverageChart.test.tsx, tests/unit/shiftTimelineTab.test.tsx, tests/unit/coverageSummary.test.ts)
  - Pre-existing lint errors (1482 across other files) are not introduced by this branch
