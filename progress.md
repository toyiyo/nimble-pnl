# Timeline Coverage Redesign — Progress

## Phase: Preflight ✅ COMPLETED
Date: 2026-07-02

### Environment Check Results
- **Branch**: feature/timeline-coverage-redesign ✅
- **gh**: authenticated as jdelgado2002 ✅
- **jq**: 1.7.1-apple ✅
- **node**: v20.20.2 ✅
- **coderabbit**: 0.6.4 ✅
- **codex**: 0.137.0 ✅ (available)
- **.env.local symlink**: exists → /Users/josedelgado/Documents/GitHub/nimble-pnl/.env.local ✅
- **SONAR_TOKEN**: NOT SET ⚠️
- **SONAR_PROJECT_KEY**: NOT SET ⚠️
- **sonar-project.properties**: present in repo

### Notes
- Sonar is not configured (no env vars set), but sonar-project.properties exists in the repo
- All hard dependencies (gh, jq, node, coderabbit) are present
- Codex is available

## Phase: TDD Build (Phase 4)

### Task 1: Pure hourly summary + verdict ✅ COMPLETED
- **Commit**: a31a6077
- **Files**: `src/lib/coverageSummary.ts`, `tests/unit/coverageSummary.test.ts`
- **Tests**: 5 passing (UTC + TZ=Asia/Tokyo verified)
- **Functions**: `summarizeCoverageHours`, `buildVerdict`, `CoverageHour`, `CoverageVerdict` interfaces

### Task 2: CoverageVerdict component ✅ COMPLETED
- **Commit**: 1f16277f
- **Files**: `src/components/scheduling/ShiftTimeline/CoverageVerdict.tsx`, `tests/unit/coverageVerdict.test.tsx`
- **Tests**: 5 passing (no-demand, met-all, short headline, worst-hour subline, no-subline-when-met)
- **Props**: `verdict: CoverageVerdict`, optional `formatHour(hour): string` override
### Task 3: CoverageChart (area + delta views) ✅ COMPLETED
- **Commit**: d4178d18
- **Files**: `src/components/scheduling/ShiftTimeline/CoverageChart.tsx`, `tests/unit/coverageChart.test.tsx`
- **Tests**: 12 passing (area view: accessible SVG, shortfall wedge, legend, title/desc, no-shortfall when covered, no-Needed when demand absent; delta view: 2 bars with correct data-bar attrs, accessible SVG, empty array → null)
- **Props**: `{ hours: CoverageHour[]; view: 'area' | 'delta'; height?: number }`
- **Design**: proper viewBox, no preserveAspectRatio=none, y-axis gridlines + labels, dashed needed line + inline end-label, red shortfall wedges (data-shortfall), diverging bars (data-bar), role=img + title/desc accessibility
### Task 4: CoverageStatusStrip (per-hour status cells) ✅ COMPLETED
- **Commit**: c07c60c6
- **Files**: `src/components/scheduling/ShiftTimeline/CoverageStatusStrip.tsx`, `tests/unit/coverageStatusStrip.test.tsx`
- **Tests**: 6 passing (short labels, covered labels, no-demand neutral cells, empty → null, no understaffed list when fully covered, all-covered no short list)
- **Props**: `{ hours: CoverageHour[]; formatHour?: (hour: number) => string }`
- **Design**: colored cells (destructive/emerald/muted tint), per-cell aria-label ("5 PM, short 2" / "covered"), sr-only `<ul aria-label="Understaffed windows">` listing each short hour for screen readers

## Phase: UI Review (Phase 5) ✅ COMPLETED
Date: 2026-07-02

### Findings & Fixes
- **Violation found**: `bg-emerald-500`, `fill-emerald-500`, `text-emerald-700 dark:text-emerald-400` direct Tailwind color literals in CoverageVerdict, CoverageChart, CoverageStatusStrip.
- **Fix**: Replaced all 4 occurrences with `bg-success`, `fill-success`, `text-success` (semantic token backed by `--success` CSS variable, defined in tailwind.config.ts and src/index.css).
- **Commit**: 95a59af2
- **Tests**: 35/35 passing post-fix

