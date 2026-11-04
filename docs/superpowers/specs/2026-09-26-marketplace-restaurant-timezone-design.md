# Design: shift marketplace in the restaurant time zone

Date: 2026-09-26
Source: QA of PR toyiyo/nimble-pnl#812 (findings QA-1 and QA-3).

## Problem

The "Teammates need cover" home card shows trade times in the restaurant time
zone. The marketplace page and the "My shift trades" card show the same trades
in the device time zone. When the device zone is not the restaurant zone, the
two screens show different times for one trade.

The marketplace list also sorts by the UTC date only. Two items that start on
the same UTC day show in insertion order, not in time order. An item after
local midnight can show before an item on the day before.

## Current behavior (cited)

- The home card formats with `formatInstant(…, timezone, 'h:mm a')` at
  `src/components/employee/UpForGrabsCard.tsx:132` and builds the date tile
  with `tradeDateTile(startsAt, timezone)` at
  `src/components/employee/UpForGrabsCard.tsx:130`.
- `tradeDateTile` formats `EEE`, `d` and `MMM` in the restaurant zone at
  `src/lib/claimableTrades.ts:114-122`.
- `TradeCard` formats with date-fns `format` (device zone) at
  `src/pages/AvailableShiftsPage.tsx:91-95` and
  `src/pages/AvailableShiftsPage.tsx:110-111`.
- `AvailableShiftsPage` already reads the restaurant zone with
  `const { tz } = useRestaurantClock();` at
  `src/pages/AvailableShiftsPage.tsx:335`. It does not pass `tz` to
  `TradeCard` (`src/pages/AvailableShiftsPage.tsx:552-560`).
- The `TradeCard` memo comparator does not compare a zone prop
  (`src/pages/AvailableShiftsPage.tsx:222-236`).
- `mergeAvailableShifts` takes the UTC date of a trade with
  `start_time.split('T')[0]` at `src/hooks/useAvailableShifts.ts:31`. It sorts
  by that date string only at `src/hooks/useAvailableShifts.ts:40`.
- An open shift carries a restaurant-local `shift_date` and a local
  `HH:MM:SS` `start_time` (`src/types/scheduling.ts:360-365`).
- `MyShiftTradesCard` formats the date tile and the time range in the device
  zone at `src/components/schedule/MyShiftTradesCard.tsx:80-95`, and in the
  withdraw dialog at `src/components/schedule/MyShiftTradesCard.tsx:277-279`.
  Its props have no zone (`src/components/schedule/MyShiftTradesCard.tsx:30-39`).
- `EmployeeSchedule` has the zone as `restaurantTimezone`
  (`src/pages/EmployeeSchedule.tsx:77`). It does not pass it to
  `MyShiftTradesCard` (`src/pages/EmployeeSchedule.tsx:416-420`).
- `parseWallClock(wallClock, tz)` converts a naive local wall clock to a UTC
  instant, with Postgres DST rules
  (`supabase/functions/_shared/labor/restaurantClock.ts:380`).
- `toBusinessDay(value, tz)` gives the restaurant-local `YYYY-MM-DD` of an
  instant (`supabase/functions/_shared/labor/restaurantClock.ts:165`).

## Approach

1. **Sort (QA-1).** Change `mergeAvailableShifts(openShifts, trades, tz)`.
   - Add `startsAt: number` (epoch ms) to `AvailableShiftItem`.
   - For an open shift, `startsAt` is
     `parseWallClock(`${shift_date}T${start_time}`, tz)`.
   - For a trade, `startsAt` is `Date.parse(offered_shift.start_time)`.
   - A trade's `date` becomes `toBusinessDay(start_time, tz)`, not the UTC date.
   - Sort by `startsAt` ascending. Equal values keep the input order (stable
     sort).
   - A trade with no `offered_shift.start_time` gets
     `startsAt = Number.NEGATIVE_INFINITY` and `date = ''`. It sorts first, as
     today (`src/hooks/useAvailableShifts.ts:31`). Do not let `NaN` reach the
     comparator.
   - The comparator does not subtract (`-Infinity - -Infinity` is `NaN`). It
     returns `a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0`.
   - `get_open_shifts` returns `shift_date` as a local `DATE` and
     `start_time` as a local `TIME`
     (`supabase/migrations/20260721140000_open_shift_claim_authz_guard.sql:52-174`).
     `WALL_CLOCK_RE` accepts the `HH:MM:SS` form
     (`supabase/functions/_shared/labor/restaurantClock.ts:32`).
   - `useAvailableShifts(restaurantId, employeeId, weekStart, weekEnd, tz)`
     gets `tz: string` as the last argument. The page passes its `tz`. That
     value is never empty: `useRestaurantClock` returns `safeTz(...)`, which
     falls back to `DEFAULT_TIMEZONE`
     (`src/hooks/useRestaurantClock.ts:41`,
     `supabase/functions/_shared/labor/restaurantClock.ts:93`).
   - Add `tz` to the `useMemo` deps of `items`
     (`src/hooks/useAvailableShifts.ts:63-66`).
   - Import `parseWallClock`, `toBusinessDay` and `formatInstant` from
     `@/lib/restaurantClock`, as `src/lib/claimableTrades.ts:14` does. Do not
     import the `supabase/functions/...` path directly.
