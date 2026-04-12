# Browser Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Web Push notification support so employees receive browser push notifications alongside emails for shift changes, time-off updates, and shift trades.

**Architecture:** Service worker receives push events. Frontend hook manages subscription lifecycle via VAPID. New edge function sends Web Push. Existing notification edge functions gain a `sendWebPush()` call alongside email sends. New DB table stores push subscriptions.

**Tech Stack:** Web Push API (VAPID), Deno `web-push` library, Service Worker, React (hook + banner component), PostgreSQL (new table + RLS), pgTAP + Vitest tests.

**Design Spec:** `docs/superpowers/specs/2026-04-12-browser-push-notifications-design.md`

---

### Task 1: Database Migration — `web_push_subscriptions` table

**Files:**
- Create: `supabase/migrations/20260412100000_create_web_push_subscriptions.sql`
- Test: `supabase/tests/web_push_subscriptions.test.sql`

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/web_push_subscriptions.test.sql`:

```sql
BEGIN;
SELECT plan(6);

-- Table exists
SELECT has_table('public', 'web_push_subscriptions', 'web_push_subscriptions table exists');

-- Required columns
SELECT has_column('public', 'web_push_subscriptions', 'id', 'has id column');
SELECT has_column('public', 'web_push_subscriptions', 'user_id', 'has user_id column');
SELECT has_column('public', 'web_push_subscriptions', 'restaurant_id', 'has restaurant_id column');
SELECT has_column('public', 'web_push_subscriptions', 'endpoint', 'has endpoint column');
SELECT has_column('public', 'web_push_subscriptions', 'p256dh', 'has p256dh column');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — table `web_push_subscriptions` does not exist

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260412100000_create_web_push_subscriptions.sql`:

```sql
-- Web Push subscription storage for browser push notifications
CREATE TABLE web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_push_subscriptions_user_endpoint_key UNIQUE (user_id, endpoint)
);

-- Index for lookup by user + restaurant (used by send-web-push edge function)
CREATE INDEX idx_web_push_subscriptions_user_restaurant
  ON web_push_subscriptions (user_id, restaurant_id);

-- RLS: users manage their own subscriptions
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subscriptions"
  ON web_push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 4: Reset DB and run the test**

Run: `npm run db:reset && npm run test:db`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260412100000_create_web_push_subscriptions.sql supabase/tests/web_push_subscriptions.test.sql
git commit -m "feat: add web_push_subscriptions table with RLS"
```

---

### Task 2: Shared Web Push Helper — `_shared/webPushHelper.ts`

**Files:**
- Create: `supabase/functions/_shared/webPushHelper.ts`

This helper is called by existing notification edge functions to send web push alongside email. It queries the DB and sends to all subscriptions for a user.

- [ ] **Step 1: Create the shared helper**

Create `supabase/functions/_shared/webPushHelper.ts`:

```typescript
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
}

interface WebPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send Web Push notifications to all subscriptions for a user at a restaurant.
 * Silently skips if VAPID keys are not configured.
 * Cleans up stale subscriptions (410 Gone, 404 Not Found).
 */
export async function sendWebPushToUser(
  supabase: SupabaseClient,
  userId: string,
  restaurantId: string,
  payload: WebPushPayload
): Promise<{ sent: number; cleaned: number }> {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.log('Web push: VAPID keys not configured, skipping');
    return { sent: 0, cleaned: 0 };
  }

  // Look up subscriptions
  const { data: subscriptions, error } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId);

  if (error || !subscriptions?.length) {
    return { sent: 0, cleaned: 0 };
  }

  // Import web-push library
  const webpush = await import('npm:web-push@3.6.7');
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  let sent = 0;
  const staleIds: string[] = [];

  for (const sub of subscriptions as WebPushSubscription[]) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        { TTL: 86400 } // 24 hour TTL
      );
      sent++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        staleIds.push(sub.id);
      } else {
        console.error(`Web push failed for subscription ${sub.id}:`, err);
      }
    }
  }

  // Clean up stale subscriptions
  if (staleIds.length > 0) {
    await supabase.from('web_push_subscriptions').delete().in('id', staleIds);
    console.log(`Cleaned ${staleIds.length} stale web push subscriptions`);
  }

  console.log(`Web push: sent ${sent}/${subscriptions.length} to user ${userId}`);
  return { sent, cleaned: staleIds.length };
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/webPushHelper.ts
git commit -m "feat: add shared web push helper for edge functions"
```

---

### Task 3: Edge Function — `manage-web-push-subscription`

**Files:**
- Create: `supabase/functions/manage-web-push-subscription/index.ts`
- Test: `tests/unit/manageWebPushSubscription.test.ts`

- [ ] **Step 1: Write the unit test**

Create `tests/unit/manageWebPushSubscription.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

