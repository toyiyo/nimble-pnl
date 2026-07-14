# Design — Shift-available push notification (Phase A)

**Date:** 2026-07-11
**Branch:** `feature/shift-available-push`

## Problem

When an employee offers a shift for trade (`shift_trades` insert → `send-shift-trade-notification`
with `action: 'created'`), the whole team gets an **email** but **no push** — the push section
explicitly skips it (`if (action === 'created') { /* No targeted push for broadcast — skip */ }`).
Managers want the team notified on their phones when a shift becomes available.

## Critical constraint found in design review

The function builds its Supabase client by **forwarding the caller's JWT**:

```ts
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  global: { headers: { Authorization: authHeader } }   // ← poster's JWT
});
```

PostgREST derives the RLS role from that `Authorization` header, so every `.from()` runs as the
**poster (`authenticated`)**, not `service_role`. `web_push_subscriptions` RLS is strictly
`USING (auth.uid() = user_id)` with no restaurant-broadening policy, so
`sendWebPushToUser(supabase, otherUserId, …)` reads **zero rows and no-ops silently** for anyone
but the caller. Consequence: the new broadcast would ship returning `200 { attempted: N }` while
delivering **zero pushes** — and the *existing* targeted pushes (accepted/approved/rejected/
cancelled) to the *other* party are already silently broken for the same reason.

## Scope (approved)

- **In:** broadcast web-push on `created` to active employees with a subscription, **excluding the
  poster**, bounded/bulk so a big team stays within the edge budget. Fix the client so pushes
  actually deliver (this repairs the existing targeted branches too). Add the missing caller
  authorization check. Email unchanged.
- **Out (Phase B, separate):** admin-only per-type × per-channel resolver. The channel decision is
  a single isolated block so it can later be gated by `resolveChannels(...)`.
- **Out:** migrating `notify-schedule-published` / `schedulePublishedPush.ts` onto the new bulk
  helper (works today via a *bare* service client). Noted as a Phase-B consolidation follow-up.
- **Out:** excluding the poster from the *email* (pre-existing; left as-is per "email unchanged").

## Approach

### 1. Fix the client (critical) — `send-shift-trade-notification/index.ts`

Keep the JWT-scoped `supabase` **only** for `supabase.auth.getUser()`. Add a genuine bypass client
for all data/notification reads (mirrors `proxy-receipt-file/index.ts`):

```ts
const admin = createClient(supabaseUrl, supabaseServiceKey);  // no Authorization override
```

Route the broadcast `employees` query, the caller-membership lookup, and **all** `sendWebPushTo*`
calls through `admin`. This makes the new feature work and fixes the latent cross-user targeted-push
bug in the same change (documented in the PR).

### 2. Caller authorization (major)

Today the function only checks that `authHeader` resolves to *some* user — any authenticated user
can POST an arbitrary `tradeId` and (now) trigger a mass broadcast to another restaurant's staff.
After fetching the trade, verify membership:

```ts
const { data: membership } = await admin.from('user_restaurants')
  .select('role').eq('user_id', user.id).eq('restaurant_id', trade.restaurant_id).maybeSingle();
if (!membership) return 403;
```

### 3. Bulk web-push helper (major — avoid N+1 + repeated VAPID signing)

`sendWebPushToUser` does a `web_push_subscriptions` SELECT **and** `webpush.setVapidDetails()` per
call — 100 targets = 100 SELECTs + 100 ECDSA VAPID setups (real CPU) in one invocation. Add a bulk
variant to `_shared/webPushHelper.ts`:

```ts
export async function sendWebPushToUsers(
  supabase, userIds: string[], restaurantId: string, payload: WebPushPayload,
  opts?: { concurrency?: number; maxTargets?: number },
): Promise<{ sent: number; cleaned: number; skipped: number }>;
```
- One `select('id, user_id, endpoint, p256dh, auth').eq('restaurant_id', restaurantId).in('user_id', userIds)`.
- `setVapidDetails(...)` **once**; no-op (skip) if VAPID unset.
- Hard **ceiling** `maxTargets` (default 500): if `userIds` exceeds it, log and process the first N,
  returning `skipped` — matches the codebase's "max N per run" pattern; keeps the ~10s CPU budget safe.
- Fan `webpush.sendNotification` out over subscription rows with **bounded concurrency** via the
  tested `runBounded` primitive; collect 410/404 and delete stale in one batch.

### 4. Pure, tested primitives — `_shared/webPushFanout.ts` (vitest-importable)

```ts
export function selectBroadcastPushUserIds(
  employees: Array<{ user_id?: string | null }>, excludeUserId?: string | null,
): string[];  // drop null user_ids, exclude the actor, dedupe

export async function runBounded<T>(
  items: T[], worker: (item: T) => Promise<unknown>, concurrency?: number, // default 20
): Promise<void>;  // Promise.allSettled per chunk; concurrency clamped >= 1 (no hang)
```

### 5. The `created` branch

```ts
if (action === 'created') {
  const { data: rows } = await admin.from('employees')
    .select('user_id').eq('restaurant_id', trade.restaurant_id)
    .eq('is_active', true).not('user_id', 'is', null);
  const targets = selectBroadcastPushUserIds(rows ?? [], trade.offered_by?.user_id);
  try {
    await sendWebPushToUsers(admin, targets, trade.restaurant_id, {
      title: content.heading,                          // "New Shift Available for Trade"
      body: 'A teammate offered a shift for trade. Tap to view.',
      url: '/employee/shifts',
      tag: `trade-created-${tradeId}`,                 // aligns with existing `trade-${action}-${tradeId}`
    });
  } catch (e) { console.error('Broadcast web push failed:', e); }
}
```
Web-push only (no legacy FCM) for the broadcast, consistent with PR #601. Push failure never blocks
the already-sent email.

### Phase-B seam

The `created` channel decision is one isolated block; Phase B wraps it as
`if (channels.push) { … }` with `channels = resolveChannels('shift_trade_created', restaurantId)`.

## Testing

- `tests/unit/webPushFanout.test.ts`:
  - `selectBroadcastPushUserIds`: drops null/undefined; excludes `excludeUserId`; **dedupes**
    duplicate user_ids; excludeUserId null → keeps all; empty → `[]`.
  - `runBounded`: runs every item; `maxInFlight ≤ concurrency`; non-throw on a rejecting worker;
    non-positive concurrency clamps to ≥1 (no hang).
- `tests/unit/schedulePublishedPush.test.ts`: **unchanged and untouched** (that helper is not
  modified — the reviewer's refactor-risk finding is avoided entirely).
- Edge-function `index.ts` + `sendWebPushToUsers` glue are Deno-only (not in `sonar.sources=src`,
  so not coverage-gated); verified via `deno check`, `eslint`, `typecheck`, full `vitest run`, `build`.

## Decided trade-offs

- **Broadcast parity with email:** push targets = active employees minus the poster (same audience
  as the email). No position/availability targeting (out of scope; would diverge from the email).
- **Reach depends on push opt-in** (the "Enable" banner). Separate doc gap, tracked outside this PR.
- **Poster still receives the broadcast email** (unchanged); excluded only from push.
- **No `notifications_sent` idempotency record:** a client retry of `sendShiftTradeNotification`
  would re-broadcast. Pre-existing (email already has this); the on-device `tag` collapses duplicate
  *pushes* per trade. Full idempotency deferred.
- **notify-schedule-published not migrated** to the bulk helper this round (works via a bare service
  client); consolidation deferred to Phase B.
