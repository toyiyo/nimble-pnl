import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";
import { processOrder } from "../_shared/toastOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, toast-signature, toast-restaurant-external-id',
};

interface ToastWebhookPayload {
  eventGuid: string;
  timestamp: string;
  eventType: string;
  eventCategory: string;
  details: {
    restaurantGuid: string;
    entityGuid?: string; // Order GUID for order webhooks
    action?: string;
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Toast webhook received');

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse webhook payload
    const payload: ToastWebhookPayload = await req.json();
    console.log('Webhook payload:', { eventType: payload.eventType, eventCategory: payload.eventCategory, restaurantGuid: payload.details.restaurantGuid });

    // Find connection by restaurant GUID
    const { data: connection, error: connectionError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('toast_restaurant_guid', payload.details.restaurantGuid)
      .eq('is_active', true)
      .single();

    if (connectionError || !connection) {
      console.error('No active Toast connection found for restaurant:', payload.details.restaurantGuid);
      return new Response(JSON.stringify({ error: 'Restaurant connection not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify webhook signature using HMAC
    const signature = req.headers.get('toast-signature');
    if (signature && connection.webhook_secret_encrypted) {
      const encryption = await getEncryptionService();
      const webhookSecret = await encryption.decrypt(connection.webhook_secret_encrypted);
      
      const payloadString = JSON.stringify(payload);
      const computedSignature = createHmac('sha256', webhookSecret)
        .update(payloadString)
        .digest('base64');

      if (signature !== computedSignature) {
        console.error('Invalid webhook signature');
        await logSecurityEvent(supabase, 'TOAST_WEBHOOK_SIGNATURE_FAILED', undefined, connection.restaurant_id, {
          restaurantGuid: payload.details.restaurantGuid,
          eventType: payload.eventType
        });
        
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Log webhook event for idempotency
    const { data: existingEvent } = await supabase
      .from('toast_webhook_events')
      .select('id')
      .eq('event_id', payload.eventGuid)
      .single();

    if (existingEvent) {
      console.log('Duplicate webhook event, skipping:', payload.eventGuid);
      return new Response('OK', { headers: corsHeaders, status: 200 });
    }

    // Insert webhook event log
    await supabase.from('toast_webhook_events').insert({
      restaurant_id: connection.restaurant_id,
      event_id: payload.eventGuid,
      event_type: payload.eventType,
      raw_json: payload,
    });

    // Log security event
    await logSecurityEvent(supabase, 'TOAST_WEBHOOK_PROCESSED', undefined, connection.restaurant_id, {
      eventType: payload.eventType,
      eventCategory: payload.eventCategory,
      restaurantGuid: payload.details.restaurantGuid
    });

    // Process based on event category
    if (payload.eventCategory === 'orders' && payload.details.entityGuid) {
      // Toast webhooks send minimal data - we must fetch full order via API
      console.log('Processing order webhook:', payload.details.entityGuid);
      
      // Get or refresh access token
      const encryption = await getEncryptionService();
      let accessToken = connection.access_token_encrypted 
        ? await encryption.decrypt(connection.access_token_encrypted) 
        : null;
      
      const tokenExpired = !connection.token_expires_at || new Date(connection.token_expires_at) < new Date();
      
      if (!accessToken || tokenExpired) {
        // Refresh token
        const clientId = connection.client_id;
        const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);
        
        const authResponse = await fetch('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            clientSecret,
            userAccessType: 'TOAST_MACHINE_CLIENT'
          })
        });

        if (!authResponse.ok) {
          throw new Error(`Token refresh failed: ${authResponse.status}`);
        }

        const authData = await authResponse.json();
        accessToken = authData.token.accessToken;
        
        // Update token cache
        const encryptedToken = await encryption.encrypt(accessToken);
        const expiresAt = new Date(Date.now() + (authData.token.expiresIn * 1000));
        
        await supabase.from('toast_connections').update({
          access_token_encrypted: encryptedToken,
          token_expires_at: expiresAt.toISOString(),
          token_fetched_at: new Date().toISOString()
        }).eq('id', connection.id);
      }

      // Fetch full order data from Toast API
      const orderResponse = await fetch(
        `https://ws-api.toasttab.com/orders/v2/orders/${payload.details.entityGuid}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Toast-Restaurant-External-ID': payload.details.restaurantGuid
          }
        }
      );

      if (!orderResponse.ok) {
        throw new Error(`Failed to fetch order: ${orderResponse.status}`);
      }

      const order = await orderResponse.json();
      
      // Process order data (store in toast_orders, etc.)
      await processOrder(supabase, order, connection.restaurant_id, payload.details.restaurantGuid);
      
      // Sync to unified_sales
      await supabase.rpc('sync_toast_to_unified_sales', {
        p_restaurant_id: connection.restaurant_id
      });
      
      console.log('Order processed successfully:', payload.details.entityGuid);
    }

    return new Response('OK', { headers: corsHeaders, status: 200 });

  } catch (error: any) {
    console.error('Toast webhook error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
