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
- `offered_shift_id` and `offered_by_employee_id` are `ON DELETE CASCADE`.
  `accepted_by_employee_id` and `target_employee_id` are `ON DELETE SET NULL`
  (`supabase/migrations/20260104120000_create_shift_trades.sql:9-20`).
- `hasValidJoins` drops trades with a null shift or poster join
  (`src/hooks/useShiftTrades.ts:77`). The cascade deletes those rows, so for a
  manager only RLS can give a null join. The hook keeps the guard for safety.
- `invalidateShiftTradeQueries` invalidates the `['shift_trades']` key prefix
  (`src/hooks/useShiftTrades.ts:137-141`). All trade mutations call it.
- `formatInstant` formats an instant in a given time zone. Import it from
  `@/lib/restaurantClock` (`src/lib/restaurantClock.ts:3`).
  `Scheduling.tsx` already has `restaurantTimezone`, wrapped in `safeTz`
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
| `cancelled` | Cancelled | Cancelled before anyone took it | `updated_at` |

When `reviewerName` is null, the actor text is `Approved` or `Rejected` with no
name.

`getTradeHistoryParties(trade)` returns the giver and the taker text. The taker
comes from `accepted_by`, never from the current shift owner. Production shows
why: a shift can trade again later, so the current owner can be a third person
(trade `74671f85`).

| Row | Taker text |
|---|---|
| `accepted_by` is present | {name} |
| `approved` or `rejected`, no `accepted_by` | Former employee |
| `cancelled`, has a target | Offered to {target} |
| `cancelled`, no target | No taker |

`manager_note` shows on the row only when it is not `AUTO_EXPIRED_NOTE`.

### `src/hooks/useShiftTradeHistory.ts`

- Uses `useInfiniteQuery` in the v5 form, with `initialPageParam: 0`.
- Page size is 25. Each page uses `.range(from, from + 24)`.
- Each page returns `{ rows, rawCount, nextOffset }`.
- `getNextPageParam` returns `nextOffset` when `rawCount` is 25, and `undefined`
  when it is not. `rawCount` is the length before `hasValidJoins`.
- Query key: `['shift_trades', 'history', restaurantId, filter]`. The prefix
  means that `invalidateShiftTradeQueries` also refreshes the history. No
  mutation needs a change.
- Do not use `placeholderData`. A filter change must show the skeleton, not the
  rows of the prior filter. `src/hooks/useUnifiedSales.tsx:192` keeps prior
  rows on purpose. Do not copy that part.
- Selects explicit columns. `useMyTradeActivity` is a base, not a copy
  (`src/hooks/useShiftTrades.ts:257-292`). Columns: `id`, `status`,
  `offered_shift_id`, `offered_by_employee_id`, `accepted_by_employee_id`,
  `target_employee_id`, `reviewed_by`, `reviewed_at`, `manager_note`,
  `created_at`, `updated_at`.
- Joins: `offered_shift`, `offered_by`, `accepted_by`, and
  `target_employee:employees!target_employee_id(id, name)`.
- Filters `restaurant_id` and `status`.
- Orders by `updated_at` descending, then `id` descending.
- The flat list removes duplicate ids. A trade that closes between two page
  fetches moves rows down by one, so a row can repeat.
- Each page collects the distinct non-null `reviewed_by` ids and makes one
  `get_users_by_ids` call. The hook skips the call when the list is empty.
- Each row gets `reviewer_name`:

| Case | `reviewer_name` |
|---|---|
| The RPC gives a row | `full_name`, then `email` |
| The RPC succeeds with no row for the id | `a former team member` |
| The RPC fails | null, and the hook logs the error |

- An RPC error does not fail the list. The trade facts matter more than the
  approver name. 2 of 143 approved rows in production have a reviewer who left.
- The RPC call uses the cast at `src/hooks/useTipSplitAuditLog.ts:45-47`.
  Null `data` counts as an empty list.
- `staleTime` is 30000. `refetchOnWindowFocus` is true. A focus refetch fetches
  each loaded page again. Page size and volume keep this cost small.
- `hasValidJoins` is exported from `useShiftTrades.ts` so that the rule stays
  in one place.

### `src/components/schedule/TradeHistorySection.tsx`

- Props: `restaurantId`, `timezone`.
- Renders under `<TradeApprovalQueue />` in `src/pages/Scheduling.tsx:1779`.
- The section is a separate component because the queue tests mock
  `@/hooks/useShiftTrades` (`tests/unit/TradeApprovalQueue.cleanup.test.tsx:27`).
  The queue also returns early while it loads
  (`src/components/schedule/TradeApprovalQueue.tsx:385`), and that return must
  not hide the history.
- Layout: the wrapper is `CardContent` with `p-0` (`src/pages/Scheduling.tsx:1778`).
  The section root uses `border-t border-border/40 px-4 py-4 sm:px-6`. The
  queue does not change. The section has no inner scroll container.
- Heading: an `h3` with the text "Trade history" and the 12px label style.
- Filter: `Tabs`, `TabsList`, and `TabsTrigger` from `@/components/ui/tabs`, in
  the underline style. Radix gives the tab roles and the arrow keys. Triggers
  show a `focus-visible` ring.
- Loading: 3 `Skeleton` rows with the height of a final row.
- First-load error: a `role="alert"` message and a Try again button. The button
  calls `refetch()`. It is disabled while `isFetching` is true.
- Next-page error: the rows stay. The same message and button show under them.
- Empty: one message for each filter.
- Load more: a `Button` with visible text. It shows `Loading...` and is disabled
  while `isFetchingNextPage` is true. It does not show when `hasNextPage` is false.
- Row: `flex flex-col gap-2 sm:flex-row sm:justify-between`, with
  `rounded-xl border border-border/40 bg-background`.
- Names use `min-w-0 break-words`, not `truncate`. A manager must read both
  names. The badge cell uses `shrink-0`.
- The badge always has text, so color is never the only signal. Tones use
  semantic tokens only.
- Time formats use the `timezone` prop and `formatInstant`: the shift date is
  `EEE, MMM d`, the shift time is `h:mm a`, and the outcome is `MMM d, h:mm a`.

## Decided trade-offs

- No virtualization. Pages load only when the manager asks, and the largest
  restaurant has 121 trades.
- No employee filter. The request does not ask for one.
- No index. `idx_shift_trades_restaurant_id` limits the scan to one restaurant.
- The history shows only rows that exist. A deleted shift or poster deletes its
  trades through the cascade, and RLS lets a manager delete a trade. A durable
  audit record needs a schema change, which this work does not include.
- The table does not record who cancelled a trade, so the row names no one.
  `cancel_shift_trade` is the only code path. RLS allows other writers, but no
  code uses them.
- The cancelled date is the last row update. A `SET NULL` foreign key action
  changes `updated_at` through the trigger. Production shows no such drift today.
- Offset pages can skip a row only when a row is deleted between two fetches.
  New closed rows enter at the top, so they cause a repeat, and dedupe fixes it.

## Tests

- `tests/unit/shiftTradeHistory.test.ts`: every outcome row, every taker row,
  a null reviewer name, the note rule.
- `tests/unit/useShiftTradeHistory.test.ts`: filter, order, paging, names,
  former team member, RPC failure, RPC skip, dedupe, disabled state.
- `tests/unit/TradeHistorySection.test.tsx`: loading, first-load error, next-page
  error, empty, rows in the restaurant time zone, filter change with no old
  rows, Load more.
- `tests/unit/scheduling-trades-gate.test.tsx`: mock `TradeHistorySection`.
  Check that it shows with `edit:scheduling` and not with `view:scheduling`.
