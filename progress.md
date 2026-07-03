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

### Task 2a — Update CoverageChart tests for grid-aligned HTML column selectors (data-hour-col, data-shortfall, data-bar)
- Status: DONE
- Commit: ccb83054
- Files changed:
  - `tests/unit/coverageChart.test.tsx` — rewrote from SVG selectors to HTML `data-hour-col` / `data-shortfall` / `data-bar` attribute selectors; added `minToPct` prop (10:00-14:00 window) and `targetSplh` to all render calls; added `renders one positioned column per hour, aligned to minToPct` test checking `style.left` / `style.width`; added `scales no-demand bars by headcount peak` test checking `style.height` proportionality; removed SVG-only tests (title/desc elements); preserved all behavioral contracts (11 tests total).
  - `src/components/scheduling/ShiftTimeline/CoverageChart.tsx` — replaced fixed-viewBox SVG with per-hour absolutely-positioned HTML columns using `minToPct` scale; `AreaColumn` with bottom-anchored scheduled block + `data-shortfall` fill + dashed needed tick; `DeltaColumn` with `data-bar={short|covered|no-demand}` + `style.height` for proportional scaling; backward-compatible fallback `minToPct` for callers that don't yet pass it; `role="img"` + `aria-label` on container div.
- TDD cycle: RED (2 new tests fail — `[data-hour-col]` returns 0 elements, `style.height` is NaN for SVG bars) → GREEN (11 tests pass) → typecheck clean → commit
- Suites confirmed green: coverageSummary (13), coverageChart (11), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (16)
