import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SquareSyncRequest {
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

    const body: SquareSyncRequest = await req.json();
    const { restaurantId, action, dateRange } = body;

    console.log('Square sync started:', { restaurantId, action, dateRange });

    // Get Square connection and decrypt tokens
    const { data: connection, error: connectionError } = await supabase
      .from('square_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Square connection not found');
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
    await logSecurityEvent(supabase, 'SQUARE_TOKEN_ACCESSED', null, restaurantId, {
      action: action,
      merchantId: connection.merchant_id
    });

    // Get Square locations
    const { data: locations, error: locationsError } = await supabase
      .from('square_locations')
      .select('*')
      .eq('restaurant_id', restaurantId);

    if (locationsError || !locations?.length) {
      throw new Error('No Square locations found');
    }

    console.log(`Found ${locations.length} locations to sync`);

    const results = {
      catalogSynced: false,
      ordersSynced: 0,
      paymentsSynced: 0,
      refundsSynced: 0,
      teamMembersSynced: 0,
      shiftsSynced: 0,
      errors: [] as string[]
    };

    // Sync catalog (only for initial sync)
    if (action === 'initial_sync') {
      try {
        await syncCatalog(decryptedConnection, restaurantId, supabase);
        results.catalogSynced = true;
      } catch (error: any) {
        console.error('Catalog sync error:', error);
        results.errors.push(`Catalog sync failed: ${error.message}`);
      }
    }

    // Sync team members (only for initial sync or daily)
    if (action === 'initial_sync' || action === 'daily_sync') {
      try {
        const teamCount = await syncTeamMembers(decryptedConnection, restaurantId, supabase);
        results.teamMembersSynced = teamCount;
      } catch (error: any) {
        console.error('Team members sync error:', error);
        results.errors.push(`Team members sync failed: ${error.message}`);
      }
    }

    // Determine date range for orders and shifts
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

    // Sync data for each location
    for (const location of locations) {
      try {
        // Sync orders
        const ordersCount = await syncOrders(decryptedConnection, restaurantId, location.location_id, startDate, endDate, supabase);
        results.ordersSynced += ordersCount;

        // Sync payments
        const paymentsCount = await syncPayments(decryptedConnection, restaurantId, location.location_id, startDate, endDate, supabase);
        results.paymentsSynced += paymentsCount;

        // Sync refunds
        const refundsCount = await syncRefunds(decryptedConnection, restaurantId, location.location_id, startDate, endDate, supabase);
        results.refundsSynced += refundsCount;

        // Sync shifts (labor data)
        const shiftsCount = await syncShifts(decryptedConnection, restaurantId, location.location_id, startDate, endDate, supabase);
        results.shiftsSynced += shiftsCount;

      } catch (error: any) {
        console.error(`Location ${location.location_id} sync error:`, error);
        results.errors.push(`Location ${location.name} sync failed: ${error.message}`);
      }
    }

    // Calculate P&L for synced dates
    try {
      const dateRangeArray = getDateRange(startDate, endDate);
      for (const date of dateRangeArray) {
        await calculateSquareDailyPnL(supabase, restaurantId, date);
      }
    } catch (error: any) {
      console.error('P&L calculation error:', error);
      results.errors.push(`P&L calculation failed: ${error.message}`);
    }

    console.log('Square sync completed:', results);

    return new Response(JSON.stringify({
      success: true,
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Square sync error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function syncCatalog(connection: any, restaurantId: string, supabase: any): Promise<void> {
  console.log('Syncing Square catalog...');
  
  const response = await fetch('https://connect.squareup.com/v2/catalog/list', {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Square-Version': '2024-12-18',
    },
  });

  if (!response.ok) {
    throw new Error(`Catalog API error: ${response.status}`);
  }

  const data = await response.json();
  const objects = data.objects || [];

  console.log(`Processing ${objects.length} catalog objects`);

  for (const obj of objects) {
    await supabase
      .from('square_catalog_objects')
      .upsert({
        restaurant_id: restaurantId,
        object_id: obj.id,
        object_type: obj.type,
        parent_id: obj.parent_id || null,
        name: obj.item_data?.name || obj.category_data?.name || obj.modifier_list_data?.name || null,
        category_id: obj.item_data?.category_id || null,
        sku: obj.item_data?.variations?.[0]?.item_variation_data?.sku || null,
        modifier_list_ids: obj.item_data?.modifier_list_info?.map((m: any) => m.modifier_list_id) || [],
        version: obj.version,
        raw_json: obj,
      }, {
        onConflict: 'restaurant_id,object_id'
      });
  }
}

async function syncOrders(connection: any, restaurantId: string, locationId: string, startDate: string, endDate: string, supabase: any): Promise<number> {
  console.log(`Syncing orders for location ${locationId} from ${startDate} to ${endDate}`);
  
  let cursor = null;
  let totalOrders = 0;

  do {
    const searchQuery = {
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: {
            closed_at: {
              start_at: `${startDate}T00:00:00Z`,
              end_at: `${endDate}T23:59:59Z`
            }
          }
        }
      },
      return_entries: false,
      ...(cursor && { cursor })
    };

    const response = await fetch('https://connect.squareup.com/v2/orders/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Square-Version': '2024-12-18',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchQuery),
    });

    if (!response.ok) {
      throw new Error(`Orders API error: ${response.status}`);
    }

    const data = await response.json();
    const orders = data.orders || [];
    cursor = data.cursor;

    console.log(`Processing ${orders.length} orders`);

    for (const order of orders) {
      const closedAt = order.closed_at ? new Date(order.closed_at) : null;
      const serviceDate = await getServiceDate(closedAt, restaurantId, supabase);

      // Store order
      await supabase
        .from('square_orders')
        .upsert({
          restaurant_id: restaurantId,
          order_id: order.id,
          location_id: locationId,
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

      // Store line items
      if (order.line_items) {
        for (const lineItem of order.line_items) {
          await supabase
            .from('square_order_line_items')
            .upsert({
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
            }, {
              onConflict: 'restaurant_id,order_id,uid'
            });
        }
      }
    }

    totalOrders += orders.length;
  } while (cursor);

  return totalOrders;
}

async function getServiceDate(date: Date | null, restaurantId: string, supabase: any): Promise<string | null> {
  if (!date) return null;
  
  try {
    // Get restaurant timezone
    const { data: location } = await supabase
      .from('square_locations')
      .select('timezone')
      .eq('restaurant_id', restaurantId)
      .single();
    
    const timezone = location?.timezone || 'UTC';
    
    // Convert UTC date to restaurant timezone and get date
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    return formatter.format(date);
  } catch (error) {
    console.error('Error getting service date:', error);
    // Fallback to UTC date
    return date.toISOString().split('T')[0];
  }
}

async function syncPayments(connection: any, restaurantId: string, locationId: string, startDate: string, endDate: string, supabase: any): Promise<number> {
  console.log(`Syncing payments for location ${locationId}`);
  
  const response = await fetch(`https://connect.squareup.com/v2/payments?location_id=${locationId}&begin_time=${startDate}T00:00:00Z&end_time=${endDate}T23:59:59Z`, {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Square-Version': '2024-12-18',
    },
  });

  if (!response.ok) {
    throw new Error(`Payments API error: ${response.status}`);
  }

  const data = await response.json();
  const payments = data.payments || [];

  for (const payment of payments) {
    await supabase
      .from('square_payments')
      .upsert({
        restaurant_id: restaurantId,
        payment_id: payment.id,
        order_id: payment.order_id || null,
        location_id: locationId,
        status: payment.status,
        amount_money: parseFloat(payment.amount_money?.amount || '0') / 100,
        tip_money: parseFloat(payment.tip_money?.amount || '0') / 100,
        processing_fee_money: parseFloat(payment.processing_fee?.amount || '0') / 100,
        created_at: payment.created_at,
        raw_json: payment,
      }, {
        onConflict: 'restaurant_id,payment_id'
      });
  }

  return payments.length;
}

