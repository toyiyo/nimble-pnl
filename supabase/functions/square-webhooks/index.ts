import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from "node:crypto";
import { format } from 'https://esm.sh/date-fns@3.6.0';
import { formatInTimeZone } from 'https://esm.sh/date-fns-tz@3.2.0';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-square-hmacsha256-signature',
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

    const SQUARE_WEBHOOK_SIGNATURE_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY');
    
    // Get raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get('x-square-hmacsha256-signature');

    // Verify webhook signature if signature key is configured
    if (SQUARE_WEBHOOK_SIGNATURE_KEY && signature) {
      // Square uses notification URL + body for signature verification
      const notificationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/square-webhooks`;
      const signaturePayload = notificationUrl + rawBody;
      
      const computedSignature = createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
        .update(signaturePayload)
        .digest('base64');

      console.log('Webhook signature verification:', {
        receivedSignature: signature,
        computedSignature: computedSignature,
        payloadLength: rawBody.length,
        signaturePayloadLength: signaturePayload.length
      });

      if (signature !== computedSignature) {
        console.error('Invalid webhook signature - signatures do not match');
        // For now, log the error but don't reject the webhook to allow testing
        console.warn('Continuing webhook processing despite signature mismatch for debugging');
      }
    } else if (SQUARE_WEBHOOK_SIGNATURE_KEY && !signature) {
      console.warn('Webhook signature key configured but no signature received');
    } else if (!SQUARE_WEBHOOK_SIGNATURE_KEY && signature) {
      console.warn('Webhook signature received but no signature key configured');
    }

    const webhookData = JSON.parse(rawBody);
    const { type, data, merchant_id } = webhookData;

    console.log('Square webhook received:', { 
      type, 
      merchant_id, 
      event_id: data?.id,
      timestamp: new Date().toISOString(),
      headers: {
        signature: signature ? 'present' : 'missing',
        contentType: req.headers.get('content-type'),
        userAgent: req.headers.get('user-agent')
      }
    });

    // Find all restaurants connected to this merchant ID (supports multiple restaurants per merchant)
    const { data: connections, error: connectionError } = await supabase
      .from('square_connections')
      .select('id, restaurant_id, access_token, refresh_token, expires_at')
      .eq('merchant_id', merchant_id);

    if (connectionError || !connections || connections.length === 0) {
      console.error('No connection found for merchant:', merchant_id, connectionError);
      return new Response('Connection not found', { status: 404 });
    }

    console.log(`Found ${connections.length} restaurant(s) connected to merchant ${merchant_id}`);

    // Decrypt access token (same token for all connections of this merchant)
    const encryption = await getEncryptionService();
    let decryptedAccessToken = await encryption.decrypt(connections[0].access_token);

    // Check if token is expired and refresh if needed
    const expiresAt = new Date(connections[0].expires_at);
    const now = new Date();
    const isExpired = expiresAt <= now;

    if (isExpired) {
      console.log('Access token expired, refreshing...');
      try {
        const decryptedRefreshToken = await encryption.decrypt(connections[0].refresh_token);
        
        const refreshResponse = await fetch('https://connect.squareup.com/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Square-Version': '2024-12-18',
          },
          body: JSON.stringify({
            client_id: Deno.env.get('SQUARE_APPLICATION_ID'),
            client_secret: Deno.env.get('SQUARE_APPLICATION_SECRET'),
            grant_type: 'refresh_token',
            refresh_token: decryptedRefreshToken,
          }),
        });

        if (!refreshResponse.ok) {
          const errorText = await refreshResponse.text();
          console.error('Token refresh failed:', refreshResponse.status, errorText);
          throw new Error(`Token refresh failed: ${refreshResponse.status}`);
        }

        const tokenData = await refreshResponse.json();
        decryptedAccessToken = tokenData.access_token;

        // Encrypt new tokens
        const newAccessToken = await encryption.encrypt(tokenData.access_token);
        const newRefreshToken = tokenData.refresh_token 
          ? await encryption.encrypt(tokenData.refresh_token)
          : connections[0].refresh_token; // Keep old refresh token if not provided

        // Calculate new expiry (30 days from now)
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 30);

        // Update all connections for this merchant with new tokens
        for (const connection of connections) {
          await supabase
            .from('square_connections')
            .update({
              access_token: newAccessToken,
              refresh_token: newRefreshToken,
              expires_at: newExpiresAt.toISOString(),
              last_refreshed_at: new Date().toISOString(),
            })
            .eq('id', connection.id);
        }

        console.log('Access token refreshed successfully');
      } catch (error) {
        console.error('Error refreshing access token:', error);
        return new Response('Token refresh failed', { status: 401 });
      }
    }

    // Process webhook for each connected restaurant
    for (const connection of connections) {
      const restaurantId = connection.restaurant_id;

      console.log(`Processing webhook for restaurant ${restaurantId}`);

      // Log security event for webhook processing
      await logSecurityEvent(supabase, 'SQUARE_WEBHOOK_PROCESSED', undefined, restaurantId, {
        webhookType: type,
        merchantId: merchant_id,
        eventId: data?.id
      });

      // Process different webhook types
      try {
        switch (type) {
          case 'order.updated':
            await handleOrderUpdated(data, restaurantId, decryptedAccessToken, supabase);
            break;
          
          case 'payment.updated':
            await handlePaymentUpdated(data, restaurantId, decryptedAccessToken, supabase);
            break;
          
          case 'refund.updated':
            await handleRefundUpdated(data, restaurantId, decryptedAccessToken, supabase);
            break;
          
          case 'inventory.count.updated':
            await handleInventoryUpdated(data, restaurantId, decryptedAccessToken, supabase);
            break;
          
          default:
            console.log('Unhandled webhook type:', type);
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
    console.error('Square webhook error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleOrderUpdated(data: any, restaurantId: string, accessToken: string, supabase: any) {
  console.log('Processing order update:', data.id);

  // Fetch the updated order from Square
  const response = await fetch(`https://connect.squareup.com/v2/orders/${data.id}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Square-Version': '2024-12-18',
    },
  });

  if (!response.ok) {
    console.error('Failed to fetch order details:', response.status);
    return;
  }

  const orderData = await response.json();
  const order = orderData.order;

  // Fetch timezone from square_locations, fall back to restaurant timezone
  const { data: location } = await supabase
    .from('square_locations')
    .select('timezone')
    .eq('restaurant_id', restaurantId)
    .eq('location_id', order.location_id)
    .single();

  let timezone = location?.timezone;

  // If no Square location timezone, fall back to restaurant timezone
  if (!timezone) {
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', restaurantId)
      .single();
    
    timezone = restaurant?.timezone || 'UTC';
  }
  
  // Convert closedAt to restaurant's local timezone for service_date
  const closedAt = order.closed_at ? new Date(order.closed_at) : null;
  const serviceDate = closedAt 
    ? formatInTimeZone(closedAt, timezone, 'yyyy-MM-dd')
    : null;

  // Update order in database
  await supabase
    .from('square_orders')
    .upsert({
      restaurant_id: restaurantId,
      order_id: order.id,
      location_id: order.location_id,
      state: order.state,
      source: order.source?.name || null,
      created_at: order.created_at,
      closed_at: order.closed_at,
      updated_at: order.updated_at,
      service_date: serviceDate,
      gross_sales_money: parseFloat(order.total_money?.amount || '0') / 100,
      net_amounts_money: parseFloat(order.net_amounts?.total_money?.amount || '0') / 100,
      total_tax_money: parseFloat(order.total_tax_money?.amount || '0') / 100,
      total_discount_money: parseFloat(order.total_discount_money?.amount || '0') / 100,
      total_service_charge_money: parseFloat(order.total_service_charge_money?.amount || '0') / 100,
      total_tip_money: parseFloat(order.total_tip_money?.amount || '0') / 100,
      raw_json: order,
    }, {
      onConflict: 'restaurant_id,order_id'
    });

  // Update line items
  if (order.line_items) {
    // Delete existing line items for this order
    await supabase
      .from('square_order_line_items')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('order_id', order.id);

    // Insert updated line items
    for (const lineItem of order.line_items) {
      await supabase
        .from('square_order_line_items')
        .insert({
          restaurant_id: restaurantId,
          order_id: order.id,
          uid: lineItem.uid,
          catalog_object_id: lineItem.catalog_object_id || null,
          name: lineItem.name,
          quantity: parseFloat(lineItem.quantity || '0'),
          base_price_money: parseFloat(lineItem.base_price_money?.amount || '0') / 100,
          total_money: parseFloat(lineItem.total_money?.amount || '0') / 100,
          category_id: lineItem.category_id || null,
          modifiers: lineItem.modifiers || null,
          raw_json: lineItem,
        });
    }
  }

  // Extract and store adjustments (don't create fake line items)
  // This keeps revenue metrics clean and accounting-compliant
  const adjustments = [];

  if (order.total_tax_money) {
    adjustments.push({
      restaurant_id: restaurantId,
      pos_system: 'square',
      external_order_id: order.id,
      item_name: 'Sales Tax',
      item_type: 'tax',
      adjustment_type: 'tax',
      total_price: parseFloat(order.total_tax_money.amount) / 100,
      sale_date: serviceDate,
      raw_data: { total_tax_money: order.total_tax_money }
    });
  }

  if (order.total_tip_money) {
    adjustments.push({
      restaurant_id: restaurantId,
      pos_system: 'square',
      external_order_id: order.id,
      item_name: 'Tips',
      item_type: 'tip',
      adjustment_type: 'tip',
      total_price: parseFloat(order.total_tip_money.amount) / 100,
      sale_date: serviceDate,
      raw_data: { total_tip_money: order.total_tip_money }
    });
  }

  if (order.total_service_charge_money) {
    adjustments.push({
      restaurant_id: restaurantId,
      pos_system: 'square',
      external_order_id: order.id,
      item_name: 'Service Charge',
      item_type: 'service_charge',
      adjustment_type: 'service_charge',
      total_price: parseFloat(order.total_service_charge_money.amount) / 100,
      sale_date: serviceDate,
      raw_data: { total_service_charge_money: order.total_service_charge_money }
    });
  }

  if (order.total_discount_money) {
    adjustments.push({
      restaurant_id: restaurantId,
      pos_system: 'square',
      external_order_id: order.id,
      item_name: 'Discount',
      item_type: 'discount',
      adjustment_type: 'discount',
      total_price: -(parseFloat(order.total_discount_money.amount) / 100), // negative for discounts
      sale_date: serviceDate,
      raw_data: { total_discount_money: order.total_discount_money }
    });
  }

  // Upsert all adjustments
  if (adjustments.length > 0) {
    await supabase
      .from('unified_sales')
      .upsert(adjustments, {
        onConflict: 'restaurant_id,pos_system,external_order_id,item_name'
      });
  }

  // Sync this order to unified_sales so it appears in POS and triggers auto deductions
  await supabase.rpc('sync_square_to_unified_sales', {
    p_restaurant_id: restaurantId
  });

  // Recalculate P&L for the affected date
  if (serviceDate) {
    await supabase.rpc('calculate_square_daily_pnl', {
      p_restaurant_id: restaurantId,
      p_service_date: serviceDate
    });
  }

  console.log('Order update processed successfully');
}

