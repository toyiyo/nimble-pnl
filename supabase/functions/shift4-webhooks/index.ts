import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEncryptionService } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Shift4WebhookPayload {
  id: string; // Event ID
  type: string; // Event type (e.g., "CHARGE_SUCCEEDED")
  created: number; // Unix timestamp
  data?: any; // May contain partial data - DO NOT TRUST
}

/**
 * Fetch the full event details from Shift4 API for verification
 * This is CRITICAL for security - never trust the webhook payload directly
 * Note: Shift4 uses the same URL for both test and production.
 */
async function fetchEventFromShift4(
  secretKey: string,
  environment: string,
  eventId: string
): Promise<any> {
  // Shift4 uses the same base URL for both test and production environments
  const baseUrl = 'https://api.shift4.com';

  const authHeader = 'Basic ' + btoa(secretKey + ':');

  const response = await fetch(`${baseUrl}/events/${eventId}`, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch event ${eventId}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Process a charge event (CHARGE_SUCCEEDED, CHARGE_UPDATED, etc.)
 */
async function processChargeEvent(
  supabase: any,
  restaurantId: string,
  merchantId: string,
  charge: any,
  restaurantTimezone: string
) {
  // Extract tip amount from splits (if available)
  let tipAmount = 0;
  if (charge.splits && Array.isArray(charge.splits)) {
    const tipSplit = charge.splits.find((split: any) => split.type === 'tip');
    tipAmount = tipSplit?.amount || 0;
  }

  // Convert timestamp to local date/time
  const utcDate = new Date(charge.created * 1000);
  const localDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: restaurantTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(utcDate);

  const localTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: restaurantTimezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(utcDate);

  // Upsert charge
  await supabase.from('shift4_charges').upsert({
    restaurant_id: restaurantId,
    charge_id: charge.id,
    merchant_id: merchantId,
    amount: charge.amount,
    currency: charge.currency || 'USD',
    status: charge.status || 'unknown',
    refunded: charge.refunded || false,
    captured: charge.captured || false,
    created_at_ts: charge.created,
    created_time: new Date(charge.created * 1000).toISOString(),
    service_date: localDateStr,
    service_time: localTimeStr,
    description: charge.description,
    tip_amount: tipAmount,
    raw_json: charge,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'restaurant_id,charge_id',
  });

  console.log(`Charge ${charge.id} processed successfully`);
}

/**
 * Process a refund event (CHARGE_REFUNDED)
 */
async function processRefundEvent(
  supabase: any,
  restaurantId: string,
  merchantId: string,
  eventData: any,
  restaurantTimezone: string
) {
  // The event data should contain the refund object
  const refund = eventData.refund || eventData;
  const chargeId = eventData.charge || refund.charge;

  if (!refund.id || !chargeId) {
    throw new Error('Missing refund ID or charge ID in event data');
  }

  // Convert timestamp to local date
  const utcDate = new Date(refund.created * 1000);
  const localDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: restaurantTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(utcDate);

  // Upsert refund
  await supabase.from('shift4_refunds').upsert({
    restaurant_id: restaurantId,
    refund_id: refund.id,
    charge_id: chargeId,
    merchant_id: merchantId,
    amount: refund.amount,
    currency: refund.currency || 'USD',
    status: refund.status,
    reason: refund.reason,
    created_at_ts: refund.created,
    created_time: new Date(refund.created * 1000).toISOString(),
    service_date: localDateStr,
    raw_json: refund,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'restaurant_id,refund_id',
  });

  // Update the charge to mark it as refunded
  await supabase
    .from('shift4_charges')
    .update({ refunded: true, updated_at: new Date().toISOString() })
    .eq('restaurant_id', restaurantId)
    .eq('charge_id', chargeId);

  console.log(`Refund ${refund.id} for charge ${chargeId} processed successfully`);
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload: Shift4WebhookPayload = await req.json();
    console.log('Shift4 webhook received:', { 
      eventId: payload.id, 
      type: payload.type,
      created: payload.created 
    });

    if (!payload.id || !payload.type) {
      throw new Error('Invalid webhook payload: missing event ID or type');
    }

    // For security, we need to fetch the full event from Shift4 API
    // But first, we need to determine which restaurant/merchant this event is for
    // This is challenging because Shift4 doesn't include merchant ID in the webhook
    // We'll need to try all connections and fetch the event with each until one succeeds

    const { data: allConnections, error: connectionsError } = await supabase
      .from('shift4_connections')
      .select('*');

    if (connectionsError || !allConnections?.length) {
      console.error('No Shift4 connections found');
      // Still return 200 to prevent retries
      return new Response(
        JSON.stringify({ message: 'No connections found' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const encryption = await getEncryptionService();
    let processedSuccessfully = false;

    // Try each connection until we find one that can verify this event
    for (const connection of allConnections) {
      try {
        const secretKey = await encryption.decrypt(connection.secret_key);

        // Fetch the verified event from Shift4 API
        const verifiedEvent = await fetchEventFromShift4(
          secretKey,
          connection.environment,
          payload.id
        );

        console.log('Event verified from Shift4 API:', {
          eventId: verifiedEvent.id,
          type: verifiedEvent.type,
          merchantId: connection.merchant_id,
        });

        // Check if we've already processed this event (idempotency)
        const { data: existingEvent } = await supabase
          .from('shift4_webhook_events')
          .select('id')
          .eq('restaurant_id', connection.restaurant_id)
          .eq('event_id', verifiedEvent.id)
          .single();

        if (existingEvent) {
          console.log(`Event ${verifiedEvent.id} already processed, skipping`);
          processedSuccessfully = true;
          break;
        }

        // Get restaurant timezone
        const { data: restaurant } = await supabase
          .from('restaurants')
          .select('timezone')
          .eq('id', connection.restaurant_id)
          .single();

        const restaurantTimezone = restaurant?.timezone || 'America/Chicago';

        // Process based on event type
        const eventData = verifiedEvent.data || {};

        switch (verifiedEvent.type) {
          case 'CHARGE_SUCCEEDED':
          case 'CHARGE_UPDATED':
            if (eventData.charge) {
              await processChargeEvent(
                supabase,
                connection.restaurant_id,
                connection.merchant_id,
                eventData.charge,
                restaurantTimezone
              );
            }
            break;

          case 'CHARGE_REFUNDED':
            await processRefundEvent(
              supabase,
              connection.restaurant_id,
              connection.merchant_id,
              eventData,
              restaurantTimezone
            );
            break;

          default:
            console.log(`Unhandled event type: ${verifiedEvent.type}`);
        }

        // Mark event as processed
        await supabase.from('shift4_webhook_events').insert({
          restaurant_id: connection.restaurant_id,
          event_id: verifiedEvent.id,
          event_type: verifiedEvent.type,
          processed_at: new Date().toISOString(),
          raw_json: verifiedEvent,
        });

        // Sync to unified_sales
        await supabase.rpc('sync_shift4_to_unified_sales', {
          p_restaurant_id: connection.restaurant_id,
        });

        console.log(`Webhook processed successfully for restaurant ${connection.restaurant_id}`);
        processedSuccessfully = true;
        break; // Event verified and processed, no need to try other connections

      } catch (connectionError: any) {
        // This connection couldn't verify the event, try the next one
        console.log(`Connection ${connection.id} failed to verify event:`, connectionError.message);
        continue;
      }
    }

    if (!processedSuccessfully) {
      console.warn(`Event ${payload.id} could not be verified with any connection`);
    }

    // Always return 200 OK to acknowledge receipt
    return new Response(
      JSON.stringify({ 
        message: processedSuccessfully ? 'Webhook processed successfully' : 'Event acknowledged'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: any) {
    console.error('Error processing Shift4 webhook:', error);
    
    // Still return 200 to prevent Shift4 from retrying
    return new Response(
      JSON.stringify({ 
        message: 'Webhook received but processing failed',
        error: error.message 
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
