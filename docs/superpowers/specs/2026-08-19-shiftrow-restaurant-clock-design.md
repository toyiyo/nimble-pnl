# Design: read the restaurant clock in `ShiftRow`

Date: 2026-08-19
Branch: `claude/vigorous-jemison-90a798`
Status: proposed

## 1. Problem

`src/components/employee/ShiftRow.tsx` renders an employee's shift. It reads
the host browser clock for every date question. The employee portal is the one
surface a traveling employee opens from another zone.

Two defect classes exist in the file.

**Wall-clock labels.** The row prints the start and end time with
`format(parseISO(shift.start_time), 'h:mm a')`
([ShiftRow.tsx:154](src/components/employee/ShiftRow.tsx:154),
[ShiftRow.tsx:187](src/components/employee/ShiftRow.tsx:187)). The `upcoming`
variant also prints the weekday, day number and month with the same call
([ShiftRow.tsx:143](src/components/employee/ShiftRow.tsx:143),
[ShiftRow.tsx:146](src/components/employee/ShiftRow.tsx:146),
[ShiftRow.tsx:149](src/components/employee/ShiftRow.tsx:149)). `format` reads
an instant in the host zone. An employee in Denver reads a Chicago 5 p.m. shift
as "4:00 PM". The date block can name the wrong weekday and the wrong month.

**The `Today` badge.** `getShiftStatusBadge` decides the badge with
`isToday(startTime)` ([ShiftRow.tsx:61](src/components/employee/ShiftRow.tsx:61)),
where `startTime` is `new Date(shift.start_time)`
([ShiftRow.tsx:30](src/components/employee/ShiftRow.tsx:30)). `isToday`
compares host calendar days. A shift that the restaurant calls today gets
`Upcoming` when the viewer's zone is behind, and the reverse when it is ahead.

This is the same defect class that commit `5b1e1490` fixed one level up, in
`shiftsByDay` and the day-header badge of
[EmployeeSchedule.tsx](src/pages/EmployeeSchedule.tsx). That commit's test had
to scope its `Today` query to the day-header strip, because `ShiftRow` renders
a second, host-clock `Today` inside the same row
([EmployeeSchedule.restaurantTz.test.tsx:129](tests/unit/EmployeeSchedule.restaurantTz.test.tsx:129)).
That workaround is the evidence for this task.

## 2. What is already correct — do not change

Three call sites compare instants, not calendar days. An instant comparison
gives the same answer in every zone.

- `isPast(endTime)` ([ShiftRow.tsx:43](src/components/employee/ShiftRow.tsx:43))
- `now >= startTime && now <= endTime`
  ([ShiftRow.tsx:52](src/components/employee/ShiftRow.tsx:52))
- `isFuture(startTime)` ([ShiftRow.tsx:70](src/components/employee/ShiftRow.tsx:70))
  and `canTrade`'s `isFuture(parseISO(shift.start_time))`
  ([ShiftRow.tsx:117](src/components/employee/ShiftRow.tsx:117))

`formatShiftDuration` subtracts two instants with `differenceInMinutes`
([ShiftRow.tsx:23](src/components/employee/ShiftRow.tsx:23)). This is also
zone-independent.

Keep all five. A change here adds risk and fixes nothing.

## 3. Where the clock comes from

`useRestaurantClock()` returns `{tz, tzAbbrev, viewerTzDiffers, today,
formatInstant, toBusinessDay, toWallClockInput, parseWallClock}`
([useRestaurantClock.ts:15-24](src/hooks/useRestaurantClock.ts:15)). Its
`today` comes from `useTodayInTimezone(tz)`
([useRestaurantClock.ts:42](src/hooks/useRestaurantClock.ts:42)), which rolls
over at restaurant midnight.

`formatInstant(value, tz, pattern)`
([restaurantClock.ts:122](src/lib/restaurantClock.ts:122)) and
`toBusinessDay(value, tz)`
([restaurantClock.ts:128](src/lib/restaurantClock.ts:128)) are the two library
functions the clock wraps.

