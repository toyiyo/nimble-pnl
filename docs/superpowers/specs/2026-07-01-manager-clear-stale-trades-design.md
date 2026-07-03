# Design: Manager clears stale / expired shift-trade requests

**Date:** 2026-07-01
**Branch:** `feature/manager-clear-stale-trades`
**Scope:** (1) Manager-side cleanup of stale/expired trades, and (2) fix the
shift-trade notification email to render times in the restaurant's timezone.
NOT the poster tracker or area-mismatch warnings (deferred).

## Problem

Managers have no way to close, archive, or remove a stale shift-trade request.

- In `TradeApprovalQueue.tsx`, the "Open in Marketplace" section renders open
  trades via `OpenTradeCard`, which is **read-only** — no actions at all.
- An `open` trade whose shift date has already passed ("expired") sits in that
  section forever. The only actor who can clear an `open` trade today is the
  original poster (`cancel_shift_trade`, which requires `status = 'open'`).
- A `pending_approval` trade whose `accepted_by` employee was deleted renders as
  `null` in `TradeRequestCard` (the component early-returns when
  `!trade.accepted_by`), so it becomes an **invisible "ghost"** — no card, yet it
  still increments `pendingTrades.length` and the "Shift Trades" tab badge. There
  is no way to clear it.

There is no `expires_at` column and no auto-expire. "Expired" is derived purely
from the offered shift's `start_time` being in the past.

## Decision (from brainstorm)

- **Remove-only, no DB migration.** Managers hard-delete stale/expired trades.
  The manager DELETE RLS policy already exists
  (`20260105000000_fix_shift_trades_rls.sql` — "Managers can delete shift trades").
  These are unclaimed / never-completed requests, so no meaningful history is lost.
- **Manager-triggered only.** No cron / auto-expire in this change.
- **No schema, RLS, RPC, or edge-function changes.** Pure client + one React
  Query mutation using the existing `DELETE` policy.

## What "expired / stale" means

A trade is **expired** when its `offered_shift.start_time` is strictly in the
past (`< now`). This applies to both `open` and `pending_approval` trades. A
`pending_approval` ghost (null `accepted_by`) is always stale regardless of date.

Managers may remove:
- any **expired** `open` trade (shift date passed), and
- any **expired or ghost** `pending_approval` trade (shift date passed, or
  accepter no longer exists — the existing Reject flow can't render for a ghost).

Non-expired `open` trades keep their current read-only presentation (a manager
who wants to yank a live trade is out of scope; posters cancel their own).

## Changes

### 1. Hook — `src/hooks/useShiftTrades.ts`

Add `useDeleteShiftTrade()`:

```ts
export const useDeleteShiftTrade = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ tradeId, restaurantId }: { tradeId: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('shift_trades')
        .delete()
        .eq('id', tradeId)
        // Explicit tenant filter — defense-in-depth alongside the manager
        // DELETE RLS policy (which already scopes by restaurant_id). Guards
        // against an RLS regression and self-documents intent.
        .eq('restaurant_id', restaurantId)
        // Guard: never hard-delete an approved/rejected audit record, even
        // though the manager DELETE RLS policy technically permits it. If the
        // trade was approved between click and execute, this is a safe no-op.
        .in('status', ['open', 'pending_approval']);
      if (error) throw error;
      return { tradeId };
    },
    onSuccess: () => {
      // The shift never moved (ownership only transfers in approve_shift_trade),
      // so NO ['shifts'] invalidation is needed here.
      queryClient.invalidateQueries({ queryKey: ['shift_trades'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace_trades'] });
      toast({ title: 'Trade removed', description: 'The stale trade request was removed.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error removing trade', description: error.message, variant: 'destructive' });
    },
  });
};
```

- **Status guard (Supabase review, minor):** the `.in('status', [...])` filter
  closes the gap where the general-purpose hook could otherwise delete an
  `approved` record if called outside the UI guard. PostgREST `DELETE` of a
  row that no longer matches (already approved, or already gone) affects 0 rows
  and returns no error — safe/idempotent.
- No notification email fires (the poster's request is being cleaned up, not
  decided) — deliberately different from approve/reject/cancel.
- The Supabase client surfaces failures via the returned `{ error }`, not by
  throwing; the `if (error) throw error` normalizes it into the mutation's
  `onError`. Transport-level throw is possible but rare (both are tested).

### 2. Expired detection helper — `src/lib/shiftTradeStatus.ts` (new, pure, tested)

```ts
/** A trade is expired when its offered shift started in the past. */
export function isTradeExpired(startTimeIso: string | undefined, now: Date): boolean {
  if (!startTimeIso) return false;
  return new Date(startTimeIso).getTime() < now.getTime();
}
```

Pure function so it's unit-testable without rendering. `now` is injected (never
read `Date.now()` inside), per the testability lesson.

