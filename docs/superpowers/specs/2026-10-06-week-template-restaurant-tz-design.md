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
   `weekStart` is a calendar date that the UI picks (host-local midnight,
   `src/hooks/useSharedWeek.ts:22`, `src/pages/Scheduling.tsx:264`),
   so `formatLocalDate` is correct for it. This is the same rule as
   `src/lib/copyWeekShifts.ts:36-41`.
3. `start_time = formatLocalTimeInTz(shift.start_time, tz)` and the same for
   `end_time` (`src/lib/shiftInterval.ts:220`). The output stays `HH:MM:SS`.
4. Call `isValidTimezone(tz)` too. An invalid zone throws
   `TypeError('INVALID_DATE')`. The save RPC stores the JSON without a check
   (`supabase/migrations/20260328100000_schedule_plan_templates.sql:56-107`),
   so the client is the only gate.
5. Keep only shifts with `0 <= day_offset <= 6`. The shift list comes from
   `useShifts`, which uses host-local week bounds
   (`src/hooks/useShifts.tsx:92-97`). A browser in a different zone can get
   a shift from the previous or the next restaurant week. That shift is not
   part of the week, and `day_offset` must stay in 0..6
   (`src/types/scheduling.ts:320`).

### `buildShiftsFromTemplate(snapshots, targetMonday, restaurantId, tz)`

1. Call `requireTz(tz)`.
2. `dateStr = addDaysToDateStr(formatLocalDate(targetMonday), snap.day_offset)`.
   UTC field arithmetic, no host `setDate`.
3. `endDateStr = end <= start ? addDaysToDateStr(dateStr, 1) : dateStr`.
   Compare the zero-padded `HH:MM:SS` strings before resolution, not the
   instants.
   This keeps the current overnight rule
   (`src/lib/schedulePlanTemplates.ts:57-59`), and it keeps the current
   behavior for `end == start` (a 24-hour shift).
4. Resolve each endpoint with `wallClockToInstant(dateStr, HH:MM, tz)`
   (`src/lib/shiftInterval.ts:336`). Its DST rule matches Postgres
   `AT TIME ZONE` for a nonexistent and a repeated time. The test
   `supabase/tests/wall_clock_parity.sql` pins that rule.
5. `wallClockToInstant` takes `HH:MM` only. Add the seconds field of the
   snapshot back as milliseconds, so the `HH:MM:SS` contract stays exact.
   The offset is constant inside one minute, so this is exact. Accept
   `HH:MM` with no seconds too, as `parseTime` does today
   (`src/lib/schedulePlanTemplates.ts:12-15`).
6. Parse the time with `^\d{2}:\d{2}(:\d{2})?$` and range checks. A bad
   stored time throws `Error('This template has an invalid shift time.')`.
   The hook shows that message in the error toast
   (`src/hooks/useSchedulePlanTemplates.ts:96-98`), not `INVALID_DATE`.
7. After resolution, if `end <= start`, throw
   `Error('A template shift has no length on <date> after the DST change.')`.
   Example: `02:30–03:00` on 2026-03-08 in Chicago. `02:30` does not exist
   and resolves to 08:30Z. `03:00` resolves to 08:00Z. The `shifts` table has
   `CHECK (end_time > start_time)`
   (`supabase/migrations/20251114100000_create_scheduling_tables.sql:30`), so
   the RPC fails anyway. The clear message is better than a constraint error.
   The old code added one day in this case and made a 24.5-hour shift.

DST result: a template shift `09:00–17:00` applied to the week of Monday
2026-03-02 (Chicago springs forward on Sunday 2026-03-08) gives 09:00–17:00
Chicago on every day. Days 0..5 use `-06:00` (15:00Z). Day 6 uses `-05:00`
(14:00Z).

### `templateWeekBounds(targetMonday, tz)` (new, moved into scope)

