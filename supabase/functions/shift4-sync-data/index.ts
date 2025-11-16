import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEncryptionService, logSecurityEvent } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Shift4SyncRequest {
  restaurantId: string;
  action: 'initial_sync' | 'daily_sync' | 'hourly_sync';
  dateRange?: {
    startDate: string;
    endDate: string;
  };
}

/**
 * Fetch charges from Shift4 API with pagination
 */
async function fetchCharges(
  secretKey: string,
  environment: string,
  startTimestamp: number,
  endTimestamp?: number
): Promise<any[]> {
  const baseUrl = environment === 'sandbox' 
    ? 'https://api.sandbox.shift4.com' 
    : 'https://api.shift4.com';

  const authHeader = 'Basic ' + btoa(secretKey + ':');
  const allCharges: any[] = [];
  let startingAfterId: string | null = null;
  let hasMore = true;
  const limit = 100; // Max supported by Shift4
  let iterations = 0;
  const maxIterations = 100; // Safety limit

  while (hasMore && iterations < maxIterations) {
    iterations++;

    const params = new URLSearchParams({
      limit: limit.toString(),
      'created[gte]': startTimestamp.toString(),
    });

    if (endTimestamp) {
      params.set('created[lte]', endTimestamp.toString());
    }

    if (startingAfterId) {
      params.set('startingAfterId', startingAfterId);
    }

    const url = `${baseUrl}/charges?${params.toString()}`;
    console.log(`Fetching charges: ${url.substring(0, 100)}...`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch charges:', errorText);
      throw new Error(`Failed to fetch charges: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const charges = data.list || [];
    
    console.log(`Fetched ${charges.length} charges, hasMore: ${data.hasMore}`);
    
    allCharges.push(...charges);

    hasMore = data.hasMore || false;
    
    if (hasMore && charges.length > 0) {
      // Get the last charge ID for pagination
      startingAfterId = charges[charges.length - 1].id;
    }
  }

  console.log(`Total charges fetched: ${allCharges.length}`);
  return allCharges;
}

/**
 * Fetch refunds for a specific charge
 */
async function fetchRefundsForCharge(
  secretKey: string,
  environment: string,
  chargeId: string
): Promise<any[]> {
  const baseUrl = environment === 'sandbox' 
    ? 'https://api.sandbox.shift4.com' 
    : 'https://api.shift4.com';

  const authHeader = 'Basic ' + btoa(secretKey + ':');

  const url = `${baseUrl}/charges/${chargeId}/refunds?limit=100`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    console.warn(`Failed to fetch refunds for charge ${chargeId}`);
    return [];
  }

  const data = await response.json();
  return data.list || [];
}

/**
 * Extract tip amount from charge splits (if Platform Split is used)
 */
function extractTipAmount(charge: any): number {
  if (!charge.splits || !Array.isArray(charge.splits)) {
    return 0;
  }

  const tipSplit = charge.splits.find((split: any) => split.type === 'tip');
  return tipSplit?.amount || 0;
}

/**
 * Convert UTC timestamp to restaurant's local date/time
 */
function convertToLocalDateTime(
  utcTimestamp: number,
  timezone: string
): { date: string; time: string } {
  const utcDate = new Date(utcTimestamp * 1000); // Convert seconds to milliseconds

  // Get local date in YYYY-MM-DD format
  const localDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(utcDate);

  // Get local time in HH:MM:SS format
  const localTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(utcDate);

  return { date: localDateStr, time: localTimeStr };
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

    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const body: Shift4SyncRequest = await req.json();
    const { restaurantId, action, dateRange } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    console.log('Shift4 sync started:', { restaurantId, action, dateRange, userId: user.id });

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: restaurantError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (restaurantError || !userRestaurant) {
      throw new Error('Access denied: User does not have access to this restaurant');
    }

    if (!['owner', 'manager'].includes(userRestaurant.role)) {
      throw new Error('Access denied: Only owners and managers can sync POS data');
    }

    // Get Shift4 connection
    const { data: connection, error: connError } = await supabase
      .from('shift4_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connError || !connection) {
      throw new Error('Shift4 connection not found');
    }

    // Get restaurant timezone
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', restaurantId)
      .single();

    const restaurantTimezone = restaurant?.timezone || 'America/Chicago';

    // Decrypt the secret key
    const encryption = await getEncryptionService();
    const secretKey = await encryption.decrypt(connection.secret_key);

    // Log security event
    await logSecurityEvent(supabase, 'SHIFT4_KEY_ACCESSED', user.id, restaurantId, {
      action,
      merchantId: connection.merchant_id,
    });

    // Calculate date range
    let startDate: Date, endDate: Date;

    if (dateRange) {
      startDate = new Date(dateRange.startDate);
      endDate = new Date(dateRange.endDate);
    } else if (action === 'initial_sync') {
      // Last 90 days for initial sync
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 90);
    } else if (action === 'daily_sync') {
      // Previous business day
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 1);
    } else {
      // Last 2 days for hourly sync (to catch late adjustments)
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 2);
    }

    // Convert to UTC Unix timestamps (seconds, not milliseconds)
    const startTimestamp = Math.floor(startDate.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    console.log('Syncing Shift4 data:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startTimestamp,
      endTimestamp,
      timezone: restaurantTimezone,
    });

    const results = {
      chargesSynced: 0,
      refundsSynced: 0,
      errors: [] as string[],
    };

    // Fetch and store charges
    try {
      const charges = await fetchCharges(
        secretKey,
        connection.environment,
        startTimestamp,
        endTimestamp
      );

      console.log(`Processing ${charges.length} charges`);

      for (const charge of charges) {
        try {
          // Extract tip amount from splits (if available)
          const tipAmount = extractTipAmount(charge);

          // Convert timestamp to local date/time
          const { date: serviceDate, time: serviceTime } = convertToLocalDateTime(
            charge.created,
            restaurantTimezone
          );

          // Store charge
          await supabase.from('shift4_charges').upsert({
            restaurant_id: restaurantId,
            charge_id: charge.id,
            merchant_id: connection.merchant_id,
            amount: charge.amount,
            currency: charge.currency || 'USD',
            status: charge.status || 'unknown',
            refunded: charge.refunded || false,
            captured: charge.captured || false,
            created_at_ts: charge.created,
            created_time: new Date(charge.created * 1000).toISOString(),
            service_date: serviceDate,
            service_time: serviceTime,
            description: charge.description,
            tip_amount: tipAmount,
            raw_json: charge,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'restaurant_id,charge_id',
          });

          results.chargesSynced++;

          // Fetch and store refunds for this charge (if it has been refunded)
          if (charge.refunded) {
            try {
              const refunds = await fetchRefundsForCharge(
                secretKey,
                connection.environment,
                charge.id
              );

              for (const refund of refunds) {
                const { date: refundDate } = convertToLocalDateTime(
                  refund.created,
                  restaurantTimezone
                );

                await supabase.from('shift4_refunds').upsert({
                  restaurant_id: restaurantId,
                  refund_id: refund.id,
                  charge_id: charge.id,
                  merchant_id: connection.merchant_id,
                  amount: refund.amount,
                  currency: refund.currency || 'USD',
                  status: refund.status,
                  reason: refund.reason,
                  created_at_ts: refund.created,
                  created_time: new Date(refund.created * 1000).toISOString(),
                  service_date: refundDate,
                  raw_json: refund,
                  synced_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }, {
                  onConflict: 'restaurant_id,refund_id',
                });

                results.refundsSynced++;
              }
            } catch (refundError: any) {
              console.error(`Failed to fetch refunds for charge ${charge.id}:`, refundError);
              results.errors.push(`Refunds for charge ${charge.id}: ${refundError.message}`);
            }
          }

        } catch (chargeError: any) {
          console.error(`Failed to process charge ${charge.id}:`, chargeError);
          results.errors.push(`Charge ${charge.id}: ${chargeError.message}`);
        }
      }

      // Sync to unified_sales table
      const { data: syncResult, error: syncError } = await supabase.rpc(
        'sync_shift4_to_unified_sales',
        { p_restaurant_id: restaurantId }
      );

      if (syncError) {
        console.error('Error syncing to unified_sales:', syncError);
        results.errors.push(`Unified sync error: ${syncError.message}`);
      } else {
        console.log(`Synced ${syncResult} items to unified_sales`);
      }

      // Update last sync timestamp
      await supabase
        .from('shift4_connections')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', connection.id);

    } catch (syncError: any) {
      console.error('Sync error:', syncError);
      results.errors.push(syncError.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        results,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error: any) {
    console.error('Shift4 sync error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
