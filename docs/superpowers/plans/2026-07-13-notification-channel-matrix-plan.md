# Plan — Notification channel matrix (FULL, all rows live, one PR)

**Design:** docs/superpowers/specs/2026-07-13-notification-channel-matrix-design.md
**Branch:** `feature/notification-channel-matrix`
**User decision:** full retrofit + full matrix, every visible toggle live; retire old time-off toggles.

Reminder (lesson): after any migration add/edit, `npm run db:reset` before `npm run test:db`.

## The 16 notification types (matrix rows) + channels each actually sends
| key | group | email | push |
|---|---|---|---|
| schedule_published | Scheduling | ✅ | ✅ |
| shift_created / shift_modified / shift_deleted | Scheduling | ✅ | ✅ |
| open_shifts_broadcast | Scheduling | ✅ | ✅ |
| shift_trade_created / _accepted / _approved / _rejected / _cancelled | Trades | ✅ | ✅ |
| time_off_requested | Time off | ✅ | — |
| time_off_approved / time_off_rejected | Time off | ✅ | ✅ |
| pin_reset | Access | ✅ | ✅ |
| team_invite | Access | ✅ | — |
| availability_reminder | Scheduling | ✅ | — |
(weekly_brief stays on per-user `notification_preferences` — NOT a matrix row.)

---

### Task 1 — catalog + resolver + tests (single source of truth)
- **`src/lib/notificationTypes.ts`**: `NOTIFICATION_TYPES` array of `{ key, label, group, channels }`
  (channels = subset of `['email','push']` per the table above); export `NotificationType` union of keys.
- **`supabase/functions/_shared/resolveChannels.ts`**: `resolveChannels(supabase, restaurantId, type)
  → { email, push }`; single-row lookup by `(restaurant_id, notification_type)`; **fail-open** (missing
  row/error → both true). Type union kept in sync with the catalog.
- **Tests** `tests/unit/resolveChannels.test.ts` (mock supabase: present row, missing→open, error→open,
  each channel off) + `tests/unit/notificationTypes.test.ts` (catalog keys ⊆/= resolver union; a type's
  `push` channel ⇒ its function actually sends push — guards catalog/CHECK/union drift).
- Dep: none.

### Task 2 — migration: table + RLS + trigger + CHECK + data-migration + pgTAP
- **Migration** `supabase/migrations/<ts-after-20260713010000>_notification_channel_settings.sql`:
  - `CREATE TABLE notification_channel_settings(id, restaurant_id FK ON DELETE CASCADE,
    notification_type TEXT, email_enabled BOOL NOT NULL DEFAULT true, push_enabled BOOL NOT NULL
    DEFAULT true, created_at, updated_at, UNIQUE(restaurant_id, notification_type),
    CHECK (notification_type IN (<16 keys>)))`.
  - `ENABLE ROW LEVEL SECURITY`; RLS **verbatim from `20251123100500`** (view = member; `FOR ALL` =
    owner/manager).
  - `BEFORE UPDATE` trigger → `update_scheduling_updated_at()`.
  - Data-migration: `INSERT..SELECT` from `notification_settings` for the 6 legacy-gated types,
    `email_enabled = COALESCE(<bool>, true)`, `push_enabled = COALESCE(<bool>, true)`,
    `ON CONFLICT (restaurant_id, notification_type) DO NOTHING`.
- **Test** `supabase/tests/<nn>_notification_channel_settings_rls.sql` (pattern `33_tip_splits...`;
  ENABLE RLS before impersonating): staff can SELECT not write; owner/manager can write; cross-restaurant
  isolation; data-migration preserves a `false` legacy toggle into both channels; CHECK rejects a bad type.
- Dep: 1 (type list).

### Task 3 — retrofit ALL firing functions (split email/push gating)
Each: `const ch = await resolveChannels(<service client>, restaurantId, <type>)`; gate email send by
`ch.email`, push send by `ch.push`, independently. Replace legacy gates.
- **3a `send-shift-notification`**: replace the single `shouldSendNotification` (deleted + created/modified
  branches) with `resolveChannels`; action→type map.
- **3b `notify-schedule-published`**: add gating (currently none) — `schedule_published`.
- **3c `send-shift-trade-notification`**: `shift_trade_<action>`; gate the email + the web-push/FCM sends.
- **3d `send-time-off-notification`**: replace the hand-rolled `notification_settings` gate with
  `resolveChannels` for `time_off_<action>`; keep the `time_off_notify_managers/employee` **recipient**
  flags (those are recipient-routing, not channel gates — leave in `notification_settings` for now).
- **3e `broadcast-open-shifts`**: `open_shifts_broadcast`.
- **3f `notify-pin-changed`**: `pin_reset` (gate email + FCM). **3g `send-team-invitation`**: `team_invite`
  (email only). **3h `notify-availability-reminder`**: `availability_reminder` (email only).
- Use each function's existing service-role/admin client for the resolver read. `deno check` each.
- Dep: 1, 2.

### Task 4 — admin matrix UI + hook (retire old toggles)
- **`src/hooks/useNotificationChannelSettings.tsx`**: React Query `select('id, notification_type,
  email_enabled, push_enabled').eq('restaurant_id',…)` (`staleTime: 60000`); merge over default-ON
  baseline for the 16 types → `Map`. Mutation = **diff-based upsert** (only rows changed vs snapshot),
  `onConflict: 'restaurant_id,notification_type'`, invalidate. Handle both invoke-error shapes.
- **`src/components/NotificationChannelMatrix.tsx`**: grouped `<table>` per domain (mirror
  `AvailabilityGrid.tsx` a11y — `sr-only` `<th scope=col>`, `scope=row` labels, composed `aria-label`
  per `Switch` e.g. `"Shift deleted — Push"`); a channel a type doesn't support renders `—` (no toggle,
  no dead switch). Local-state-then-Save; `hasChanges` by **value comparison**; **sync-guard** so a
  refetch doesn't clobber edits while dirty; loading→skeleton, error→retry banner (never silent all-ON).
  CLAUDE.md styling; sticky Save/Reset footer; verify at 375px. Owner/manager-gated (tab already is).
- **Retire old toggles**: remove the 5 time-off event switches from `NotificationSettings.tsx`
  (now governed by the matrix); keep the Weekly Brief card (still per-user). Render the matrix in the
  Notifications tab.
- **Tests** `tests/unit/useNotificationChannelSettings.test.ts` (default-ON merge, diff-upsert payload,
  error swallow) + `tests/unit/NotificationChannelMatrix.test.tsx` (renders grouped rows; unsupported
  channel shows `—`; toggle+Save calls diff-upsert; hasChanges value-based; loading/error states).
- Dep: 1, 2.

---

## Phase 5 UI review: REQUIRED. ## Phase 8 verify: `db:reset`+`test:db`, `test`, `typecheck`, `lint`,
`build`, `deno check` on retrofits, and the shift-trade-accept-style flows unaffected.

## Task order: 1 → 2 ; 1,2 → 3 ; 1,2 → 4. (3 and 4 independent.)

## Out of scope: per-employee overrides; unify web-push vs FCM; drop legacy notification_settings
columns after a soak; weekly_brief admin control.
