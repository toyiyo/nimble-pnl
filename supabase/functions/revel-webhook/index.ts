import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyRevelSignature } from "../_shared/revelSignature.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { resolveRestaurantTimeZone } from "../_shared/timezone.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-revel-signature, x-revel-instance, x-revel-establishment-id, x-revel-event-type, x-revel-event-id',
};

// Always ack 2XX for non-actionable cases so Revel does not retry-storm (spec: return 200, log).
function ack(body = 'OK', status = 200) {
  return new Response(body, { headers: corsHeaders, status });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-revel-signature');
    const instance = req.headers.get('x-revel-instance');
    const establishmentId = req.headers.get('x-revel-establishment-id');
    const eventType = req.headers.get('x-revel-event-type') ?? 'unknown';
    const eventId = req.headers.get('x-revel-event-id');

    const webhookSecret = Deno.env.get('REVEL_WEBHOOK_SECRET');
    if (!webhookSecret) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_SECRET_NOT_CONFIGURED');
      return ack('Webhook not configured', 200);
    }

    // MANDATORY signature check
    const valid = await verifyRevelSignature(rawBody, signature, webhookSecret);
    if (!valid) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_SIGNATURE_FAILED', undefined, undefined, { instance, eventType });
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!instance) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_MISSING_INSTANCE');
      return ack('Missing instance', 200);
    }

    // Route instance -> restaurant
    const { data: connection } = await supabase
      .from('revel_connections')
      .select('*')
      .eq('revel_instance', instance)
      .eq('is_active', true)
      .maybeSingle();

    if (!connection) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_NO_CONNECTION', undefined, undefined, { instance });
      return ack('No connection', 200); // ack to avoid retries; merchant not onboarded here
    }

    // Idempotency
    if (eventId) {
      const { data: existing } = await supabase
        .from('revel_webhook_events')
        .select('id')
        .eq('restaurant_id', connection.restaurant_id)
        .eq('event_id', eventId)
        .maybeSingle();
      if (existing) return ack();
    }

    const payload = JSON.parse(rawBody);

    // Only order.finalized carries sales; ignore other event types for v1.
    if (eventType === 'order.finalized' || payload.Order || payload.order) {
      // Resolved once per invocation (a webhook run processes a single order).
      const timeZone = await resolveRestaurantTimeZone(supabase, connection.restaurant_id);
      await processOrder(
        supabase,
        payload,
        connection.restaurant_id,
        instance,
        establishmentId ?? connection.establishment_id ?? null,
        {},
        timeZone,
      );
    }

    // Record the event as processed ONLY after successful processing, so a processing
    // failure (500) lets Revel retry instead of being short-circuited by the idempotency
    // check above. ignoreDuplicates avoids a unique-violation throw on concurrent delivery.
    if (eventId) {
      await supabase.from('revel_webhook_events').upsert({
        restaurant_id: connection.restaurant_id,
        event_id: eventId,
        event_type: eventType,
        raw_json: payload,
      }, { onConflict: 'restaurant_id,event_id', ignoreDuplicates: true });
    }

    await logSecurityEvent(supabase, 'REVEL_WEBHOOK_PROCESSED', undefined, connection.restaurant_id, { eventType, eventId });
    return ack();
  } catch (error: any) {
    // 500 => Revel will retry per its backoff schedule (spec: 60/300/900/900).
    await logSecurityEvent(supabase, 'REVEL_WEBHOOK_ERROR', undefined, undefined, { message: error?.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
