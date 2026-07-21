# Design: Shift "filled" reflects who's actually assigned (not position coverage)

**Date:** 2026-07-20
**Branch:** `fix/shift-fill-by-assignment`
**Type:** Bug fix (scheduling correctness)

## Problem

At Rush Bowls (and any restaurant with multiple same-position templates), the
schedule grid shows a template as **filled ("1/1 ✓") with zero employee chips**.
Because the slot looks filled, managers can't tell it's open, and employees
can't claim it — the open shift is hidden from the "Available Shifts" list and
`claim_open_shift` rejects the claim with *"No open spots available."*

## Root cause (confirmed by reading the code)

Each grid cell has **two independent sources of truth that disagree**:

| Signal | Source | Rule |
|---|---|---|
| Employee **chips** | `buildTemplateGridData` ([useShiftPlanner.ts:125](../../../src/hooks/useShiftPlanner.ts)) | Bucketed by **exact `shift_template_id`** (legacy fallback: exact time/position/day/area) |
| **"1/1 ✓" badge** | `computeSlotCoverage` ([shiftCoverage.ts:112](../../../src/lib/shiftCoverage.ts)) | Counts **every same-`position` shift in the whole week** overlapping the window — **never checks `shift_template_id`** |

`computeSlotCoverage` filters only by `position` (line 132) + optional `area`,
and its candidate list ([ShiftPlannerTab.tsx:229](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx))
is built from the **entire week's shifts**. So one employee on a long shift
(e.g. 8a–4p, position "Crew") satisfies the coverage sweep for *every* other
same-position template whose window sits inside 8a–4p — marking them filled with
no chips.

The **server mirrors the identical flaw**: `shift_slot_min_concurrent`
([20260626120000_open_shift_coverage.sql:64](../../../supabase/migrations/20260626120000_open_shift_coverage.sql))
filters by `restaurant_id + position + date + status` only. It backs both
`get_open_shifts` (drops the slot when `open_spots <= 0`) and `claim_open_shift`
(rejects the claim). Same over-count → genuinely-open slots look full.

The banner count `computeOpenShiftCount` ([Scheduling.tsx:164](../../../src/pages/Scheduling.tsx))
uses the same whole-floor `computeSlotCoverage` and therefore has the same bug.

### Why it was built this way

The coverage sweep was a **deliberate** replacement of exact-time matching so a
"fill-in with a different start/end time correctly reduces open_spots" (migration
comments). The mistake was scoping the sweep by **position across the whole
restaurant** instead of by **the template the shift belongs to**.

## Decided semantics (approved by user)

> A template slot is **filled** when **≥ `capacity` distinct employees are
> assigned to *that template* (by ID)** on that date — regardless of whether
> their hours span the whole window.
>
> `openSpots = max(0, capacity − distinctAssignedCount)`

A cell with no chips can therefore **never** show as filled. Chips and badge
become one signal by construction.

Trade-off accepted vs. the old sweep: a single assignee whose hours cover only
part of the window now counts the slot as filled (the user explicitly chose
this). The time-based `coveragePct` bar is retained as *secondary* information
(shown only when the slot still has open spots).

## The single "belongs to template" predicate

All fill computations (client badge, banner, server RPCs) use one rule,
mirroring `buildTemplateGridData` / `findAreaAwareTemplate`
([templateAreaMatch.ts](../../../src/lib/templateAreaMatch.ts)):

```
belongs(shift, template, day) :=
     shift.status <> 'cancelled'
  AND localDate(shift.start_time) == day
  AND (
        shift.shift_template_id == template.id                       -- FK match
     OR ( shift.shift_template_id IS NULL                            -- legacy fallback
          AND shift.position == template.position
          AND localTime(shift.start_time) == template.start_time
          AND localTime(shift.end_time)   == template.end_time
          AND template active on day
          AND areaCompatible(template.area, employee.area) )         -- null on either side = permissive
     )
```

`distinctAssignedCount(template, day) = COUNT(DISTINCT employee_id where belongs)`.

## Design — Client

The planner already computes `templateGridData` (the per-template buckets that
drive the chips). The fix reuses that bucket for the fill badge, so chips and
badge can never diverge.

