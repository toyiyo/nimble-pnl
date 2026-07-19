# Plan — Notification channel matrix (B1 + B2 combined)

**Design:** docs/superpowers/specs/2026-07-13-notification-channel-matrix-design.md
**Branch:** `feature/notification-channel-matrix`
**Approved:** B1+B2 in one PR; **default = ON for both channels** (fail-open preserved).

Reminder: after any migration add/edit, `npm run db:reset` before `npm run test:db`.

---

## B1 — Data model + resolver + one retrofit

### Task 1 — migration: table + RLS + data-migration
- **File** `supabase/migrations/<ts-after-20260713010000>_notification_channel_settings.sql`:
  - `CREATE TABLE notification_channel_settings (id, restaurant_id FK, notification_type TEXT,
    email_enabled BOOL DEFAULT true, push_enabled BOOL DEFAULT true, created_at, updated_at,
    UNIQUE(restaurant_id, notification_type))`; index on restaurant_id; `ENABLE ROW LEVEL SECURITY`.
  - RLS **copied verbatim from `20251123100500_create_notification_settings.sql`** (change only the
    table name): SELECT for any `user_restaurants` member; `FOR ALL` (manage) for `role IN
    ('owner','manager')`.
  - **Data-migration** (preserve existing choices): for each `notification_settings` row, INSERT
    channel rows for the 8 gated types mapping the old single boolean → BOTH email_enabled and
    push_enabled: `shift_created←notify_shift_created`, `shift_modified←notify_shift_modified`,
    `shift_deleted←notify_shift_deleted`, `time_off_requested←notify_time_off_request`,
    `time_off_approved←notify_time_off_approved`, `time_off_rejected←notify_time_off_rejected`.
    `ON CONFLICT (restaurant_id, notification_type) DO NOTHING`. Untracked types left absent (→ ON).
- **Test** `supabase/tests/<nn>_notification_channel_settings_rls.sql` (pattern:
  `33_tip_splits_employee_rls.sql`; ENABLE RLS before impersonating): a staff member can SELECT but
  NOT insert/update; an owner/manager can; cross-restaurant isolation; and a data-migration
  assertion (a restaurant with `notify_shift_created=false` gets a seeded row with
  email_enabled=false AND push_enabled=false).
- Dep: none.

### Task 2 — `_shared/resolveChannels.ts` resolver + unit test
- **Test** `tests/unit/resolveChannels.test.ts` (inject a mock supabase): row present → returns its
  {email,push}; no row (PGRST116) → {email:true,push:true}; query error → {email:true,push:true}
  (fail-open); email off / push off variants.
- **Code** `supabase/functions/_shared/resolveChannels.ts` per design (union type of the 17 types;
  `ChannelDecision`; fail-open).
- Dep: 1.

### Task 3 — retrofit `send-shift-notification/index.ts`
- Replace the single `shouldSendNotification(..., settingKey)` gate (deleted branch ~154, created/
  modified ~261) with `const ch = await resolveChannels(supabase, restaurantId, <type>)`; gate the
  Resend email send by `ch.email` and the `sendWebPushToUser` call by `ch.push` **independently**
  (today they share one boolean). Map action→type: created→`shift_created`, modified→`shift_modified`,
  deleted→`shift_deleted`. Keep the "no email / no user_id" short-circuits.
- **Verify**: `deno check`; the existing `send-shift-notification` behavior for a fully-on restaurant
  is unchanged (default ON).
- Dep: 2.

## B2 — Admin matrix UI

### Task 4 — `useNotificationChannelSettings` hook + types + test
- **Code** `src/hooks/useNotificationChannelSettings.tsx`: React Query fetch of all rows for the
  restaurant (`select('*').eq('restaurant_id', …)`), returning a `Map<type,{email,push}>` merged
  over the default-ON baseline for the 17 known types; an upsert mutation
  (`.upsert(rows, { onConflict: 'restaurant_id,notification_type' })`) invalidating the query.
- **Types**: add `NotificationChannelSetting` + the `NOTIFICATION_TYPES` catalog (type key + human
  label + group) in `src/types/` (or a `src/lib/notificationTypes.ts`). Run `sync-types` if needed.
- **Test** `tests/unit/useNotificationChannelSettings.test.ts`: default-ON merge for absent types;
  upsert payload shape; both invoke-error shapes swallowed (per the 2026-05-16 lesson).
- Dep: 1.

### Task 5 — matrix UI in Settings → Notifications
- **Code** extend `src/components/NotificationSettings.tsx` (or a new
  `NotificationChannelMatrix.tsx` rendered in the same tab): a grouped table — rows = the 17 types
  (grouped Scheduling / Trades / Time-off / Access / Open shifts), columns = **Email** / **Push**
  `Switch` cells; local-state-then-**Save** pattern (mirror the existing component: `localSettings`
  diffed for `hasChanges`, Save/Reset buttons). Follow CLAUDE.md styling (semantic tokens, typography
  scale, `Switch` `data-[state=checked]:bg-foreground`). Handle loading/empty/error states. a11y:
  each Switch labelled by its row+column. Owner/manager-gated (tab already is).
- **Test** `tests/unit/NotificationChannelMatrix.test.tsx`: renders rows/columns; toggling a cell +
  Save calls the upsert with the right payload; disabled/read-only for non-managers if applicable.
- Dep: 4.

---

## Phase 5 UI review: REQUIRED (Task 5 adds real UI) — run frontend-design review.
## Phase 8 verify
`npm run db:reset` + `npm run test:db` (RLS + data-migration), `npm run test` (resolver, hook,
component), `npm run typecheck`, `npm run lint`, `npm run build`, `deno check` on the retrofit.

## Task order
1 → 2 → 3 (B1) ; 1 → 4 → 5 (B2). 3 and 4/5 independent after their deps.

## Out of scope (B3 + follow-ups)
- B3: retrofit notify-schedule-published, send-shift-trade-notification, send-time-off-notification,
  broadcast-open-shifts, notify-pin-changed onto `resolveChannels` (next PR).
- Per-employee overrides; unifying web-push vs legacy FCM; dropping legacy notification_settings cols.