`EmployeeSchedule` already holds a clock at
[EmployeeSchedule.tsx:81](src/pages/EmployeeSchedule.tsx:81). It renders
`ShiftRow` at two sites:
[EmployeeSchedule.tsx:282](src/pages/EmployeeSchedule.tsx:282) (`upcoming`
variant) and [EmployeeSchedule.tsx:383](src/pages/EmployeeSchedule.tsx:383)
(`day` variant). These are the only two call sites in `src`.

## 4. Options

### Option A — call `useRestaurantClock()` inside `ShiftRow`

Matches the majority pattern. Leaf components already do this, for example
[EmployeeAuditDetail.tsx:69](src/components/payroll/EmployeeAuditDetail.tsx:69)
and
[ReviewFeedbackDetail.tsx:41](src/components/reviews/ReviewFeedbackDetail.tsx:41).
Call sites need no change.

Two costs:

1. **One timer per row.** `useTodayInTimezone` starts a 60-second
   `setInterval` at
   [useTodayInTimezone.ts:27](src/hooks/useTodayInTimezone.ts:27) and two
   window listeners at
   [useTodayInTimezone.ts:31-32](src/hooks/useTodayInTimezone.ts:31), once per
   hook instance. A full week grid plus the Upcoming card renders tens of rows,
   so the page would hold tens of timers that all compute the same string.

   [CLAUDE.md:315](CLAUDE.md:315) says a row component must have no hooks
   inside and take all data as props. That rule sits under the heading "Row
   components in virtualized lists" ([CLAUDE.md:313](CLAUDE.md:313)).
   `ShiftRow` renders in a 7-day grid and a short Upcoming card, both far below
   the 100-item threshold that CLAUDE.md sets for virtualization. The rule
   therefore does not apply to `ShiftRow` today. Read it as a forward-looking
   alignment, not as a present violation. The timer count above is the argument
   that stands on its own.
2. **The row stops working without a provider.** `useRestaurantContext` throws
   when no provider is above it
   ([RestaurantContext.tsx:25-27](src/contexts/RestaurantContext.tsx:25)).
   `tests/unit/ShiftRow.test.tsx` renders the row bare, for example at
   [ShiftRow.test.tsx:35](tests/unit/ShiftRow.test.tsx:35). Every case in that
   file would need a context mock.

### Option B — pass the clock as a required prop (recommended)

Add `clock: RestaurantClock` to `ShiftRowProps`. `EmployeeSchedule` passes the
object it already has.

- One timer for the page, not one per row.
- The row stays a pure presentational component. See the CLAUDE.md:315
  caveat under Option A: the rule scopes to virtualized lists, so this is an
  alignment, not a rule the current code breaks.
- A **required** prop makes a forgetful future caller a `tsc` error, not a
  silent host-clock regression. This is the property Option A cannot give.
- The hook documents a stable object identity
  ([useRestaurantClock.ts:26-33](src/hooks/useRestaurantClock.ts:26)), so the
  prop does not defeat future memoization.
- Cost: the six existing cases in `tests/unit/ShiftRow.test.tsx` must pass a
  clock. A local `makeClock(tz, today)` helper covers this in a few lines.

### Option C — pass `timezone: string` and `today: string`

Same benefits as B with two props instead of one. Rejected: it splits one
concept across two arguments, and a caller can pass a `today` from a different
zone than `timezone`.

**Recommendation: Option B.**

## 5. The change

### 5.1 `src/components/employee/ShiftRow.tsx`

1. Add `clock: RestaurantClock` to `ShiftRowProps`, required.
2. Change `getShiftStatusBadge(shift)` to `getShiftStatusBadge(shift, clock)`.
   Replace `isToday(startTime)` with
   `clock.toBusinessDay(shift.start_time) === clock.today`.
3. Replace every `format(parseISO(x), p)` with `clock.formatInstant(x, p)`.
   This covers the four patterns `'h:mm a'`, `'EEE'`, `'d'` and `'MMM'`.