### 3. Component — `src/components/schedule/TradeApprovalQueue.tsx`

- **`OpenTradeCard`** gains optional `onRemove`, `isRemoving`, `expired` props.
  When `expired`, show an "Expired" badge and a **Remove** button that opens the
  confirm dialog. Non-expired open trades render exactly as today (read-only).
  - **Badge styling (frontend review, minor):** mirror the component's existing
    badge language — `<Badge variant="outline">` at the established size — and
    route the destructive action through shadcn `<Button variant="destructive">`
    so the semantic token applies via the variant (consistent with the existing
    Reject button). Do not introduce new raw palette classes.
- **Split open trades once via `partition`** (frontend review, major): compute
  `{ expired, active }` from `openTrades` in a single pass and render Expired
  (removable) and Active (read-only) sub-groups. Do not rely on a child's `null`
  return as an implicit filter.
- **Ghost / stale pending trades** (frontend review, major): partition
  `pendingTrades` **once** into
  `stalePending = t => !t.accepted_by || isTradeExpired(t.offered_shift?.start_time, now)`
  and `normalPending` (the rest). Pass `normalPending` to `TradeRequestCard.map()`
  and `stalePending` to a small "Needs cleanup" row with a Remove action. This
  prevents a ghost from (a) rendering in both paths or (b) rendering in neither
  while still counting in the tab badge. The "Needs cleanup" Remove button uses
  visible text (`<Button size="sm">Remove</Button>`), no `aria-label` needed.
- **Bulk action:** "Remove all expired (N)" button that removes every expired
  open trade + stale pending after a single confirm. It uses
  `await Promise.allSettled(ids.map(id => mutateAsync({ tradeId: id, restaurantId })))`
  (not fire-and-forget `mutate()`), so each per-ID `.finally()` clears that ID's
  spinner independently and the handler can await the whole batch. `allSettled`
  (not `all`) so one failed delete does not abort the rest. The bulk button is
  disabled whenever `deletingIds.size > 0`, and it must remain visible whenever
  stale work exists — the in-marketplace header button renders only when there
  are expired *open* trades, so a standalone fallback covers the
  `hasOpenTrades && !hasExpiredOpen` case (stale pending alongside active-only
  open trades) as well as the no-open-trades case.
- **Concurrency (frontend review, major):** track in-flight deletions with
  `useState<Set<string>>` — add on start, remove in **`onSettled`** (NOT
  `onSuccess`, so a failed delete still clears the spinner). Per-row spinner uses
  `deletingIds.has(trade.id)`, **not** the mutation's shared `isPending` (which
  would spin every row at once).
- **Confirm dialog (frontend review, major):** ONE dialog at list level.
  State is a discriminated union so a single dialog serves both cases:
  `type ConfirmTarget = { type: 'single'; trade: ShiftTrade } | { type: 'bulk'; ids: string[] } | null`.
  Single shows the trade's date/time/poster; bulk shows the count.
- **Focus management (frontend review, minor):** after the confirm dialog closes
  (especially bulk remove, which unmounts rows), return focus to the "Remove all
  expired" button (or the Open Marketplace section header) so focus is not lost
  to an unmounted node.
- **Null `start_time` edge (frontend review, minor):** `isTradeExpired` returns
  `false` for a missing `start_time`, so such an open trade stays in the Active
  (read-only) group rather than being flagged expired. Acceptable — the hook
  already filters out trades whose `offered_shift` is null.

### 4. Email timezone fix — shift-trade notification

**Bug:** `send-shift-trade-notification/index.ts` formats shift times with
`toLocaleString('en-US', {...})` and **no `timeZone` option**
(`index.ts:61`). On Supabase's edge runtime the default TZ is UTC, so every
trade email shows the shift in UTC instead of the restaurant's local time.

