# Plan: read the restaurant clock in `ShiftRow`

Date: 2026-08-19
Design: `docs/superpowers/specs/2026-08-19-shiftrow-restaurant-clock-design.md`
Branch: `claude/vigorous-jemison-90a798`

## Scope

Change `src/components/employee/ShiftRow.tsx` to read the restaurant clock.
Pass the clock from `src/pages/EmployeeSchedule.tsx` as a required prop.

No DB change. No migration. No RPC. No edge function. Display only.

## Task order

The order is TDD. Task 1 writes a test that fails. Task 2 makes it pass.

### Task 1 — write the failing timezone test

File: `tests/unit/ShiftRow.restaurantTz.test.tsx` (new)

1. Copy the `pinHostTzToPhoenix` guard from
   `tests/unit/useShiftsRecurringCreateTz.test.ts:92`. The guard sets
   `process.env.TZ = 'America/Phoenix'` and then asserts
   `getTimezoneOffset() === 420`. The assignment can fail without an error,
   and a silent failure makes the test vacuous.
2. Add a local `makeClock(tz, today)` helper. Build it from
   `formatInstant` and `toBusinessDay` in `src/lib/restaurantClock.ts`, so the
   fake cannot drift from production behaviour.
3. Pick instants where Phoenix and `Pacific/Auckland` name different calendar
   days and different wall-clock hours.
4. Write the four cases from design section 5.4:
   - the `day` variant shows the restaurant wall-clock time;
   - the `upcoming` variant shows the restaurant weekday, day and month;
   - a shift that is today in Auckland shows `Today`;
   - a shift that is not today in Auckland does not show `Today`.
5. Each case asserts the wanted string AND the absence of the host-zone string.

Expect: the file does not compile, because `ShiftRow` has no `clock` prop yet.
That is the failing state.

### Task 2 — change `ShiftRow`

File: `src/components/employee/ShiftRow.tsx`

1. Import `RestaurantClock` from `@/hooks/useRestaurantClock`.
2. Add `clock: RestaurantClock` to `ShiftRowProps`. Make it required.
3. Change the signature to `getShiftStatusBadge(shift, clock)`.
4. Replace `isToday(startTime)` with
   `clock.toBusinessDay(shift.start_time) === clock.today`.
5. Replace each `format(parseISO(x), p)` with `clock.formatInstant(x, p)`.
   Seven call sites: lines 143, 146, 149, 154, 155, 187, 188.
6. Change `canTrade` to `isFuture(new Date(shift.start_time))`.
7. Delete `format`, `parseISO` and `isToday` from the `date-fns` import.
   Keep `isPast`, `isFuture` and `differenceInMinutes`.
8. Add a comment above `getShiftStatusBadge`. Name which questions are
   calendar-day questions and which are instant questions. State that
   `isPast`, `isFuture` and the `now` range check must stay.

Expect: Task 1's test passes.

### Task 3 — wire the two call sites

File: `src/pages/EmployeeSchedule.tsx`

1. Pass `clock={clock}` at line 282 (`upcoming` variant).
2. Pass `clock={clock}` at line 383 (`day` variant).

Expect: `npm run typecheck` passes.

### Task 4 — update the existing `ShiftRow` tests

File: `tests/unit/ShiftRow.test.tsx`

1. Add a `makeClock` helper, the same shape as Task 1's.
2. Pass `clock={...}` in the six existing cases.
3. Add case 5: a shift that ended one hour ago shows `Completed`.
4. Add case 6: a shift in progress shows `In Progress`.
5. Run cases 5 and 6 a second time with the host zone pinned to
   `America/Phoenix`. Check the badge does not change. Both branches compare
   instants, so the zone must not matter.

### Task 5 — check the `EmployeeSchedule` test workaround

File: `tests/unit/EmployeeSchedule.restaurantTz.test.tsx`

1. Run the file. The `dayHeader` helper at line 129 scopes the `Today` query,
   because `ShiftRow` used to show a second, host-clock `Today`.
2. After Task 2, the row badge follows the restaurant clock. Two correct
   `Today` strings can now appear in the same row.
3. Decide from the test run, not from this plan. Keep the scoping if the
   collision is real and correct. Delete the workaround and its comment only
   if the query is unambiguous.

### Task 6 — negative control

1. Revert Task 2's two changes by hand, in a scratch copy.
2. Run `tests/unit/ShiftRow.restaurantTz.test.tsx`.
3. Check that it FAILS. A test that passes against the old code proves
   nothing.
4. Restore the fixed file.

## Verify

```bash
npm run typecheck
npx eslint src/components/employee/ShiftRow.tsx src/pages/EmployeeSchedule.tsx tests/unit/ShiftRow.test.tsx tests/unit/ShiftRow.restaurantTz.test.tsx
npx vitest run tests/unit/ShiftRow.test.tsx tests/unit/ShiftRow.restaurantTz.test.tsx tests/unit/EmployeeSchedule.restaurantTz.test.tsx
npm run test
```

Run the full unit suite once under `TZ=UTC`. `memory/lessons.md:1324` says that
one command reproduces the CI-versus-dev zone difference that a green local run
hides.

```bash
TZ=UTC npm run test
```

## E2E

No E2E change. The fix has no new route, no new user flow and no new data
write. The unit tests pin the zone behaviour, which an E2E cannot do better:
an E2E runs one host zone at a time, and `memory/lessons.md:1011` warns against
an E2E that asserts exact clock strings.

## Out of scope

- Badge staleness. `getShiftStatusBadge` reads `new Date()` at render, and no
  ticker re-renders the row. See design section 6.
- Other host-clock surfaces in the employee portal.

## Rollback

Revert the three source commits. The change is display-only, so no data needs
repair.