1. **New pure helper** `src/lib/shiftFill.ts`:
   - `distinctAssignedCount(bucketShifts): number` — distinct non-cancelled
     `employee_id` in a template's day-bucket.
   - `computeCellFill(bucketShifts, capacity, { position, tz, dateStr, windowStart, windowEnd }): SlotFill`
     returning `{ assignedCount, openSpots, coveragePct, segments, coveringEmployees }`.
     `openSpots = max(0, capacityFloor(capacity) − assignedCount)`.
     `coveragePct`/`segments`/`coveringEmployees` come from the existing
     sweep-line **run over the bucket only** (for the progress bar + popover).
2. **Extract `computeLoanedOut(allShifts, opts)`** from `computeSlotCoverage`'s
   loaned-out branch into `src/lib/loanedOut.ts` (or a sibling). Ghosts genuinely
   need the whole-floor set — they stay whole-floor and are computed in a
   separate pass, unchanged behaviourally.
3. **`ShiftPlannerTab.tsx`**: build `coverageByTemplateDay` from
   `templateGridData.get(t.id).get(day)` via `computeCellFill`; build
   `ghostByCell` from `computeLoanedOut` over the whole-floor set (as today).
   `SlotCoverage.openSpots` now reflects assignment count.
4. **`ShiftCell.tsx`**: no logic change — it already renders from
   `coverage.openSpots` / `coveragePct` / `filledCount = capacity − openSpots`.
   The fix upstream makes those correct. (Verify `coveringEmployees` popover.)
5. **`Scheduling.tsx` `computeOpenShiftCount`**: replace whole-floor
   `computeSlotCoverage` with `buildTemplateGridData` + `distinctAssignedCount`,
   summing `openSpots` per (template, day).
6. **Retire `computeSlotCoverage`** once the two responsibilities above are
   split out (fill + loanedOut). Keep its sweep-line internals (reused by
   `computeCellFill`).

## Design — Server (new migration)

New migration `supabase/migrations/<ts>_shift_fill_by_assignment.sql`:

1. **`shift_template_assigned_count(p_restaurant_id, p_template_id, p_date, p_tz) RETURNS int`**
   — `COUNT(DISTINCT s.employee_id)` over `shifts s` joined to the template,
   applying the `belongs()` predicate above (FK match OR null-FK exact-time +
   position + area-compatible fallback). `STABLE SECURITY DEFINER
   SET search_path = public`; `REVOKE` direct execute (same posture as
   `shift_slot_min_concurrent`).
2. **`get_open_shifts`** — replace the `CROSS JOIN LATERAL
   shift_slot_min_concurrent` with `shift_template_assigned_count(...)`.
   `open_spots = GREATEST(1, capacity) − assigned − pending`. All other
   behaviour (enabled gate, published-date/future filter, pending subtraction,
   ordering, grant) preserved.
3. **`claim_open_shift`** — (a) compute `v_assigned_count` via
   `shift_template_assigned_count`; (b) **stamp `shift_template_id =
   p_template_id`** on the `INSERT INTO shifts` (currently omitted, line ~414)
   so instantly-approved claims count by FK on the next read. Guard arithmetic
   unchanged (`assigned + pending >= GREATEST(1, capacity)`).
4. **Drop `shift_slot_min_concurrent`** if no other object references it
   (grep confirms only these two callers). Otherwise leave it.

### Decided trade-offs (server)

- **No data backfill.** Existing null-FK shifts keep matching via the legacy
  fallback; new planner/claim/AI shifts already carry the FK (PR #511 + this
  PR). Backfilling FKs onto historical rows is risky (ambiguous matches) and out
  of scope.
- **Legacy-fallback double-attribution edge case.** A null-FK shift whose exact
  time/position matches *two* active templates differing only by `area` (one
  area-specific, one area-agnostic) is counted for both by the per-template
  predicate, whereas `buildTemplateGridData` attributes it to one (prefer
  same-area). This requires legacy null-FK data **and** overlapping same-time
  area-variant templates — rare. Documented; flagged for the Supabase design
  reviewer. If deemed material, resolve each null-FK shift to a single template
  via a `LATERAL` preferred-pick before counting.

## Testing

- **Unit** (`tests/unit/shiftFill.test.ts`): `distinctAssignedCount` (dedupe one
  employee w/ two shifts; ignore cancelled); `computeCellFill` (empty bucket →
  `openSpots == capacity`; assigned-but-partial-hours → filled; capacity floor).
  Regression: a same-position shift in a *different* template's bucket does not
  affect this cell. `computeLoanedOut` parity with prior `computeSlotCoverage`
  loaned-out output. `computeOpenShiftCount` banner: cross-template contamination
  gone. Count branches for Sonar (≥ 80% new-code, conditions not lines).