`applyTemplate` sends `p_target_start`/`p_target_end` as host-local week
bounds (`src/hooks/useSchedulePlanTemplates.ts:76-77`,
`src/hooks/useShiftPlanner.ts:372-377`). The RPC deletes unlocked shifts in
that window in `replace` mode
(`supabase/migrations/20260328100000_schedule_plan_templates.sql:137-142`).
After this fix, the inserted shifts use restaurant time. If the window stays
host-local, a Tokyo browser on a Chicago restaurant deletes most of the
previous Sunday and keeps most of the target Sunday. The RPC then inserts
template shifts with no overlap check, so an employee gets two shifts.

New pure helper in `src/lib/schedulePlanTemplates.ts`:

- `start = firstInstantOfDay(formatLocalDate(targetMonday), tz)`.
- `end = firstInstantOfDay(addDaysToDateStr(mondayStr, 7), tz) - 1 ms`.
  The RPC uses `start_time <= p_target_end`, so the end is inclusive.
- `firstInstantOfDay` is in `src/lib/restaurantClock.ts` (re-export of
  `supabase/functions/_shared/labor/restaurantClock.ts:290`).

`applyTemplate` uses this helper for both bounds.

### Hook and caller

- `useSchedulePlanTemplates(restaurantId, tz: string)`: the hook takes the
  zone as a required second argument and passes it to the helpers. The
  helpers call `requireTz`, so a missing zone shows the existing error toast
  (`src/hooks/useSchedulePlanTemplates.ts:52-54`, `:96-98`). For the current
  caller this guard never fires, because `restaurantTimezone` comes from
  `safeTz` (`src/pages/Scheduling.tsx:255`). The guard is for future
  callers. The query key does not include `tz`, because the stored rows do
  not depend on the zone.
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
  `end == start` (`src/lib/shiftInterval.ts:122-123`). The current helper
  makes a 24-hour shift. Rejected to keep the current behavior.
- **Use `ShiftInterval.createSpanning` with an explicit end offset.** It
  keeps the 24-hour case (`src/lib/shiftInterval.ts:76-82`). Rejected:
  it accepts `HH:MM` only (`src/lib/shiftInterval.ts:337-338`), so it drops
  the seconds of the snapshot. Steps 4-7 give the same DST result and keep
  the seconds.

## Out of scope (follow-up)

File these as separate tasks:

- `useCopyWeekShifts` sends host-local week bounds to `copy_week_shifts`
  (`src/hooks/useCopyWeekShifts.ts:46-47`). Same bug as the template window.
- `useShifts` fetches the week with host-local bounds
  (`src/hooks/useShifts.tsx:92-97`). A browser in a different zone does not
  get the late-Sunday shifts of the restaurant week. Step 5 above drops the
  extra shifts, but it cannot add the missing ones.
- `CopyWeekDialog` counts target-week shifts with host-local bounds
  (`src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx:135-146`).
- The three template RPCs are `SECURITY DEFINER` with no `SET search_path`
  and no role check
  (`supabase/migrations/20260328100000_schedule_plan_templates.sql:63`,
  `:120`, `:213`).
- Templates saved before this fix hold browser-local times. This change does
  not rewrite them.
- A shift longer than 24 hours loses its end day in the snapshot format.
  This is a current limit of the `HH:MM:SS` format.
- A shift that crosses the fall-back hour and ends at an earlier wall clock
  (01:30 CDT to 01:15 CST) applies as a 23.75-hour shift. The `HH:MM:SS`
  format loses this, the same as the shift longer than 24 hours.
- The 0..6 filter drops out-of-week shifts and does not tell the user. The
  dialog count uses the unfiltered list
  (`src/components/scheduling/ShiftPlanner/CopyWeekDialog.tsx:102-105`). The
  `useShifts` fetch fix above removes the cause.
- `formatLocalTimeInTz` and `formatLocalDateInTz`
  (`src/lib/shiftInterval.ts:207-224`) read host getters off a
  `toZonedTime` Date. A restaurant wall clock in a DST gap of the browser
  zone moves by one hour. This change does not use them in the snapshot.
  Other callers keep the bug.

## Tests

`tests/unit/schedulePlanTemplates.test.ts`:

