// Sends the owner alert for an integration disconnect (design 4.5).
// All logic lives in _shared/integrationDisconnectAlertHandler.ts.
// This file only wires real Supabase, Resend, and fetch clients.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmailResult } from '../_shared/emailQueue.ts';
import { NOTIFICATION_FROM, APP_URL } from '../_shared/notificationHelpers.ts';
import { handleIntegrationDisconnectAlert } from '../_shared/integrationDisconnectAlertHandler.ts';

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceKey || !resendKey) {
    console.error('[notify-integration-disconnect] missing required env');
    return json(500, { error: 'Service not configured' });
  }
  if (!authHeader) return json(401, { error: 'Unauthorized' });

  let payload: { eventId?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const service = createClient(supabaseUrl, serviceKey);

  try {
    const res = await handleIntegrationDisconnectAlert(
      {
        getCallerId: async () => {
          const { data, error } = await userClient.auth.getUser();
          return error || !data.user ? null : data.user.id;
        },
        loadEvent: async (eventId) => {
          const { data } = await service
            .from('integration_events')
            .select('id, restaurant_id, integration, event, actor_user_id, reason, reason_text, created_at')
            .eq('id', eventId)
            .maybeSingle();
          return data ?? null;
        },
        claimAlert: async (eventId) => {
          const leaseCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data, error } = await service
            .from('integration_events')
            .update({ alert_claimed_at: new Date().toISOString() })
            .eq('id', eventId)
            .is('alerted_at', null)
            .or(`alert_claimed_at.is.null,alert_claimed_at.lt.${leaseCutoff}`)
            .select('id');
          if (error) throw new Error(error.message);
          return (data?.length ?? 0) > 0;
        },
        markAlerted: async (eventId) => {
          await service
            .from('integration_events')
            .update({ alerted_at: new Date().toISOString() })
            .eq('id', eventId);
        },
        loadRecipients: async (restaurantId) => {
          const { data, error } = await service.rpc('integration_alert_recipients', {
            p_restaurant_id: restaurantId,
          });
          if (error) throw new Error(error.message);
          return data ?? [];
        },
        loadRestaurant: async (restaurantId) => {
          const { data } = await service
            .from('restaurants')
            .select('name, timezone')
            .eq('id', restaurantId)
            .maybeSingle();
          return data ?? null;
        },
        loadActor: async (userId) => {
          const { data } = await service
            .from('profiles')
            .select('full_name, email')
            .eq('user_id', userId)
            .maybeSingle();
          return data ?? null;
        },
        sendEmail: (to, subject, html) =>
          sendEmailResult(resendKey, NOTIFICATION_FROM, to, subject, html),
        fetch,
        slackWebhookUrl: Deno.env.get('CS_SLACK_WEBHOOK_URL') || undefined,
        appUrl: APP_URL,
        now: () => new Date(),
        log: (m) => console.log(`[notify-integration-disconnect] ${m}`),
      },
      payload,
    );
    return json(res.status, res.body);
  } catch (err) {
    console.error('[notify-integration-disconnect] failed', err instanceof Error ? err.message : err);
    return json(500, { error: 'Internal error' });
  }
});