- **pgTAP** (`supabase/tests/shift_fill_by_assignment.test.sql`): dates relative
  to `CURRENT_DATE` (no hardcoded future dates); delete-before-insert fixtures.
  Cases: (a) template with a same-position shift assigned to a *different*
  template → `get_open_shifts` still lists it, `claim_open_shift` succeeds;
  (b) FK-assigned shift fills the slot → excluded from open, claim rejected;
  (c) `claim_open_shift` stamps `shift_template_id`; (d) legacy null-FK exact
  match counts; (e) distinct-employee dedupe.

## Design Review Resolutions (Phase 2.5)

Both design reviewers (Supabase + Frontend) ran against this doc. Resolutions:

### Client — keep `SlotCoverage`, don't introduce a field-dropping type

The reviewers flagged (Critical C1 / Major C2) that dropping `loanedOut` from
the cell type breaks `assignLoanedOutCell` ([loanedOut.ts:29](../../../src/lib/loanedOut.ts))
and `CoverageDetail`'s "Covering elsewhere" section
([CoverageDetail.tsx:76](../../../src/components/scheduling/ShiftPlanner/CoverageDetail.tsx),
which reads `coveringEmployees`, `segments`, **and** `loanedOut` off `coverage`).

**Resolution: keep the `SlotCoverage` type and all its fields.** Do not add a
`SlotFill` type. Instead:

- `computeCellFill(bucketShifts, capacity, { position, tz, dateStr, windowStart, windowEnd })`
  returns the fill fields **only** — `{ minConcurrent, openSpots, coveragePct,
  segments, coveringEmployees }` — computed over the template's own bucket, with
  `openSpots = max(0, capacityFloor(capacity) − distinctAssignedCount)` and
  `distinctAssignedCount = COUNT(DISTINCT employee_id)` among the bucket's
  non-cancelled shifts.
- `computeLoanedOut(shiftsForDay, { position, tz, dateStr, windowStart, windowEnd, area })`
  returns `CoveringEmployee[]` — the loaned-out ghosts for one (template, day),
  extracted verbatim from `computeSlotCoverage`'s current loaned-out branch. It
  still needs the **whole-floor** shift set for that day.
- **`ShiftPlannerTab` assembles** `SlotCoverage = { ...computeCellFill(bucket),
  loanedOut: computeLoanedOut(wholeFloorForDay) }`. So the map stays
  `Map<templateId, Map<day, SlotCoverage>>` with `loanedOut` populated —
  `assignLoanedOutCell`, `CoverageDetail`, `ShiftCell`, and `TemplateGrid` keep
  their exact signatures. **No type migration.**

This makes `computeSlotCoverage` decompose into `computeCellFill` +
`computeLoanedOut`; the whole-floor function is retired.

- **Perf (Minor C5):** pre-group the week's shifts into `Map<day, CoverageShift[]>`
  **once** before the template loop, so `computeLoanedOut` iterates only that
  day's shifts, not the whole week per (template, day). `computeCellFill` already
  gets an O(1)-sized bucket.
