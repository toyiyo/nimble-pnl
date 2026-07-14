# Design — Admin per-type × per-channel notification matrix (Phase B)

**Date:** 2026-07-13
**Branch:** `feature/notification-channel-matrix`
**Control model:** admin-only (restaurant-level; no per-employee override this phase)

## Goal

One place where a manager decides, **per notification type**, whether it goes out over **Email**
and/or **Push**. Every notification-sending edge function consults a shared resolver before sending
on each channel, replacing today's scattered/absent gating.

## Current reality (from infra map)

- `notification_settings` gates by a **single boolean per type** (`notify_shift_created` …) that
  covers email+push together; only `send-shift-notification` (3 shift types) and
  `send-time-off-notification` (5 time-off flags) actually consult it. 12+ other types fire with
  **no gating**. ~21 columns are inert.
- `shouldSendNotification()` is **fail-open** (missing row → send).
- 17 distinct types fire across 8 functions; channels vary (email-only, email+push, +legacy FCM).
- `notification_preferences` (weekly brief) is per-user — **out of scope**.

## Data model

New table (do NOT extend the 29-column `notification_settings` further):

```sql
CREATE TABLE notification_channel_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,        -- 'schedule_published', 'shift_created', …
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled  BOOLEAN NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (restaurant_id, notification_type)
);
```
- **RLS** copies `notification_settings` verbatim: SELECT for any restaurant member; INSERT/UPDATE/
  DELETE (`FOR ALL`) restricted to `role IN ('owner','manager')` — already exactly "admin-only".
- **Absent row ⇒ both channels ON** (preserves the current fail-open behavior → zero behavior change
  for restaurants that never configure anything).
- **Data migration to preserve existing choices:** for every restaurant with a `notification_settings`
  row, seed `notification_channel_settings` rows for the 8 already-gated types
  (`shift_created/modified/deleted`, `time_off_requested/approved/rejected`) mapping the old single
  boolean → BOTH `email_enabled` and `push_enabled` (a restaurant that turned `notify_shift_created`
  off keeps it off on both channels). Types that were never gated are left absent (→ ON, unchanged).

## Resolver (shared)

`supabase/functions/_shared/resolveChannels.ts` (pure-ish; DB read injectable for tests):

```ts
export type NotificationType = 'schedule_published' | 'shift_created' | … ;   // union of the 17
export interface ChannelDecision { email: boolean; push: boolean }

/** Restaurant-level channel decision for a notification type. Fail-OPEN: no row ⇒ both true
 *  (matches today's shouldSendNotification default — never silently drop on a missing/errored row). */
export async function resolveChannels(
  supabase: SupabaseClient, restaurantId: string, type: NotificationType,
): Promise<ChannelDecision>;
```
- Reads the one row by `(restaurant_id, notification_type)`; missing/error → `{ email: true, push: true }`.
- Each notify function becomes: `const ch = await resolveChannels(...); if (ch.email) {…email…} if (ch.push) {…push…}` — splitting today's single combined gate into two.
- The "push" boolean is **channel-agnostic**: a function fans out to whatever push it already uses
  (web push and/or legacy FCM) when `ch.push` is true. This migration does not unify the two push
  mechanisms (separate follow-up).

## Rollout — sliced into reviewable PRs

**B1 — Foundation (this PR):** migration (table + RLS + data-migration from `notification_settings`)
+ `resolveChannels.ts` resolver (unit-tested) + retrofit **one** function as proof —
`send-shift-notification` (cleanest: it already uses the single `shouldSendNotification`; replace with
per-channel `resolveChannels`, email gated by `ch.email`, push by `ch.push`). pgTAP for table/RLS;
vitest for the resolver; the retrofit verified by `deno check`.

**B2 — Admin UI:** a matrix in the existing Settings → Notifications tab (rows = the 17 types,
columns = Email / Push `Switch` cells; local-state-then-Save, mirroring `NotificationSettings.tsx`).
New `useNotificationChannelSettings` hook. Regenerate/extend TS types. Human-friendly type labels +
grouping (Scheduling / Trades / Time-off / Access / …).

**B3 — Retrofit the rest:** wire `resolveChannels` into `notify-schedule-published`,
`send-shift-trade-notification`, `send-time-off-notification`, `broadcast-open-shifts`,
`notify-pin-changed`. Each splits email/push gating; `send-time-off-notification`'s hand-rolled gate
is unified onto the resolver.

## Out of scope / follow-ups

- Per-**employee** channel overrides (a `notification_user_channel_overrides` table layered on top) —
  explicitly deferred (user chose admin-only for now).
- Unifying the two push mechanisms (web push vs legacy FCM `device_tokens`).
- `weekly_brief` stays on per-user `notification_preferences`; not an admin-matrix row.
- The ~21 inert `notification_settings` columns (payroll/tips/etc.) — those types don't fire yet, so
  they're not matrix rows until a sender exists. The matrix covers only currently-firing types.

## Decided trade-offs

- **Fail-open preserved.** A restaurant with no config (or a type with no row) gets both channels —
  matching today. Fail-closed would silently mute everyone on deploy; rejected.
- **New table, not more `notification_settings` columns.** A normalized `(type, channel)` shape scales
  to 17+ types × 2 channels without a 60-column table, and cleanly separates the new model from the
  legacy per-type booleans (which the data-migration reads once, then the new table is authoritative).
- **Legacy `notification_settings` booleans become read-once seed data**, not a live dual-source. After
  B3, the new table is the single source of truth for the retrofitted types; the old columns are left
  in place (harmless) and can be dropped in a later cleanup.
