# Design: Planner per-cell coverage — area scope + always-visible (PR #552 regression fix)

**Date:** 2026-06-26
**Branch:** `fix/planner-coverage-area-scope`
**Status:** Design — decided with user; brief pass

## Problem (regression shipped in PR #552, merged as c2868fb0)

The planner's per-cell coverage indicator renders on **0 of 28 active cells**. Confirmed by live
React-prop inspection (stable.easyshifthq.com, Wetzel's–Cold Stone, week 2026-06-29):

1. **Whole-restaurant scope.** `ShiftPlannerTab.coverageByTemplateDay` → `computeSlotCoverage`
   matches shifts by `position` only. Every shift in this restaurant has `position: 'Server'` (even
   Mixer/Oven/Dishwasher employees), so every `(template, day)` cell pools **all** same-position
   shifts across **both areas** (Cold Stone + Wetzel's) and all templates. A Cold Stone "Open" slot
   with 2 placed shifts reported `coveringEmployees: 10`. Result: all 28 active cells compute
   `coveragePct: 100, openSpots: 0`.
2. **Suppression.** `ShiftCell`'s `showCoverageIndicator = coverage !== undefined && !(coveragePct === 100 && shifts.length >= 1)`
   then hides all 28. The old per-cell `classifyCapacity` badge was removed in #552, so staffed
   cells now show nothing.

Net: the feature is invisible and uninformative — "looks nothing like the mockup" (the mockup was
implicitly per-slot/area-scoped). This is a design fault in #552, not a deploy issue (the full
feature code is confirmed live in the deployed bundle).

## Decided fix (user chose "scope by the template's area")

1. **Area-scope the planner cell coverage.** Count only shifts whose **employee's area** matches the
   template's `area` (plus position + window overlap). `shifts` has no `area` column, but `employees`
   do, and the planner already groups employees by area. Deriving shift area from the employee stops
   the always-100% pooling and surfaces real per-slot partial / half-shift coverage.
2. **Remove the suppression.** Always show the indicator on active cells
   (`showCoverageIndicator = coverage !== undefined`), including fully-covered ones, so the manager
   always sees "X of N + gaps".

## Implementation (keep the shared engine backward-compatible)

The engine `computeSlotCoverage` is shared with the restaurant-level banner (`Scheduling.tsx`) and
mirrors the SQL. The area filter must be **opt-in** so the banner/SQL/tests are unaffected.

| File | Change |
|---|---|
| `src/types/scheduling.ts` | Add optional `area?: string \| null` to `CoverageShift`. |
| `src/lib/shiftCoverage.ts` | Add a trailing optional `area?: string \| null` param to `computeSlotCoverage`. When non-null, additionally require `shift.area === area`. When omitted/null → **unchanged** behavior (no area filter). Document the back-compat contract. |
| `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` | In `coverageByTemplateDay` (~:133): build an `employeeId → area` map from the in-scope `employees`; set `area` on each `CoverageShift`; pass `t.area` as the new arg to `computeSlotCoverage`. |
| `src/components/scheduling/ShiftPlanner/ShiftCell.tsx` | `showCoverageIndicator = coverage !== undefined` (drop the `100% && shifts>=1` clause). Keep button/aria/semantic-tokens/sr-only/onCoverageClick. The `FallbackCapacityBadge` (`!coverage && capacity>1`) stays as the inactive-day/no-coverage fallback. |
| `CoverageDetail.tsx` | No logic change — renders whatever (now area-scoped) coverage it's given. |

## Constraints — DO NOT TOUCH

- **Banner** (`Scheduling.tsx` `computeOpenShiftCount`/`openShiftCount`): stays **whole-floor** (no
  area arg). That was the original "stop false needs-staff" fix; area-scoping it would re-introduce
  false positives when staff cross areas.
- **SQL** `get_open_shifts` / `claim_open_shift`: unchanged.

## Coverage semantics nuance (decided)

- A template with `area = null` (no area) → pass `null` → no area filter (counts all same-position),
  same as today. Only area-tagged templates get scoped.
- Area is the **employee's** home area (the planner's grouping dimension). An employee working
  outside their home area is rare and out of scope; documented.

## Tests

- `tests/unit/shiftCoverage.test.ts`: same-area shift counts; cross-area shift excluded; `area`
  null/undefined ⇒ no filtering (back-compat); a same-area half-shift fill-in ⇒ partial `coveragePct`
  + a gap segment. TZ-portable (`new Date(y,m,d)`).
- `tests/unit/shiftCellCoverageIndicator.test.tsx`: update suppression tests — the indicator now
  **always** renders when `coverage` is defined (incl. `coveragePct === 100` with placed shifts);
  remove the old "suppressed at 100%" assertions.
- `tests/unit/shiftPlannerCoverageWiring.test.ts` (or a new behavioral test): assert `area`/`t.area`
  is threaded into the coverage computation.

## Verify (real-data shape)

A Cold Stone "Open" (Need 2) cell counts only Cold Stone Servers (not Wetzel's Mixers); under-capacity
cells show "needs N"; fully covered show X/N; a same-area partial-window shift shows a gap.

## Phase 2.5 frontend-review resolutions (folded)

- **(crit) `employees` in deps.** `coverageByTemplateDay`'s `useMemo` deps become
  `[shifts, templates, weekDays, restaurantTimezone, employees]` — the new `employeeId → area` map
  is built from `employees`, so it must be a dependency or the area map goes stale.
- **(crit + major) Two-tier indicator with a non-color cue.** Removing suppression must not drown the
  grid. Render two weights:
  - **Fully covered** (`openSpots === 0`): quiet — `text-[10px] text-muted-foreground`, label `N/N`
    + a `Check` icon (`aria-hidden`), **no progress bar**. Matches `FallbackCapacityBadge`'s full
    tokens for consistency.
  - **Under-covered** (`openSpots > 0`): prominent — `text-[11px] text-destructive`, progress bar +
    `AlertTriangle` + `needs N`.
  The `Check` vs `AlertTriangle` icon is the WCAG 1.4.1 non-color differentiator.
- **(major) Options bag, not an 8th positional param.** `computeSlotCoverage(..., options?: { area?: string | null })`.
  Banner/SQL callers pass no options (unchanged). Planner passes `{ area: t.area }`.
- **(major) `aria-label` carries slot identity.** Thread a concise slot name (e.g.
  `${t.area ? t.area + ' ' : ''}${t.position}`) to `ShiftCell`; label reads
  `"<slot> <weekday>: <filled> of <capacity> staffed[, needs N more]. Open details"` — not a bare
  `"Coverage 100%"`.
- **(major) CoverageDetail heading includes area.** `coverageSlotLabel` prepends `t.area` when set
  (`"Cold Stone · Server · 10:00–4:30"`); when `t.area` is null, append `"(all areas)"` so the
  restaurant-wide list isn't mistaken for area-scoped.
- **(minor) a11y polish.** Remove `role="status"` from the static gap rows in `CoverageDetail`
  (it's not a live region). Keep the progress bar `aria-hidden`. Keep `onOpenAutoFocus` preventDefault
  but ensure the popover has a focusable element (the existing close affordance) so keyboard users can
  enter the list.

## Retrospective lesson (record in Phase 10)

Verify a data-driven UI feature against **real production data**, not just the mockup + isolated
fixtures. #552's indicator passed all tests + multi-model review + CodeRabbit, but real data has every
shift on one `position` ('Server') across multiple areas, so the position-only scope pooled the whole
restaurant → every cell 100% → suppression hid the feature. Add a browser/real-data smoke check before
declaring a data-driven UI feature done.
