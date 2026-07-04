# Design: Per-area coverage + demand legibility (co-brand)

**Date:** 2026-07-03
**Branch:** `feature/timeline-area-coverage` (stacked on `feature/timeline-coverage-redesign` / PR #566)
**Status:** Approved via interactive mock + decisions → design

## Problem

Live feedback on the shipped Timeline coverage panel (screenshot + a cold reviewer
who was confused):

1. **Demand is a black box.** The chart shows `−1` / `+3` but never *what you have
   vs. what's needed*, nor where "needed" comes from. Nothing on screen explains it.
2. **Area / co-brand is aggregated away.** The store is co-branded (Cold Stone +
   Wetzel's as separate `area`s). The coverage panel sums both brands into one
   number, so "short 1 at 11 AM" doesn't say *which brand* — and a Wetzel's employee
   can't cover a Cold Stone gap. (The `−2` bar vs "short 1" verdict is this blending:
   the aggregate sums both brands' shortfalls.)

## Constraint (from the code)

Coverage and demand are computed **whole-restaurant**. Per-area *coverage*
(scheduled) is trivial (filter shifts by area). Per-area *demand* is **not**
available: `computeStaffingSuggestions` derives demand from whole-restaurant
sales/SPLH with no brand split. Per the approved decision, this PR is
**coverage-only per area** — show each brand's *scheduled shape*; keep the shared
(whole-location) demand for the aggregate verdict; per-area demand targets are a
separate follow-up.

## Approach (approved)

### 1. Demand legibility (aggregate panel)

- **"How is needed set?" explainer** — an info affordance (shadcn `Popover`) on the
  coverage panel header. Copy: *"Needed staff = each hour's projected sales ÷ your
  target sales-per-labor-hour (SPLH), never below your minimum crew. Covered =
  scheduled ≥ needed."* with a link to Staffing settings.
- **`have / needed` cells** — `CoverageStatusStrip` cells show `2/3` (scheduled /
  needed) instead of a bare `✓` / `−1`, so the comparison is visible, not inferred.
  When demand is null, show just the scheduled count.

### 2. Per-area scheduled coverage (coverage-only)

- When **group-by = Area**, render a compact **per-area scheduled strip** for each
  area: one cell per hour showing that brand's scheduled headcount over the day, so
  the co-brand distribution is finally visible ("Cold Stone ramps at dinner;
  Wetzel's steady").
- These are **scheduled-only** (no red/green short/covered) because there's no
  per-area demand yet. A one-line footnote states: *"Demand targets are set for the
  whole location — per-brand targets coming soon."*
- When group-by = Position (or none), the per-area strips are hidden; the aggregate
  panel is unchanged.

## Architecture

| Unit | Responsibility | New/changed |
|---|---|---|
| `summarizeAreaCoverage` (`src/lib/coverageSummary.ts`) | Pure: `(shifts, employees, day, tz, window) → { area, hours: CoverageHour[] }[]` grouped by employee `area` (same key as `buildRosterDay`), each via `computeDayCoverage` + `summarizeCoverageHours(..., null, window)`. Scheduled-only. | new export |
| `AreaCoverageStrips.tsx` | Renders the per-area scheduled strips (area label + per-hour headcount cells). | new component |
| `CoverageDemandInfo.tsx` | The "How is needed set?" `Popover` trigger + content. | new component |
| `CoverageStatusStrip.tsx` | Cells show `have/needed`; keep `role="img"` + sr-only gap list. | changed |
| `ShiftTimelineTab.tsx` | Add `CoverageDemandInfo` to the panel header; render `AreaCoverageStrips` when `groupBy === 'area'`. | changed |

`summarizeAreaCoverage` reuses `computeDayCoverage` + the existing
`summarizeCoverageHours` (with `demand = null`) — no new coverage math.

## Non-goals (deferred)

- **Per-area demand** (short/covered per brand) — needs per-area sales split or
  manager-set per-area targets. Separate follow-up; this PR lays the per-area
  coverage groundwork it will build on.
- **Relabel `+/−` view / three-tier over-cost coloring** — not in scope.

## Accessibility

- Per-area cells: `role="img"` + `aria-label` ("Cold Stone, 6 PM, 5 scheduled").
- `CoverageDemandInfo`: keyboard-focusable trigger with `aria-label`; popover content
  is plain text.
- `have/needed` cell keeps a full `aria-label` ("6 PM, 3 of 5, short 2").

## Testing

| Layer | Location | Covers |
|---|---|---|
| `summarizeAreaCoverage` | `tests/unit/coverageSummary.test.ts` (extend) | grouping by area, scheduled-only per-hour, Unassigned bucket, empty day. `CRITICAL:`-prefixed per path instruction. |
| `CoverageStatusStrip` have/needed | `tests/unit/coverageStatusStrip.test.tsx` (extend) | cell shows `have/needed`; no-demand shows scheduled only |

## Decided trade-offs

- **Coverage-only per area** — ships the co-brand visibility now; per-area demand is
  a follow-up (avoids blocking on a sales-split / target-config data model).
- **Group by employee `area`** — consistent with `buildRosterDay` and the lane
  grouping, so the per-area strips line up with the lane bands the manager reads.
