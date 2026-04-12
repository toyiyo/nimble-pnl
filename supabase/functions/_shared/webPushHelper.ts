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
