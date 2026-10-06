# Week templates: use the restaurant time zone — design

Date: 2026-10-06
Branch: `claude/wizardly-ramanujan-tv0d16`

## Problem

A week template stores each shift as a day offset plus wall-clock times.
The two helpers that save and apply a template use the browser time zone.
They must use the restaurant time zone.

Current code:

- `buildTemplateSnapshot` reads the day offset with host-local `Date`
  getters (`src/lib/schedulePlanTemplates.ts:5-10`, called at
  `src/lib/schedulePlanTemplates.ts:24`).
- `buildTemplateSnapshot` reads `start_time` and `end_time` with
  `formatLocalTime` (`src/lib/schedulePlanTemplates.ts:25-26`).
  `formatLocalTime` reads `getHours()` in the host zone
  (`src/hooks/useShiftPlanner.ts:45-49`).
- `buildShiftsFromTemplate` moves the date with host-local `setDate`
  (`src/lib/schedulePlanTemplates.ts:41-42`). It builds each instant with
  `new Date(y, m, d, h, mi, s)` in the host zone
  (`src/lib/schedulePlanTemplates.ts:47-56`). It adds one day when
  `end <= start` (`src/lib/schedulePlanTemplates.ts:57-59`).
- The hook calls both helpers with no zone
  (`src/hooks/useSchedulePlanTemplates.ts:36`,
  `src/hooks/useSchedulePlanTemplates.ts:65`).
- The only UI caller is `CopyWeekDialog`
  (`src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx:88`). The
  dialog does not get a zone prop today. `Scheduling.tsx` renders it at
  `src/pages/Scheduling.tsx:2009-2018` and already holds
  `restaurantTimezone` (`src/pages/Scheduling.tsx:255`).

Effect: a manager in Los Angeles who edits a Chicago restaurant saves
`07:00:00` for a 09:00 Chicago shift. When the manager applies the template,
the shift lands at 07:00 Los Angeles time, which is 09:00 Chicago time by
accident only. A Chicago manager who then applies the same template gets
07:00 Chicago time. Any viewer gets the wrong day near local midnight.

## Note on the Week Templates tab

The task names `src/components/scheduling/WeekTemplates/` and the branch
`feature/editable-week-templates`. Neither exists on `origin` on 2026-10-06
(`git ls-remote origin` shows no such branch). This change fixes the helpers,
the hook, and the one current caller (`CopyWeekDialog`). The hook signature
change makes the zone mandatory, so the Week Templates tab must pass it when
that branch merges. TypeScript shows an error there if it does not.

## Approach (chosen)

Mirror `src/lib/copyWeekShifts.ts`, which already does the same reprojection
with the restaurant zone (`src/lib/copyWeekShifts.ts:45-58`).

### `buildTemplateSnapshot(shifts, weekStart, tz)`

1. Call `requireTz(tz)` (`src/lib/shiftInterval.ts:298`). A missing zone
   throws `TypeError('INVALID_DATE')`. No silent fallback to the browser.
2. `day_offset = daysBetweenDateStrs(formatLocalDate(weekStart),
   formatLocalDateInTz(new Date(shift.start_time), tz))`.
   `weekStart` is a calendar date that the UI picks (host-local midnight),
   so `formatLocalDate` is correct for it. This is the same rule as
   `src/lib/copyWeekShifts.ts:36-41`.
3. `start_time = formatLocalTimeInTz(shift.start_time, tz)` and the same for
   `end_time` (`src/lib/shiftInterval.ts:220`). The output stays `HH:MM:SS`.

### `buildShiftsFromTemplate(snapshots, targetMonday, restaurantId, tz)`

1. Call `requireTz(tz)`.
2. `dateStr = addDaysToDateStr(formatLocalDate(targetMonday), snap.day_offset)`.
   UTC field arithmetic, no host `setDate`.
3. `endDateStr = end <= start ? addDaysToDateStr(dateStr, 1) : dateStr`.
   This keeps the current overnight rule
   (`src/lib/schedulePlanTemplates.ts:57-59`), and it keeps the current
   behavior for `end == start` (a 24-hour shift).
4. Resolve each endpoint with `wallClockToInstant(dateStr, HH:MM, tz)`
   (`src/lib/shiftInterval.ts:336`). This resolves DST the same way as
   Postgres: a nonexistent spring-forward time and a repeated fall-back time
   both get the server answer.