async function syncRefunds(connection: any, restaurantId: string, locationId: string, startDate: string, endDate: string, supabase: any): Promise<number> {
  console.log(`Syncing refunds for location ${locationId}`);
  
  const response = await fetch(`https://connect.squareup.com/v2/refunds?location_id=${locationId}&begin_time=${startDate}T00:00:00Z&end_time=${endDate}T23:59:59Z`, {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Square-Version': '2024-12-18',
    },
  });

  if (!response.ok) {
    throw new Error(`Refunds API error: ${response.status}`);
  }

  const data = await response.json();
  const refunds = data.refunds || [];

  for (const refund of refunds) {
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
  }

  return refunds.length;
}

async function syncTeamMembers(connection: any, restaurantId: string, supabase: any): Promise<number> {
  console.log('Syncing team members...');
  
  const response = await fetch('https://connect.squareup.com/v2/team-members', {
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Square-Version': '2024-12-18',
    },
  });

  if (!response.ok) {
    throw new Error(`Team members API error: ${response.status}`);
  }

  const data = await response.json();
  const teamMembers = data.team_members || [];

  for (const member of teamMembers) {
    await supabase
      .from('square_team_members')
      .upsert({
        restaurant_id: restaurantId,
        team_member_id: member.id,
        name: `${member.given_name || ''} ${member.family_name || ''}`.trim(),
        status: member.status,
        wage_default_money: parseFloat(member.wage_setting?.hourly_rate?.amount || '0') / 100,
        raw_json: member,
      }, {
        onConflict: 'restaurant_id,team_member_id'
      });
  }

  return teamMembers.length;
}

