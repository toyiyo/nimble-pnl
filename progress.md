# Timeline Area Coverage — Progress

## Preflight (completed 2026-07-03)

### Environment checks
- **Branch**: feature/timeline-area-coverage ✓
- **gh**: authenticated as jdelgado2002 ✓
- **jq**: 1.7.1-apple ✓
- **node**: v20.20.2 ✓
- **coderabbit**: 0.6.4 ✓
- **codex**: 0.137.0 (available) ✓
- **.env.local symlink**: already present, pointing to main repo ✓
- **SONAR_TOKEN**: not set (warning)
- **SONAR_PROJECT_KEY**: not set (warning)

### Warnings
- Sonar is not configured (SONAR_TOKEN and SONAR_PROJECT_KEY not set). SonarQube scans will be skipped.

## Phase 4 — Build (TDD)

### Task 1: `summarizeAreaCoverage` pure helper — DONE
- **Commit:** `91832188`
- Files changed:
  - `src/lib/coverageSummary.ts` — added `AreaCoverage` interface + `summarizeAreaCoverage` export
  - `tests/unit/coverageSummary.test.ts` — 3 new CRITICAL-prefixed tests (area grouping, Unassigned bucket, empty shifts)
- Tests pass under TZ=UTC and TZ=Asia/Tokyo (8/8 total)
- TypeScript clean (exit 0)

### Task 2: `CoverageDemandInfo` explainer popover — DONE
- **Commit:** `97b33101`
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageDemandInfo.tsx` — new shadcn Popover component (trigger + content with demand formula + settings link)
  - `tests/unit/coverageDemandInfo.test.tsx` — 5 new tests (trigger aria-label, formula text, settings link href, Covered/Short vocabulary, Escape-key dismissal)
- Tests pass (5/5)
- TypeScript clean (exit 0), ESLint clean

### Task 3: `AreaCoverageStrips` component — DONE
- **Commit:** `4facdb46`
- Files changed:
  - `src/components/scheduling/ShiftTimeline/AreaCoverageStrips.tsx` — new component (per-area scheduled headcount strips, neutral cells, demand footnote, null guard)
  - `tests/unit/areaCoverageStrips.test.tsx` — 6 tests (empty guard, area labels, CRITICAL role="img" aria-labels, visible headcount text, demand footnote, Unassigned bucket)
- Tests pass (6/6 new; 25/25 total across all coverage suites)
- TypeScript clean, ESLint clean on new files

### Task 4: `CoverageStatusStrip` have/needed cell display — DONE
- **Commit:** `a25802e2`
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageStatusStrip.tsx` — cell value changed from `✓/−N` to `scheduled/needed` fraction; `cellAriaLabel` updated to expose "N of M, short K" / "N of M, covered" / "N scheduled" for screen readers
  - `tests/unit/coverageStatusStrip.test.tsx` — 2 new CRITICAL-prefixed tests (fraction display, aria-label "N of M" format)
- Tests pass (8/8; 27/27 total across all 4 coverage suites)
- TypeScript clean (exit 0), ESLint clean on changed files

### Task 5: Wire `CoverageDemandInfo` + `AreaCoverageStrips` into `ShiftTimelineTab` — DONE
- **Commit:** `8bc67903`
- Files changed:
  - `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx` — added imports for `CoverageDemandInfo`, `AreaCoverageStrips`, `summarizeAreaCoverage`; added `areaCoverage` useMemo (guards on `groupBy === 'area'`); placed `<CoverageDemandInfo />` next to verdict in header; placed `<AreaCoverageStrips areas={areaCoverage} />` (pl-[120px] aligned) below `CoverageStatusStrip` when grouped by area
  - `tests/unit/shiftTimelineTab.test.tsx` — 4 new CRITICAL-prefixed tests (demand trigger aria-label, per-area group rows, strips hidden when groupBy=position, footnote text)
- Tests pass (16/16 in shiftTimelineTab; 43/43 across all 5 coverage suites)
- TypeScript clean (exit 0), ESLint clean on changed file
- Production build clean

## Phase 4 Complete
All 5 tasks done. Phase 4 (Build, TDD) is complete.

