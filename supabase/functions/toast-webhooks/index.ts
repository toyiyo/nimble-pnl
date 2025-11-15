import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from "node:crypto";
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, toast-signature',
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

    const TOAST_WEBHOOK_SECRET = Deno.env.get('TOAST_WEBHOOK_SECRET');
    
    // Get raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get('toast-signature');

    // Verify webhook signature if signature secret is configured
    if (TOAST_WEBHOOK_SECRET && signature) {
      const computedSignature = createHmac('sha256', TOAST_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

      console.log('Webhook signature verification:', {
        receivedSignature: signature,
        computedSignature: computedSignature,
        payloadLength: rawBody.length
      });

      if (signature !== computedSignature) {
        console.error('Invalid webhook signature - signatures do not match');
        return new Response('Invalid signature', { status: 401 });
      }
    } else if (TOAST_WEBHOOK_SECRET && !signature) {
      console.warn('Webhook signature secret configured but no signature received');
    }

    const webhookData = JSON.parse(rawBody);
    const { eventType, restaurantGuid, guid } = webhookData;

    console.log('Toast webhook received:', { 
      eventType, 
      restaurantGuid, 
      event_guid: guid,
      timestamp: new Date().toISOString()
    });

    // Find all restaurants connected to this Toast restaurant GUID
    const { data: connections, error: connectionError } = await supabase
      .from('toast_connections')
      .select('id, restaurant_id, access_token, environment')
      .eq('restaurant_guid', restaurantGuid);

    if (connectionError || !connections || connections.length === 0) {
      console.error('No connection found for restaurant GUID:', restaurantGuid, connectionError);
      return new Response('Connection not found', { status: 404 });
    }

    console.log(`Found ${connections.length} restaurant(s) connected to Toast restaurant ${restaurantGuid}`);

    // Decrypt access token
    const encryption = await getEncryptionService();
    const decryptedAccessToken = await encryption.decrypt(connections[0].access_token);

    // Toast API base URL
    const TOAST_BASE_URL = connections[0].environment === 'sandbox'
      ? 'https://ws-sandbox-api.eng.toasttab.com'
      : 'https://ws-api.toasttab.com';

    // Process webhook for each connected restaurant
    for (const connection of connections) {
      const restaurantId = connection.restaurant_id;

      console.log(`Processing webhook for restaurant ${restaurantId}`);

      // Log security event for webhook processing
      await logSecurityEvent(supabase, 'TOAST_WEBHOOK_PROCESSED', undefined, restaurantId, {
        webhookType: eventType,
        restaurantGuid: restaurantGuid,
        eventGuid: guid
      });

      // Process different webhook types
      try {
        switch (eventType) {
          case 'ORDER_CREATED':
          case 'ORDER_MODIFIED':
          case 'ORDER_FIRED':
          case 'ORDER_SENT':
          case 'ORDER_COMPLETED':
            await handleOrderEvent(webhookData, restaurantId, decryptedAccessToken, supabase, TOAST_BASE_URL, restaurantGuid);
            break;
          
          default:
            console.log('Unhandled webhook type:', eventType);
        }
        console.log(`Successfully processed webhook for restaurant ${restaurantId}`);
      } catch (error) {
        console.error(`Error processing webhook for restaurant ${restaurantId}:`, error);
        // Continue processing other restaurants even if one fails
      }
    }

    return new Response('OK', { 
      headers: corsHeaders,
      status: 200 
    });

  } catch (error: any) {
    console.error('Toast webhook error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleOrderEvent(
  webhookData: any, 
  restaurantId: string, 
  accessToken: string, 
  supabase: any,
  baseUrl: string,
  restaurantGuid: string
) {
  console.log('Processing order event:', webhookData.guid);

  // Extract order GUID from webhook data
  const orderGuid = webhookData.entityGuid || webhookData.guid;

  // Fetch the full order details from Toast API
  const response = await fetch(`${baseUrl}/orders/v2/orders/${orderGuid}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Toast-Restaurant-External-ID': restaurantGuid,
    },
  });

  if (!response.ok) {
    console.error('Failed to fetch order details:', response.status);
    return;
  }

  const order = await response.json();

  // Get restaurant timezone
  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('timezone')
    .eq('id', restaurantId)
    .single();
  
  const timezone = restaurant?.timezone || 'America/Chicago';
  
  // Calculate service date from closed date or business date
  let serviceDate = order.businessDate || null;
  
  if (order.closedDate) {
    const closedAt = new Date(order.closedDate);
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(closedAt);
    serviceDate = localDate;
  }

  // Calculate totals from order amounts
  const totalAmount = (order.amount || 0) / 100;
  const taxAmount = (order.taxAmount || 0) / 100;
  const tipAmount = (order.tipAmount || 0) / 100;
  const discountAmount = (order.appliedDiscounts?.reduce((sum: number, d: any) => 
    sum + ((d.discountAmount || 0) / 100), 0)) || 0;
  const serviceChargeAmount = (order.serviceCharges?.reduce((sum: number, sc: any) => 
    sum + ((sc.chargeAmount || 0) / 100), 0)) || 0;
  const amountDue = (order.totalAmount || 0) / 100;

  // Update order in database
  await supabase
    .from('toast_orders')
    .upsert({
      restaurant_id: restaurantId,
      order_guid: order.guid,
      restaurant_guid: restaurantGuid,
      check_guid: order.checkGuid || null,
      business_date: order.businessDate || null,
      closed_date: order.closedDate ? new Date(order.closedDate).toISOString() : null,
      modified_date: order.modifiedDate ? new Date(order.modifiedDate).toISOString() : null,
      created_date: order.createdDate ? new Date(order.createdDate).toISOString() : null,
      service_date: serviceDate,
      dining_option: order.diningOption?.behavior || null,
      source: order.source || null,
      void_business_date: order.voidBusinessDate || null,
      deleted: order.deleted || false,
      voided: order.voided || false,
      number: order.number?.toString() || null,
      total_amount: totalAmount,
      tax_amount: taxAmount,
      tip_amount: tipAmount,
      discount_amount: discountAmount,
      service_charge_amount: serviceChargeAmount,
      amount_due: amountDue,
      raw_json: order,
    }, {
      onConflict: 'restaurant_id,order_guid'
    });

  // Update selections (line items)
  if (order.selections && order.selections.length > 0) {
    // Delete existing selections for this order
    await supabase
      .from('toast_order_selections')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('order_guid', order.guid);

    // Insert updated selections
    for (const selection of order.selections) {
      const quantity = selection.quantity || 1;
      const unitPrice = selection.preDiscountPrice ? 
        (selection.preDiscountPrice / 100) / quantity : null;
      const price = (selection.price || 0) / 100;
      const tax = (selection.tax || 0) / 100;

      await supabase
        .from('toast_order_selections')
        .insert({
          restaurant_id: restaurantId,
          order_guid: order.guid,
          selection_guid: selection.guid,
          item_guid: selection.itemGuid || null,
          item_group_guid: selection.itemGroupGuid || null,
          name: selection.displayName || selection.name || 'Unknown Item',
          display_name: selection.displayName || null,
          quantity: quantity,
          unit_price: unitPrice,
          pre_discount_price: selection.preDiscountPrice ? 
            (selection.preDiscountPrice / 100) : null,
          price: price,
          tax: tax,
          voided: selection.voided || false,
          deferred: selection.deferred || false,
          pre_modifier: selection.preModifier || false,
          raw_json: selection,
        });
    }
  }

  // Sync this order to unified_sales
  await supabase.rpc('sync_toast_to_unified_sales', {
    p_restaurant_id: restaurantId
  });

  console.log('Order event processed successfully');
}