**Fix:**
1. Extend the shared helper `_shared/emailTemplates.ts` `formatDateTime` to take
   an **optional** `timeZone?: string` param (backward compatible — existing
   callers that omit it are unchanged):
   ```ts
   export const formatDateTime = (date: string | Date, timeZone?: string): string => {
     const d = typeof date === 'string' ? new Date(date) : date;
     return d.toLocaleString('en-US', {
       weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
       hour: 'numeric', minute: '2-digit', hour12: true,
       ...(timeZone ? { timeZone } : {}),
     });
   };
   ```
2. In `send-shift-trade-notification/index.ts`: replace the file-local
   `formatDateTime` with the shared import, add `timezone` to the restaurant
   embed (`restaurant:restaurants(name, timezone)`), compute
   `const restaurantTimezone = trade.restaurant?.timezone || 'America/Chicago'`
   (matches the `restaurants.timezone` column default and the Clover/Shift4 sync
   fallback), and pass it: `formatDateTime(shift.start_time, restaurantTimezone)`.
3. **Harden against invalid IANA values:** `toLocaleString({ timeZone })` throws
   `RangeError` on a malformed/empty/legacy timezone string, which would crash
   the whole email send. `formatDateTime` probes the timezone once
   (`new Intl.DateTimeFormat('en-US', { timeZone })` in a try/catch) and falls
   back to `'UTC'` on failure, so a bad stored value degrades gracefully instead
   of throwing.

**Out of scope (follow-up):** `send-shift-notification/index.ts` uses the same
shared `formatDateTime` without a `timeZone` and has the identical latent bug.
The optional param leaves it untouched (still renders in runtime default). Fixing
it needs that function to fetch the restaurant timezone — filed as a separate
follow-up, not bundled here to keep this PR's blast radius tight. The dead
`index.refactored.ts` is left as-is.

### 5. Tab-badge correctness — `src/pages/Scheduling.tsx`

The "Shift Trades" tab badge uses `pendingTrades.length`. Ghost pending trades
inflate it. Out of direct scope to change the badge formula, but removing the
ghost via the new UI naturally corrects the count once acted on. No badge-logic
change in this PR (noted as a follow-up if the count still feels wrong).

## Three-state rendering

- Loading: existing skeletons (unchanged).
- Error: existing (hook `error` surfaced via toast).
- Empty: when there are no expired/stale trades, the Expired group is not
  rendered; the existing "No shifts currently in the marketplace" empty state
  covers the fully-empty case. Card visibility follows "does data exist?" not
  "does active data exist?" (history-state lesson): the Open Marketplace card
  still renders whenever any open trade exists.

## Accessibility

- Remove buttons get explicit text ("Remove") + `aria-label` where icon-only.
- Confirm dialog uses `DialogTitle` + `DialogDescription` (Radix
  `aria-describedby`).
- Destructive styling via `text-destructive` semantic token, not raw red.

## Testing

- `tests/unit/shiftTradeStatus.test.ts` — `isTradeExpired`: past → true,
  future → false, exactly-now → false, undefined → false. Inject a fixed `now`.
- `tests/unit/useShiftTrades.deleteTrade.test.ts` — mock the
  `supabase.from().delete().eq().in()` builder chain; assert success invalidates
  `['shift_trades']` + `['marketplace_trades']` and shows the success toast;
  assert both failure shapes surface the destructive toast — a resolved
  `{ error: {...} }` (PostgREST HTTP failure) and a thrown error (transport),
  per the error-shape lesson.
- `tests/unit/emailTemplates.formatDateTime.test.ts` — the same UTC instant
  renders a different wall-clock string for `America/Chicago` vs
  `America/New_York`; omitting `timeZone` stays backward compatible. (Lives under
  `_shared/**`, which is vitest-coverage-excluded, so no coverage-gate impact —
  the test guards correctness only. Precedent: `trialEmailTemplates.test.ts`.)
- Component behavior is covered indirectly; a source-text guard is unnecessary
  since logic lives in the pure helper + hook.

## Decided trade-offs

- **Hard delete over soft-archive:** chosen in brainstorm. Stale/never-completed
  requests carry no audit value worth a schema change. If retention is later
  needed, add an `archived` status + `archived_at` in a follow-up.
- **No email on remove:** removal is janitorial, not a decision affecting the
  poster's shift ownership (the shift never moved). Sending "your trade was
  removed" would be noise.
- **Badge formula unchanged:** avoids widening scope into `Scheduling.tsx`
  counting logic; the ghost is cleared by the new action.
