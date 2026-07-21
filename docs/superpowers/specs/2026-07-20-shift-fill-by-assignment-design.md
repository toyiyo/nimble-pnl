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

## Out of scope

- Loaned-out ghost visual behaviour (preserved as-is).
- The `coveragePct` progress-bar semantics (kept as secondary info).
- Historical FK backfill.
