# Plan: Shift fill by assignment (not position coverage)

Design: [2026-07-20-shift-fill-by-assignment-design.md](../specs/2026-07-20-shift-fill-by-assignment-design.md)

Each task is RED → GREEN → REFACTOR → COMMIT. Client and server are independent
until wiring; server tasks (7–12) can proceed in parallel with client (1–6).

## Client

### Task 1 — `computeCellFill` pure helper
- **File:** `src/lib/shiftFill.ts` (new), `tests/unit/shiftFill.test.ts` (new).
- **RED:** tests — empty bucket → `openSpots == capacity`, `assignedCount == 0`;
  one employee with two shifts in bucket → `assignedCount == 1`; cancelled shift
  ignored; partial-hours single assignee (capacity 1) → `openSpots == 0`
  (filled); `capacityFloor` coercion (0/NaN → 1); `coveragePct`/`segments`
  produced from the sweep over the bucket; over-assignment (2 in cap-1) →
  `openSpots == 0`, `assignedCount == 2`.
- **GREEN:** implement `computeCellFill(bucketShifts, capacity, { position, tz,
  dateStr, windowStart, windowEnd })` returning `{ minConcurrent, openSpots,
  coveragePct, segments, coveringEmployees }`. Reuse the existing sweep-line
  math from `shiftCoverage.ts` for `coveragePct`/`segments`/`coveringEmployees`;
  `openSpots = max(0, capacityFloor(capacity) − distinctAssignedCount)`.
- **Deps:** none.

### Task 2 — `computeLoanedOut` extraction
- **File:** `src/lib/shiftCoverage.ts` (add export) or `src/lib/loanedOut.ts`;
  `tests/unit/shiftCoverage.test.ts` (extend) or new.
- **RED:** parity tests — same inputs that today produce `computeSlotCoverage(...).loanedOut`
  produce identical `CoveringEmployee[]` from `computeLoanedOut`; area filter
  off → `[]`.
- **GREEN:** extract the loaned-out branch (`shiftCoverage.ts:143-161`) into
  `computeLoanedOut(shiftsForDay, { position, tz, dateStr, windowStart,
  windowEnd, area })` returning `CoveringEmployee[]`.
- **Deps:** none.

### Task 3 — Wire `ShiftPlannerTab` to assemble per-cell `SlotCoverage`
- **File:** `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`.
- **RED:** none new (integration; covered by helper tests + existing tab tests if
  any). If a testable pure builder is extracted, unit-test it.
- **GREEN:** replace the `coverageByTemplateDay` `useMemo`: pre-group shifts into
  `Map<day, CoverageShift[]>` once; for each (template, active day), assemble
  `SlotCoverage = { ...computeCellFill(templateGridData.get(t.id)?.get(day) ?? [],
  t.capacity, {…}), loanedOut: computeLoanedOut(byDay.get(day) ?? [], {…, area:
  t.area}) }`. Keep `ghostByCell`/`assignLoanedOutCell` unchanged.
- **Deps:** Tasks 1, 2.

### Task 4 — Banner `computeOpenShiftCount`
- **File:** `src/pages/Scheduling.tsx`; `tests/unit/*` (find existing
  `computeOpenShiftCount` test, extend).
- **RED:** regression test — a same-position shift assigned to a *different*
  template does NOT reduce this template's open count; FK-assigned shift does.
- **GREEN:** rebuild using `buildTemplateGridData` + `distinctAssignedCount`
  (export the count helper from `shiftFill.ts`), summing `openSpots` per
  (template, day).
- **Deps:** Task 1.

### Task 5 — `ShiftCell` memo comparator
- **File:** `src/components/scheduling/ShiftPlanner/ShiftCell.tsx`.
- **RED:** (optional) — hard to unit-test memo; rely on manual/UI review.
- **GREEN:** compare `prev.coverage?.openSpots === next.coverage?.openSpots &&
  …coveragePct && …coveringEmployees.length && …loanedOut.length` instead of
  `prev.coverage === next.coverage`.
- **Deps:** Task 3.

### Task 6 — Retire `computeSlotCoverage`
- **File:** `src/lib/shiftCoverage.ts` + callers.
- **GREEN:** remove `computeSlotCoverage` once Tasks 1–4 land; keep shared sweep
  internals used by `computeCellFill`. Update/trim `shiftCoverage.test.ts`.
- **Deps:** Tasks 1–4.

## Server

### Task 7 — `shift_template_assigned_count` function
- **File:** `supabase/migrations/20260720120000_shift_fill_by_assignment.sql` (new).
- **GREEN:** `CREATE FUNCTION shift_template_assigned_count(p_restaurant_id,
  p_template_id, p_date, p_tz) RETURNS int` — `COUNT(*)` over `UNION` of Branch A
  (FK) + Branch B (null-FK `LATERAL` preferred-pick), per design. `STABLE
  SECURITY DEFINER SET search_path = public`; `REVOKE EXECUTE … FROM PUBLIC,
  authenticated`. Join `shift_templates` on `id AND restaurant_id` (defense in
  depth). Comment the two "active on day" conditions.
- **Deps:** none. **Tested in Task 12.**

### Task 8 — Rewrite `get_open_shifts`
- **Same migration file.** Replace `CROSS JOIN LATERAL shift_slot_min_concurrent`
  with `shift_template_assigned_count`. `open_spots = GREATEST(1, capacity) −
  assigned − pending`. Preserve enabled gate, future/published filter, ordering,
  grant.
- **Deps:** Task 7.

### Task 9 — Rewrite `claim_open_shift`
- **Same migration file.** `v_assigned_count := shift_template_assigned_count(…)`;
  stamp `shift_template_id = p_template_id` on `INSERT INTO shifts`. Guard
  arithmetic unchanged. Preserve advisory lock, conflict check, approval branch,
  grant.
- **Deps:** Task 7.

### Task 10 — Rewrite `approve_open_shift_claim` (FK stamp)
- **Same migration file.** `CREATE OR REPLACE` from
  `20260707090000_...`, adding `shift_template_id = v_claim.shift_template_id`
  to its `INSERT INTO shifts`. Everything else verbatim.
- **Deps:** none (independent).

### Task 11 — DROP `shift_slot_min_concurrent`
- **Same migration file.** After Tasks 8–9 remove its callers, `grep -rn` the
  final tree; if zero references, `DROP FUNCTION IF EXISTS
  public.shift_slot_min_concurrent(uuid, text, date, time, time, text);` (no
  CASCADE).
- **Deps:** Tasks 8, 9.

### Task 12 — pgTAP tests
- **File:** `supabase/tests/shift_fill_by_assignment.test.sql` (new).
- Dates relative to `CURRENT_DATE`; delete-before-insert fixtures;
  `ON CONFLICT DO UPDATE`. Cases: (a) same-position shift on a *different*
  template → slot still open + claimable; (b) FK-assigned fills → excluded +
  claim rejected; (c) `claim_open_shift` stamps FK; (d) `approve_open_shift_claim`
  stamps FK; (e) legacy null-FK exact match counts; (f) null-FK area-variant
  preferred-pick attributes to one template only; (g) distinct-employee dedupe.
- **Deps:** Tasks 7–10.

## Verify (Phase 8)
`npm run typecheck && npm run lint && npm run test && npm run test:db &&
npm run build`. Check `src/integrations/supabase/types.ts` — RPC signatures for
`get_open_shifts`/`claim_open_shift` are unchanged (same params/returns) and the
new function is REVOKE'd from `authenticated`, so no type regen expected; confirm.
