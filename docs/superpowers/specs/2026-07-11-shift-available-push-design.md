# Design — Shift-available push notification (Phase A)

**Date:** 2026-07-11
**Branch:** `feature/shift-available-push`

## Problem

When an employee offers a shift for trade (`shift_trades` insert → `send-shift-trade-notification`
with `action: 'created'`), the whole team gets an **email** but **no push**. The push section
explicitly skips it:

```js
if (action === 'created') {
  // No targeted push for broadcast — skip (would notify all employees)
}
```

Managers want the team notified on their phones when a shift becomes available. Push reaches
only employees who opted in via the "Enable" banner, so a broadcast push pings *opted-in*
teammates — not literally everyone — and email is unchanged.

## Scope (approved)

- **In:** Add a bounded-concurrency web-push fan-out to the `created` branch → active employees
  with a push subscription, **excluding the poster** (`trade.offered_by.user_id`). Email untouched.
- **Out (Phase B, separate):** admin-only per-type × per-channel resolver. Not built now; the
  channel decision is kept isolated (a single call site) so it can later be gated by a resolver.
- **Out:** changing the targeted actions (accepted/approved/rejected/cancelled) — they already push.
- **Out:** excluding the poster from the *email* (pre-existing behavior; the poster currently gets
  the broadcast email too — left as-is per "email unchanged").

## Approach

### New tested helper — `supabase/functions/_shared/webPushFanout.ts` (pure, vitest-importable)

```ts
export type WebPushSend = (userId: string) => Promise<unknown>;

/** Filter employee rows to the distinct set of push targets, dropping null user_ids
 *  and the excluded user (e.g. the poster / actor who caused the event). */
export function selectBroadcastPushUserIds(
  employees: Array<{ user_id?: string | null }>,
  excludeUserId?: string | null,
): string[];

/** Fan `send` out over userIds in bounded-concurrency chunks (clamped >= 1) so a
 *  100+-employee broadcast doesn't open 100+ simultaneous push round-trips in one
 *  edge-function invocation. Promise.allSettled per chunk — a rejecting send never throws. */
export async function fanOutWebPush(
  userIds: string[],
  send: WebPushSend,
  concurrency?: number, // default 20
): Promise<{ attempted: number }>;
```

`fanOutWebPush` is the generalized form of the bounded loop already shipped in
`_shared/schedulePublishedPush.ts` (PR #601). **Refactor** `notifySchedulePublishedPush` to map
its `employees` → user_ids via `selectBroadcastPushUserIds` and delegate to `fanOutWebPush` —
one implementation, no duplication. Its existing test (`schedulePublishedPush.test.ts`) guards the
identical behavior (including the concurrency-clamp guard).

### Edge function — `send-shift-trade-notification/index.ts`, `created` branch only

Replace the skip with:
1. Fetch active employees' user_ids for the restaurant (service-role client already in scope):
   `employees.select('user_id').eq('restaurant_id', restaurantId).eq('is_active', true).not('user_id','is',null)`.
2. `const targets = selectBroadcastPushUserIds(rows, trade.offered_by?.user_id)`.
3. `await fanOutWebPush(targets, (uid) => sendWebPushToUser(supabase, uid, trade.restaurant_id, {
     title: content.heading,                 // "New Shift Available for Trade"
     body: 'A teammate offered a shift for trade. Tap to view.',
     url: '/employee/shifts',
     tag: `shift-trade-created-${tradeId}`,  // on-device dedupe per trade
   }))`.

Notes:
- **Web push only** for the broadcast (no legacy FCM `send-push-notification` fan-out) — FCM is
  disabled and 100 FCM POSTs would be wasteful; consistent with PR #601's schedule-published fix.
  The targeted actions keep their existing dual FCM+web-push loop, untouched.
- Wrapped in try/catch → push failure never blocks the (already-sent) email response.
- The `created` branch sits in the existing push section; the DB fetch + two helper calls are the
  only new index.ts lines (thin — new logic is unit-tested in the helper).

### Phase-B seam

The channel decision for `created` is a single, isolated block. When Phase B lands the admin-only
resolver, this becomes `if (channels.push) { …fanOutWebPush… }` where
`channels = resolveChannels('shift_trade_created', restaurantId)`. No structural rework needed.

## Testing

- `tests/unit/webPushFanout.test.ts`:
  - `selectBroadcastPushUserIds`: drops null/undefined user_ids; excludes `excludeUserId`; dedupes;
    returns [] for empty; excludeUserId null/undefined keeps everyone.
  - `fanOutWebPush`: sends once per id; bounded concurrency (maxInFlight ≤ n); non-throw on a
    rejecting send; non-positive concurrency clamps to ≥1 (no hang); `{ attempted }` count.
- `tests/unit/schedulePublishedPush.test.ts`: unchanged, must stay green after the delegation refactor
  (regression guard that the generalization preserved behavior).
- Edge-function `index.ts` broadcast wiring: covered indirectly via the pure helpers; Deno lines stay
  thin. Verified with `deno check`, `eslint`, `typecheck`, full `vitest run`, `build`.

## Decided trade-offs

- **Broadcast parity with email:** push goes to the same audience as the email (all active
  employees, minus the poster). No position/availability targeting — that would diverge from the
  existing email broadcast and is out of scope.
- **Reach depends on push opt-in.** Only employees who tapped "Enable" receive it. (Separate doc
  gap — surfacing the opt-in — tracked outside this PR.)
- **Poster still gets the broadcast email** (unchanged); excluded only from push. Aligning email is
  a separate, deliberate choice left for later to honor "email unchanged."
