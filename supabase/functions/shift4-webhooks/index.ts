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

        // Process based on event type
        let shouldSync = false;

        switch (verifiedEvent.type) {
          case 'CHARGE_SUCCEEDED':
          case 'CHARGE_UPDATED':
          case 'CHARGE_REFUNDED':
            shouldSync = true;
            console.log(`Processing ${verifiedEvent.type} - will trigger sync`);
            break;

          default:
            console.log(`Unhandled event type: ${verifiedEvent.type}`);
        }

        // Mark event as processed
        const { error: insertError } = await supabase.from('shift4_webhook_events').insert({
          restaurant_id: connection.restaurant_id,
          event_id: verifiedEvent.id,
          event_type: verifiedEvent.type,
          processed_at: new Date().toISOString(),
          raw_json: verifiedEvent,
        });

        if (insertError) {
          console.error('Failed to insert webhook event:', insertError);
        }

        // Trigger sync function to fetch and process the charge
        // This is more reliable than inline processing and keeps sync logic centralized
        if (shouldSync) {
          console.log('Triggering shift4-sync-data for hourly sync...');
          
          // Call sync function without auth (internal webhook call)
          const syncResponse = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/shift4-sync-data`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                restaurantId: connection.restaurant_id,
                action: 'hourly_sync',
              }),
            }
          );

          if (!syncResponse.ok) {
            const errorText = await syncResponse.text();
            console.error('Sync function error:', errorText);
          } else {
            const syncResult = await syncResponse.json();
            console.log('Sync completed:', syncResult);
          }
        }

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
