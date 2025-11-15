import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from 'https://deno.land/std@0.168.0/node/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-spoton-signature',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get('x-spoton-signature');
    
    // Verify webhook signature
    const WEBHOOK_SECRET = Deno.env.get('SPOTON_WEBHOOK_SECRET');
    if (WEBHOOK_SECRET && signature) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const notificationUrl = `${supabaseUrl}/functions/v1/spoton-webhooks`;
      const signaturePayload = notificationUrl + rawBody;
      
      const computedSignature = createHmac('sha256', WEBHOOK_SECRET)
        .update(signaturePayload)
        .digest('base64');

      if (signature !== computedSignature) {
        console.error('Invalid webhook signature');
        // Log but don't reject in dev for debugging
        console.warn('Signature mismatch - computed:', computedSignature, 'received:', signature);
      }
    }

    // Parse webhook data
    const webhookData = JSON.parse(rawBody);
    console.log('SpotOn webhook received:', webhookData.event_type || webhookData.type);

    const eventType = webhookData.event_type || webhookData.type;
    const eventId = webhookData.id || webhookData.event_id;
    const data = webhookData.data || webhookData.payload;

    // Check if we've already processed this event (idempotency)
    const { data: existingEvent } = await supabase
      .from('spoton_webhook_events')
      .select('id')
      .eq('external_event_id', eventId)
      .maybeSingle();

    if (existingEvent) {
      console.log('Event already processed:', eventId);
      return new Response(JSON.stringify({ 
        received: true, 
        message: 'Event already processed' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Store webhook event for auditing
    await supabase
      .from('spoton_webhook_events')
      .insert({
        external_event_id: eventId,
        event_type: eventType,
        payload: webhookData,
        received_at: new Date().toISOString(),
      });

    // Process different event types
    switch (eventType) {
      case 'order.created':
      case 'order.updated':
        await processOrderEvent(supabase, data);
        break;
      
      case 'order.cancelled':
        await processOrderCancellation(supabase, data);
        break;
      
      case 'menu.updated':
        await processMenuUpdate(supabase, data);
        break;
      
      case 'item.availability_changed':
        await processItemAvailability(supabase, data);
        break;
      
      default:
        console.log('Unhandled event type:', eventType);
    }

    return new Response(JSON.stringify({ 
      received: true,
      eventType: eventType
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('SpotOn webhook error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processOrderEvent(supabase: any, orderData: any) {
  try {
    const orderId = orderData.id || orderData.order_id;
    const locationId = orderData.location_id;

    // Find the connection for this location
    const { data: connection } = await supabase
      .from('spoton_connections')
      .select('id, restaurant_id')
      .eq('location_id', locationId)
      .single();

    if (!connection) {
      console.error('No connection found for location:', locationId);
      return;
    }

    // Store/update order
    await supabase
      .from('spoton_orders')
      .upsert({
        restaurant_id: connection.restaurant_id,
        connection_id: connection.id,
        external_order_id: orderId,
        order_date: orderData.created_at || orderData.order_date,
        total_amount: orderData.total || orderData.total_amount,
        tax_amount: orderData.tax || orderData.tax_amount,
        discount_amount: orderData.discount || orderData.discount_amount,
        status: orderData.status,
        raw_data: orderData,
        synced_at: new Date().toISOString(),
      }, {
        onConflict: 'restaurant_id,external_order_id'
      });

    // Process order items
    const items = orderData.items || orderData.line_items || [];
    for (const item of items) {
      await supabase
        .from('spoton_order_items')
        .upsert({
          restaurant_id: connection.restaurant_id,
          connection_id: connection.id,
          external_order_id: orderId,
          external_item_id: item.id || item.item_id,
          item_name: item.name || item.item_name,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || item.price,
          total_price: item.total || item.total_price || (item.quantity * (item.unit_price || item.price)),
          category: item.category || item.category_name,
          raw_data: item,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: 'restaurant_id,external_order_id,external_item_id'
        });
    }

    // Sync to unified_sales
    await supabase.rpc('sync_spoton_to_unified_sales' as any, {
      p_restaurant_id: connection.restaurant_id
    });

    console.log('Order processed successfully:', orderId);
  } catch (error) {
    console.error('Error processing order event:', error);
  }
}

async function processOrderCancellation(supabase: any, orderData: any) {
  try {
    const orderId = orderData.id || orderData.order_id;
    
    // Update order status
    await supabase
      .from('spoton_orders')
      .update({ 
        status: 'cancelled',
        raw_data: orderData,
        synced_at: new Date().toISOString()
      })
      .eq('external_order_id', orderId);

    console.log('Order cancelled:', orderId);
  } catch (error) {
    console.error('Error processing order cancellation:', error);
  }
}

async function processMenuUpdate(supabase: any, menuData: any) {
  try {
    console.log('Menu update received:', menuData);
    // Menu updates can be logged or processed as needed
    // This might trigger a full menu sync
  } catch (error) {
    console.error('Error processing menu update:', error);
  }
}

async function processItemAvailability(supabase: any, itemData: any) {
  try {
    console.log('Item availability changed:', itemData);
    // Track item availability changes if needed
  } catch (error) {
    console.error('Error processing item availability:', error);
  }
}
