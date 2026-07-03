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

### Task 3a — Add failing tests for tooltip content (scheduled/needed/sales÷SPLH math, graceful degradation)
- Status: DONE
- Commit: a2e65040
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageChart.tsx` — exported `buildHourTooltip(h, targetSplh)` pure helper returning lines array (time range, scheduled/needed, projected sales, ÷SPLH math, verdict); updated `buildColumnAriaLabel` to join all lines via comma; wired `buildHourTooltip` into `<TooltipContent>` via multi-line `<p>` layout (replacing bare ariaLabel string); set `delayDuration={0}` on `TooltipProvider`; destructured `targetSplh` in main component.
  - `tests/unit/coverageChart.test.tsx` — added `CoverageChart — tooltip content (buildHourTooltip)` describe block with 13 new tests: 10 `buildHourTooltip` unit tests (CRITICAL-prefixed, covering all branches: short/covered/spare/right-on-target/no-demand/sales-omitted/SPLH-omitted/no-demand-no-sales) + 2 aria-label integration tests + 1 TooltipContent wiring contract test (line count + exact content); imported `screen` and `buildHourTooltip`.
- TDD cycle: RED (12 new tests fail — `buildHourTooltip` not exported, aria-labels missing detail) → GREEN (28 tests pass, 79 across all 6 suites) → typecheck clean → commit
- Note: The 2 "portal" tests that test Radix Tooltip portal opening via `userEvent`/`fireEvent` were restructured to test the `buildHourTooltip` line array directly (exact content contract) since Radix Tooltip portal rendering is unreliable in jsdom. The existing tooltip *shell* tests (task 2c) already validate that `TooltipContent` is wired to each column.
- Suites confirmed green: coverageSummary (13), coverageChart (28), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (19)

### Task 3b — Implement buildHourTooltip helper and wire tooltip content into CoverageChart columns
- Status: DONE
- Commit: a2e65040 (implementation was completed as part of Task 3a's TDD RED→GREEN cycle in the same commit)
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageChart.tsx` — `buildHourTooltip(h, targetSplh)` pure exported helper (5 lines: time range, scheduled/needed, projected sales, SPLH math, verdict); `buildColumnAriaLabel` delegates to it (comma-join); `TooltipContent` renders each line as a `<p>` with `space-y-0.5` spacing; `delayDuration={0}` on `TooltipProvider`.
- TDD cycle: implementation was the GREEN phase of Task 3a (tests were RED, then buildHourTooltip was implemented in the same cycle); all 28 coverageChart tests pass, 79 total across 6 suites; typecheck clean.
- Verification: `buildHourTooltip` handles all branches (short/covered/spare/right-on-target/no-demand/no-sales/no-SPLH); aria-labels on columns contain full tooltip content via comma-join; TooltipContent wiring contract confirmed by test (exact 5-line structure for full-data hour, 3-line for no-demand).
- Suites confirmed green: coverageSummary (13), coverageChart (28), areaCoverageStrips (6), coverageStatusStrip (8), coverageDemandInfo (5), shiftTimelineTab (19)

### Task 3c — Run tooltip tests, lint, then commit per-hour tooltip feature
- Status: DONE
- Commit: (verification-only task — all code already committed in 3a/3b at a2e65040; progress.md update committed below)
- Verification results:
  - `coverageChart` suite: 28 tests pass (all tooltip content + shell + layout + delta view tests)
  - All 6 coverage-related suites: 79 tests pass (coverageSummary 13, coverageChart 28, areaCoverageStrips 6, coverageStatusStrip 8, coverageDemandInfo 5, shiftTimelineTab 19)
  - Lint: 0 errors, 1 pre-existing warning (`react-refresh/only-export-components` on `buildHourTooltip` export — design doc requires this export for direct testing; warning is not an error and does not block the build)
  - All 28 coverageChart tests pass including all CRITICAL-prefixed tooltip tests

