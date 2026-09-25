# Marketplace trade cards: show the restaurant time zone

## Problem

The Shift Marketplace (`/employee/shifts`) and the home card "Teammates need
cover" show different times for the same trade when the device zone is not
the restaurant zone. A UI review saw 11:00 AM – 5:00 PM on the home card and
4:00 PM – 10:00 PM on the marketplace for one shift.

## Current code (cited)

- `TradeCard` formats the date and the time with `parseISO` + date-fns
  `format`, which use the device zone
  (`src/pages/AvailableShiftsPage.tsx:92-95`, `:109-112`).
- The page already reads the restaurant zone:
  `const { tz } = useRestaurantClock();` (`src/pages/AvailableShiftsPage.tsx:291`).
- The home card formats the time range with `formatInstant(..., timezone,
  'h:mm a')` and an en dash (`src/components/employee/UpForGrabsCard.tsx:134-138`).
- `formatInstant` formats an instant in an explicit zone
  (`src/lib/restaurantClock.ts:122-125`).
- The `TradeCard` memo compare function lists each prop it reads
  (`src/pages/AvailableShiftsPage.tsx:227-242`).
- "My Claims" formats `claim.shift_date` with `parseDateLocal`
  (`src/pages/AvailableShiftsPage.tsx:686`). `shift_date` is a DATE column
  (`src/types/scheduling.ts:384`). `parseDateLocal` builds local midnight of
  that calendar day (`src/lib/dateUtils.ts:9-12`), so the label is the same
  day in every device zone. This section needs no change.

## Design

1. Add two pure helpers to `src/lib/claimableTrades.ts`:
   - `tradeDateLabel(start, tz)` → `"Fri, Sep 26"` (`EEE, MMM d`).
   - `tradeTimeRange(start, end, tz)` → `"4:00 PM – 10:00 PM"`.
   Both call `formatInstant`.
2. `UpForGrabsCard` uses `tradeTimeRange` in place of its inline range. The
   output does not change. Both screens now share one formatter.
3. `AvailableShiftsPage` builds a `Map<tradeId, { dateLabel, timeLabel }>`
   with `useMemo` over `items` and `tz`. It passes `dateLabel` and
   `timeLabel` to `TradeCard` as string props.
4. `TradeCard` deletes `formatTradeTime` and its own date format. It keeps
   no hooks. The memo compare function adds `dateLabel` and `timeLabel`.
5. The marketplace separator changes from `-` to `–` to match the home card.

## Tests

- `tests/unit/claimableTrades.test.ts`: the helpers under
  `Pacific/Kiritimati` (UTC+14). No CI or dev runner uses that zone.
- `tests/unit/AvailableShiftsPage.tradeCard.test.tsx`: the restaurant zone is
  `Pacific/Kiritimati`. A trade at 14:00Z shows `4:00 AM – 10:00 AM` on the
  next calendar day. A claim on `shift_date` shows that same calendar day.
  Each test asserts that the runner offset differs from the restaurant offset.

## Decided trade-offs

- No E2E spec. The change is display-only in an existing surface. The unit
  tests drive the full page render with a restaurant zone that differs from
  the runner zone, which is the seam that failed.
