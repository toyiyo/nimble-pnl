# Design: Planner area-coverage visibility (co-branded stores)

**Date:** 2026-06-27
**Branch:** `feature/planner-area-coverage-visibility`
**Status:** Approved mockup → design

## Problem

In a co-branded / multi-area store (e.g. Wetzel's Pretzels × Cold Stone
Creamery sharing one location, or any restaurant that uses `area` to fence
employees to parts of the business), an employee can be scheduled into an
area that is **not their home area** ("covering"). The current planner makes
that invisible, plus a second class of shift is invisible entirely:

1. **Cross-area coverage is hidden from the home area.** Termora Johnson is a
   Cold Stone server, but her Saturday shift is bound to the Wetzel's
   `Close-weekend-wtz` template. Her chip renders only under the Wetzel's
   section. The Cold Stone Saturday coverage popover is area-filtered, so it
   excludes her too. A manager scanning Cold Stone never sees she's working —
   yet conflict detection (which ignores area) blocks re-booking her with
   "already scheduled."

2. **Off-template shifts render no chip at all.** `buildTemplateGridData`
   sends any shift that doesn't bucket to an active template (odd-time manual
   shifts, or shifts whose `shift_template_id` points to an archived template)
   to the `'__unmatched__'` bucket, which `TemplateGrid` never renders. Proven
   in prod this week: Corey Trussell (Tue/Wed 10:00–14:30) and Aleah Holderread
   (Wed/Thu 13:00–18:30) — manual shifts whose times match no template. They
   show no chip, but still count toward coverage and still block assignment.

**Root invariant we want:** anyone scheduled during a slot must be visible —
either as a chip in the grid or in the slot's coverage popover — and `area`
should be a first-class grouping, not a silent filter.

## Goals

Visibility, clarity, and reading the **schedule against the plan**. Four
features (all approved via the visual mockup):

1. **Covering chips** — a chip whose work area ≠ the employee's home area
   renders with a distinct "covering" treatment and a home-area origin badge.
2. **Loaned-out marker** — in the employee's home area, surface that they're
   working elsewhere, so home-area managers don't try to re-book them.
3. **Off-template lane** — a per-area "Off-template" row that surfaces
   unmatched / odd-time shifts as visible, time-stamped chips.
4. **Area-grouped coverage popover** — the popover lists everyone working the
   slot grouped by area ("On {area}" + "Covering from {area}"), and adds a
   "Covering elsewhere" group for the area's loaned-out staff.

## Data model: two area concepts

Every shift has two area facets. Making them explicit is the whole design.

| Concept | Definition | Source |
|---|---|---|
| **work area** | where the shift is *worked* | template's `area` if `shift_template_id` is set & active; else `employee.area` |
| **home area** | the employee's home area | `shift.employee.area` |

- **Covering** = `workArea != null && homeArea != null && workArea !== homeArea`.
  The person is working outside their home area.
- **Loaned out from area X** = `homeArea === X && workArea !== X`. Same
  condition, viewed from the home area's perspective.