async function syncShifts(connection: any, restaurantId: string, locationId: string, startDate: string, endDate: string, supabase: any): Promise<number> {
  console.log(`Syncing shifts for location ${locationId}`);
  
  const searchQuery = {
    query: {
      filter: {
        location_ids: [locationId],
        start: {
          start_at: `${startDate}T00:00:00Z`,
          end_at: `${endDate}T23:59:59Z`
        }
      }
    }
  };

  const response = await fetch('https://connect.squareup.com/v2/labor/shifts/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${connection.access_token}`,
      'Square-Version': '2024-12-18',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchQuery),
  });

  if (!response.ok) {
    throw new Error(`Shifts API error: ${response.status}`);
  }

  const data = await response.json();
  const shifts = data.shifts || [];

  for (const shift of shifts) {
    const startAt = shift.start_at ? new Date(shift.start_at) : null;
    const serviceDate = await getServiceDate(startAt, restaurantId, supabase);

    await supabase
      .from('square_shifts')
      .upsert({
        restaurant_id: restaurantId,
        shift_id: shift.id,
        team_member_id: shift.team_member_id,
        location_id: locationId,
        start_at: shift.start_at,
        end_at: shift.end_at,
        service_date: serviceDate,
        hourly_rate_money: parseFloat(shift.wage?.hourly_rate?.amount || '0') / 100,
        total_wage_money: parseFloat(shift.wage?.total?.amount || '0') / 100,
        overtime_seconds: shift.breaks?.reduce((acc: number, b: any) => acc + (b.break_type?.overtime_seconds || 0), 0) || 0,
        break_seconds: shift.breaks?.reduce((acc: number, b: any) => acc + (b.duration_seconds || 0), 0) || 0,
        raw_json: shift,
      }, {
        onConflict: 'restaurant_id,shift_id'
      });
  }

  return shifts.length;
}

function getDateRange(startDate: string, endDate: string): string[] {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  
  return dates;
}

// Direct P&L calculation function to replace RPC call
async function calculateSquareDailyPnL(supabase: any, restaurantId: string, serviceDate: string) {
  console.log(`Calculating P&L for ${restaurantId} on ${serviceDate}`);
  
  // Update daily_sales table with Square data
  const { data: ordersData, error: ordersError } = await supabase
    .from('square_orders')
    .select('gross_sales_money, total_discount_money')
    .eq('restaurant_id', restaurantId)
    .eq('service_date', serviceDate)
    .eq('state', 'COMPLETED');

  if (ordersError) {
    console.error('Error fetching orders for P&L:', ordersError);
    throw ordersError;
  }

  if (ordersData && ordersData.length > 0) {
    const grossRevenue = ordersData.reduce((sum, order) => sum + (order.gross_sales_money || 0), 0);
    const discounts = ordersData.reduce((sum, order) => sum + (order.total_discount_money || 0), 0);

    console.log(`Square sales for ${serviceDate}: $${grossRevenue}, discounts: $${discounts}`);

    // Upsert Square sales data
    const { error: salesError } = await supabase
      .from('daily_sales')
      .upsert({
        restaurant_id: restaurantId,
        date: serviceDate,
        source: 'square',
        gross_revenue: grossRevenue,
        discounts: discounts,
        comps: 0
      }, {
        onConflict: 'restaurant_id,date,source'
      });

    if (salesError) {
      console.error('Error upserting sales:', salesError);
      throw salesError;
    }
  }

  // Update daily_labor_costs table with Square data
  const { data: shiftsData, error: shiftsError } = await supabase
    .from('square_shifts')
    .select('total_wage_money')
    .eq('restaurant_id', restaurantId)
    .eq('service_date', serviceDate);

  if (shiftsError) {
    console.error('Error fetching shifts for P&L:', shiftsError);
    // Don't throw - labor data might not be available
  }

  if (shiftsData && shiftsData.length > 0) {
    const totalWages = shiftsData.reduce((sum, shift) => sum + (shift.total_wage_money || 0), 0);

    console.log(`Square labor for ${serviceDate}: $${totalWages}`);

    // Upsert Square labor data
    const { error: laborError } = await supabase
      .from('daily_labor_costs')
      .upsert({
        restaurant_id: restaurantId,
        date: serviceDate,
        source: 'square',
        hourly_wages: totalWages,
        salary_wages: 0,
        benefits: 0,
        total_labor_cost: totalWages
      }, {
        onConflict: 'restaurant_id,date,source'
      });

    if (laborError) {
      console.error('Error upserting labor costs:', laborError);
      throw laborError;
    }
  }

  // Trigger overall P&L calculation by calling the aggregation function
  const { error: pnlError } = await supabase.rpc('calculate_daily_pnl', {
    p_restaurant_id: restaurantId,
    p_date: serviceDate
  });

  if (pnlError) {
    console.error('Error calculating daily P&L:', pnlError);
    throw pnlError;
  }

  console.log(`P&L calculation completed for ${serviceDate}`);
}