### Task 4a — Full verification: typecheck + lint + tests (UTC) + build, confirm recovered #569 suites pass
- Status: DONE
- Commit: (verification-only task — all code already committed; progress.md update committed below)
- Verification results:
  - Typecheck: clean (tsc --noEmit — 0 errors)
  - Lint on branch-modified files: 0 errors, 1 pre-existing warning (`react-refresh/only-export-components` on `buildHourTooltip` — not an error)
  - Pre-existing lint errors (1483 across other files) — not introduced by this branch (confirmed on main)
  - `TZ=UTC npm run test` (all suites): 403 test files pass, 5374 tests pass (5 `focus*` test files fail due to pre-existing missing `fast-xml-parser` package — confirmed identical failure on `main` branch)
  - All 6 coverage-related suites under TZ=UTC: 79 tests pass (coverageSummary 13, coverageChart 28, areaCoverageStrips 6, coverageStatusStrip 8, coverageDemandInfo 5, shiftTimelineTab 19)
  - Recovered #569 suites confirmed green: areaCoverageStrips (6), coverageDemandInfo (5), coverageStatusStrip (8), shiftTimelineTab (19) — 38 total
  - Build: `npm run build` succeeds in 50.65s (0 errors, only pre-existing chunk-size warnings)

## Phase 6: Simplify

