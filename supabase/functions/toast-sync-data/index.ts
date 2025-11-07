import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ToastSyncRequest {
  restaurantId: string;
  action: 'initial_sync' | 'daily_sync' | 'hourly_sync';
  dateRange?: {
    startDate: string;
    endDate: string;
  };
}

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

    const body: ToastSyncRequest = await req.json();
    const { restaurantId, action, dateRange } = body;

    console.log('Toast sync started:', { restaurantId, action, dateRange });

    // Get Toast connection and decrypt tokens
    const { data: connection, error: connectionError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Toast connection not found');
    }

    // Decrypt the access token
    const encryption = await getEncryptionService();
    const decryptedAccessToken = await encryption.decrypt(connection.access_token);
    
    // Create connection object with decrypted token
    const decryptedConnection = {
      ...connection,
      access_token: decryptedAccessToken
    };

    // Log security event for token access
    await logSecurityEvent(supabase, 'TOAST_TOKEN_ACCESSED', undefined, restaurantId, {
      action: action,
      restaurantGuid: connection.restaurant_guid
    });

    // Get restaurant timezone
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', restaurantId)
      .single();
    
    const restaurantTimezone = restaurant?.timezone || 'America/Chicago';

    // Toast API base URL
    const TOAST_BASE_URL = connection.environment === 'sandbox'
      ? 'https://ws-sandbox-api.eng.toasttab.com'
      : 'https://ws-api.toasttab.com';

    console.log(`Using Toast API: ${TOAST_BASE_URL} (${connection.environment})`);

    const results = {
      ordersSynced: 0,
      errors: [] as string[]
    };

    // Determine date range for orders
    let startDate: string, endDate: string;
    
    if (dateRange) {
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    } else if (action === 'initial_sync') {
      // Last 90 days for initial sync
      const start = new Date();
      start.setDate(start.getDate() - 90);
      startDate = start.toISOString().split('T')[0];
      endDate = new Date().toISOString().split('T')[0];
    } else if (action === 'daily_sync') {
      // Yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday.toISOString().split('T')[0];
      endDate = startDate;
    } else {
      // Last 2 days for hourly sync
      const start = new Date();
      start.setDate(start.getDate() - 2);
      startDate = start.toISOString().split('T')[0];
      endDate = new Date().toISOString().split('T')[0];
    }

    console.log(`Syncing data from ${startDate} to ${endDate}`);

    // Sync orders
    try {
      const ordersCount = await syncOrders(
        decryptedConnection, 
        restaurantId, 
        startDate, 
        endDate, 
        supabase,
        TOAST_BASE_URL,
        restaurantTimezone
      );
      results.ordersSynced = ordersCount;
    } catch (error: any) {
      console.error('Orders sync error:', error);
      results.errors.push(`Orders sync failed: ${error.message}`);
    }

    // Sync Toast orders to unified_sales table (for POS Sales page)
    try {
      console.log('Syncing Toast orders to unified_sales...');
      const { error: unifiedSyncError } = await supabase.rpc('sync_toast_to_unified_sales', {
        p_restaurant_id: restaurantId
      });
      
      if (unifiedSyncError) {
        console.error('Error syncing to unified_sales:', unifiedSyncError);
        results.errors.push(`Failed to sync to POS Sales: ${unifiedSyncError.message}`);
      } else {
        console.log('Successfully synced Toast orders to unified_sales');
      }
    } catch (error: any) {
      console.error('Unified sales sync error:', error);
      results.errors.push(`Unified sales sync failed: ${error.message}`);
    }

    console.log('Toast sync completed:', results);

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Toast sync error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function syncOrders(
  connection: any, 
  restaurantId: string, 
  startDate: string, 
  endDate: string, 
  supabase: any,
  baseUrl: string,
  timezone: string
): Promise<number> {
  console.log(`Syncing Toast orders from ${startDate} to ${endDate}`);
  
  let totalOrders = 0;
  let pageToken: string | null = null;
  const pageSize = 100;

  do {
    // Build the orders query
    const ordersUrl = new URL(`${baseUrl}/orders/v2/orders`);
    ordersUrl.searchParams.set('businessDate', startDate);
    ordersUrl.searchParams.set('endDate', endDate);
    ordersUrl.searchParams.set('pageSize', pageSize.toString());
    if (pageToken) {
      ordersUrl.searchParams.set('pageToken', pageToken);
    }

    console.log('Fetching orders:', ordersUrl.toString());

    const response = await fetch(ordersUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Toast-Restaurant-External-ID': connection.restaurant_guid,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Orders API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`Orders API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const orders = data.data || [];
    pageToken = data.nextPageToken || null;

    console.log(`Processing ${orders.length} orders`);

    for (const order of orders) {
      // Calculate service date from closed date or business date
      let serviceDate = order.businessDate || null;
      
      if (order.closedDate) {
        const closedAt = new Date(order.closedDate);
        // Convert to restaurant's timezone to get the correct business date
        const localDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(closedAt);
        serviceDate = localDate; // Format: YYYY-MM-DD
      }

      // Calculate totals from order amounts
      const totalAmount = (order.amount || 0) / 100; // Toast amounts are in cents
      const taxAmount = (order.taxAmount || 0) / 100;
      const tipAmount = (order.tipAmount || 0) / 100;
      const discountAmount = (order.appliedDiscounts?.reduce((sum: number, d: any) => 
        sum + ((d.discountAmount || 0) / 100), 0)) || 0;
      const serviceChargeAmount = (order.serviceCharges?.reduce((sum: number, sc: any) => 
        sum + ((sc.chargeAmount || 0) / 100), 0)) || 0;
      const amountDue = (order.totalAmount || 0) / 100;

      // Store order
      await supabase
        .from('toast_orders')
        .upsert({
          restaurant_id: restaurantId,
          order_guid: order.guid,
          restaurant_guid: connection.restaurant_guid,
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

      // Store selections (line items)
      if (order.selections && order.selections.length > 0) {
        for (const selection of order.selections) {
          const quantity = selection.quantity || 1;
          const unitPrice = selection.preDiscountPrice ? 
            (selection.preDiscountPrice / 100) / quantity : null;
          const price = (selection.price || 0) / 100;
          const tax = (selection.tax || 0) / 100;

          await supabase
            .from('toast_order_selections')
            .upsert({
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
            }, {
              onConflict: 'restaurant_id,order_guid,selection_guid'
            });
        }
      }

      totalOrders++;
    }

  } while (pageToken);

  console.log(`Synced ${totalOrders} Toast orders`);
  return totalOrders;
}
