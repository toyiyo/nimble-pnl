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
- New **per-cell** output `loanedOut: CoveringEmployee[]` — computed **only when**
  `options.area != null`: shifts whose `homeArea === options.area` **and**
  `workArea (s.area) !== options.area`, clipped to and overlapping the window,
  same position filter (so loaned-out is already position-matched), cancelled
  excluded. Each carries `workArea` (where they went) plus the clipped
  `startMin`/`endMin` (so overlap length = `endMin − startMin` is available to
  the de-dup helper without recomputation). Loaned-out staff do **not** affect
  `minConcurrent`/`openSpots` — they aren't filling this slot. This per-cell
  list feeds the **popover** (F4); the inline **ghost** (F2) is a deduped view
  derived from it.

**Complexity:** `computeSlotCoverage` already scans all candidate shifts per
cell (O(shifts) per cell); the loaned-out branch is one extra condition in the
same loop, not a new pass — no change to the O(templates × days × shifts)
budget of the existing `coverageByTemplateDay` memo. It's gated on
`options.area != null` so whole-restaurant templates skip it entirely.

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
- **Memo comparator (required):** `EmployeeChip` and `ShiftCell` are both
  `memo`'d with custom comparators. `homeArea`/`cellArea` MUST be added to
  `EmployeeChip`'s comparator, and any new `ShiftCell` props to its comparator,
  or covering state will be suppressed across re-renders.
- **Origin badge styling:** semantic tokens only — `bg-muted/50
  text-muted-foreground`, `text-[10px]`, with `truncate max-w-[72px]` so long
  area names (e.g. "Wetzel's Pretzels") can't overflow the chip. No raw color
  literals.
- **A11y:** the covering context is added to the Remove button's accessible
  name: `Remove {name} from shift (covering from {homeArea})`, so screen-reader
  users get the context without reading the badge.
- `ShiftCell` passes `cellArea={template.area}` (threaded from `TemplateGrid`'s
  `template.area`) and `homeArea={shift.employee?.area}` to each chip.

### F2 — Loaned-out ghost (`ShiftCell.tsx`)

- `ShiftCell` renders the loaned-out ghosts as muted, **non-interactive** rows:
  `↗ {name} · at {workArea}`. Visual: `text-muted-foreground`, dashed hairline,
  arrow icon — clearly "not here." The rows contain **no focusable descendants**
  (no buttons/links), so they add no keyboard-trap risk inside the droppable
  cell; the row carries an `aria-label` (`{name} working {workArea} this slot`)
  so it stays screen-reader legible.
- **De-dup placement** (decided trade-off below): a loaned-out person overlaps
  *every* home-area template whose window overlaps their shift (e.g. both Cold
  Stone Open and Close), so the engine's per-cell `loanedOut` lists them in
  multiple cells. To show the inline ghost exactly once, the pure helper
  `assignLoanedOutCell(coverageByTemplateDay, templateStartById)` consumes the
  already-computed per-cell `loanedOut` (no overlap recomputation) and, for each
  `(employeeId, day)`, keeps the single best cell. Selection order
  (deterministic): **(1)** greatest clipped overlap (`endMin − startMin`);
  **(2)** earliest template start; **(3)** template id (lexicographic — stable
  within a dataset). Position-match is already guaranteed by the engine's
  position filter. Returns `Map<\`${templateId}:${day}\`, CoveringEmployee[]>`,
  threaded to `ShiftCell` as a `ghostLoanedOut` prop (added to the memo
  comparator). A loaned-out shift with no overlapping same-position home
  template appears in no cell's `loanedOut`, so it shows no ghost — the person
  is still visible as a covering chip in their work area (never invisible).

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
  with a clock / off-template treatment, plus the remove affordance. They render
  in a **separate read-only component** (`OffTemplateRow` / cell) that does
  **not** call `useDroppable` — there is no template to bind to, so the row is
  not a drag target and uses no synthetic `templateId` (which would break the
  `over.id.split(':')` → `templates.find` path in `handleDragEnd`).
- Off-template shifts whose `employee.area` is null fall under the `Unassigned`
  area section's off-template row.

### F4 — Area-grouped popover (`CoverageDetail.tsx`, `ShiftPlannerTab.tsx`)

- `CoverageDetail` gains a `slotArea?: string | null` prop, threaded
  `ShiftPlannerTab` (`slotArea={coverageDetailTemplate?.area ?? null}`) →
  `CoverageDetail` → `CoverageList`. `CoverageList` groups `coveringEmployees`:
  - **On {slotArea}** — entries with `homeArea == slotArea` or `homeArea` null.
  - **Covering from {homeArea}** — entries with `homeArea !== slotArea`,
    sub-grouped by `homeArea`, each tagged with its origin area.
  - When `slotArea` is null (whole-restaurant template), render a single flat
    list (today's behavior) — no grouping.
- New **Covering elsewhere** group renders `coverage.loanedOut`
  (`{name} · at {workArea}`) — **only when non-empty** (no orphan heading).
- **Group headings** reuse the existing label scale already used for the "Gaps"
  heading: `text-[11px] font-medium text-muted-foreground uppercase
  tracking-wider`. List items keep the `text-[13px]` scale.
- **List keys** are namespaced to avoid collisions across sections:
  `on-${id}-${i}`, `cov-${id}-${i}`, `loaned-${id}-${i}`.
- **Header wording:** the panel now shows multiple areas + loaned-out, so the
  title/`aria-label`/`DrawerTitle` change from "Covering employees for this
  slot" to **"Staff for this slot"** (desktop `PopoverContent` aria-label,
  desktop title text, and mobile `DrawerTitle` all updated).

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

## Design review folded in (2026-06-27)

Frontend design-reviewer concerns and resolutions:

- **[critical] Memo comparators** — `homeArea`/`cellArea` added to
  `EmployeeChip`'s comparator; `ghostLoanedOut` (+ any new props) added to
  `ShiftCell`'s comparator. Captured in F1/F2.
- **[critical] Ghost rows** — non-interactive, no focusable descendants, carry
  an `aria-label`; no Single-Dialog / keyboard-trap impact. Captured in F2.
- **[major] `homeArea` construction site** — the `coverageByTemplateDay` memo in
  `ShiftPlannerTab.tsx` (the `cov: CoverageShift[]` map, ~L150–161) MUST set
  `homeArea: s.employee?.area ?? null` in addition to the existing `area`
  (workArea), or `loanedOut` is always empty. Explicit build step in the plan.
- **[major] `'__unmatched__'` collision** — the sentinel lives in the gridData
  **templateId keyspace** (real keys are UUIDs), so it cannot collide with a
  template id. Off-template rows are grouped by `employee.area` compared against
  the area-section name — a different namespace from the bucket key. The
  rendered label is always "Off-template", never the sentinel. No change needed;
  reasoning documented. (The pre-existing `UNASSIGNED = 'Unassigned'` literal in
  `templateAreaGrouping.ts` is unchanged — out of scope.)
- **[major] Origin badge** — semantic tokens + `truncate max-w-[72px]`. F1.
- **[major] `assignLoanedOutCell` determinism** — position-match guaranteed
  upstream; tie-break overlap → earliest start → id. F2.
- **[major] Popover headings scale / droppable off-template / loaned-out
  complexity** — all addressed in F3/F4 and the engine complexity note.
- **[minor] covering in accessible name, namespaced list keys, suppress empty
  "Covering elsewhere", header wording** — all folded into F1/F4.

## Out of scope

- Reassigning / binding off-template shifts from the planner.
- Changing the SQL open-shift coverage function.
- Mobile-specific re-layout beyond what the shared components already do.
