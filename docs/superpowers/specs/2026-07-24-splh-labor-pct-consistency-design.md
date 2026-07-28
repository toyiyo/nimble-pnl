# SPLH ↔ Labor-% Consistency Guard (Settings + Planner)

**Date:** 2026-07-24 (revised 2026-07-27 after PR #650 landed)
**Status:** Approved
**Author:** Claude (with Jose Delgado)

## Problem

Three staffing settings are bound by a hard identity:

```
labor% = avg_hourly_wage / target_splh
```

`target_splh` and `target_labor_pct` are entered independently, and the blended
average hourly wage comes from the employee roster. Where nothing ties them
together, a manager can save a self-contradictory pair with no warning.

### Real case

Restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed` saved `target_splh = $30` with
`target_labor_pct = 25%` and every hourly employee at `$10.00/hr`. That implies
`10 / 30 = 33.3%` labor — not 25%. Because demand is
`ceil(avgSales / target_splh)`, the too-low SPLH target inflated the Planner
coverage chart to **17 staff for a $503 hour**, which reads as a broken chart
rather than a misconfiguration.

Users read "SPLH" as *"what I currently get per hour"* and enter their blended
actual — a figure dominated by slow hours — which as a *target* over-staffs the
peak. The relationship is also counter-intuitive: **lowering** SPLH **increases**
recommended headcount.

## What already exists (PR #650)

PR #650 ("coverage chart explainer") shipped this guard for **one** surface — the
ShiftTimeline coverage chart — via `src/lib/coverageChartModel.ts`:

- `impliedLabor({wage, splh, targetLaborPct}) → {pct, overTarget}`, tolerance
  `0.05` percentage points, `wage` in **dollars**.
- `laborConsistentSplh({wage, targetLaborPct}) → number` — the consistent SPLH.
- `SplhSlider.tsx` renders a live `→ X% labor at $W/hr` readout, an
  On/Over-target pill, a track notch at the consistent value, and the
  directional line *"a lower target schedules more staff."*

**This design does not re-invent that math.** It reuses it and extends coverage
to the surfaces #650 did not touch.

## Gaps this design closes

| Gap | Where |
|---|---|
| 1. Settings Labor Planning tab has no implied %, warning, suggestion, or directional line | `src/pages/RestaurantSettings.tsx` |
| 2. Planner's inline staffing overrides have the same absence (`SplhSlider` is rendered only by `ShiftTimelineTab`, not `ShiftPlannerTab`) | `src/components/scheduling/ShiftPlanner/StaffingConfigPanel.tsx` |
| 3. The readout is computed off a **fabricated wage** for rosters with no active hourly employees | `SplhSlider` (visible readout + `aria-valuetext`) and `buildReceipt`'s implied-SPLH aside, both fed from `ShiftTimelineTab.tsx:505` |

Gap 3 is a real correctness bug in shipped code:
`computeAvgHourlyRateCents` (`staffingCalculator.ts:6-15`) falls back to
`DEFAULT_HOURLY_RATE_CENTS = 1500` ($15/hr) when the roster has no active hourly
employees, and `ShiftTimelineTab` divides that by 100 with no guard. An empty or
salaried-only restaurant is shown an implied labor % presented as fact, derived
from a wage nobody is paid. It surfaces in **three** places off that one value:
the slider's visible readout, the slider's `aria-valuetext`
(`SplhSlider.tsx:141` — otherwise screen-reader users still hear the fabricated
percentage after the visible readout is suppressed), and `buildReceipt`'s
`laborPctAt` aside (`coverageChartModel.ts:190`), which renders in the pinned
receipt column beside the slider on the same tab. All three are gated.

## Goals

1. Show the implied labor % live next to the SPLH input on the Settings tab and
   the Planner's inline panel, warning when it exceeds `target_labor_pct` and
   naming the consistent SPLH.
2. Add a short helper line on both, clarifying that lowering SPLH increases
   recommended headcount.
3. Suppress the implied-% readout on **all three** surfaces when there is no real
   hourly wage to reason about.

## Non-goals

- Do **not** block saving. Warn only — a manager may knowingly run above target.
- No schema/DB change.
- No change to the demand math (`buildHourlyRecommendations`) or to `impliedLabor`
  / `laborConsistentSplh` semantics (tolerance stays `0.05`, `wage` stays dollars).

## Design

### 1. Relocate the shared math to the staffing-domain lib

`impliedLabor`, `laborConsistentSplh`, and `ImpliedLaborResult` move from
`src/lib/coverageChartModel.ts` to `src/lib/staffingCalculator.ts`, unchanged in
behavior and signature. Rationale: three surfaces across settings, planner, and
timeline now depend on the identity, and none of them is "the coverage chart";
`staffingCalculator.ts` already owns `computeAvgHourlyRateCents`, which produces
the `wage` these functions consume. This is a mechanical move — one production
import (`SplhSlider.tsx`) and one test block (`coverageChartModel.test.ts`
lines 87-144) follow it. No re-export shim; the imports are updated directly.

### 2. New roster predicate

```ts
/**
 * True when the roster has at least one active hourly employee — i.e. the wage
 * from computeAvgHourlyRateCents is real, not the DEFAULT_HOURLY_RATE_CENTS
 * ($15/hr) fallback.
 */
export function hasHourlyWageData(employees: Employee[] | undefined): boolean;
```

Mirrors `computeAvgHourlyRateCents`'s own filter
(`compensation_type === 'hourly' && is_active`) so the two never disagree. Lives
in `staffingCalculator.ts` beside it.

### 3. Expose wage + flag from the week-suggestions hook

`useWeekStaffingSuggestions` already computes `avgHourlyRateCents` internally
(line 77) but does not return it. Add `avgHourlyRateCents` and `hasWageData`
(from `hasHourlyWageData(employees)`) to its return object. Both new fields are
additive.

### 4. Surface changes

**Non-finite guard, all surfaces.** Callers must not pass `NaN`. The Settings
form holds SPLH/labor-% as raw strings with no coercion, and
`Number.parseFloat('')` is `NaN` while `NaN <= 0` is `false` — so a bare `> 0`
check lets `NaN` through into the arithmetic. Each surface gates on
`Number.isFinite(x) && x > 0` for both inputs before rendering.

**Colour token.** The over-target emphasis uses the semantic `text-warning`
token (`tailwind.config.ts:47-49`, `src/index.css:35-36`) — **not** raw
`text-amber-600 dark:text-amber-400`. CLAUDE.md forbids direct colours, and
`CoverageVerdict.tsx:70-71` already documents `text-warning` as this codebase's
convention for exactly this amber "over target" emphasis.

**(a) `SplhSlider.tsx`** — new required prop `hasWageData: boolean`, passed from
`ShiftTimelineTab` as `hasHourlyWageData(employees)`. When `false`:

- Hide the On/Over-target pill and the labor-consistent notch.
- Replace the `→ X% labor at $W/hr` readout with `Add hourly rates`, at
  `text-[13px] text-muted-foreground` (the same classes as the span it
  replaces). The copy is kept this short deliberately: it sits in a
  `whitespace-nowrap` flex row (`SplhSlider.tsx:99`) alongside the `$value`
  figure, so a longer sentence would overflow at 375px.
- Drop the labor % from `aria-valuetext` (`SplhSlider.tsx:141`), leaving
  `` `$${value}/hr` ``. Without this, screen-reader users still hear the
  fabricated percentage the visible change just suppressed.

The `$value` figure and the slider control itself are unaffected.

**(a2) `buildReceipt` (`coverageChartModel.ts`)** — takes a `hasWageData:
boolean` param (threaded from `ShiftTimelineTab.tsx:1045`). When `false`, omit
the `implied SPLH is $X/hr → Y% labor` aside (line 190-191) entirely, keeping the
rest of the receipt intact. While this call site is open, replace the aside's
hand-inlined `Math.round((wage / splhAt) * 100)` with a call to the relocated
`impliedLabor`, so the identity has one implementation rather than two.

**(b) `StaffingConfigPanel.tsx`** — new props `avgHourlyRateCents: number` and
`hasWageData: boolean`, threaded from the hook through `StaffingOverlay`. Under
the SPLH input, in an `aria-live="polite"` container at `text-[11px]`,
`max-w-[220px]` (so it wraps inside its flex column rather than displacing the
Labor% / Min Staff columns at 375px):

- Implied line: `≈ {pct}% labor at current wage`, coloured `text-warning` when
  `overTarget`, else `text-muted-foreground/80`.
- When `overTarget`, append: `— above your {target}% target, try ${Math.round(consistent)}`.
- A persistent directional line at `text-[11px] text-muted-foreground/70`:
  *"Lower SPLH → more staff recommended."*

**(c) `RestaurantSettings.tsx`** (Labor Planning tab) — add
`useEmployees(restaurantId)`, derive wage + flag, and parse the live form
strings. Same three lines under the Target SPLH help text, at `text-[13px]` to
match sibling captions, in an `aria-live="polite"` container. Gating on
`hasWageData` also means no `$15`-default flash while `useEmployees` loads.

The tab splits the two inputs across separate cards — `target_splh` in "Revenue
Targets" (~line 1122) and `target_labor_pct` in "Labor Constraints" (~line 1172)
— and at 375px the grid is single-column, so a manager editing Target Labor %
cannot see a hint anchored to the SPLH field. The same `aria-live` hint block is
therefore rendered under **both** fields, so the warning is present at whichever
field is being edited. Both render from the one derived value; the copy is
identical.

### Data flow

```
useEmployees ─┬─► computeAvgHourlyRateCents ──► wage (dollars, ÷100 at the call site)
              └─► hasHourlyWageData ──────────► hasWageData
                                                    │
target_splh, target_labor_pct ──────────────────────┤
                                                    ▼
                    impliedLabor() / laborConsistentSplh()   [staffingCalculator.ts]
                                                    ▼
              readout + warning + directional line  (Settings · Planner · Slider)
```

## Testing

**Moved tests** — the `impliedLabor` / `laborConsistentSplh` blocks move from
`tests/unit/coverageChartModel.test.ts` to `tests/unit/staffingCalculator.test.ts`
verbatim (behavior is unchanged; they must keep passing as-is).

**New in `tests/unit/staffingCalculator.test.ts`:**

- `hasHourlyWageData`: `undefined`, `[]`, and salaried-only rosters → `false`; an
  inactive hourly employee alone → `false`; ≥1 active hourly employee → `true`.
- Real-case integration of the identity: at `wage = 10`, `splh = 30`,
  `targetLaborPct = 25` → `pct ≈ 33.33`, `overTarget === true`, and
  `laborConsistentSplh` → `40`.
- Round-trip: feeding `laborConsistentSplh` back through `impliedLabor` yields
  `pct ≈ targetLaborPct` with `overTarget === false`.

**Component tests:**

- `StaffingConfigPanel`: hint hidden when `hasWageData` is false; hidden on a
  non-finite `target_splh`; muted line within tolerance; amber line + suggested
  value when over target; directional line always present when shown;
  `aria-live="polite"` wrapper.
- `RestaurantSettings` Labor Planning: same visibility matrix driven by the form
  strings, including the cleared-field (`NaN`) case, asserted under **both** the
  Target SPLH and Target Labor % fields.
- `splhSlider.test.tsx`: extend with `hasWageData={false}` → no pill, no notch,
  `Add hourly rates` copy, and `aria-valuetext` carrying no percentage; existing
  `hasWageData={true}` assertions unchanged.
- `coverageReceipt` / `buildReceipt`: with `hasWageData: false` the implied-SPLH
  aside is absent; with `true` it is byte-identical to today's output (guards the
  `impliedLabor` swap against rounding drift).
- `StaffingOverlay` wiring: `avgHourlyRateCents` / `hasWageData` reach the panel.

**Existing suites that must stay green unmodified:** the moved `impliedLabor` /
`laborConsistentSplh` blocks, and `tests/e2e/coverage-chart-explainer.spec.ts`
(its fixture seeds one active hourly employee, so `hasWageData` is `true` there
and its pill/notch assertions are unaffected by the new prop).

## Decided trade-offs

- **Move the helpers rather than import `coverageChartModel` from Settings.**
  A settings page importing a "coverage chart model" is a semantic wart; the
  move costs one import line and one test-block relocation.
- **Keep #650's `0.05` tolerance and dollar units.** Shipped, tested, and the
  difference from the originally-planned `0.1` is immaterial.
- **Warn, don't block** — a manager may knowingly run above target.
- **Directional helper is a visible line, not a tooltip** on the two new
  surfaces. The whole failure mode is that users never open the tooltip before
  mis-entering the value.
- **Inline per surface, shared math.** The three surfaces have different type
  scales and layouts; copy is kept consistent by convention rather than by a
  component that must flex across all three.
- **`SplhSlider`'s existing "Over target" pill keeps `bg-destructive/15
  text-destructive`.** New inline hint text uses `text-warning`. A filled status
  pill and inline body text are different affordances, and re-colouring
  just-shipped UI from #650 is churn this change does not need. Both are semantic
  tokens, so the CLAUDE.md rule is satisfied either way; harmonising the pill is
  noted as a follow-up rather than done here.
- **The Settings hint is duplicated under both inputs** rather than placed once
  between the two cards. Restructuring the tab's card layout is a larger,
  unrelated change; rendering the same derived block twice is the cheap fix that
  puts the warning at the point of edit.

## Superseded approach

The first revision of this design added a self-contained
`evaluateSplhConsistency(avgHourlyRateCents, targetSplh, targetLaborPct, hasWageData)`
to `staffingCalculator.ts` with a `0.1` tolerance and cents units. PR #650 landed
equivalent math first, so that helper is dropped in favor of reusing
`impliedLabor` / `laborConsistentSplh`. Only the `hasHourlyWageData` predicate
survives from that revision. Prior implementation preserved on the local branch
`backup/splh-pre-rebase` (commit `29a19faf`).
