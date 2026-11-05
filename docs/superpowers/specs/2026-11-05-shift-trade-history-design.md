# Shift trade history for managers

Date: 2026-11-05

## Problem

A manager reported: "Audrina has placed a bunch of her shifts for trading and
I don't see them anymore."

The rows exist. The manager queue fetches only `pending_approval` and `open`
trades (`src/components/schedule/TradeApprovalQueue.tsx:109`,
`src/components/schedule/TradeApprovalQueue.tsx:114`). A trade leaves the view
when its status changes.

Production check on 2026-11-05 (read-only), restaurant
`7c0c76e3-e770-401b-a2a9-c1edd407efed`:

| Employee | approved | cancelled | open |
|---|---|---|---|
| Audrina A. Adame | 13 | 5 | 0 |
| Audrina K Gamboa | 3 | 1 | 1 |

The restaurant has 75 approved, 2 rejected, 37 cancelled, and 7 open trades.
All 75 approved rows have `reviewed_by`, `reviewed_at`, and
`accepted_by_employee_id`.

Audrina Adame's 4 most recent lost offers are `cancelled`, not approved. For
this reason the owner chose to show all closed trades, not only approved ones.

## Goal

The Shift Trades tab shows a history of closed trades. Closed means `approved`,
`rejected`, or `cancelled`. Each row shows:

- who gave the shift
- who took it
- the shift date and time
- the outcome, who decided it, and when

The list handles loading, error, and empty states.

## Existing behavior this design depends on

- `approve_shift_trade` sets `reviewed_by`, `reviewed_at`, and `updated_at`
  (`supabase/migrations/20260903034800_shift_protection_trade_functions.sql:174-181`).
- `cancel_shift_trade` sets only `status` and `updated_at`
  (`supabase/migrations/20260713010000_harden_accept_shift_trade.sql:301-305`).
  A cancelled row has no reviewer, so the row shows no actor.
- `expire_stale_shift_trades` sets `status = 'cancelled'`, `reviewed_at`, and
  `manager_note = 'auto_expired'`
  (`supabase/migrations/20260903035000_shift_protection_auto_expire.sql:26-30`).
  `AUTO_EXPIRED_NOTE` holds this marker (`src/lib/shiftTradeStatus.ts:5`).
- `reviewed_by` references `auth.users`, not `employees`
  (`supabase/migrations/20260104120000_create_shift_trades.sql:38`).
- `get_users_by_ids` returns `full_name` and `email` only for users who share a
  restaurant with the caller
  (`supabase/migrations/20261026120600_scope_user_lookup_rpcs.sql:28-52`).
  An id outside that scope gives no row, not an error.
- A user with `edit:scheduling` can read all trades of the restaurant
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:276-278`).
- The Shift Trades tab shows only for `canManageSchedule`
  (`src/pages/Scheduling.tsx:1746`). This is the same capability.
- `hasValidJoins` drops trades that lost the poster or the shift
  (`src/hooks/useShiftTrades.ts:77`).
- `invalidateShiftTradeQueries` invalidates the `['shift_trades']` key prefix
  (`src/hooks/useShiftTrades.ts:137-141`). All trade mutations call it.
- `formatInstant` formats an instant in a given time zone
  (`supabase/functions/_shared/labor/restaurantClock.ts:138`).
  `Scheduling.tsx` already has `restaurantTimezone`
  (`src/pages/Scheduling.tsx:256`).

## Design

No migration. No RLS change. No RPC change.

### `src/lib/shiftTradeHistory.ts` (pure)

- `CLOSED_TRADE_STATUSES`: `approved`, `rejected`, `cancelled`.
- `TradeHistoryFilter`: `all` or one closed status.
- `getTradeHistoryOutcome(trade, reviewerName)` returns the badge label, the
  badge tone, the actor text, and the outcome instant.

| Row | Badge | Actor text | Instant |
|---|---|---|---|
| `approved` | Approved | Approved by {name} | `reviewed_at` |
| `rejected` | Rejected | Rejected by {name} | `reviewed_at` |
| `cancelled` + `auto_expired` | Expired | No one took the shift | `reviewed_at` |
| `cancelled` | Cancelled | Cancelled by the employee | `updated_at` |

`getTradeHistoryParties(trade)` returns the giver and the taker text. The taker
comes from `accepted_by`, never from the current shift owner. Production shows
why: a shift can trade again later, so the current owner can be a third person
(trade `74671f85`). A trade with no taker shows `Offered to {target}` when it
has a target, and `No taker` when it has none.

`manager_note` shows on the row only when it is not `AUTO_EXPIRED_NOTE`.

### `src/hooks/useShiftTradeHistory.ts`

- Uses `useInfiniteQuery`. Page size is 25.
- Query key: `['shift_trades', 'history', restaurantId, filter]`. The prefix
  means that `invalidateShiftTradeQueries` also refreshes the history. No
  mutation needs a change.
- Selects explicit columns with the same joins as `useMyTradeActivity`.
- Filters `restaurant_id` and `status`.
- Orders by `updated_at` descending, then `id` descending, so pages are stable.
- `hasNextPage` uses the raw page length, before `hasValidJoins`. A dropped row
  must not end the list early.
- The flat list removes duplicate ids. A trade that closes between two page
  fetches moves rows down by one.
- After each page, one `get_users_by_ids` call gets the reviewer names for that
  page. Name order: `full_name`, then `email`, then `Unknown manager`.
- An RPC error does not fail the list. The rows show `Unknown manager` and the
  hook logs the error. The approver name is secondary to the trade facts.
- `staleTime` is 30000. `refetchOnWindowFocus` is true.
- `hasValidJoins` is exported from `useShiftTrades.ts` so that the rule stays
  in one place.

### `src/components/schedule/TradeHistorySection.tsx`

- Props: `restaurantId`, `timezone`.
- Renders under `<TradeApprovalQueue />` in `src/pages/Scheduling.tsx:1779`.
- The section is a separate component because the queue tests mock
  `@/hooks/useShiftTrades` (`tests/unit/TradeApprovalQueue.cleanup.test.tsx:27`).
  The queue also has its own loading return, and that return must not hide the
  history.
- Filter: underline tabs with All, Approved, Rejected, and Cancelled.
- States: `Skeleton` rows, an error message with a Try again button, and an
  empty message for each filter.
- A Load more button fetches the next page.
- Times show in the restaurant time zone.
- Styling follows the CLAUDE.md Apple/Notion rules and semantic tokens.

## Decided trade-offs

- No virtualization. Pages load only when the manager asks, and the largest
  restaurant has 121 trades.
- No employee filter. The request does not ask for one.
- No index. `idx_shift_trades_restaurant_id` limits the scan to one restaurant.
- The history does not record who cancelled a trade. `cancel_shift_trade` does
  not store it. The label says "the employee" because that RPC is the only path
  that cancels without the auto-expiry note.

## Tests

- `tests/unit/shiftTradeHistory.test.ts`: every outcome row, parties, note rule.
- `tests/unit/useShiftTradeHistory.test.ts`: filter, order, paging, names, RPC
  failure, dedupe, disabled state.
- `tests/unit/TradeHistorySection.test.tsx`: loading, error, empty, rows in the
  restaurant time zone, filter change, Load more.
