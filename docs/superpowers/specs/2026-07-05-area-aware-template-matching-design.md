# Area-Aware Template Matching in the Shift Planner Grid

**Date:** 2026-07-05
**Status:** Approved (user requested "real fix" for the confirmed prod bug)

## Problem

The shift planner's weekly grid buckets shifts into template rows. For shifts
with an explicit `shift_template_id`, bucketing is exact. For unlinked shifts
(manual/legacy, `shift_template_id IS NULL`), `findMatchingTemplate` in
`src/hooks/useShiftPlanner.ts` falls back to matching by start time + end time
+ position + active day — **area is ignored**, and the first matching template
wins.

Confirmed in production (week of 2026-07-06): Josiah Gonzalez and Justin Seals
(both `employees.area = "Wetzel's"`) have manual 10:00–16:00 Server shifts with
no template link. The only template with that exact time/position/days is
"Prep-weekend" (`shift_templates.area = "Cold Stone"`), so their Wetzel's
shifts render under the Cold Stone section with a spurious "Wetzel's" covering
badge, and inflate Cold Stone's coverage counts (the 1/1 "Cover" numbers).

## Design

Make the fallback matcher area-compatible:

- `findMatchingTemplate` receives the shift's employee home area
  (`shift.employee?.area ?? null`).
- A template is a candidate only if it is **area-compatible**:
  `!template.area || !employeeArea || template.area === employeeArea`.
  - Null/undefined on either side stays permissive — legacy data without
    areas keeps today's behavior.
  - Both sides non-null and different → not a match.
- If no area-compatible template matches, the shift buckets under
  `__unmatched__`, which `groupUnmatchedByArea` already groups into the
  off-template lane keyed by the employee's home area. So Josiah's shifts
  appear in a Wetzel's off-template lane, not Cold Stone's row.
- Shifts with an explicit `shift_template_id` are untouched: they bucket under
  that template unconditionally (deliberate cross-area assignment keeps its
  covering badge).

## Alternatives considered

1. **Prefer-same-area with cross-area fallback** (two-pass): would NOT fix the
   reported bug — Wetzel's has no 10:00–16:00 template, so the second pass
   would still land Josiah in Cold Stone's row. Rejected.
2. **Drop fallback matching entirely** (only `shift_template_id` buckets):
   simplest, but regresses legitimate same-area manual/legacy shifts that
   currently display correctly in template rows. Rejected.

## Impact surface

- `buildTemplateGridData` / `findMatchingTemplate` in
  `src/hooks/useShiftPlanner.ts` — the only code change site.
- Downstream consumers referencing the same matching assumption
  (`usePlannerShiftsIndex.ts`, `Scheduling.tsx` `computeOpenSpots`,
  `shiftAllocation.ts` comments) reference the exact-match path for
  template-linked shifts and are unaffected; comments will be checked for
  drift.
- Coverage counts fix themselves: a mis-bucketed shift no longer counts toward
  another area's slot numerator.

## Testing

Unit tests in `tests/unit/useShiftPlanner.test.ts` (existing file) covering:

1. Same-area unlinked shift still matches its area's template (regression
   guard).
2. Cross-area unlinked shift with an exact time/position collision goes to
   `__unmatched__`, and `groupUnmatchedByArea` places it under the employee's
   home area (the Josiah repro).
3. Null employee area matches an area-bearing template (permissive-null).
4. Null template area matches an area-bearing employee (permissive-null).
5. Explicit `shift_template_id` to a cross-area template still buckets under
   that template (covering flow untouched).
