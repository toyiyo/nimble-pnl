# Design: Delete the dead component TradeMarketplace

Date: 2026-09-26
Branch: chore/delete-trade-marketplace
Type: chore (dead-code deletion)

## Problem

`src/components/schedule/TradeMarketplace.tsx` formats shift times with
date-fns `format(new Date(...))`. That function uses the device time zone,
not the restaurant time zone. The calls are at
`src/components/schedule/TradeMarketplace.tsx:221`,
`src/components/schedule/TradeMarketplace.tsx:225-226`,
`src/components/schedule/TradeMarketplace.tsx:343` and
`src/components/schedule/TradeMarketplace.tsx:348`.

The design `docs/superpowers/specs/2026-09-26-marketplace-restaurant-timezone-design.md`
puts this file out of scope, because no page imports it. This task closes
that gap. If the file is dead, delete it. If a page uses it, change it to
`formatInstant`.

## Evidence (premise citations)

1. **No code under `src/` imports the component.** The command
   `grep -rn "TradeMarketplace" src tests` on `origin/main` (5dd9f01f)
   matches the declaration at
   `src/components/schedule/TradeMarketplace.tsx:54` and the test file only.
2. **One test imports the component.** The import is at
   `tests/unit/TradeMarketplace.tentative.test.tsx:41`.
3. **No route mounts the component.** The employee shift route
   `/employee/shifts` mounts `AvailableShiftsPage` at `src/App.tsx:401`,
   imported at `src/App.tsx:64`.
4. **A past lesson confirms that the component is not mounted.** See
   `memory/lessons.md:3269`.
5. **Each shared import of the component has other live consumers.** No
   module becomes an orphan after the deletion:
   - `useMarketplaceTrades` (`src/hooks/useShiftTrades.ts:666`):
     `src/hooks/useAvailableShifts.ts:61`, `src/hooks/useClaimableTrades.ts:32`.
   - `useAcceptShiftTrade` (`src/hooks/useShiftTrades.ts:439`):
     `src/pages/AvailableShiftsPage.tsx`.
   - `useShiftProtection`, `tradeDeadlineFinding`, `ShiftProtectionWarning`
     and `TentativeDraftBadge`: `src/pages/AvailableShiftsPage.tsx` and
     `src/components/schedule/TradeApprovalQueue.tsx`.
6. **The live page keeps test coverage for the tentative badge.** See
   `tests/unit/AvailableShiftsPage.tradeCard.test.tsx:350` and
   `tests/unit/TentativeDraftBadge.test.tsx`.
7. **Historical docs name the component.** Files under `docs/` are
   historical records. Do not change them.

## Approaches

1. **Delete the component and its test (chosen).** The component is dead
   (evidence 1-4). A time-zone fix in dead code gives no value to a user.
2. **Change the component to `formatInstant`.** Rejected. No user sees the
   component. The fix adds cost to keep code that nothing runs.
3. **Mount the component on a route.** Rejected. `AvailableShiftsPage`
   already serves the employee shift feed (evidence 3).

## Design

Delete these two files. Change no other file.

- `src/components/schedule/TradeMarketplace.tsx`
- `tests/unit/TradeMarketplace.tentative.test.tsx`

## Test strategy

A deletion adds no behavior, so it adds no tests. The gates are:

- `npm run typecheck`: no import resolves to the deleted file.
- `npm run lint` and `npm run build`: standard Phase 8 gates.
- `npm run test`: the unit suite does not need the deleted file.
- E2E: justified exception. No route mounts the component, so no
  user-facing behavior changes.
- `npm run test:db`: justified exception. The change touches no SQL.
