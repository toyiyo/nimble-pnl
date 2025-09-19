import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { createHmac } from "node:crypto";
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
      const computedSignature = createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
        .update(rawBody)
        .digest('base64');

      if (signature !== computedSignature) {
        console.error('Invalid webhook signature');
        return new Response('Invalid signature', { status: 401 });
      }
    }

    const webhookData = JSON.parse(rawBody);
    const { type, data, merchant_id } = webhookData;

    console.log('Square webhook received:', { type, merchant_id, event_id: data?.id });

    // Find restaurant by merchant ID and decrypt access token
    const { data: connection, error: connectionError } = await supabase
      .from('square_connections')
      .select('restaurant_id, access_token')
      .eq('merchant_id', merchant_id)
      .single();

    if (connectionError || !connection) {
      console.error('No connection found for merchant:', merchant_id);
      return new Response('Connection not found', { status: 404 });
    }

    // Decrypt the access token
    const encryption = await getEncryptionService();
    const decryptedAccessToken = await encryption.decrypt(connection.access_token);
    
    const restaurantId = connection.restaurant_id;

    // Log security event for webhook processing
    await logSecurityEvent(supabase, 'SQUARE_WEBHOOK_PROCESSED', null, restaurantId, {
      webhookType: type,
      merchantId: merchant_id,
      eventId: data?.id
    });

    // Process different webhook types
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

  const closedAt = order.closed_at ? new Date(order.closed_at) : null;
  const serviceDate = closedAt ? closedAt.toISOString().split('T')[0] : null;

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