2. **TradeCard (QA-3).** Add a `timezone` prop. Format the date label and the
   time range with `formatInstant(…, timezone, …)`. Add
   `prev.timezone === next.timezone` to the memo comparator. Keep every
   current check: trade `id`, `status`, `is_published`, `start_time`,
   `end_time`, `position`, `isAccepting`, `currentEmployeeId`, the two
   `areaMismatch` areas, `isHighlighted` and `highlightSource`.
3. **MyShiftTradesCard (QA-3).** Add a required `timezone` prop.
   `ShiftDateBlock` uses `tradeDateTile` and `formatInstant`, as the home card
   does. The withdraw dialog uses `formatInstant`. `EmployeeSchedule` passes
   `restaurantTimezone`.

Each surface keeps its current text shape. Only the zone changes:

- `TradeCard` date: `EEE, MMM d`. Time: `h:mm a - h:mm a`.
- `ShiftDateBlock` tile: `EEE` / `d` / `MMM`. Time: `h:mm a - h:mm a`.
- Withdraw dialog: `{position} · EEE, MMM d · h:mm a - h:mm a`.

The date, the day and the clock times match the home card. This keeps
existing text assertions valid.

### Rejected alternatives

- **Sort by a local date string plus a local time string.** This needs two
  keys and still fails on DST edges. One instant is simpler and exact.
- **Read the zone inside `TradeCard` with a hook.** CLAUDE.md says a memoized
  row has no hooks. The zone goes in as a prop.

## Tests

- `tests/unit/availableShifts.test.ts`: restaurant zone
  `America/Los_Angeles` (UTC-7 in October 2026).
  - Two trades on the same UTC day, input in reverse time order. The result
    is in time order.
  - A trade at 18:00 local on 2 Oct (01:00Z on 3 Oct) and an open shift at
    20:00 local on 2 Oct. The trade sorts first. The old code put the open
    shift first.
  - A trade at 23:30 local on 1 Oct (06:30Z on 2 Oct). Its `date` is
    `2026-10-01`.
  - A trade with no `offered_shift`. It sorts first. Its `date` is `''`.
    Two such trades keep their input order.
- `tests/unit/AvailableShiftsPage.tradeCard.test.tsx`: the trade card shows the
  restaurant-zone date and time. Update the one assertion that uses the host
  zone.
- `tests/unit/MyShiftTradesCard.test.tsx`: the date tile, the time and the
  withdraw dialog text show in the restaurant zone.
- Run the unit suite under `TZ=UTC` and under `TZ=Asia/Tokyo`
  (lesson at `memory/lessons.md:1322-1325`).
- E2E: extend `tests/e2e/shift-trade-up-for-grabs.spec.ts`. Pin the restaurant
  zone to a zone that differs from the browser zone. Seed a fixed UTC instant.
  Check that the home row and the marketplace card show the same clock time,
  computed with `Intl` in the restaurant zone.

## Out of scope

- `src/components/schedule/TradeMarketplace.tsx` also formats in the device
  zone. No page imports it (only
  `tests/unit/TradeMarketplace.tentative.test.tsx`). A separate task can
  delete it or fix it.
- `OpenShiftCard` shows local wall-clock strings. It has no zone problem.
