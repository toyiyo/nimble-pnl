# Browser Push Notifications for Employees — Design Spec

**Date:** 2026-04-12
**Status:** Approved
**Scope:** Infrastructure + employee-facing event types (shift, time-off, shift trade)

## Problem

Web users only receive email notifications. Employees who add EasyShiftHQ to their phone's home screen (PWA shortcut) have no way to get timely alerts. Browser push notifications fill this gap — they work on Android, desktop, and iOS 16.4+ (when added to Home Screen).

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Channel strategy | Parallel — push alongside email | No disruption to existing email flow; users get both |
| Scope | Infrastructure + 3 employee event types | Delivers value immediately, keeps PR reviewable |
| Permission UX | Contextual banner after login | Browser best practice — never cold-prompt |
| Backend | VAPID Web Push via edge function | Open standard, no vendor lock-in, no Firebase SDK bloat |

## Architecture

### Data Flow

```
Employee clicks "Enable" on banner
  → Notification.requestPermission()
  → navigator.serviceWorker.register('sw.js')
  → PushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })
  → POST subscription to manage-web-push-subscription edge function
  → Stored in web_push_subscriptions table

Event fires (e.g., shift created):
  → Existing edge function sends email via Resend (unchanged)
  → Same function calls send-web-push edge function
  → Reads subscriptions for user+restaurant from DB
  → Sends Web Push via VAPID protocol
  → Service worker receives push event → showNotification()
  → Employee taps notification → opens app at target URL
```

### Components

#### 1. Service Worker — `public/sw.js`

Minimal service worker handling push and notification click:

- `push` event: Parse JSON payload `{ title, body, icon, url, tag }`, call `showNotification()`
- `notificationclick` event: Open/focus app at target URL from notification data
- `tag` field prevents duplicate notifications for the same event
- No caching or offline logic — push only

#### 2. Database — `web_push_subscriptions` table

```sql
CREATE TABLE web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Same browser re-subscribing replaces the old subscription
ALTER TABLE web_push_subscriptions
  ADD CONSTRAINT web_push_subscriptions_user_endpoint_key UNIQUE (user_id, endpoint);

-- RLS: users manage their own subscriptions
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subscriptions"
  ON web_push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

#### 3. Edge Function — `manage-web-push-subscription`

Handles subscription CRUD from the frontend:

- `POST` — Upsert subscription (subscribe or re-subscribe)
- `DELETE` — Remove subscription (unsubscribe)
- Auth: requires valid JWT (user token)
- Validates payload shape before storing

#### 4. Edge Function — `send-web-push`

Sends Web Push notifications:

- Input: `{ user_id, restaurant_id, title, body, url }`
- Queries `web_push_subscriptions` for matching user+restaurant
- Sends to each subscription endpoint using VAPID credentials
- On `410 Gone` or `404`: deletes the stale subscription (mirrors FCM token cleanup pattern)
- On other errors: logs and continues to next subscription
- Uses `web-push` library from npm via Deno (`npm:web-push`)
- Env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (email URI)

#### 5. Wiring — Existing Edge Functions

Each function gains a `sendWebPush()` call alongside existing `sendEmail()`:

**`send-shift-notification`** (employee receives):
- `created`: title="New Shift", body="Mon Jan 6, 8:00 AM - 4:00 PM", url="/schedule"
- `modified`: title="Shift Changed", body="Mon Jan 6 updated: 9:00 AM - 5:00 PM", url="/schedule"
- `deleted`: title="Shift Cancelled", body="Mon Jan 6, 8:00 AM - 4:00 PM has been removed", url="/schedule"

**`send-time-off-notification`** (employee receives on approved/rejected):
- `approved`: title="Time Off Approved", body="Dec 25-26 approved", url="/time-off"
- `rejected`: title="Time Off Denied", body="Dec 25-26 was not approved", url="/time-off"

**`send-shift-trade-notification`** (employees involved in trade):
- `offered`: title="Shift Trade Offer", body="Trade offered for your Mon 8 AM shift", url="/shift-trades"
- `accepted`: title="Shift Trade Accepted", body="Your trade for Mon 8 AM was accepted", url="/shift-trades"

Notification content respects existing `notification_settings` toggles — if the email toggle for an event is off, the push is also skipped.

#### 6. Frontend Hook — `useWebPushSubscription`

```typescript
// Returns:
{
  isSupported: boolean;      // browser has Push API + service worker support
  isSubscribed: boolean;     // current browser is subscribed
  permission: NotificationPermission; // 'default' | 'granted' | 'denied'
  subscribe: () => Promise<void>;     // request permission + subscribe
  unsubscribe: () => Promise<void>;   // remove subscription
  isLoading: boolean;
}
```

- Checks `'serviceWorker' in navigator && 'PushManager' in window`
- On mount: registers service worker, checks existing subscription
- `subscribe()`: requests permission, calls `PushManager.subscribe()` with VAPID key, POSTs to edge function
- `unsubscribe()`: calls `subscription.unsubscribe()`, DELETEs from edge function
- Uses React Query for subscription state

#### 7. Frontend Component — `EnableNotificationsBanner`

Contextual banner shown on dashboard and schedule pages:

**Show conditions** (all must be true):
- Browser supports Push API
- Permission is not `'denied'` (permanently blocked)
- User is not already subscribed
- User hasn't dismissed within 30 days (`localStorage: push_banner_dismissed_at`)
- User role is employee/staff (not just owner/manager for this PR)

**UI** (Apple/Notion style):
- Subtle card: `rounded-xl border-border/40 bg-muted/30 p-4`
- Bell icon in `h-10 w-10 rounded-xl bg-muted/50` icon box
- Title: "Get instant shift updates" (text-[14px] font-medium)
- Subtitle: "Enable notifications to know immediately when shifts change" (text-[13px] text-muted-foreground)
- Primary button: "Enable" (bg-foreground text-background)
- Dismiss: "Not now" (text-muted-foreground ghost button)
- Dismissed state persisted to localStorage with 30-day TTL

#### 8. VAPID Key Management

- Generate VAPID keypair using `web-push generate-vapid-keys`
- Store as Supabase secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Public key exposed to frontend via `VITE_VAPID_PUBLIC_KEY` env var
- For local development: add to `.env.local`

## iOS Safari Considerations

Web Push on iOS requires:
- iOS 16.4+
- Site added to Home Screen (standalone mode — already configured in manifest.json)
- User must grant permission from within the PWA

The banner only shows when `'PushManager' in window` is true, so it naturally hides on unsupported browsers. For iOS Safari (not added to Home Screen), the banner won't appear since PushManager is unavailable.

## Out of Scope

- Offline caching / full PWA service worker
- Manager-facing notification types (follow-up PR)
- Separate push notification preferences (reuses email toggles)
- Push notification analytics/delivery tracking
- Notification inbox/history UI

## Testing Strategy

| Layer | Test Type | What |
|-------|-----------|------|
| `web_push_subscriptions` table | pgTAP | RLS policies, unique constraint, cascade delete |
| `send-web-push` edge function | Unit (Vitest) | Payload construction, stale subscription cleanup |
| `useWebPushSubscription` hook | Unit (Vitest) | Subscribe/unsubscribe flows, browser support detection |
| `EnableNotificationsBanner` | Unit (Vitest) | Show/hide conditions, dismiss persistence |
| Service worker | Unit (Vitest) | Push event handling, notification click routing |
| Full flow | E2E (Playwright) | Banner appears, permission mock, subscription stored |