- **`React.memo` (Major C3):** replace `ShiftCell`'s `prev.coverage ===
  next.coverage` identity check with a primitive comparison
  (`openSpots`, `coveragePct`, `coveringEmployees.length`, `loanedOut.length`)
  since the coverage map is rebuilt wholesale on every edit and identity always
  fails today. Keep the rest of the comparator as-is.
- **coveragePct narrowing (Minor C8):** scoping the sweep to the bucket makes
  `coveragePct`/`segments` legitimately narrow for slots that previously showed
  phantom cross-template coverage — intended. Add a `CoverageDetail`/`computeCellFill`
  unit assertion pinning it.
- **Over-assignment badge (Minor C7):** 2 employees on a capacity-1 template
  still renders "1/1" (`filledCount = capacity − openSpots` clamps). Pre-existing,
  not a regression. **Spawn-off**, not this PR.

### Server — preferred-pick UNION, and fix the second FK-omitting path

- **Critical S1 — `approve_open_shift_claim` also omits the FK.** Migration
  `20260707090000_approve_open_shift_claim_active_guard.sql` creates the shift on
  the manager-approval path and omits `shift_template_id`. **Add task:**
  `CREATE OR REPLACE approve_open_shift_claim` to stamp
  `shift_template_id = v_claim.shift_template_id` on its `INSERT INTO shifts`.
  Without this, approval-required restaurants keep minting null-FK shifts forever.
- **Major S1 + S2 — preferred-pick, structured as UNION.**
  `shift_template_assigned_count` returns `COUNT(*)` over a `UNION` (dedupes
  employees across branches) of:
  - **Branch A (FK):** `SELECT employee_id FROM shifts WHERE shift_template_id =
    p_template_id AND …` — served by the partial index
    `idx_shifts_shift_template_id`.
  - **Branch B (null-FK preferred-pick):** null-FK shifts on the date whose
    `LATERAL` best-match template resolves to `p_template_id`. The LATERAL mirrors
    `findAreaAwareTemplate`: filter active templates by exact start/end time +
    position + `EXTRACT(DOW …) = ANY(days)` + `isAreaCompatible(t.area, e.area)`
    (join `employees e`), `ORDER BY (t.area IS NOT DISTINCT FROM e.area) DESC,
    t.start_time, t.id LIMIT 1`. This attributes each legacy shift to exactly one
    template — no double-count. Served by `idx_shifts_restaurant_position_status`.
  - The deterministic tie-break when the employee has no area differs slightly
    from the client's arbitrary input-order pick; both are single-attribution, so
    chips/badge can't diverge. Documented minor divergence in a rare legacy case.
  - Verify with `EXPLAIN ANALYZE` that both index paths are used (no seq scan).
- **Minor S1 — spell out "active on day"** = `is_active = true` **AND**
  `EXTRACT(DOW FROM p_date)::int = ANY(t.days)`, in the migration comments.
- **Minor S2 — defense in depth:** `shift_template_assigned_count` joins
  `shift_templates` on `id = p_template_id AND restaurant_id = p_restaurant_id`,
  so a mismatched pair returns 0 rather than leaking another tenant's data.
- **Minor S3 — per-(template,date) call:** `SECURITY DEFINER` prevents inlining,
  so `get_open_shifts` makes one real function call per row (same shape as the old
  `shift_slot_min_concurrent`). Acceptable at per-restaurant scale; documented.
- **Minor S4 — DROP `shift_slot_min_concurrent`** only after re-grepping the final
  tree for references; bare `DROP` (no `CASCADE`) fails safe on any dependency.

## Phase 7 Review Decisions (post-build)

Two Phase-7 findings needed a human call (the workflow correctly halted):

1. **Codex CRITICAL — `approve_open_shift_claim` has no authorization check**
   (any authenticated employee can self-approve their own pending claim,
   bypassing the manager gate; cross-restaurant approval possible). This is
   **pre-existing** (inherited from `20260707090000`), not introduced here — this
   migration only added the FK stamp. **Decision: spin off** a dedicated security
   PR (manager-role + restaurant-membership guard, with pgTAP), to keep this
   correctness fix focused. Filed as a separate task. Documented here as a known,
   out-of-scope pre-existing risk.

2. **Sound-logic MAJOR — banner day-bucketing regressed to browser timezone.**
   Design step 5 moved `computeOpenShiftCount` onto `buildTemplateGridData`,
   which bucketed shifts to days in the **viewer's** timezone. **Decision
   (user): everything schedule-related must render in the restaurant timezone**
   (a manager was hit by this while travelling). **Fixed in this PR:**
   `buildTemplateGridData` now takes the restaurant `tz` and resolves calendar
   day, time-of-day, and day-of-week in it (new `formatLocalTimeInTz` helper);
   both callers (`ShiftPlannerTab`, `computeOpenShiftCount`) pass it. Chips,
   banner, and the SQL (`… AT TIME ZONE p_tz`) now agree for any viewer. A
   broader schedule-tz audit (`buildGridData` employee view, `plannerExport`,
   `usePlannerShiftsIndex`) is a **follow-up** — those are pre-existing
   browser-local paths outside this fix's surface.

**E2E coverage added:** `tests/e2e/open-shift-claiming.spec.ts` — an overlapping
same-position regular-calendar shift (different employee) must not hide the open
shift; asserts it stays offered (assigned 0 / open 1), is claimable through the
UI, the claimed shift is FK-stamped, and the filled capacity-1 slot then drops
out of the open list.

## Out of scope

- Loaned-out ghost visual behaviour (preserved as-is).
- The `coveragePct` progress-bar semantics (kept as secondary info).
- Historical FK backfill.
- Over-assignment badge display (Minor C7) — spawn-off.
- `approve_open_shift_claim` authorization hardening — spun-off security PR.
- Broader schedule-tz audit (`buildGridData`, `plannerExport`) — follow-up.