4. Delete `format`, `parseISO` and `isToday` from the `date-fns` import
   ([ShiftRow.tsx:1](src/components/employee/ShiftRow.tsx:1)). Keep `isPast`,
   `isFuture` and `differenceInMinutes`.
5. `canTrade` keeps `isFuture`, but on `new Date(shift.start_time)` after
   `parseISO` goes. Both parse the same ISO string to the same instant.
6. Add a comment that names which questions are calendar-day questions and
   which are instant questions, so the next reader does not "fix" section 2.

### 5.2 `src/pages/EmployeeSchedule.tsx`

Pass `clock={clock}` at
[EmployeeSchedule.tsx:282](src/pages/EmployeeSchedule.tsx:282) and
[EmployeeSchedule.tsx:383](src/pages/EmployeeSchedule.tsx:383).

### 5.3 `tests/unit/ShiftRow.test.tsx`

Add a `makeClock` helper and pass it in the six existing cases. The helper
builds a real clock from `src/lib/restaurantClock.ts`, so it cannot drift from
production behaviour.

### 5.4 `tests/unit/ShiftRow.restaurantTz.test.tsx` (new)

Pin the host zone to `America/Phoenix` and the restaurant to
`Pacific/Auckland`. Copy the `pinHostTzToPhoenix` guard from
[useShiftsRecurringCreateTz.test.ts:92](tests/unit/useShiftsRecurringCreateTz.test.ts:92).
The guard asserts `getTimezoneOffset() === 420`, because the `process.env.TZ`
assignment can fail without an error and leave a vacuous test.

Cases:

1. The `day` variant prints the restaurant wall-clock time, not the host one.
2. The `upcoming` variant prints the restaurant weekday, day number and month.
3. A shift that is today in Auckland and tomorrow in Phoenix shows `Today`.
4. A shift that is today in Phoenix and yesterday in Auckland does not show
   `Today`.

Cases 1 to 4 assert both the wanted string and the absence of the host-zone
string.

The Phase 2.5 frontend reviewer found a coverage gap. `getShiftStatusBadge` has
five branches. The six cases in `tests/unit/ShiftRow.test.tsx` all use a shift
seven days out, so they reach `Cancelled`, `Today` and `Upcoming` only. No test
reaches `Completed` ([ShiftRow.tsx:43](src/components/employee/ShiftRow.tsx:43))
or `In Progress` ([ShiftRow.tsx:52](src/components/employee/ShiftRow.tsx:52)).
This task edits that same function and that same import line, so a mistake in
those two branches would ship. Close the gap:

5. A shift that ended one hour ago shows `Completed`.
6. A shift that started one hour ago and ends in one hour shows `In Progress`.

Cases 5 and 6 belong in `tests/unit/ShiftRow.test.tsx`, not in the new
timezone file. They pin branch order, not zone behaviour. Both branches compare
instants, so the badge must be the same under every host zone. Assert that:
run each case a second time with the host zone pinned to `America/Phoenix` and
check the badge does not change.

### 5.5 `tests/unit/EmployeeSchedule.restaurantTz.test.tsx`

Delete the `dayHeader` scoping workaround and its comment
([EmployeeSchedule.restaurantTz.test.tsx:129](tests/unit/EmployeeSchedule.restaurantTz.test.tsx:129))
only if the row badge no longer collides. Keep the scoping if two `Today`
strings still appear for a correct reason. Decide from the test run, not from
this document.

## 6. Out of scope

- **Badge staleness.** `getShiftStatusBadge` reads `new Date()` at render
  ([ShiftRow.tsx:32](src/components/employee/ShiftRow.tsx:32)). No ticker
  re-renders the row, so `Upcoming` does not become `In Progress` while the
  page stays open. `memory/lessons.md:1242` describes the `useNowTick` fix for
  this class. It is a different defect and it needs its own design.
- **Other host-clock surfaces** in the employee portal.

## 7. Risk

Low. The change is display-only. No data write, no query, no RLS surface, no
migration. The worst failure is a wrong label, and the new tests fail on a
wrong label by construction.

The one real risk is a silent revert: a future component renders `ShiftRow`
and the required `clock` prop stops that at compile time.
