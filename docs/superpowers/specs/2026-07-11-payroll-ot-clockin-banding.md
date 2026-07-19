# Design + Plan: Payroll OT banding by clock-in day

**Date:** 2026-07-11 · **Branch:** `fix/payroll-ot-clockin-banding` · Type: bug fix (payroll wage accuracy)

## Problem
`calculateEmployeePay` (the shared engine behind `usePayroll` — **actual paychecks** — and the monthly labor calc) buckets hours for OT banding by `period.startTime` (`payrollCalculations.ts:489`). Because `handleBreakEnd` advances a shift's clock-in anchor, a **break-after-midnight** segment's `startTime` is the next calendar day. So a shift that clocks in Sunday, takes a break past midnight, and crosses the Mon/Sun ISO-week boundary has its post-break hours banded into a *different week* (and different day) — under-counting weekly OT, daily OT, and mis-prorating tips for that shift. This is the `// KNOWN GAP` deferred from #612 (sound-logic-reproduced: 40h week + Sun→Mon break shift → $618.23 vs correct $970.00).

## Fix (one line + test)
`payrollCalculations.ts:489`: `period.startTime` → `period.clockIn ?? period.startTime`, and remove the now-resolved `// KNOWN GAP` comment (#612 added it here). `period.clockIn` was added in #599 (the shift's true clock-in, unmoved by breaks).

## Blast radius (verified narrow)
`dateKey` feeds `hoursByDate` → weekly OT (`hoursByWeek`), daily OT (`dailyHours`), and tip proration. But `clockIn` day == `startTime` day for **every** case except a break-after-midnight segment:
- No-break shift (even overnight): one period, `startTime == clockIn`. No change.
- Same-day shift with break: both segments on the clock-in day. No change.
- **Break-after-midnight shift:** post-break segment's `startTime` is a later day → the ONLY case changed, moving its hours to the clock-in day/week (correct, consistent with the app-wide clock-in-day attribution).

So all existing payroll tests (no such fixtures) stay green; the change only corrects the target case, in the correct direction, for weekly OT, daily OT, and tip proration together.

## Not changing
- `overtimeAdjustments` still key on `punchDate` (manual manager overrides) — a rare adjustment recorded against the post-break day would no longer match the shift's (now clock-in) day; acceptable, manual, out of scope.

## Test plan (TDD)
`tests/unit/payrollCalculations.test.ts` — new `describe`: a break-after-midnight overnight shift (Sun 20:00 → Mon 02:00, break 00:00–00:30 = 5.5h) crossing the Mon/Sun week with a weekly OT threshold of 4h → assert `regularHours=4, overtimeHours=1.5` (was `5.5 / 0` — split across two weeks). Verify under `TZ=UTC` and `TZ=America/Chicago`. Full suite + the #612 monthly acceptance case stay green.

## Steps
1. RED: add the test. 2. GREEN: apply the one-line fix + drop the KNOWN GAP comment. 3. Verify payroll + monthly + full suite (UTC + Chicago). 4. Phase 7 sound-logic review on the diff. 5. Verify (typecheck/lint/build) → PR.