### Other guidelines verified as compliant
- Typography scale: ✅ (`text-[15px]`, `text-[13px]`, `text-[12px]`, `text-[11px]`, `text-[10px]` with correct pairings)
- Three-state rendering: ✅ (loading → skeleton, error → message, empty → empty-state, data → full render)
- Accessibility: ✅ (`role="img"` + `<title>`/`<desc>` on SVG, `aria-label` on groups/buttons, `aria-pressed`, `aria-busy`, sr-only list for understaffed hours)
- Border/radius patterns: ✅ (`border-border/40`, `bg-muted/30`, `bg-muted/50`, `rounded-lg`, `rounded-xl`)
- Keyboard navigation: ✅ (day selector buttons with `aria-pressed`, ToggleGroup items are keyboard accessible)

### Task 5: Wire into ShiftTimelineTab; remove old components ✅ COMPLETED
- **Commit**: f4ecb77d
- **Files modified**: `src/components/scheduling/ShiftTimeline/ShiftTimelineTab.tsx`, `tests/unit/shiftTimelineTab.test.tsx`
- **Files deleted**: `src/components/scheduling/ShiftTimeline/CoverageCurve.tsx`, `src/components/scheduling/ShiftTimeline/CoverageGapList.tsx`, `tests/unit/coverageGapList.test.tsx`
- **Tests**: 43 passing (12 in shiftTimelineTab.test.tsx including 4 new wiring tests, all prior coverage tests still passing)
- **Build**: clean (tsc + eslint on changed files = 0 errors, build succeeds in 47s)
- **Wiring**: `summarizeCoverageHours` + `buildVerdict` memos; `coverageView` state; `CoverageVerdict` → `ToggleGroup (Chart|+/−)` → `CoverageChart` (inside `pl-[120px]`) → `CoverageStatusStrip` (inside `pl-[120px]`); `CoverageCurve`/`CoverageGapList` imports+usages removed

## Phase: Simplify (Phase 6) ✅ COMPLETED
Date: 2026-07-02

### Review Findings (4 angles)

**Reuse**: `defaultFormatHour` was copy-pasted verbatim across `CoverageVerdict.tsx`, `CoverageStatusStrip.tsx`, and `CoverageChart.tsx` (where it was also named `formatHourLabel` and had a subtle inconsistency — no space before AM/PM, producing `"5PM"` vs `"5 PM"`).

**Simplification**: The x-axis hour-label JSX block was duplicated identically in both branches of `Axes` (area and delta views). The `computePeak` function used a manual `for` loop with two `if` branches.

**Efficiency**: No wasted computation found. `buildVerdict` filters once and reuses the result; shortfall rendering is already lazy.

**Altitude**: No bandaid patterns found. The `pl-[120px]` layout offset is intentional (aligns coverage panel with the shift-lane axis) and documented in comments.

### Fixes Applied
- Extracted `formatCoverageHour` into `src/lib/coverageSummary.ts` — single canonical export replacing 3 copies; also fixes the `"5PM"` vs `"5 PM"` inconsistency between the chart axis and verdict/strip labels.
- Lifted x-axis hour-label JSX out of both branches of `Axes` into a shared `xAxisLabels` constant (removed ~14 lines of duplication).
- Simplified `computePeak` from manual `for` loop to a `reduce` + `Math.max`.

### Commit
- **Commit**: 3042f8fe
- **Files**: `src/lib/coverageSummary.ts`, `CoverageVerdict.tsx`, `CoverageStatusStrip.tsx`, `CoverageChart.tsx`
- **Tests**: 40/40 passing; typecheck + lint clean
- **Net**: −31 lines (39 ins / 70 del)