- Status: DONE
- Commit: 73f8b338
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageChart.tsx` — (1) merged the identical area/delta `hours.map()` branches into a single map that switches only the inner column component, eliminating ~35 lines of duplicated tooltip + aria-label logic; (2) removed the `buildColumnAriaLabel` one-liner wrapper (was just `buildHourTooltip(h, t).join(', ')`) and inlined it at the call site; (3) removed the `shortfallBottomPct` alias for `scheduledPct` in AreaColumn (always equal, no semantic value).
  - `src/lib/coverageSummary.ts` — replaced `rec ? rec.projectedSales : null` / `rec ? rec.laborPct : null` ternaries with idiomatic `rec?.projectedSales ?? null` / `rec?.laborPct ?? null` optional chaining.
- Verification: all 79 coverage-related tests pass (TZ=UTC); typecheck clean (tsc --noEmit 0 errors); net reduction of 32 lines across 2 files.

## Phase 7a: Adversarial Review (Codex)

- Status: DONE
- Output: `dev-tools/codex-review-output.md`
- Finding:
  - severity=major file=src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx line=241
  - `ShiftTimelineTab` returns the empty state whenever `model.lanes.length === 0`, before rendering the coverage panel. Trigger: a day has staffing recommendations/demand but zero scheduled shifts. `summarizeCoverageHours` was explicitly changed to emit `scheduled=0` shortage hours for this case, but the UI never reaches that code path because no shifts means no lanes, so managers see "No shifts scheduled" instead of the demand shortfall/needed staff for a fully unstaffed day.

## Phase 7b: Fold Review Findings

- Status: DONE
- Commit: cf94256e
- Findings reviewed: security (0), performance (1 minor), maintainability (3 minor), sound-logic (2 minor), ocr-rules (2 major + 4 minor), codex (1 major)
- Fixes applied:
  1. **codex (major):** `ShiftTimelineTab` — removed `lanes.length === 0` early return that prevented the coverage panel from showing on fully-unstaffed days; "No shifts scheduled" message now rendered inline below the coverage panel so demand shortfalls remain visible
  2. **sound-logic (minor):** `buildHourTooltip` — added `&& targetSplh > 0` guard before dividing `projectedSales / targetSplh` to prevent "Infinity needed" tooltip text when target_splh is stored as 0
  3. **ocr-rules (major):** `DeltaColumn` — deduplicated the identical outer wrapper div (ref, data-hour-col, tabIndex, aria-label, className, style) across the three early-return branches; now renders a single outer div with `innerContent` switched by branch, eliminating ~20 lines of duplication
- Skipped (not bugs):
  - `key={i}` in tooltipLines.map — minor opportunity; lines array is short-lived, not a correctness issue
  - hardcoded `/settings` in CoverageDemandInfo — confirmed IS the real route (App.tsx line 256); not a bug
  - import order, task comments, magic-number comments, AREA_STEP comment — nits; CodeRabbit covers these in 7c
  - `delta===null & needed!==null` unreachable gap — unreachable per current code path; adding an else branch would be defensive code without a triggering test
- Verification: 79/79 coverage-related tests pass (TZ=UTC); typecheck clean (0 errors)

## Phase 8: Verify

- Status: DONE
- Checks:
  - `.env.local` symlink: PRESENT (→ /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local)
  - `npm run test` (TZ=UTC): 5374 tests pass, 403 test files pass; 5 test files fail (pre-existing `fast-xml-parser` missing — identical on main)
  - All 6 coverage-related suites: 79/79 pass (coverageSummary 13, coverageChart 28, areaCoverageStrips 6, coverageStatusStrip 8, coverageDemandInfo 5, shiftTimelineTab 19)
  - `npm run test:db`: pre-existing failures (focus cron chedule mismatches + `_focus_parse_local_time` function missing) — identical on main
  - `npm run test:e2e`: 23 passed, 12 skipped, 22 did not run (0 failures); main branch had 3 pre-existing failures
  - `npm run typecheck`: CLEAN (0 errors)
  - `npm run lint`: 1483 problems (pre-existing — identical on main; 1 pre-existing warning from this branch: `react-refresh/only-export-components` on `buildHourTooltip`)
  - `npm run build`: SUCCESS in 22s (0 errors, only pre-existing chunk-size warnings)
  - Dev server torn down after E2E tests

## Phase 9a: Ship

- Status: DONE
- PR: https://github.com/toyiyo/nimble-pnl/pull/574 (PR #574)
- Branch `worktree-timeline-chart-fixes` pushed to origin; PR opened against `main`.

## Phase 9b: CI

- Status: DONE (iteration 1/5)
- All checks passed on first run — no fixes required.
- Results:
  - Analyze (actions): pass
  - Analyze (javascript-typescript): pass
  - CodeQL: pass
  - CodeRabbit: pass
  - Database Tests (pgTAP): pass (5m0s)
  - E2E Tests (Shard 1/4): pass (10m47s)
  - E2E Tests (Shard 2/4): pass (12m49s)
  - E2E Tests (Shard 3/4): pass (10m12s)
  - E2E Tests (Shard 4/4): pass (8m27s)
  - Merge E2E Reports: pass
  - Unit Tests: pass (6m4s)
  - SonarCloud Code Analysis: pass (54s)
  - Vercel: pass
  - netlify/easyshifthq/deploy-preview: pass
  - Redirect rules - easyshifthq: pass
  - Vercel Preview Comments: pass
  - Supabase Preview: skipping (expected)
  - Pages changed - easyshifthq: skipping (expected)
  - Header rules - easyshifthq: skipping (expected)

## Phase 5: UI Review

- Status: DONE (no violations found — no code changes required)
- Components reviewed: `ShiftTimelineTab.tsx`, `CoverageChart.tsx`, `CoverageDemandInfo.tsx`, `CoverageStatusStrip.tsx`, `AreaCoverageStrips.tsx`
- Checks:
  - Typography scale: PASS — all sizes per CLAUDE.md (9px chart annotations, 11px counts, 12px labels, 13px secondary, 15px body emphasis)
  - Semantic color tokens: PASS — no direct colors; all use foreground/background/muted/destructive/success/primary/border semantic tokens
  - Three-state rendering: PASS — ShiftTimelineTab: loading (Skeleton + aria-busy), error (inline message), empty (EmptyState with icon), data; child components return null for empty
  - Accessibility: PASS — all interactive elements have aria-label; day buttons use aria-pressed; hour columns use tabIndex=0 + focus-visible:ring; screen-reader ul for understaffed windows in CoverageStatusStrip
  - Card/container patterns: PASS — rounded-xl + border-border/40 for containers, rounded-lg for buttons, transition-colors for hover states
  - No fixes required
