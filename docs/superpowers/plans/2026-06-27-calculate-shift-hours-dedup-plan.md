# Plan: Remove remaining inline `calculateShiftHours` duplicates

- **Date:** 2026-06-27
- **Design:** `docs/superpowers/specs/2026-06-27-calculate-shift-hours-dedup-design.md`

## Tasks

1. **Null-guard the canonical helper** — `src/lib/scheduleRoster.ts`:
   `Math.max(totalMinutes - (shift.break_duration ?? 0), 0)`; extend JSDoc.
2. **Lock it in with tests** — `tests/unit/scheduleRoster.test.ts`: add
   break-exceeds-shift clamp + null-break_duration cases.
3. **Remove the three inline duplicates** — `useEmployeeLaborCosts.tsx`,
   `Scheduling.tsx`, `laborCalculations.ts`: delete the local `calculateShiftHours`,
   import it from `@/lib/scheduleRoster`. Confirm the `Shift` type import stays used.
4. **Verify** — `npm run typecheck`; the labor/schedule suites green; exactly one
   definition remaining (grep).

## Acceptance

- One definition of `calculateShiftHours` (`src/lib/scheduleRoster.ts`).
- typecheck clean; targeted suites + full unit suite green; build OK.
- Behavior-preserving except null break_duration now yields correct hours (was NaN).
