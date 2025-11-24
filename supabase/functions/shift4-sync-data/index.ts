import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEncryptionService, logSecurityEvent } from "../_shared/encryption.ts";

/**
 * Authenticate with Lighthouse API and return token
 */
async function authenticateWithLighthouse(email: string, password: string): Promise<string> {
  const response = await fetch('https://lighthouse-api.harbortouch.com/api/v1/auth/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Lighthouse authentication failed: ${errorText}`);
  }
  const data = await response.json();
  if (!data.token) throw new Error('No token returned from Lighthouse');
  return data.token;
}

/**
 * Store Lighthouse token in shift4_connections (encrypted)
 */
async function storeLighthouseToken(supabase: any, connectionId: string, token: string) {
  const encryption = await getEncryptionService();
  const encryptedToken = await encryption.encrypt(token);
  await supabase.from('shift4_connections').update({
    lighthouse_token: encryptedToken,
    lighthouse_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(), // 1hr expiry (adjust if needed)
    updated_at: new Date().toISOString(),
  }).eq('id', connectionId);
}

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
 * Fetch sales summary by item from Lighthouse API
 */
async function fetchLighthouseSalesSummary(token: string, start: string, end: string, locations: number[], locale = 'en-US'): Promise<any> {
  const url = 'https://lighthouse-api.harbortouch.com/api/v1/reports/echo-pro/sales-summary-by-item';
  const payload = {
    start,
    end,
    locations,
    intradayPeriodGroupGuids: [],
    revenueCenterGuids: [],
    locale,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      'origin': 'https://lh.shift4.com',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'referer': 'https://lh.shift4.com/',
      'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'x-access-token': token,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Lighthouse sales summary fetch failed: ${errorText}`);
  }
  return await response.json();
}

/**
 * Fetch refunds for a specific charge
 * Note: Shift4 uses the same URL for both test and production.
 */
async function fetchRefundsForCharge(
  secretKey: string,
  environment: string,
  chargeId: string
): Promise<any[]> {
  // Shift4 uses the same base URL for both test and production environments
  const baseUrl = 'https://api.shift4.com';

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

    const body: Shift4SyncRequest = await req.json();
    const { restaurantId, action, dateRange } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    // Get authenticated user (optional - webhooks can call this without auth)
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;

    if (authHeader) {
      // If auth header present, verify user and permissions
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);

      if (userError || !user) {
        throw new Error('Invalid authentication token');
      }

      userId = user.id;

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
    }
    // If no auth header, assume internal call from webhook (already validated)

    console.log('Shift4 sync started:', { restaurantId, action, dateRange, userId });


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

  // Decrypt the secret key only if present
  const encryption = await getEncryptionService();
  const secretKey = connection.secret_key ? await encryption.decrypt(connection.secret_key) : null;

    // (Authentication handled later when token is actually needed)

    // Log security event (only if user authenticated)
    if (userId) {
      await logSecurityEvent(supabase, 'SHIFT4_KEY_ACCESSED', userId, restaurantId, {
        action,
        merchantId: connection.merchant_id,
      });
    }

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


    // Fetch and store Lighthouse sales summary
    try {
      // Decrypt Lighthouse token
      let lighthouseToken: string | null = null;
      const now = new Date();
      const expiresAt = connection.lighthouse_token_expires_at
        ? new Date(connection.lighthouse_token_expires_at)
        : null;

      if (connection.lighthouse_token && expiresAt && expiresAt > now) {
        lighthouseToken = await encryption.decrypt(connection.lighthouse_token);
      } else if (connection.email && connection.password) {
        const email = await encryption.decrypt(connection.email);
        const password = await encryption.decrypt(connection.password);
        // Authenticate and get full response
        const authResponse = await (async () => {
          const response = await fetch('https://lighthouse-api.harbortouch.com/api/v1/auth/authenticate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Lighthouse authentication failed: ${errorText}`);
          }
          return await response.json();
        })();
        lighthouseToken = authResponse.token;
        // Extract all unique location IDs from permissions
        const locationIds = Array.from(new Set((authResponse.permissions || []).map((p: any) => p.l).filter((l: any) => typeof l === 'number')));
        const { data: updatedConn, error: tokenError } = await supabase.from('shift4_connections').update({
          lighthouse_token: await encryption.encrypt(lighthouseToken),
          lighthouse_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          lighthouse_location_ids: locationIds.length ? JSON.stringify(locationIds) : null,
          updated_at: new Date().toISOString(),
        }).eq('id', connection.id).select().single();
        if (tokenError || !updatedConn) {
          console.error('Failed to persist Lighthouse token:', tokenError, updatedConn);
          throw new Error('Failed to persist Lighthouse token');
        }
        if (userId) {
          await logSecurityEvent(
            supabase,
            'LIGHTHOUSE_TOKEN_ACQUIRED',
            userId,
            restaurantId,
            { action, merchantId: connection.merchant_id, locationIds },
          );
        }
      }
      if (!lighthouseToken) throw new Error('No Lighthouse token available');

      // Prepare request params
      const startIso = new Date(startTimestamp * 1000).toISOString();
      const endIso = new Date(endTimestamp * 1000).toISOString();
      const locations = connection.lighthouse_location_ids || [connection.merchant_id];

      // Fetch sales summary
      const salesSummary = await fetchLighthouseSalesSummary(
        lighthouseToken,
        startIso,
        endIso,
        locations,
        'en-US'
      );

      // Store each row as a charge (minimal example)
      if (Array.isArray(salesSummary.rows)) {
        for (const row of salesSummary.rows) {
          // Map row to fields (example: item, qty, gross sales, net sales, discount)
          const item = row[0];
          const qty = parseFloat(row[4]);
          const grossSales = parseFloat(row[9].replace(/[^\d.]/g, ''));
          const netSales = parseFloat(row[10].replace(/[^\d.]/g, ''));
          const discount = parseFloat(row[7].replace(/[^\d.\-]/g, ''));

          await supabase.from('shift4_charges').upsert({
            restaurant_id: restaurantId,
            charge_id: `${item}-${startIso}`,
            merchant_id: connection.merchant_id,
            amount: grossSales,
            currency: 'USD',
            status: 'completed',
            refunded: false,
            captured: true,
            created_at_ts: startTimestamp,
            created_time: startIso,
            service_date: startIso.split('T')[0],
            service_time: startIso.split('T')[1]?.substring(0,8) || '',
            description: item,
            tip_amount: 0,
            raw_json: row,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'restaurant_id,charge_id',
          });
          results.chargesSynced++;

          // Store discount as negative adjustment in unified_sales (if non-zero)
          if (discount && Math.abs(discount) > 0.0001) {
            await supabase.from('unified_sales').upsert({
              restaurant_id: restaurantId,
              pos_system: 'lighthouse',
              external_order_id: `${item}-${startIso}`,
              external_item_id: `${item}-${startIso}-discount`,
              item_name: `${item} Discount`,
              item_type: 'discount',
              adjustment_type: 'discount',
              total_price: -discount, // negative for discounts
              sale_date: startIso.split('T')[0],
              sale_time: startIso.split('T')[1]?.substring(0,8) || '',
              raw_data: { discount, row },
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'restaurant_id,external_order_id,external_item_id',
            });
          }
        }
      }

      // Update last sync timestamp
      await supabase
        .from('shift4_connections')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', connection.id);

    } catch (syncError: any) {
      console.error('Lighthouse sync error:', syncError);
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