## Phase 5 — UI Review

### Findings
Reviewed all changed TSX files against CLAUDE.md Apple/Notion guidelines:

- **CoverageDemandInfo.tsx**: Import order violation — Lucide icon imported before shadcn components (CLAUDE.md: shadcn #2, icons #3). Fixed.
- **CoverageStatusStrip.tsx**: Cell gap was `gap-0.5` (2px) vs `gap-[3px]` in AreaCoverageStrips. Typography was `text-[10px]` for both hour label and value; aligned to hour label `text-[9px]` (secondary) + value `text-[11px]` (badge scale), matching AreaCoverageStrips pattern. Fixed.
- All other files (AreaCoverageStrips, ShiftTimelineTab, CoverageVerdict, CoverageChart): semantic tokens throughout, three-state rendering correct, accessibility attributes present. No violations.

### Fixes
- **Commit:** `9cdd1497`
- Files changed:
  - `src/components/scheduling/ShiftTimeline/CoverageDemandInfo.tsx` — shadcn imports before Lucide icon
  - `src/components/scheduling/ShiftTimeline/CoverageStatusStrip.tsx` — gap-[3px], text-[9px]/text-[11px] typography
- All 35 coverage-related tests still pass; typecheck and ESLint clean.

## Phase 5 Complete

## Phase 6 — Simplify

### Review findings (4 angles)

**Applied fixes — commit `e50212bd`:**
- `CoverageChart.tsx`: `DeltaView` previously recomputed `deltaPeak` from scratch even though `CoverageChart` already computed it for `Axes`. Now passed as a prop, eliminating the duplicate `Math.max` + spread.
- `CoverageChart.tsx`: Removed dead `isOver` variable in `DeltaView`. The zero-delta branch is now expressed as the clearer `h.delta === 0` guard.
- `coverageSummary.ts`: Dropped redundant `as number` casts in `buildVerdict`'s worst-finding loop (shortHours is already filtered to `delta < 0`, so non-null is guaranteed).
- `CoverageStatusStrip.tsx`: Built a `labelByStartMin` Map once so `formatHour` is called a single time per hour instead of twice (visual strip + sr-only list).

**Skipped findings:**
- `worstIndex` in `AreaView` re-implements a subset of `buildVerdict` — fixing properly requires threading `verdict` through `CoverageChart` props (larger API change than phase 6 scope).
- `xEnd = MARGIN_LEFT + plotW` alias — the name communicates intent ("right edge of the plot"), keeping it is clearer than replacing with bare `plotW`.
- `neededPath` IIFE → named function — style preference only, no clarity gain.

### Verification
- TypeScript: clean (exit 0)
- Tests: 5322 passed (5 pre-existing `fast-xml-parser` failures unrelated to this branch)

## Phase 6 Complete

## Phase 7a — Codex Adversarial Review

### Command
`bash dev-tools/codex-adversarial-review.sh main`

### Output
`dev-tools/codex-review-output.md` — 1 finding (not `::skip::`)

### Finding
- **Severity**: major
- **File**: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`
- **Line**: 269
- The outer coverage panel wrapper `<div className="px-4 ...">` adds 16px of horizontal padding on each side. The inner `pl-[120px]` divs for CoverageChart, CoverageStatusStrip, and AreaCoverageStrips are relative to this padded container, so they start 16px further right than the `TimelineAxis` and shift lane `pl-[120px]` elements which are outside the padded wrapper. This causes the coverage chart/strips to visually misalign with the axis ticks below them, so per-hour coverage data appears under the wrong tick.

## Phase 7a Complete

## Phase 7b — Fold Review Findings

### Findings triaged (6 reviewers: security, performance, maintainability, sound-logic, ocr-rules, codex)

| # | Severity | Area | Fix |
|---|----------|------|-----|
| 1 | critical | `coverageSummary.ts`: zero-coverage early-return hid fully-unstaffed periods | Fixed: removed early-return; emit scheduled=0 when demand configured |
| 2 | critical | `ShiftTimelineTab.tsx`: `px-4` on coverage panel misaligned chart 16px from axis ticks | Fixed: removed `px-4` |
| 3 | major | `CoverageDemandInfo.tsx`: `<a href>` caused full-page reload in SPA | Fixed: `<Link to>` from react-router-dom; test wrapped in MemoryRouter |
| 4 | major | `CoverageStatusStrip.tsx`: `hasDemand` checked only `delta !== null`, not `needed !== null` | Fixed: guarded both |
| 5 | major | `CoverageChart.tsx`: DeltaView surplus label clipped above SVG viewBox | Fixed: clamped `Math.max(labelY, MARGIN_TOP + 8)` |
| 6 | major | `CoverageChart.tsx`: not wrapped in `React.memo` — re-ran O(H) SVG paths on every `setActiveShift` | Fixed: wrapped in `memo()` |
| — | skipped | `focusBackfillSyncHandler.ts` gate-less cron (OCR): intentional design, security reviewer confirmed clean | Skipped |
| — | skipped | All nits/minors (totalScheduled label, JSDoc spec references, `h.delta!` vs `as number`) | Skipped (CodeRabbit catches in 7c) |

### Commit
- `2b31e6ea` fix(review): address critical/major multi-reviewer findings

### Verification
- TypeScript: clean (exit 0)
- Tests: 5324 passed (all new + existing; 5 pre-existing fast-xml-parser failures unchanged)
- New regression tests added for zero-coverage-with-demand fix (2 tests)

## Phase 7b Complete

## Phase 7c — CodeRabbit Review (iteration 1)

### Command
`coderabbit review --plain --type committed`

### Findings (6 total)

| # | Severity | File | Action |
|---|----------|------|--------|
| 1 | major [Security] | `tests/unit/focusBackfillSyncHandler.test.ts:197` | Skipped — intentional gateless design confirmed in Phase 7b |
| 2 | major [Security] | `supabase/functions/focus-bulk-sync/index.ts:10` | Skipped — same intentional design |
| 3 | minor [Correctness] | `src/lib/coverageSummary.ts:62` | **Fixed** — clamp hour-bucket filter to window bounds (commit `e28760b1`) |
| 4 | major [Correctness] | `docs/superpowers/plans/2026-07-03-timeline-area-coverage.md:44` | Skipped — plan doc, actual code already zero-fills |
| 5 | major [Correctness] | `docs/superpowers/plans/2026-07-02-timeline-coverage-redesign.md:111` | Skipped — plan doc pseudocode, actual implementation correct |
| 6 | minor [Correctness] | `tests/unit/focusTestConnectionHandler.test.ts:196` | Skipped — pre-existing test weakness, out of scope |

### Fix applied
- `src/lib/coverageSummary.ts`: Clamp coverage filter to `[max(start, window.startMin), min(start+HOUR, window.endMin))` for defensive correctness with non-hour-aligned windows. All 10 coverageSummary tests pass.

## Phase 7c — CodeRabbit Review (iteration 2)

### Command
`coderabbit review --plain --type committed`

### Findings (1 total)

| # | Severity | File | Action |
|---|----------|------|--------|
| 1 | minor [Functional Correctness] | `src/components/scheduling/ShiftTimeline/AreaCoverageStrips.tsx:75` | **Fixed** — footnote text "per-brand" → "per-area" (commit `c1791805`) |

### Fix applied
- `AreaCoverageStrips.tsx`: Corrected copy/paste typo in footnote — "per-brand targets" replaced with "per-area targets". All 6 areaCoverageStrips tests pass.

## Phase 7c Complete (iteration 2)

## Phase 8 — Verify

### .env.local symlink
- Present: symlink to `/Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local` ✓

### npm run test (Vitest unit)
- **Result**: 5324 passed, 2 skipped; 5 pre-existing fast-xml-parser failures (unchanged from main) ✓
- Exit code: 0

### npm run test:db (pgTAP)
- Branch-added tests (`42_focus_cron.sql`, `48_focus_backfill_cron.sql`): all assertions pass ✓
- Pre-existing transient failures (deadlock in `14_calculate_inventory_impact_conversions.sql`, `35_get_unified_sales_totals.sql`; data pollution in `32_weekly_brief_queue.sql`): unrelated to this branch, not in branch-changed files

### npm run test:e2e (Playwright)
- Scheduling-related tests (files touched by this branch): **12/12 passed** ✓
  - `tests/e2e/shift-planner.spec.ts` — 8 passed
  - `tests/e2e/shift-template-areas.spec.ts` — 1 passed
  - `tests/e2e/schedule-group-by-area.spec.ts` — 5 passed
- Pre-existing E2E failures in `asset-quantity`, `employee-activation`, `employee-compensation-history`, `employee-mobile`, `bulk-edit-pos-sales`, `bulk-edit-transactions` tests: all due to shared helper `signUpAndCreateRestaurant` timeout on "add new restaurant" dialog; no E2E test files were added or changed in this branch

### npm run typecheck
- Exit code: 0 (clean) ✓

### npm run lint
- Branch-changed files (ShiftTimeline/ + coverageSummary.ts): 0 errors ✓
- Full codebase: pre-existing errors in unrelated files (no errors introduced by this branch)

### npm run build
- Exit code: 0 ✓
- Built in 5m 48s; chunk size warnings are pre-existing

## Phase 8 Complete

## Phase 9a — Ship

- Branch pushed: `origin/feature/timeline-area-coverage`
- PR opened: **#569** — https://github.com/toyiyo/nimble-pnl/pull/569
  - Base: `main` (PR #566 / `feature/timeline-coverage-redesign` was already merged)
  - Title: "feat(scheduling): per-area coverage strips + demand explainer in Timeline"

## Phase 9a Complete

## Phase 9b — CI (iteration 1)

### PR #569 CI checks — all green

| Check | Result |
|-------|--------|
| Analyze (actions) | pass (40s) |
| Analyze (javascript-typescript) | pass (2m8s) |
| CodeQL | pass |
| CodeRabbit | pass — Review completed |
| Database Tests (pgTAP) | pass (4m49s) |
| E2E Tests (Shard 1/4) | pass (10m38s) |
| E2E Tests (Shard 2/4) | pass (13m0s) |
| E2E Tests (Shard 3/4) | pass (11m1s) |
| E2E Tests (Shard 4/4) | pass (8m14s) |
| Merge E2E Reports | pass (37s) |
| SonarCloud Code Analysis | pass (2m53s) |
| Supabase Preview | pass |
| Unit Tests | pass (8m0s) |
| Vercel | pass — Deployment completed |
| netlify/easyshifthq/deploy-preview | pass |

No failures. SonarCloud gate passed. ciGreen = true.

## Phase 9b Complete

## Phase 9d — Review-comment triage

### All PR comments (3 inline, 4 conversation, 3 PR-level reviews)

| # | Source | Classification | Action |
|---|---|---|---|
| Inline #1 | github-code-quality: unused `within` import in areaCoverageStrips.test.tsx | nit/lint | **FIXED** |
| Inline #2 | Codex P1: Step 0 DELETE orphans don't get re-aggregated — stale daily_sales | **bug/correctness** | **FIXED** — RETURNING+UNION in SQL migration |
| Inline #3 | CodeRabbit major: misleading test name in focusTestConnectionHandler.test.ts | refactor | **FIXED** — test renamed |
| Conv #1-3 | netlify/vercel/supabase bots (deploy status) | informational | read only |
| Conv #4 | CodeRabbit walkthrough summary | informational | read only |
| PR review #3 | CodeRabbit: 6 nitpicks (SQL perf, pgTAP gap, 120px constant, CoverageCell DRY, isSafeBase export) | nit/refactor | Declined with PR comment |
| PR review #3 | CodeRabbit: area-with-no-shifts test suggestion | suggestion | **IMPLEMENTED** — test added documenting by-design behaviour |

### Fix commit
- `677b988d` fix(review): triage PR #569 comments — Codex P1 delete-date re-aggregation + test cleanups

### Verification post-fix
- TypeScript: clean (exit 0)
- Tests: 5323 passed (same 5 pre-existing fast-xml-parser failures; all coverage suites pass)
- Pushed to origin

### Artifact
- `dev-tools/9d-triage-feature/timeline-area-coverage.md`

## Phase 9d Complete