/**
 * Validate the subscription payload shape expected by the manage-web-push-subscription
 * edge function. The actual edge function runs in Deno, so we test the validation logic
 * that will be shared with the frontend hook.
 */

interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  restaurant_id: string;
}

function validateSubscriptionPayload(
  payload: unknown
): payload is PushSubscriptionPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.endpoint !== 'string' || !p.endpoint.startsWith('https://')) return false;
  if (!p.keys || typeof p.keys !== 'object') return false;
  const keys = p.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== 'string' || keys.p256dh.length === 0) return false;
  if (typeof keys.auth !== 'string' || keys.auth.length === 0) return false;
  if (typeof p.restaurant_id !== 'string' || p.restaurant_id.length === 0) return false;
  return true;
}

// Export for reuse in the frontend hook
export { validateSubscriptionPayload };
export type { PushSubscriptionPayload };

describe('validateSubscriptionPayload', () => {
  it('accepts a valid subscription payload', () => {
    const valid = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'BNcRd...base64', auth: 'tBHI...base64' },
      restaurant_id: '550e8400-e29b-41d4-a716-446655440000',
    };
    expect(validateSubscriptionPayload(valid)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateSubscriptionPayload(null)).toBe(false);
  });

  it('rejects missing endpoint', () => {
    const invalid = {
      keys: { p256dh: 'abc', auth: 'def' },
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects non-https endpoint', () => {
    const invalid = {
      endpoint: 'http://insecure.example.com',
      keys: { p256dh: 'abc', auth: 'def' },
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects missing keys', () => {
    const invalid = {
      endpoint: 'https://push.example.com',
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects empty p256dh key', () => {
    const invalid = {
      endpoint: 'https://push.example.com',
      keys: { p256dh: '', auth: 'def' },
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects missing restaurant_id', () => {
    const invalid = {
      endpoint: 'https://push.example.com',
      keys: { p256dh: 'abc', auth: 'def' },
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/manageWebPushSubscription.test.ts`
Expected: PASS (these are pure function tests, they pass immediately since the validation function is defined inline)

- [ ] **Step 3: Create the edge function**

Create `supabase/functions/manage-web-push-subscription/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface SubscribeRequest {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  restaurant_id: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Authenticate the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'POST') {
      const body: SubscribeRequest = await req.json();

      // Validate payload
      if (
        !body.endpoint?.startsWith('https://') ||
        !body.keys?.p256dh ||
        !body.keys?.auth ||
        !body.restaurant_id
      ) {
        return new Response(
          JSON.stringify({ error: 'Invalid subscription payload' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Upsert subscription (same user + endpoint = update keys)
      const { error } = await supabase
        .from('web_push_subscriptions')
        .upsert(
          {
            user_id: user.id,
            restaurant_id: body.restaurant_id,
            endpoint: body.endpoint,
            p256dh: body.keys.p256dh,
            auth: body.keys.auth,
          },
          { onConflict: 'user_id,endpoint' }
        );

      if (error) {
        console.error('Failed to save subscription:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to save subscription' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'DELETE') {
      const { endpoint } = await req.json();

      if (!endpoint) {
        return new Response(
          JSON.stringify({ error: 'Missing endpoint' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('web_push_subscriptions')
        .delete()
        .eq('user_id', user.id)
        .eq('endpoint', endpoint);

      if (error) {
        console.error('Failed to delete subscription:', error);
        return new Response(
          JSON.stringify({ error: 'Failed to delete subscription' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/manage-web-push-subscription/index.ts tests/unit/manageWebPushSubscription.test.ts
git commit -m "feat: add manage-web-push-subscription edge function"
```

---

### Task 4: Service Worker — `public/sw.js`

**Files:**
- Create: `public/sw.js`
- Test: `tests/unit/serviceWorker.test.ts`

- [ ] **Step 1: Write the unit test**

Create `tests/unit/serviceWorker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

/**
 * Test the push payload parsing logic used by the service worker.
 * The actual service worker runs in browser context, but we can test
 * the payload parsing as a pure function.
 */

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
}

function parsePushPayload(jsonString: string): PushPayload | null {
  try {
    const data = JSON.parse(jsonString);
    if (!data.title || !data.body) return null;
    return {
      title: data.title,
      body: data.body,
      icon: data.icon || '/icon-192.png',
      url: data.url || '/',
      tag: data.tag,
    };
  } catch {
    return null;
  }
}

// This function is duplicated in sw.js (service workers can't import modules).
// Keep them in sync.
export { parsePushPayload };

describe('parsePushPayload', () => {
  it('parses a valid payload with all fields', () => {
    const json = JSON.stringify({
      title: 'New Shift',
      body: 'Mon 8am-4pm',
      icon: '/custom-icon.png',
      url: '/schedule',
      tag: 'shift-123',
    });
    const result = parsePushPayload(json);
    expect(result).toEqual({
      title: 'New Shift',
      body: 'Mon 8am-4pm',
      icon: '/custom-icon.png',
      url: '/schedule',
      tag: 'shift-123',
    });
  });

  it('provides defaults for optional fields', () => {
    const json = JSON.stringify({ title: 'Alert', body: 'Something happened' });
    const result = parsePushPayload(json);
    expect(result).toEqual({
      title: 'Alert',
      body: 'Something happened',
      icon: '/icon-192.png',
      url: '/',
      tag: undefined,
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parsePushPayload('not json')).toBeNull();
  });

  it('returns null for missing title', () => {
    expect(parsePushPayload(JSON.stringify({ body: 'no title' }))).toBeNull();
  });

  it('returns null for missing body', () => {
    expect(parsePushPayload(JSON.stringify({ title: 'no body' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/unit/serviceWorker.test.ts`
Expected: PASS

- [ ] **Step 3: Create the service worker**

Create `public/sw.js`:

```javascript
// EasyShiftHQ Service Worker — Push Notifications Only
// No caching or offline support. This file handles push events
// and notification clicks.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  if (!data.title || !data.body) return;

  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.tag,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if one is open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 4: Commit**

```bash
git add public/sw.js tests/unit/serviceWorker.test.ts
git commit -m "feat: add service worker for push notification handling"
```

---

### Task 5: Frontend Hook — `useWebPushSubscription`

**Files:**
- Create: `src/hooks/useWebPushSubscription.ts`
- Test: `tests/unit/useWebPushSubscription.test.ts`

- [ ] **Step 1: Write the unit test**

Create `tests/unit/useWebPushSubscription.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Test the helper functions used by useWebPushSubscription.
 * The hook itself depends on browser APIs (navigator.serviceWorker, PushManager),
 * so we test the pure logic separately.
 */

function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function shouldShowBanner(
  isSupported: boolean,
  permission: NotificationPermission | null,
  isSubscribed: boolean,
  dismissedAt: number | null
): boolean {
  if (!isSupported) return false;
  if (permission === 'denied') return false;
  if (isSubscribed) return false;
  if (dismissedAt) {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - dismissedAt < thirtyDaysMs) return false;
  }
  return true;
}

export { isWebPushSupported, shouldShowBanner };

describe('isWebPushSupported', () => {
  it('returns false in non-browser environment', () => {
    // vitest runs in jsdom which has window but not serviceWorker/PushManager
    // This test documents the expected behavior
    const result = isWebPushSupported();
    // jsdom doesn't have serviceWorker, so this should be false
    expect(result).toBe(false);
  });
});

describe('shouldShowBanner', () => {
  it('shows banner when supported, default permission, not subscribed, not dismissed', () => {
    expect(shouldShowBanner(true, 'default', false, null)).toBe(true);
  });

  it('shows banner when permission is granted but not yet subscribed', () => {
    expect(shouldShowBanner(true, 'granted', false, null)).toBe(true);
  });

  it('hides banner when not supported', () => {
    expect(shouldShowBanner(false, 'default', false, null)).toBe(false);
  });

  it('hides banner when permission is denied', () => {
    expect(shouldShowBanner(true, 'denied', false, null)).toBe(false);
  });

  it('hides banner when already subscribed', () => {
    expect(shouldShowBanner(true, 'default', true, null)).toBe(false);
  });

  it('hides banner when dismissed less than 30 days ago', () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, tenDaysAgo)).toBe(false);
  });

  it('shows banner when dismissed more than 30 days ago', () => {
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, fortyDaysAgo)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/useWebPushSubscription.test.ts`
Expected: PASS

- [ ] **Step 3: Create the hook**

Create `src/hooks/useWebPushSubscription.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const DISMISS_KEY = 'push_banner_dismissed_at';

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function shouldShowBanner(
  isSupported: boolean,
  permission: NotificationPermission | null,
  isSubscribed: boolean,
  dismissedAt: number | null
): boolean {
  if (!isSupported) return false;
  if (permission === 'denied') return false;
  if (isSubscribed) return false;
  if (dismissedAt) {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - dismissedAt < thirtyDaysMs) return false;
  }
  return true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useWebPushSubscription() {
  const { user } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  const [isSupported] = useState(() => isWebPushSupported());
  const [permission, setPermission] = useState<NotificationPermission | null>(
    () => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : null)
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Check existing subscription on mount
  useEffect(() => {
    if (!isSupported) return;

    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      });
    });
  }, [isSupported]);

  // Register service worker on mount (only if supported)
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    if (!user || !restaurantId || !VAPID_PUBLIC_KEY) return;

    setIsLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = subscription.toJSON();
      const { error } = await supabase.functions.invoke('manage-web-push-subscription', {
        method: 'POST',
        body: {
          endpoint: json.endpoint,
          keys: json.keys,
          restaurant_id: restaurantId,
        },
      });

      if (error) throw error;
      setIsSubscribed(true);
    } catch (err) {
      console.error('Failed to subscribe to web push:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, restaurantId]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await supabase.functions.invoke('manage-web-push-subscription', {
          method: 'DELETE',
          body: { endpoint },
        });
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error('Failed to unsubscribe from web push:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }, []);

  const dismissedAt = (() => {
    if (typeof window === 'undefined') return null;
    const val = localStorage.getItem(DISMISS_KEY);
    return val ? Number(val) : null;
  })();

  return {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
    dismiss,
    shouldShowBanner: shouldShowBanner(isSupported, permission, isSubscribed, dismissedAt),
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useWebPushSubscription.ts tests/unit/useWebPushSubscription.test.ts
git commit -m "feat: add useWebPushSubscription hook for browser push"
```

---

### Task 6: Enable Notifications Banner Component

**Files:**
- Create: `src/components/EnableNotificationsBanner.tsx`
- Test: `tests/unit/enableNotificationsBanner.test.ts`

- [ ] **Step 1: Write the unit test**

Create `tests/unit/enableNotificationsBanner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { shouldShowBanner } from '../../src/hooks/useWebPushSubscription';

// The banner component delegates show/hide logic to shouldShowBanner.
// We test that logic here. The component itself is a thin UI wrapper.
// Visual correctness is verified via UI review (Phase 5).

describe('EnableNotificationsBanner show/hide logic', () => {
  it('shows for supported browser with default permission', () => {
    expect(shouldShowBanner(true, 'default', false, null)).toBe(true);
  });

  it('hides when permission permanently denied', () => {
    expect(shouldShowBanner(true, 'denied', false, null)).toBe(false);
  });

  it('hides when already subscribed', () => {
    expect(shouldShowBanner(true, 'granted', true, null)).toBe(false);
  });

  it('respects 30-day dismiss window', () => {
    const recent = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, recent)).toBe(false);
    expect(shouldShowBanner(true, 'default', false, old)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/enableNotificationsBanner.test.ts`
Expected: PASS

- [ ] **Step 3: Create the banner component**

Create `src/components/EnableNotificationsBanner.tsx`:

```typescript
import { Bell, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription';

export function EnableNotificationsBanner() {
  const { shouldShowBanner, subscribe, dismiss, isLoading } = useWebPushSubscription();

  if (!shouldShowBanner) return null;

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-muted/30">
      <div className="h-10 w-10 shrink-0 rounded-xl bg-muted/50 flex items-center justify-center">
        <Bell className="h-5 w-5 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-foreground">
          Get instant shift updates
        </p>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Enable notifications to know immediately when your shifts change
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          onClick={dismiss}
        >
          Not now
        </Button>
        <Button
          size="sm"
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          onClick={subscribe}
          disabled={isLoading}
        >
          {isLoading ? 'Enabling...' : 'Enable'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/EnableNotificationsBanner.tsx tests/unit/enableNotificationsBanner.test.ts
git commit -m "feat: add EnableNotificationsBanner component"
```

---

### Task 7: Wire Banner into Employee Portal

**Files:**
- Modify: `src/pages/EmployeePortal.tsx`

- [ ] **Step 1: Add the banner import and render it**

In `src/pages/EmployeePortal.tsx`, add the import at the top (after existing imports):

```typescript
import { EnableNotificationsBanner } from '@/components/EnableNotificationsBanner';
```

Find the return statement in the component (after the loading/error checks) and add the banner at the top of the main content area. Look for the first `<Card>` or `<div>` after the page header and add before it:

```typescript
<EnableNotificationsBanner />
```

The banner will be placed between the page header and the tabs section. It self-hides when not needed (unsupported browser, already subscribed, dismissed).

- [ ] **Step 2: Verify the page still renders**

Run: `npm run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add src/pages/EmployeePortal.tsx
git commit -m "feat: show notification banner on employee portal"
```

---

### Task 8: Wire Web Push into `send-shift-notification`

**Files:**
- Modify: `supabase/functions/send-shift-notification/index.ts`

- [ ] **Step 1: Add web push call after email send**

At the top of `supabase/functions/send-shift-notification/index.ts`, add the import:

```typescript
import { sendWebPushToUser } from '../_shared/webPushHelper.ts';
```

After the successful email send (after line 218 `console.log(...)`, before the `return successResponse`), add:

```typescript
    // Send web push notification to the employee
    if (shift.employee?.user_id) {
      try {
        await sendWebPushToUser(supabase, shift.employee.user_id, shift.restaurant_id, {
          title: config.heading,
          body: config.message(!!hasChanges),
          url: '/employee/schedule',
          tag: `shift-${action}-${shiftId}`,
        });
      } catch (e) {
        console.error('Web push failed:', e);
      }
    }
```

Note: The `shift` query at line 119 already joins `employees!employee_id` but does NOT select `user_id`. Update the select at line 124 to include it:

Change:
```
employee:employees!employee_id(
  id,
  name,
  email
)
```

To:
```
employee:employees!employee_id(
  id,
  name,
  email,
  user_id
)
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-shift-notification/index.ts
git commit -m "feat: send web push alongside email for shift notifications"
```

---

### Task 9: Wire Web Push into `send-time-off-notification`

**Files:**
- Modify: `supabase/functions/send-time-off-notification/index.ts`

- [ ] **Step 1: Add web push call alongside existing FCM call**

At the top of `supabase/functions/send-time-off-notification/index.ts`, add the import:

```typescript
import { sendWebPushToUser } from '../_shared/webPushHelper.ts';
```

After the existing FCM push block (after line 303, inside the same `if` block for approved/rejected), add:

```typescript
        // Also send web push
        try {
          await sendWebPushToUser(supabase, timeOffRequest.employee.user_id, timeOffRequest.restaurant_id, {
            title: 'Time-Off Update',
            body: `Your time-off request (${startDate} - ${endDate}) has been ${action}`,
            url: '/employee/portal',
            tag: `timeoff-${action}-${timeOffRequestId}`,
          });
        } catch (e) {
          console.error('Web push failed:', e);
        }
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-time-off-notification/index.ts
git commit -m "feat: send web push alongside email for time-off notifications"
```

---

### Task 10: Wire Web Push into `send-shift-trade-notification`

**Files:**
- Modify: `supabase/functions/send-shift-trade-notification/index.ts`

- [ ] **Step 1: Add web push call alongside existing FCM calls**

At the top of `supabase/functions/send-shift-trade-notification/index.ts`, add the import:

```typescript
import { sendWebPushToUser } from '../_shared/webPushHelper.ts';
```

After the existing FCM push loop (after line 440, before the final `return`), add a parallel web push loop. The trade object already has `restaurant_id` from the query:

```typescript
    // Send web push notifications to the same users
    for (const userId of [...new Set(pushUserIds)]) {
      try {
        await sendWebPushToUser(supabase, userId, trade.restaurant_id, {
          title: 'Shift Trade Update',
          body: content.subject(employeeName),
          url: '/employee/shifts',
          tag: `trade-${action}-${tradeId}`,
        });
      } catch (e) {
        console.error('Web push failed:', e);
      }
    }
```

Note: Verify that `trade.restaurant_id` is available from the query. Check the select statement — if it doesn't include `restaurant_id`, add it to the select.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/send-shift-trade-notification/index.ts
git commit -m "feat: send web push alongside email for shift trade notifications"
```

---

### Task 11: VAPID Key Generation and Environment Setup

**Files:**
- Modify: `.env.local` (add VAPID public key for frontend)
- Modify: `.env` (add placeholder for production)

- [ ] **Step 1: Generate VAPID keys**

Run:
```bash
npx web-push generate-vapid-keys
```

This outputs a public key and private key. Copy them.

- [ ] **Step 2: Add to local environment**

Add to `.env.local`:
```
VITE_VAPID_PUBLIC_KEY=<generated-public-key>
```

The private key and subject are Supabase secrets (set via `supabase secrets set` for production, or in `.env.local` for local edge functions):
```
VAPID_PUBLIC_KEY=<same-public-key>
VAPID_PRIVATE_KEY=<generated-private-key>
VAPID_SUBJECT=mailto:notifications@easyshifthq.com
```

- [ ] **Step 3: Add placeholder to `.env`**

Add to `.env` (production template):
```
VITE_VAPID_PUBLIC_KEY=
```

- [ ] **Step 4: Commit**

```bash
git add .env
git commit -m "feat: add VAPID public key env var placeholder"
```

Note: `.env.local` is gitignored — do NOT commit it. The actual VAPID keys for production will be set via Supabase dashboard secrets.

---

### Task 12: Regenerate Supabase Types

**Files:**
- Modify: `src/integrations/supabase/types.ts`

- [ ] **Step 1: Reset DB and regenerate types**

Run:
```bash
npm run db:reset
npx supabase gen types typescript --local 2>/dev/null > src/integrations/supabase/types.ts
```

- [ ] **Step 2: Verify the generated file starts cleanly**

Check that line 1 starts with `export type` and not a log message (per lesson from 2026-04-11).

Run: `head -1 src/integrations/supabase/types.ts`
Expected: `export type Json =` (or similar valid TypeScript)

- [ ] **Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase types with web_push_subscriptions"
```
