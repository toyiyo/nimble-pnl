import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncRequest {
  restaurantId: string;
  action: 'initial_sync' | 'daily_sync';
  dateRange?: {
    startDate: string;
    endDate: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { restaurantId, action, dateRange }: SyncRequest = await req.json();

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    // Get Clover connection
    const { data: connection, error: connError } = await supabase
      .from('clover_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connError || !connection) {
      throw new Error('Clover connection not found');
    }

    // Decrypt access token
    const encryption = await getEncryptionService();
    const accessToken = await encryption.decrypt(connection.access_token);

    // Determine if this is a sandbox or production connection
    const isSandbox = connection.environment === 'sandbox';

    const regionAPIDomains = {
      na: isSandbox ? 'apisandbox.dev.clover.com' : 'api.clover.com',
      eu: isSandbox ? 'apisandbox.dev.clover.com' : 'api.eu.clover.com',
      latam: isSandbox ? 'apisandbox.dev.clover.com' : 'api.la.clover.com',
      apac: isSandbox ? 'apisandbox.dev.clover.com' : 'api.clover.com'
    };

    const CLOVER_API_DOMAIN = regionAPIDomains[connection.region as keyof typeof regionAPIDomains] || (isSandbox ? 'apisandbox.dev.clover.com' : 'api.clover.com');
    const BASE_URL = `https://${CLOVER_API_DOMAIN}/v3/merchants/${connection.merchant_id}`;
    
    console.log('Using Clover API:', { environment: isSandbox ? 'sandbox' : 'production', domain: CLOVER_API_DOMAIN, region: connection.region });

    // Calculate date range
    let startDate: Date, endDate: Date;
    if (dateRange) {
      startDate = new Date(dateRange.startDate);
      endDate = new Date(dateRange.endDate);
    } else if (action === 'initial_sync') {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 90);
    } else {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 1);
    }

    console.log('Syncing Clover data from', startDate.toISOString(), 'to', endDate.toISOString());

    let ordersSynced = 0;
    let errors: string[] = [];

    try {
      // Fetch orders with pagination
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      let maxIterations = 50; // Safety limit to prevent infinite loops
      let iterations = 0;

      while (hasMore && iterations < maxIterations) {
        iterations++;
        const ordersUrl = new URL(`${BASE_URL}/orders`);
        
        // Clover API expects Unix timestamps in SECONDS (not milliseconds)
        const startTimestamp = Math.floor(startDate.getTime() / 1000);
        const endTimestamp = Math.floor(endDate.getTime() / 1000);
        
        // Use modifiedTime which is more commonly supported in Clover API
        ordersUrl.searchParams.set('filter', `modifiedTime>=${startTimestamp}`);
        ordersUrl.searchParams.set('expand', 'lineItems');
        ordersUrl.searchParams.set('limit', limit.toString());
        ordersUrl.searchParams.set('offset', offset.toString());

        console.log('Fetching orders:', ordersUrl.toString());
        console.log('Date range:', { 
          startDate: startDate.toISOString(), 
          endDate: endDate.toISOString(),
          startTimestamp,
          endTimestamp,
          note: 'Using modifiedTime filter instead of createdTime'
        });

        // Add timeout and abort controller to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        let ordersResponse;
        try {
          ordersResponse = await fetch(ordersUrl.toString(), {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          console.error('Fetch timeout or error:', fetchError.message);
          errors.push(`Fetch error: ${fetchError.message}`);
          break;
        }

        if (!ordersResponse.ok) {
          const errorText = await ordersResponse.text();
          console.error('Failed to fetch orders:', errorText);
          errors.push(`Failed to fetch orders: ${errorText}`);
          break;
        }

        const ordersData = await ordersResponse.json();
        const orders = ordersData.elements || [];

        if (orders.length === 0) {
          hasMore = false;
          break;
        }

        console.log(`Processing ${orders.length} orders`);

        for (const order of orders) {
          try {
            // Store order
            const serviceDate = order.createdTime ? new Date(order.createdTime).toISOString().split('T')[0] : null;
            
            await supabase
              .from('clover_orders')
              .upsert({
                restaurant_id: restaurantId,
                order_id: order.id,
                merchant_id: connection.merchant_id,
                employee_id: order.employee?.id,
                state: order.state,
                total: order.total ? order.total / 100 : null,
                tax_amount: order.taxAmount ? order.taxAmount / 100 : null,
                service_charge_amount: order.serviceCharge ? order.serviceCharge.amount / 100 : null,
                discount_amount: order.discount ? order.discount.amount / 100 : null,
                tip_amount: order.tipAmount ? order.tipAmount / 100 : null,
                created_time: order.createdTime ? new Date(order.createdTime).toISOString() : null,
                modified_time: order.modifiedTime ? new Date(order.modifiedTime).toISOString() : null,
                closed_time: order.clientCreatedTime ? new Date(order.clientCreatedTime).toISOString() : 
                           order.createdTime ? new Date(order.createdTime).toISOString() : null,
                service_date: serviceDate,
                raw_json: order,
              }, {
                onConflict: 'restaurant_id,order_id'
              });

            // Store line items
            if (order.lineItems?.elements) {
              for (const lineItem of order.lineItems.elements) {
                await supabase
                  .from('clover_order_line_items')
                  .upsert({
                    restaurant_id: restaurantId,
                    order_id: order.id,
                    line_item_id: lineItem.id,
                    item_id: lineItem.item?.id,
                    name: lineItem.name || 'Unknown Item',
                    alternate_name: lineItem.alternateName,
                    price: lineItem.price ? lineItem.price / 100 : null,
                    unit_quantity: lineItem.unitQty || 1,
                    is_revenue: lineItem.isRevenue !== false, // Default to true if undefined, false only if explicitly false
                    note: lineItem.note,
                    printed: lineItem.printed || false,
                    category_id: lineItem.item?.categories?.elements?.[0]?.id,
                    raw_json: lineItem,
                  }, {
                    onConflict: 'restaurant_id,order_id,line_item_id'
                  });
              }
            }

            ordersSynced++;
          } catch (orderError: any) {
            console.error(`Error processing order ${order.id}:`, orderError);
            errors.push(`Order ${order.id}: ${orderError.message}`);
          }
        }

        offset += limit;
        
        if (orders.length < limit) {
          hasMore = false;
        }
      }

      // Debug: Check what orders we have before sync
      const { data: ordersCheck } = await supabase
        .from('clover_orders')
        .select('order_id, state, service_date, closed_time')
        .eq('restaurant_id', restaurantId);
      
      const { data: lineItemsCheck } = await supabase
        .from('clover_order_line_items')
        .select('line_item_id, is_revenue, price')
        .eq('restaurant_id', restaurantId);
      
      console.log('Orders before sync:', ordersCheck);
      console.log('Line items before sync:', lineItemsCheck);

      // Sync to unified_sales table
      const { data: syncResult, error: syncError } = await supabase
        .rpc('sync_clover_to_unified_sales', {
          p_restaurant_id: restaurantId
        });

      if (syncError) {
        console.error('Error syncing to unified sales:', syncError);
        errors.push(`Unified sales sync error: ${syncError.message}`);
      } else {
        console.log(`Synced ${syncResult} items to unified_sales`);
        
        // Debug: Check what got synced
        const { data: syncedItems } = await supabase
          .from('unified_sales')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .eq('pos_system', 'clover');
        console.log('Items in unified_sales after sync:', syncedItems?.length || 0);
      }

    } catch (syncError: any) {
      console.error('Sync error:', syncError);
      errors.push(syncError.message);
    }

    return new Response(JSON.stringify({
      success: true,
      results: {
        ordersSynced,
        paymentsSynced: 0,
        refundsSynced: 0,
        teamMembersSynced: 0,
        shiftsSynced: 0,
        catalogSynced: false,
        errors,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Clover sync error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
