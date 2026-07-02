# Design: Manager clears stale / expired shift-trade requests

**Date:** 2026-07-01
**Branch:** `feature/manager-clear-stale-trades`
**Scope:** Manager-side cleanup only. NOT the poster tracker or area-mismatch warnings (deferred).

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
    mutationFn: async ({ tradeId }: { tradeId: string }) => {
      const { error } = await supabase
        .from('shift_trades')
        .delete()
        .eq('id', tradeId);
      if (error) throw error;
      return { tradeId };
    },
    onSuccess: () => {
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

No notification email fires (the poster's request is being cleaned up, not
decided) — deliberately different from approve/reject/cancel.

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

- **`OpenTradeCard`** gains an optional `onRemove` + `isRemoving` + `expired`
  props. When `expired`, show an "Expired" badge (semantic tokens, not raw
  colors) and a **Remove** button that opens the confirm dialog. Non-expired
  open trades render exactly as today (read-only).
- Split the "Open in Marketplace" list into **Expired** (removable) and **Active**
  (read-only) groups, so the manager sees what's actionable.
- **Ghost pending trades:** compute `stalePending = pendingTrades.filter(t => !t.accepted_by || isTradeExpired(t.offered_shift?.start_time, now))`. Render
  a small "Needs cleanup" row for these with a Remove action (a ghost can't use
  the existing Approve/Reject card because it renders null). Non-stale
  pending trades keep the existing `TradeRequestCard`.
- **Bulk action:** "Remove all expired (N)" button that deletes every expired
  open trade (and stale pending) after a single confirm.
- **Concurrency:** track in-flight deletions with `useState<Set<string>>` —
  add on start, delete in `onSettled` — so multiple rows can be removed
  independently (per the Set-vs-scalar lesson). The bulk button and per-row
  buttons all disable while any relevant deletion is in flight.
- **Confirm dialog:** single dialog at list level (single-dialog pattern), not
  per row. Reuses the existing dialog styling in this file.

### 4. Tab-badge correctness — `src/pages/Scheduling.tsx`

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
- `tests/unit/useShiftTrades.deleteTrade.test.ts` — mock `supabase.from().delete().eq()`;
  assert success invalidates both query keys and shows toast; assert the
  resolved-with-`{error}` path surfaces the destructive toast and rejects
  (per the `functions.invoke`/PostgREST error-shape lesson — here it's a
  `.delete()` builder returning `{ error }`, mock both a thrown error and a
  resolved `{ error }`).
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
