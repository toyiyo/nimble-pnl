# Design: Remove the remaining inline `calculateShiftHours` duplicates

- **Date:** 2026-06-27
- **Branch:** `claude/nostalgic-noether-45fa47` (rebased onto `origin/main` @ #554)
- **Type:** Refactor (+ one small correctness fix)

## Context / what changed under us

This task began against a base where `src/lib/scheduleRoster.ts` did not exist.
While it was in flight, the per-day-schedule-roster work (#553) landed on `main`
and **already created `src/lib/scheduleRoster.ts` with the canonical
`calculateShiftHours`**, and already made `src/utils/scheduleExport.ts` import +
re-export it. So the "canonical home + re-export" half of the original plan is
**already done on main**.

What `main` did **not** do is remove the three inline copies of the same
calculation. They still exist and can still drift:

| File | Line | Status on main |
|------|------|----------------|
| `src/hooks/useEmployeeLaborCosts.tsx` | 49 | inline duplicate |
| `src/pages/Scheduling.tsx` | 575 | inline duplicate |
| `src/services/laborCalculations.ts` | 400 | inline duplicate |

## Decision

1. **Point the three duplicates at the existing canonical** — import
   `calculateShiftHours` from `@/lib/scheduleRoster` and delete the inline copies.
   No new file, no re-export work (main already has both).
2. **Null-guard the canonical helper** — `shifts.break_duration` is nullable at
   the DB level (DEFAULT 0, no NOT NULL constraint), but the hand-written `Shift`
   interface declares it `number`. A runtime `null` makes
   `totalMinutes - break_duration` evaluate to `NaN`, which silently poisons every
   labor-cost total that sums these hours. Fix once, in the single canonical
   location: `Math.max(totalMinutes - (shift.break_duration ?? 0), 0)`. (Surfaced
   by the multi-model sound-logic reviewer on the pre-rebase branch.)

## Semantics audit (pre-condition for replacement)

All three inline copies are byte-for-byte identical to main's canonical
implementation (break excluded, `Math.max(… , 0)` clamp, `÷ 60`). No intentional
divergence — they can adopt the shared helper directly. The only behavioral delta
introduced is the `?? 0` guard, which changes output **only** when
`break_duration` is null/undefined (previously `NaN`, now the correct net hours).

## Testing

- Extend main's `tests/unit/scheduleRoster.test.ts` `calculateShiftHours`
  describe with a **break-exceeds-shift clamp** case and a **null break_duration**
  case (locks in the NaN-prevention fix).
- Regression nets stay green: `scheduleRosterExport`, `scheduleExportHelpers`,
  `useScheduledLaborCosts`, `laborCalculations*`, `dashboardLaborCosts`,
  `pnlLaborCosts`, `employeeLaborColumns`.

## Out of scope

- Re-creating the canonical module or the `scheduleExport` re-export (main has both).
- Widening the `Shift.break_duration` type (kept `number`; the `?? 0` is a runtime guard).
- The ~1470 pre-existing repo lint problems.

## Design review

- **Supabase:** N/A — no DB schema, RLS, RPC, migration, or edge-function change.
- **Frontend:** N/A — `Scheduling.tsx` edit is solely deleting a local helper and
  adding an import; no JSX/styling/behavior change.
