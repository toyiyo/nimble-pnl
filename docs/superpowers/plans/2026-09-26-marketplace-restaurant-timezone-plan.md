# Plan: shift marketplace in the restaurant time zone

Design: `docs/superpowers/specs/2026-09-26-marketplace-restaurant-timezone-design.md`
Branch: `fix/marketplace-restaurant-timezone`

Run each unit test step with `npx vitest run <file>`. Tasks 1–6 are in
order. Each task depends on the task before it.

## Task 1 — RED: sort and date tests for `mergeAvailableShifts`

File: `tests/unit/availableShifts.test.ts`

1. Add `const TZ = 'America/Los_Angeles';` (UTC-7 in October 2026).
2. Pass `TZ` as the third argument in every current
   `mergeAvailableShifts(...)` call.
3. Add these cases:
   - Two trades on the same UTC day, input in reverse time order. The
     result is in time order.
   - A trade at `2026-10-03T01:00:00Z` (18:00 local, 2 Oct) and an open
     shift on `2026-10-02` at `20:00:00`. The trade is first.
   - A trade at `2026-10-02T06:30:00Z`. Its `date` is `2026-10-01`.
   - An open shift at `2026-10-02` / `09:00:00`. Its `startsAt` equals
     `Date.parse('2026-10-02T16:00:00Z')`.
   - A trade with no `offered_shift`. It is first, and its `date` is `''`.
   - Two trades with no `offered_shift`. They keep their input order.

Run the file. The new cases must fail.

## Task 2 — GREEN: change `mergeAvailableShifts` and `useAvailableShifts`

File: `src/hooks/useAvailableShifts.ts`

1. Import `parseWallClock` and `toBusinessDay` from `@/lib/restaurantClock`.
2. Add `startsAt: number` to `AvailableShiftItem`.
3. Add the parameter `tz: string` to `mergeAvailableShifts`.
4. Open shift: `startsAt = parseWallClock(`${shift_date}T${start_time}`, tz)`
   as epoch ms. Keep `date = shift_date`.
5. Trade with `offered_shift.start_time`: `startsAt = Date.parse(start_time)`,
   `date = toBusinessDay(start_time, tz)`.
6. Trade with no start time: `startsAt = Number.NEGATIVE_INFINITY`,
   `date = ''`.
7. Sort with `a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0`.
   Do not subtract.
8. Add `tz: string` as the last parameter of `useAvailableShifts`. Pass it to
   `mergeAvailableShifts`. Add `tz` to the `useMemo` deps.
9. In `src/pages/AvailableShiftsPage.tsx`, pass `tz` to `useAvailableShifts`.
10. Update `tests/unit/useAvailableShifts.test.ts` for the new argument.

Run `tests/unit/availableShifts.test.ts` and
`tests/unit/useAvailableShifts.test.ts`. Both must pass.

## Task 3 — RED then GREEN: `TradeCard` in the restaurant zone

Test file: `tests/unit/AvailableShiftsPage.tradeCard.test.tsx`

1. RED: mock `useRestaurantClock` to return `tz: 'America/Los_Angeles'`.
   Seed a trade at `2026-10-03T01:00:00Z`–`2026-10-03T07:00:00Z`. Assert
   `Fri, Oct 2` and `6:00 PM - 12:00 AM`. Change the one assertion that uses
   host-zone `format(parseISO(...))`.
2. Run the file under `TZ=UTC`. It must fail.
3. GREEN in `src/pages/AvailableShiftsPage.tsx`:
   - Add the prop `timezone: string` to `TradeCard`.
   - `formatTradeTime(startTime, endTime, timezone)` uses `formatInstant`
     with `'h:mm a'`. Keep the ` - ` separator.
   - `dateLabel = formatInstant(start_time, timezone, 'EEE, MMM d')`.
   - Add `prev.timezone === next.timezone` to the memo comparator. Keep all
     current checks.
   - Pass `timezone={tz}` at the `<TradeCard` call site.
   - Delete the date-fns imports that have no more use.
4. Run the file under `TZ=UTC` and `TZ=Asia/Tokyo`. Both must pass.

## Task 4 — RED then GREEN: `MyShiftTradesCard` in the restaurant zone

Test file: `tests/unit/MyShiftTradesCard.test.tsx`

1. RED: render with `timezone="America/Los_Angeles"`. Seed the same trade as
   Task 3. Assert the tile `Fri` / `2` / `Oct` and `6:00 PM - 12:00 AM`.
   Open the withdraw dialog. Assert `Fri, Oct 2` and `6:00 PM - 12:00 AM` in
   its text.
2. Run the file under `TZ=UTC`. It must fail.
3. GREEN in `src/components/schedule/MyShiftTradesCard.tsx`:
   - Add the required prop `timezone: string`.
   - `ShiftDateBlock` takes `timezone`. It uses `tradeDateTile` from
     `@/lib/claimableTrades` and `formatInstant(…, timezone, 'h:mm a')`.
   - The withdraw dialog uses `formatInstant` with `'EEE, MMM d'` and
     `'h:mm a'`.
   - Delete the date-fns imports that have no more use.
4. In `src/pages/EmployeeSchedule.tsx`, pass
   `timezone={restaurantTimezone}` to `<MyShiftTradesCard`.
5. Run the file under `TZ=UTC` and `TZ=Asia/Tokyo`. Both must pass.

## Task 5 — E2E: the home card and the marketplace show the same time

File: `tests/e2e/shift-trade-up-for-grabs.spec.ts`

1. Add `timezoneId: 'Asia/Tokyo'` to `test.use`. This makes the browser zone
   differ from the restaurant zone.
2. As P, set the restaurant zone with
   `supabase.from('restaurants').update({ timezone: 'America/Los_Angeles' })`.
   Use the pattern in `tests/e2e/coverage-chart-explainer.spec.ts:41`.
3. Seed the shift at a fixed UTC instant 3 days out: 01:00Z to 07:00Z. This
   is 18:00–00:00 in Los Angeles, and a different day in Tokyo.
4. Compute the expected date and time with `Intl.DateTimeFormat` in
   `America/Los_Angeles`.
5. Assert the home card row shows the expected time.
6. After the deep link, assert the highlighted marketplace card shows the
   same date and time.

Run `npx playwright test tests/e2e/shift-trade-up-for-grabs.spec.ts
--reporter=line` in the foreground.

## Task 6 — Verify

Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
Run `TZ=Asia/Tokyo npx vitest run tests/unit/availableShifts.test.ts
tests/unit/AvailableShiftsPage.tradeCard.test.tsx
tests/unit/MyShiftTradesCard.test.tsx`.
