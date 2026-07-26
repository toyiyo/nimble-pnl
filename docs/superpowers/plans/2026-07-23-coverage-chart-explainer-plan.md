# Plan — Coverage chart explainer redesign

**Design:** `docs/superpowers/specs/2026-07-23-coverage-chart-explainer-design.md`
**Branch:** `feature/coverage-chart-explainer`

Tasks are TDD-sized (RED → GREEN → REFACTOR → COMMIT). Stages 1–2 are the pure
data layer (fully unit-tested, SonarCloud-counted); Stages 3–6 build the UI on
top. Dependencies noted per task.

## Stage 1 — Data model: raw `demand` (pure, no UI)

- **1.1** `scheduling.ts`: add `demand: number` to `HourlyStaffingRecommendation`.
  (Type-only; no test.) *Dep: none.*
- **1.2** `staffingCalculator.ts`: `buildHourlyRecommendations` computes
  `demand = avgSales > 0 && targetSplh > 0 ? ceil(avgSales/targetSplh) : 0` and
  `recommendedStaff = max(demand, minStaff)`; stops calling
  `calculateRecommendedStaff`. **RED:** unit test asserts `demand` emitted,
  `recommendedStaff === max(demand, minStaff)`, `demand === 0` at sales ≤ 0, and
  the folded value equals the old `calculateRecommendedStaff` output for a range
  of inputs (behavior-preservation). *Dep: 1.1.*
- **1.3** `coverageSummary.ts`: add `demand: number | null` and
  `scheduledMax: number` to `CoverageHour`; `summarizeCoverageHours` copies
  `rec.demand` (null when no rec) and sets `scheduledMax = inHour.length ?
  Math.max(...counts) : 0`. **RED:** test threads both; `demand` null with no rec;
  `demand=null` (area-coverage) path unchanged; `scheduledMax ≥ scheduled`.
  *Dep: 1.1.*

## Stage 2 — Pure presentation helpers (new `coverageChartModel.ts`)

New pure module so every helper is exported + unit-covered (SonarCloud gate).

- **2.1** `classifyHour(h, minStaff)` → `'crit'|'floor'|'spare'|'ok'|'nodata'`.
  **RED:** boundary tests — `demand===null`→nodata; `scheduled<demand`→crit;
  `scheduled>=demand && scheduled<needed`→floor; `scheduled===needed`→ok;
  `scheduled>needed`→spare; `scheduled===demand`, `demand<minStaff` edges.
- **2.2** `impliedLabor({ wage, splh, targetLaborPct })` → `{ pct, overTarget }`
  where `overTarget = pct > targetLaborPct + 0.05`; and
  `laborConsistentSplh({ wage, targetLaborPct }) = wage / (targetLaborPct/100)`.
  **RED:** pct math + threshold at boundary; consistent-splh value.
- **2.3** `buildReceipt(h, { minStaff, weekdayKey, wage, lookbackWeeks })` →
  ordered ledger rows + asides (implied-SPLH, mid-hour range note only when
  `scheduledMax !== scheduled`, floor explanation, nodata copy). **RED:** row set
  + aside presence per kind. *Dep: 2.1, Stage 1.*
- **2.4** `chartSummaryLabel(hours, minStaff)` → the rolled-up aria string
  ("N short on demand, M at the floor over K hours") + the sr-only understaffed
  windows list. **RED:** counts per kind; windows list matches short hours.

## Stage 3 — CoverageChart SVG rewrite

- **3.1** Replace `AreaColumn`/`DeltaColumn`/`Legend` with one SVG chart: people
  y-axis (0…`peak`), scheduled bar + solid demand slice + dashed/hatched floor
  slice + hatched nodata ghost + `floor N` rule. Props gain `minStaff`,
  `selectedStartMin`, `onSelect`, `onQuickAdd`. `role="toolbar"` container,
  roving-tabindex `role="option"` columns, ArrowLeft/Right selection, sr-only
  summary + understaffed-windows `<ul>`. Hatch/dash via `<pattern>` +
  `hsl(var(--warning))`/`hsl(var(--muted-foreground))` — no hex. *Dep: Stage 2.*
- **3.2** Y-axis rendered in a `sticky left-0 z-10 w-[120px]` gutter so it stays
  visible under horizontal scroll (mirror `TimelineLane`); plot keeps `minToPct`.
- **3.3** One-click hover "+" quick-add on `crit`/`floor` columns →
  `onQuickAdd(startMin)`. Component render test (optional) or helper coverage for
  the column-class mapping.

## Stage 4 — Slider + labor readout + receipt panel

- **4.1** `SplhSlider` sub-component: native `range` (25–120, step 5, display-clamp
  only), label, live `→ X% labor at $W/hr` readout + red/green pill, notch at
  `laborConsistentSplh`, Reset, manager-only Save (`isSaving` pending). Styling per
  CLAUDE.md scale. `aria-valuetext` includes implied labor %. *Dep: 2.2.*
- **4.2** `CoverageReceipt` sub-component: renders `buildReceipt` rows +
  "Add shift for this hour" (→ `onQuickAdd`); `aria-live="polite"` updated on
  slider **commit** only (pointerup/keyup), not per frame. Apple/Notion container.
  *Dep: 2.3.*

## Stage 5 — Wire into ShiftTimelineTab

- **5.1** Add `sliderTarget` state; pass `{ target_splh: sliderTarget } | null` as
  the `settingsOverrides` arg to `useWeekStaffingSuggestions` (replaces `null` at
  line 261). Destructure `updateSettings`, `isSaving`, `employees`; derive
  `avgWage` and `minStaff = computeMinStaffFromCrew(min_crew, min_staff)`.
- **5.2** Remove `coverageView` state + Area/Delta `ToggleGroup` +
  `CoverageStatusStrip` render. Lay out flex row: scrollable chart (in the
  existing `overflow-x-auto`) + pinned `CoverageReceipt` outside it (stacked on
  mobile). Fold `CoverageVerdict`/`CoverageDemandInfo` (keep the `/settings`
  deep-link) into the chart header. Keep `hours={hourlySummary}` (preserves
  live-drag). Wire `onSelect`, `onQuickAdd={handleGapClick}`.
- **5.3** Save-gate authz: use `['owner','manager','operations_manager']
  .includes(selectedRestaurant?.role)` for the Save button; preview+Reset for all.
  Document the role set in the PR body.
- **5.4** Reshape the loading skeleton to mirror slider + axis + chart + receipt.

## Stage 6 — Cleanup

- **6.1** Delete `CoverageStatusStrip.tsx` if no other importer (grep first);
  otherwise leave and just stop rendering it here. Update any barrel/exports.
- **6.2** Full Phase 8 verify: `typecheck`, `lint`, `test`, `build`.

## Test coverage focus (SonarCloud ≥80% new code)

All of Stage 1–2 (`staffingCalculator`, `coverageSummary`, `coverageChartModel`)
are pure and directly unit-tested — that's where the counted logic lives. UI
components (Stages 3–5) lean on those helpers so the branch logic is covered
outside JSX.