`workArea` is exactly the existing `CoverageShift.area` (set by
`ShiftPlannerTab` since PR #554). We add `homeArea` alongside it.

The joined `employee` (`useShifts.tsx`: `select('*, employee:employees(*)')`)
already carries `area`, so both facets are available client-side with no query
change.

## Engine changes (`src/lib/shiftCoverage.ts`)

The coverage **math** (sweep-line `minConcurrent` / `openSpots`, mirrored in
SQL) does **not** change. Only the employee lists the engine emits change.

- `CoverageShift` gains `homeArea?: string | null`.
- `CoveringEmployee` gains `homeArea?: string | null` and `workArea?: string | null`.
- `computeSlotCoverage` continues to compute `coveringEmployees` from clips
  whose **work area** matches the slot (unchanged filter + counting), but now
  tags each with `homeArea` and `workArea`.
- New output `loanedOut: CoveringEmployee[]` — computed **only when**
  `options.area != null`: shifts whose `homeArea === options.area` **and**
  `workArea (s.area) !== options.area`, clipped to and overlapping the window,
  same position filter, cancelled excluded. Each carries `workArea` (where they
  went). Loaned-out staff do **not** affect `minConcurrent`/`openSpots` — they
  aren't filling this slot.

Counting semantics (confirmed correct, unchanged): a covering employee counts
toward the slot they're *working* (their work area), never toward their home
area. So Termora counts toward Wetzel's `2/2`, and does **not** fill a Cold
Stone slot.

`SlotCoverage` gains `loanedOut: CoveringEmployee[]` (always present; empty
array when `options.area` is null or none found). Additive → back-compatible.

## Component changes

### F1 — Covering chips (`EmployeeChip.tsx`, `ShiftCell.tsx`, `TemplateGrid.tsx`)

- `EmployeeChip` gains `homeArea?: string | null` and `cellArea?: string | null`.
  When both set and `homeArea !== cellArea`, render: dashed border + a small
  origin badge with the home-area name (e.g. `Cold Stone`). Otherwise unchanged.
- `ShiftCell` passes `cellArea={template.area}` (threaded from `TemplateGrid`'s
  `template.area`) and `homeArea={shift.employee?.area}` to each chip.

### F2 — Loaned-out ghost (`ShiftCell.tsx`)

- `ShiftCell` renders `coverage.loanedOut` as muted, non-interactive ghost rows:
  `↗ {name} · at {workArea}`. Visual: `text-muted-foreground`, dashed hairline,
  arrow icon — clearly "not here."
- **De-dup placement** (decided trade-off below): a loaned-out person overlaps
  *every* home-area template whose window overlaps their shift (e.g. both Cold
  Stone Open and Close). To avoid showing the same ghost in multiple rows, the
  engine returns `loanedOut` per template cell, and `ShiftPlannerTab` assigns
  each loaned-out (employee, day) to exactly **one** home-area cell: the
  same-position home-area template with the greatest window overlap (tie-break:
  earliest start, then template id). Implemented as a pure helper
  `assignLoanedOutCell(...)` so it's unit-testable. A loaned-out shift with no
  overlapping same-position home template shows no ghost (the person is still
  visible as a covering chip in their work area — never invisible).

### F3 — Off-template lane (`useShiftPlanner.ts`, `TemplateGrid.tsx`)

- Keep the existing `'__unmatched__'` bucket from `buildTemplateGridData`
  (already grouped by day). Use the **sentinel** key `'__unmatched__'` — never
  a display label (lesson PR #550: a real area named "Off-template" must not
  collide; the sentinel doubles safely as React key / DOM id).
- `TemplateGrid`: within each area group, render an **"Off-template"** row when
  that area has unmatched shifts. An unmatched shift's area = its `workArea`
  (`employee.area`, since unbound). Group the `'__unmatched__'` bucket's shifts
  by `employee.area` and render each area's under that area section; render the
  row only if non-empty (no empty-row noise).
- Off-template chips show name + actual time range (e.g. `Aleah H · 1:00p–6:30p`)
  with a clock / off-template treatment, plus the remove affordance. They are
  **not** droppable targets (no template to bind to) — they're read/manage only.
- Off-template shifts whose `employee.area` is null fall under the `Unassigned`
  area section's off-template row.

### F4 — Area-grouped popover (`CoverageDetail.tsx`, `ShiftPlannerTab.tsx`)

- `CoverageDetail` gains `slotArea?: string | null`. `CoverageList` groups
  `coveringEmployees`:
  - **On {slotArea}** — entries with `homeArea == slotArea` or `homeArea` null.
  - **Covering from {homeArea}** — entries with `homeArea !== slotArea`,
    sub-grouped by `homeArea`, each tagged with its origin area.
  - When `slotArea` is null (whole-restaurant template), render a single flat
    list (today's behavior) — no grouping.
- New **Covering elsewhere** group renders `coverage.loanedOut`: `{name} · at {workArea}`.
- `ShiftPlannerTab` passes `slotArea={coverageDetailTemplate?.area ?? null}`.

## Decided trade-offs

- **Inline loaned-out ghost (F2) is kept** (matches the approved mockup) despite
  the placement complexity, because it directly answers "I tried to add her and
  she was already scheduled — where is she?" at the point of confusion. The
  single-cell de-dup rule bounds the noise.
- **Loaned-out does not affect coverage counts.** A home-area slot still reads
  as under-covered when its people are loaned out — that's accurate; the work
  isn't being covered here. The ghost explains *why* the gap exists.
- **Off-template rows are not drag targets.** Binding an arbitrary-time shift to
  a template would change its hours; out of scope. Managers fix these via the
  existing schedule/day view.
- **No DB / RPC / SQL changes.** All four features are client-render concerns
  over data already fetched. The SQL `shift_slot_min_concurrent` parity is
  untouched (counting math unchanged).

## Test plan

Pure functions (unit, direct-import — Sonar counts conditions):

- `computeSlotCoverage`: covering tag (homeArea/workArea on coveringEmployees);
  `loanedOut` populated for cross-area home match; `loanedOut` empty when
  `options.area` null; loaned-out excluded from `openSpots`; back-compat
  (existing 20 tests stay green).
- `assignLoanedOutCell`: greatest-overlap selection; tie-break earliest start
  then id; no-match → no cell; overnight window overlap.
- `buildTemplateGridData`: unmatched bucket retains shifts (existing 43 tests
  green); helper to group unmatched by area.
- Covering predicate edge cases: workArea null, homeArea null, equal areas →
  not covering.

Component (where logic-bearing): `CoverageList` grouping (on-area vs covering-
from vs elsewhere), off-template row visibility (hidden when empty). Prefer one
fixture exercising multiple branches per Sonar branch-coverage guidance.

## Out of scope

- Reassigning / binding off-template shifts from the planner.
- Changing the SQL open-shift coverage function.
- Mobile-specific re-layout beyond what the shared components already do.