5. `wallClockToInstant` takes `HH:MM` only. Add the seconds field of the
   snapshot back as milliseconds, so the `HH:MM:SS` contract stays exact.

DST result: a template shift `09:00–17:00` applied to the week of
2026-03-09 (Chicago springs forward on Sunday 2026-03-08) gives 09:00–17:00
Chicago on every day. The UTC offset is `-05:00` after the change and
`-06:00` before it. A week that contains the change gives the correct offset
on each side of it.

### Hook and caller

- `useSchedulePlanTemplates(restaurantId, tz)`: the hook takes the zone as a
  second argument and passes it to both helpers. The `saveTemplate` and
  `applyTemplate` mutations call `requireTz` through the helpers, so a
  missing zone shows the existing error toast.
- `CopyWeekDialog` gets a required `timezone: string` prop. This is the same
  prop name as the other dialogs that `Scheduling.tsx` renders
  (`src/pages/Scheduling.tsx:2004`).
- `Scheduling.tsx` passes `timezone={restaurantTimezone}`.

No UI markup changes. No SQL changes. No stored data changes.

## Alternatives (rejected)

- **Keep an optional `tz` and fall back to the browser zone.** This is the
  pattern of `buildTemplateGridData` (`src/hooks/useShiftPlanner.ts:134-185`).
  Rejected: an optional zone lets a new caller (the Week Templates tab)
  forget it and bring the bug back. `requireTz` is the current rule for
  create and update paths (`src/lib/shiftInterval.ts:289-298`).
- **Use `ShiftInterval.create`.** It throws `INVALID_DURATION` when
  `end == start` (`src/lib/shiftInterval.ts:123-125`). The current helper
  makes a 24-hour shift. Rejected to keep the current behavior.

## Out of scope (follow-up)

- `applyTemplate` sends `p_target_start` and `p_target_end` as host-local
  week bounds (`src/hooks/useSchedulePlanTemplates.ts:76-77`).
  `useCopyWeekShifts` has the same pattern
  (`src/hooks/useCopyWeekShifts.ts:46-47`). In `replace` mode, a browser zone
  that differs from the restaurant zone can delete shifts near the week edge.
  This is a separate fix for both RPC callers. I file it as a follow-up task.
- Templates saved before this fix hold browser-local times. This change does
  not rewrite them. Most managers use the same zone as the restaurant, so
  most stored rows are correct.
- A shift longer than 24 hours loses its end day in the snapshot format.
  This is a current limit of the `HH:MM:SS` format.

## Tests

`tests/unit/schedulePlanTemplates.test.ts`:

- Restaurant `America/Chicago`, host `TZ` set to `Asia/Tokyo` in the test.
  A shift at `2026-04-01T14:00:00Z` (09:00 Chicago, 23:00 Tokyo) saves as
  `day_offset 2`, `09:00:00`.
- A shift at 23:30 Chicago on Sunday is 05:30 UTC Monday. It saves as
  `day_offset 6`, not the next week.
- Apply with host `Asia/Tokyo`: `09:00:00` on `day_offset 0` gives
  `2026-04-06T14:00:00.000Z`.
- Fall-back week: Chicago falls back on Sunday 2026-11-01. Apply
  `09:00–17:00` for `day_offset 0..6` to Monday 2026-10-26. Days 0..5 start
  at `14:00Z` (CDT). Day 6 starts at `15:00Z` (CST).
- Spring-forward week: week of Monday 2026-03-02, day 6 is Sun 2026-03-08.
  A `02:30:00` start does not exist. The result must equal
  `wallClockToInstant('2026-03-08', '02:30', tz)` (the Postgres answer).
- Overnight `22:00–02:00` across fall-back: end is on the next day.
- Round trip: snapshot then apply to the next week keeps wall clocks.
- Missing zone throws `INVALID_DATE` for both helpers.
- Seconds are kept: `09:00:30` gives `...:00:30.000Z`.

The existing tests change to pass a zone. They keep their assertions where
the zone is `UTC` or the host zone. The repo `npm run test:tz` script runs the
suite in three host zones.

## E2E

Justified exception candidate: the change is pure TypeScript conversion with
no new UI, route, or RPC. The behavior that changes depends on the browser
zone, which the Playwright config does not set per test. Phase 8 decides.
