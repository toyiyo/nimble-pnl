# Week templates: use the restaurant time zone — plan

Design: `docs/superpowers/specs/2026-10-06-week-template-restaurant-tz-design.md`
Branch: `claude/wizardly-ramanujan-tv0d16`

## Task 1: `buildTemplateSnapshot` takes `tz`

1. RED: in `tests/unit/schedulePlanTemplates.test.ts`, add a
   `describe('buildTemplateSnapshot with a restaurant zone')` block.
   Use `vi.stubEnv('TZ', 'Asia/Tokyo')` in `beforeEach` and
   `vi.unstubAllEnvs()` in `afterEach`. Tests:
   - `2026-04-01T14:00:00Z`, tz `America/Chicago`, weekStart
     `new Date(2026, 2, 30)` → `day_offset 2`, `09:00:00`.
   - Sunday 23:30 Chicago (`2026-04-06T04:30:00Z`) → `day_offset 6`,
     `23:30:00`.
   - Shifts from the previous and the next restaurant week → not kept.
   - Missing tz (`''`) and invalid tz (`'Not/AZone'`) → throw `INVALID_DATE`.
2. Change the existing `buildTemplateSnapshot` tests to pass a tz. Build the
   fixtures as UTC instants, and pass `'UTC'`, so they do not depend on the
   host zone.
3. GREEN: add `tz: string` to `buildTemplateSnapshot`. Use `requireTz`,
   `formatLocalDateInTz`, `daysBetweenDateStrs`, `formatLocalDate`,
   `formatLocalTimeInTz`. Delete `computeDayOffset` and the
   `formatLocalTime` import.
4. Commit.

## Task 2: `buildShiftsFromTemplate` takes `tz`

1. RED: add tests (host `Asia/Tokyo`, tz `America/Chicago`):
   - `09:00:00` on `day_offset 0`, Monday `new Date(2026, 3, 6)` →
     `2026-04-06T14:00:00.000Z`.
   - Fall-back week, Monday `new Date(2026, 9, 26)`, `09:00–17:00` on
     offsets 0..6 → days 0..5 start `14:00Z`, day 6 (2026-11-01) starts
     `15:00Z`; durations 8h.
   - Spring-forward week, Monday `new Date(2026, 2, 2)`, day 6 `02:30:00` →
     equals `wallClockToInstant('2026-03-08', '02:30', tz).toISOString()`.
   - Overnight Sat 2026-10-31 `22:00–02:00` (day 5 of the fall-back week)
     → `2026-11-01T03:00:00.000Z` to `2026-11-01T08:00:00.000Z`.
   - DST collapse `02:30–03:00` on Sun 2026-03-08 → throws
     `A template shift has no length on 2026-03-08 after the DST change.`
   - Bad stored time `'9am'` → throws
     `This template has an invalid shift time.` `HH:MM` works.
   - `end == start` → 24h later (current behavior).
   - Seconds kept: `09:00:30` → `2026-04-06T14:00:30.000Z`.
   - Round trip: snapshot a week, apply to the next week, read back with
     `formatLocalTimeInTz` → same wall clocks.
   - Missing tz → throws `INVALID_DATE`.
2. Change the existing `buildShiftsFromTemplate` tests to pass `'UTC'` and
   assert ISO strings.
3. GREEN: add `tz: string`. Use `requireTz`, `addDaysToDateStr`,
   `formatLocalDate`, `wallClockToInstant`, plus seconds in ms. Compare the
   `HH:MM:SS` strings for the overnight rule. Check `end > start` after
   resolution.
4. Commit.

## Task 2b: `templateWeekBounds(targetMonday, tz)`

1. RED: host `Asia/Tokyo`, `new Date(2026, 3, 6)`, `America/Chicago` →
   `{ start: '2026-04-06T05:00:00.000Z', end: '2026-04-13T04:59:59.999Z' }`.
   Fall-back week (Monday 2026-10-26) → window is 169 h. Missing tz throws.
2. GREEN: `firstInstantOfDay` of Monday and of Monday + 7, minus 1 ms.
3. Commit.

## Task 3: hook and caller pass the restaurant zone

1. `useSchedulePlanTemplates(restaurantId, tz: string)` passes `tz` to both
   helpers and uses `templateWeekBounds` for `p_target_start`/`p_target_end`.
2. `CopyWeekDialog` gets a required `timezone: string` prop and passes it to
   the hook.
3. `Scheduling.tsx` passes `timezone={restaurantTimezone}`.
4. Update any test that renders `CopyWeekDialog` or mocks the hook.
5. Run `npm run typecheck`, `npm run lint`, the unit tests. Commit.

## Task 4: verify in three host zones

1. Run `TZ=America/Chicago`, `TZ=Pacific/Auckland`, `TZ=UTC` for the
   changed test files (`npm run test:tz` runs the full suite).
2. File the follow-up tasks in the design "Out of scope" list.
