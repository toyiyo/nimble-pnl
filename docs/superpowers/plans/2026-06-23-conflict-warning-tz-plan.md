# Plan: Fix DST timezone anchor in availability conflict warning

**Design:** docs/superpowers/specs/2026-06-23-conflict-warning-tz-design.md
**Branch:** `fix/conflict-warning-tz-anchor`

## Task breakdown (TDD)

### Task 1 — RED: failing regression + coverage tests
- Create `tests/unit/conflictFormatUtils.test.ts`.
- `formatUTCTimeToLocal`:
  - `'03:00:00','America/Chicago', new Date(2026,5,23)` → `'10:00 PM'` (reported bug; fails on old code).
  - `'03:30:00', …summer` → `'10:30 PM'`.
  - `'03:00:00','America/Chicago', new Date(2026,0,1)` → `'9:00 PM'` (anchor-matters / CST).
  - DST transition: `America/Chicago` Mar 8 2026, `America/New_York` Nov 1 2026.
  - Edge: `'00:00:00'`→`'12:00 AM'`, `'12:00:00'`→`'12:00 PM'`, `'09:00:00'`→`'9:00 AM'`, `'22:00'` (no seconds)→`'10:00 PM'`.
- `formatConflictLine`:
  - time-off conflict → returns `message`.
  - availability conflict with `available_start/end` + pinned `referenceDate` → contains `available 10:00 PM – 10:30 PM`.
- Run → confirm the regression assertions FAIL against current code.

### Task 2 — GREEN: fix the function
- Rewrite `formatUTCTimeToLocal(utcTime, timezone, referenceDate = new Date())` to delegate to
  `utcTimeToLocalTime` then `formatHourToTime(h + m/60)`.
- Add `referenceDate = new Date()` param to `formatConflictLine`, pass it through to both
  `formatUTCTimeToLocal` calls.
- Imports: `utcTimeToLocalTime` from `./availabilityTimeUtils`, `formatHourToTime` from `./timeUtils`.
- Run → all tests green.

### Task 3 — Verify callers unchanged
- Confirm `src/components/ShiftDialog.tsx` and
  `src/components/scheduling/ShiftPlanner/AvailabilityConflictDialog.tsx` still call
  `formatConflictLine(conflict, timezone)` (2-arg) and compile. No change expected.
- Grep for any other importer of `formatUTCTimeToLocal` (expected: none outside this file).

### Task 4 — Local verification (Phase 8)
- `npx vitest run tests/unit/conflictFormatUtils.test.ts` under `TZ=UTC`, `TZ=America/Los_Angeles`, `TZ=Asia/Tokyo`.
- `npm run typecheck`, `npm run lint`, `npm run build`, full `npm run test`.

## Dependencies
- Task 1 → Task 2 → Task 3 → Task 4 (linear; small change).

## Out of scope (flag only)
- `ShiftDialog` browser-TZ shift parse.
- `extractDayLabel` off-by-one day label → follow-up task.

## Risk / rollback
- Pure presentation change in one util; revert is a single-file revert.
- Behavioral change limited to: correct DST offset + ASCII space before AM/PM.