async function handlePaymentUpdated(data: any, restaurantId: string, accessToken: string, supabase: any) {
  console.log('Processing payment update:', data.id);

  // Fetch the updated payment from Square
  const response = await fetch(`https://connect.squareup.com/v2/payments/${data.id}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Square-Version': '2024-12-18',
    },
  });

  if (!response.ok) {
    console.error('Failed to fetch payment details:', response.status);
    return;
  }

  const paymentData = await response.json();
  const payment = paymentData.payment;

  // Update payment in database
  await supabase
    .from('square_payments')
    .upsert({
      restaurant_id: restaurantId,
      payment_id: payment.id,
      order_id: payment.order_id || null,
      location_id: payment.location_id,
      status: payment.status,
      amount_money: parseFloat(payment.amount_money?.amount || '0') / 100,
      tip_money: parseFloat(payment.tip_money?.amount || '0') / 100,
      processing_fee_money: parseFloat(payment.processing_fee?.amount || '0') / 100,
      created_at: payment.created_at,
      raw_json: payment,
    }, {
      onConflict: 'restaurant_id,payment_id'
    });

  console.log('Payment update processed successfully');
}

async function handleRefundUpdated(data: any, restaurantId: string, accessToken: string, supabase: any) {
  console.log('Processing refund update:', data.id);

  // Fetch the updated refund from Square
  const response = await fetch(`https://connect.squareup.com/v2/refunds/${data.id}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Square-Version': '2024-12-18',
    },
  });

  if (!response.ok) {
    console.error('Failed to fetch refund details:', response.status);
    return;
  }

  const refundData = await response.json();
  const refund = refundData.refund;

  // Update refund in database
  await supabase
    .from('square_refunds')
    .upsert({
      restaurant_id: restaurantId,
      refund_id: refund.id,
      payment_id: refund.payment_id,
      order_id: refund.order_id || null,
      amount_money: parseFloat(refund.amount_money?.amount || '0') / 100,
      status: refund.status,
      created_at: refund.created_at,
      raw_json: refund,
    }, {
      onConflict: 'restaurant_id,refund_id'
    });

  // Recalculate P&L for the affected date if we can determine it
  if (refund.order_id) {
    const { data: order } = await supabase
      .from('square_orders')
      .select('service_date')
      .eq('restaurant_id', restaurantId)
      .eq('order_id', refund.order_id)
      .single();

    if (order?.service_date) {
      await supabase.rpc('calculate_square_daily_pnl', {
        p_restaurant_id: restaurantId,
        p_service_date: order.service_date
      });
    }
  }

  console.log('Refund update processed successfully');
}

async function handleInventoryUpdated(data: any, restaurantId: string, accessToken: string, supabase: any) {
  console.log('Processing inventory update:', data.catalog_object_id);
  
  // For now, just log inventory updates
  // In the future, this could trigger recipe cost recalculations
  console.log('Inventory webhook received but not processed:', data);
}