# Plan — Shift-available broadcast push (Phase A)

**Design:** docs/superpowers/specs/2026-07-11-shift-available-push-design.md
**Branch:** `feature/shift-available-push`

TDD: RED → GREEN → REFACTOR → COMMIT per task. `sonar.sources=src` → edge-function files aren't
coverage-gated, but pure logic still gets unit tests for correctness.

---

### Task 1 — `_shared/webPushFanout.ts` (pure primitives) + test
- **Test** `tests/unit/webPushFanout.test.ts`:
  - `selectBroadcastPushUserIds`: drops null/undefined user_ids; excludes `excludeUserId`; dedupes;
    excludeUserId null/undefined keeps all; empty input → `[]`.
  - `runBounded`: runs worker once per item; `maxInFlight ≤ concurrency` (timing probe like the
    schedulePublishedPush test); non-throw when a worker rejects (Promise.allSettled); non-positive
    concurrency clamps to ≥1 and still completes (no hang).
- **Code** `supabase/functions/_shared/webPushFanout.ts`: `selectBroadcastPushUserIds` +
  `runBounded<T>` per design (no Deno-only imports — vitest-importable).
- Dep: none.

### Task 2 — `sendWebPushToUsers` bulk helper in `_shared/webPushHelper.ts`
- **Code**: add `sendWebPushToUsers(supabase, userIds, restaurantId, payload, opts?)`:
  one `web_push_subscriptions` select `.in('user_id', userIds).eq('restaurant_id', restaurantId)`;
  `maxTargets` ceiling (default 500, log+cap, return `skipped`); `setVapidDetails` once (skip if
  VAPID unset); `runBounded` over subscription rows calling `webpush.sendNotification`; batch-delete
  410/404 stale; return `{ sent, cleaned, skipped }`. Reuses the `runBounded` primitive from Task 1.
- **Verify**: `deno check`; no vitest target (Deno-only glue, same status as existing
  `sendWebPushToUser`). Pure decision logic lives in Task 1's tested helpers.
- Dep: 1.

### Task 3 — wire `send-shift-trade-notification/index.ts`
- **Code**:
  1. Add bare `admin = createClient(supabaseUrl, supabaseServiceKey)` (no Authorization). Keep the
     JWT-scoped `supabase` for `auth.getUser()` only.
  2. After the trade fetch, caller-authz: `admin.from('user_restaurants').select('role')
     .eq('user_id', user.id).eq('restaurant_id', trade.restaurant_id).maybeSingle()` → 403 if none.
  3. Repoint the existing targeted `sendWebPushToUser(...)` calls from `supabase` → `admin`
     (fixes the latent cross-user silent no-op). The broadcast `employees` query also uses `admin`.
  4. Replace the `created` push-skip with: fetch active employees' user_ids via `admin`,
     `selectBroadcastPushUserIds(rows, trade.offered_by?.user_id)`, then
     `sendWebPushToUsers(admin, targets, trade.restaurant_id, { title: content.heading,
     body: 'A teammate offered a shift for trade. Tap to view.', url: '/employee/shifts',
     tag: `trade-created-${tradeId}` })`, wrapped in try/catch.
- **Verify**: `deno check --config supabase/functions/deno.json`, `eslint`, `typecheck`.
- Dep: 1, 2.

---

## Phase 8 verify
Full `npx vitest run` (not just the new file — lesson from #601), `typecheck`, `lint`, `build`,
`deno check` on the edited functions. No migration, no pgTAP (no schema change).

## Task order
1 → 2 → 3 (strictly sequential; 2 and 3 depend on 1's `runBounded`/`selectBroadcastPushUserIds`).

## Out of scope (follow-ups)
- Admin-only per-type × per-channel resolver (Phase B) — the `created` block is the seam.
- Migrate notify-schedule-published + retire `schedulePublishedPush.ts` onto `sendWebPushToUsers`.
- `notifications_sent` idempotency record for the trade broadcast (email already lacks one).
- Excluding the poster from the broadcast *email*.
- Surfacing the push opt-in banner in help docs (separate doc gap).
