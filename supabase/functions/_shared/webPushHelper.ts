import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runBounded } from './webPushFanout.ts';

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

interface BulkWebPushSubscription extends WebPushSubscription {
  user_id: string;
}

// Hard ceiling on how many user_ids a single bulk send will process — keeps the
// ~10s edge-function CPU budget safe. Matches the codebase's "max N per run" pattern
// (see e.g. Toast bulk sync's "max 200 orders per restaurant per run").
const DEFAULT_MAX_TARGETS = 500;
const BULK_SEND_CONCURRENCY = 20;

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

/**
 * Send Web Push notifications to many users' subscriptions in a restaurant with a
 * single subscription lookup and a single VAPID setup — avoids the N+1 SELECT +
 * repeated ECDSA VAPID signing that calling `sendWebPushToUser` per target would
 * cost (see design doc "avoid N+1 + repeated VAPID signing").
 *
 * `userIds` beyond `opts.maxTargets` (default 500) are dropped and counted in
 * `skipped`, so one oversized broadcast can't blow the edge function's CPU budget.
 * Silently skips (0 sent) if VAPID keys are not configured. Cleans up stale
 * subscriptions (410 Gone, 404 Not Found) in one batched delete.
 */
export async function sendWebPushToUsers(
  supabase: SupabaseClient,
  userIds: string[],
  restaurantId: string,
  payload: WebPushPayload,
  opts?: { concurrency?: number; maxTargets?: number }
): Promise<{ sent: number; cleaned: number; skipped: number }> {
  if (!userIds.length) {
    return { sent: 0, cleaned: 0, skipped: 0 };
  }

  const maxTargets = opts?.maxTargets ?? DEFAULT_MAX_TARGETS;
  const targetIds = userIds.slice(0, maxTargets);
  const skipped = userIds.length - targetIds.length;
  if (skipped > 0) {
    console.log(
      `Web push: ${userIds.length} target(s) exceed maxTargets=${maxTargets}, processing first ${targetIds.length} and skipping ${skipped}`
    );
  }

  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.log('Web push: VAPID keys not configured, skipping');
    return { sent: 0, cleaned: 0, skipped };
  }

  // Single lookup for every target's subscriptions, instead of one SELECT per user.
  const { data: subscriptions, error } = await supabase
    .from('web_push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .eq('restaurant_id', restaurantId)
    .in('user_id', targetIds);

  if (error || !subscriptions?.length) {
    return { sent: 0, cleaned: 0, skipped };
  }

  // Import web-push library and configure VAPID once for the whole batch.
  const webpush = await import('npm:web-push@3.6.7');
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  let sent = 0;
  const staleIds: string[] = [];

  await runBounded(
    subscriptions as BulkWebPushSubscription[],
    async (sub) => {
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
          console.error(`Web push failed for subscription ${sub.id} (user ${sub.user_id}):`, err);
        }
      }
    },
    opts?.concurrency ?? BULK_SEND_CONCURRENCY
  );

  // Clean up stale subscriptions in one batch.
  if (staleIds.length > 0) {
    await supabase.from('web_push_subscriptions').delete().in('id', staleIds);
    console.log(`Cleaned ${staleIds.length} stale web push subscriptions`);
  }

  console.log(`Web push: sent ${sent}/${subscriptions.length} to ${targetIds.length} target user(s)`);
  return { sent, cleaned: staleIds.length, skipped };
}