Set the host zone with `vi.stubEnv('TZ', 'Asia/Tokyo')` and restore it with
`vi.unstubAllEnvs()` in `afterEach`, so the value does not leak to other
tests in the worker.

- Restaurant `America/Chicago`, host `TZ` `Asia/Tokyo`.
  A shift at `2026-04-01T14:00:00Z` (09:00 Chicago, 23:00 Tokyo) saves as
  `day_offset 2`, `09:00:00`.
- Sunday 2026-04-05 23:30 Chicago (CDT) is `2026-04-06T04:30:00Z`. It saves
  as `day_offset 6`, not the next week.
- A shift from the previous restaurant week (Sun 2026-03-29) and one from the
  next week (Mon 2026-04-06) are not in the snapshot.
- An invalid zone (`'Not/AZone'`) throws `INVALID_DATE`.
- Apply with host `Asia/Tokyo`: `09:00:00` on `day_offset 0` gives
  `2026-04-06T14:00:00.000Z`.
- Fall-back week: Chicago falls back on Sunday 2026-11-01. Apply
  `09:00–17:00` for `day_offset 0..6` to Monday 2026-10-26. Days 0..5 start
  at `14:00Z` (CDT). Day 6 starts at `15:00Z` (CST).
- Spring-forward week: week of Monday 2026-03-02, day 6 is Sun 2026-03-08.
  A `02:30:00` start does not exist. The result must equal
  `wallClockToInstant('2026-03-08', '02:30', tz)` (the Postgres answer).
- Overnight across fall-back: Sat 2026-10-31 `22:00–02:00` gives
  `2026-11-01T03:00:00.000Z` to `2026-11-01T08:00:00.000Z` (5 hours).
- DST collapse: `02:30–03:00` on Sun 2026-03-08 throws the clear message.
- `end == start` gives a 24-hour shift.
- A bad stored time (`'9am'`) throws the clear message. `HH:MM` works.
- `templateWeekBounds(new Date(2026, 3, 6), 'America/Chicago')` gives
  `2026-04-06T05:00:00.000Z` to `2026-04-13T04:59:59.999Z`, with host
  `Asia/Tokyo`. The fall-back week gives a 169-hour window.
- Round trip: snapshot then apply to the next week keeps wall clocks.
- Missing zone throws `INVALID_DATE` for both helpers.
- Seconds are kept: `09:00:30` gives `...:00:30.000Z`.

The existing tests change to pass a zone. They keep their assertions where
the zone is `UTC` or the host zone. The repo `npm run test:tz` script runs the
suite in three host zones (`package.json:34`).

## E2E

Playwright can set the browser zone with `test.use({ timezoneId })`. An E2E
that saves and applies a template from a browser zone that differs from the
restaurant zone covers this seam. Phase 8 decides between that spec and a
justified exception. This container has no local Supabase, so it cannot run
E2E or QA here.

## Design review outcome

Both Phase 2.5 reviewers ran. Folded into this doc: the 0..6 filter, the
string overnight rule, the DST-collapse error, the clear bad-time error,
the zone check on save, the restaurant-zone replace window, the test env
isolation, and the citations. Deleted: the claim about most stored rows.

## Code review outcome (Phase 7a/7b)

- `logic:minor` host DST gap in the snapshot: fixed. The snapshot uses
  `toBusinessDay` and an `Intl.DateTimeFormat` wall clock, not
  `formatLocalTimeInTz`.
- `logic:minor` no `day_offset` check on apply: fixed. A bad value throws
  `This template has an invalid shift day.`
- `logic:minor` fall-back short shift, silent 0..6 drop: deferred (above).
- `ocr:minor` import order and `maintainability:minor` file comment and
  test cast: fixed.
- `maintainability:minor` move `templateWeekBounds`, `requireValidTz` and
  the time parser to shared files: deferred. The copy-week window fix is the
  second caller, so that change moves them.
- `maintainability:minor` `timezone` prop vs `tz` parameter: kept. The
  sibling dialogs in `src/pages/Scheduling.tsx` use the `timezone` prop.
