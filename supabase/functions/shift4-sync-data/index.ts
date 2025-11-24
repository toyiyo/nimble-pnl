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

const getLocalYMD = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date).reduce((acc: any, part) => {
    if (part.type === 'year') acc.year = parseInt(part.value, 10);
    if (part.type === 'month') acc.month = parseInt(part.value, 10);
    if (part.type === 'day') acc.day = parseInt(part.value, 10);
    return acc;
  }, { year: 0, month: 0, day: 0 });
  return parts as { year: number; month: number; day: number };
};

const getLocalDateRangeDays = (startDate: Date, endDate: Date, timeZone: string) => {
  const days: { year: number; month: number; day: number }[] = [];
  const start = getLocalYMD(startDate, timeZone);
  const end = getLocalYMD(endDate, timeZone);

  const startValue = Date.UTC(start.year, start.month - 1, start.day);
  const endValue = Date.UTC(end.year, end.month - 1, end.day);

  for (let ts = startValue; ts <= endValue; ts += 24 * 60 * 60 * 1000) {
    const d = new Date(ts);
    const local = getLocalYMD(d, timeZone);
    days.push(local);
  }

  return days;
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
      // Last 7 days for initial sync
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(endDate.getDate() - 7);
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

    console.log('Syncing Shift4 data:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
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

      // Prepare request params (align days to restaurant timezone)
      const startDay = new Date(startDate);
      const endDay = new Date(endDate);
      let locations: number[] = [];
      if (connection.lighthouse_location_ids) {
        try {
          const parsed = JSON.parse(connection.lighthouse_location_ids);
          if (Array.isArray(parsed)) {
            locations = parsed.filter((l) => typeof l === 'number');
          }
        } catch (e) {
          console.error('Failed to parse lighthouse_location_ids:', connection.lighthouse_location_ids, e);
        }
      }
      // If no valid location IDs, throw error
      if (!locations.length) {
        throw new Error('No valid Lighthouse location IDs found for sync');
      }

      // Build list of days to sync (inclusive) in restaurant timezone
      const daysToSync = getLocalDateRangeDays(startDay, endDay, restaurantTimezone);

      for (const syncDate of daysToSync) {
        const dayStart = new Date(Date.UTC(syncDate.year, syncDate.month - 1, syncDate.day, 0, 0, 0));
        const dayEnd = new Date(Date.UTC(syncDate.year, syncDate.month - 1, syncDate.day, 23, 59, 59, 999));
        const dayStartIso = dayStart.toISOString();
        const dayEndIso = dayEnd.toISOString();
        const dayDateString = `${syncDate.year}-${String(syncDate.month).padStart(2, '0')}-${String(syncDate.day).padStart(2, '0')}`;

        const salesSummary = await fetchLighthouseSalesSummary(
          lighthouseToken,
          dayStartIso,
          dayEndIso,
          locations,
          'en-US'
        );

        if (!Array.isArray(salesSummary.rows)) {
          continue;
        }

        const parseCurrency = (value: string): number => {
          if (!value) return 0;
          const cleaned = value.replace(/[^0-9.-]/g, '');
          const parsed = parseFloat(cleaned);
          return Number.isFinite(parsed) ? parsed : 0;
        };

        for (const row of salesSummary.rows) {
          const item = row[0];
          // Skip total/summary rows
          if (typeof item === 'string' && item.toLowerCase().includes('totals')) {
            continue;
          }
          const revenueClass = row[1];
          const department = row[2];
          const defaultPrice = parseCurrency(row[3]);
          const qty = parseFloat(row[4]) || 0;
          const totalCost = parseCurrency(row[5]);
          const discount = parseCurrency(row[7]); // reported as positive in Lighthouse
          const avgSalePrice = parseCurrency(row[8]);
          const grossSales = parseCurrency(row[9]);
          const netSales = parseCurrency(row[10]);

          const locationId = locations[0] ?? null;
          const merchantId = locationId !== null ? String(locationId) : 'unknown';
          const chargeId = `${item}-${merchantId}-${dayDateString}`;
          const chargeAmount = netSales || grossSales || 0;
          const chargeAmountCents = Math.round(chargeAmount * 100);

          const rawData = {
            item,
            revenueClass,
            department,
            defaultPrice,
            qty,
            totalCost,
            discount,
            avgSalePrice,
            grossSales,
            netSales,
          };

          const { error: chargeError } = await supabase.from('shift4_charges').upsert({
            restaurant_id: restaurantId,
            charge_id: chargeId,
            merchant_id: merchantId,
            amount: chargeAmountCents,
            currency: 'USD',
            status: 'completed',
            refunded: false,
            captured: true,
            created_at_ts: Math.floor(dayStart.getTime() / 1000),
            created_time: dayStartIso,
            service_date: dayDateString,
            service_time: '00:00:00',
            description: item,
            tip_amount: 0,
            raw_json: rawData,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'restaurant_id,charge_id',
          });
          if (chargeError) {
            console.error(`[${dayDateString}] [Lighthouse Sync] shift4_charges upsert error:`, chargeError);
            results.errors.push(`[${dayDateString}] Charge upsert failed for ${item}: ${chargeError.message}`);
          } else {
            results.chargesSynced++;
          }

          // Remove any prior rows for this charge to avoid partial-index conflict issues
          await supabase
            .from('unified_sales')
            .delete()
            .eq('restaurant_id', restaurantId)
            .eq('pos_system', 'lighthouse')
            .eq('external_order_id', chargeId);

          const { error: saleError } = await supabase.from('unified_sales').insert({
            restaurant_id: restaurantId,
            pos_system: 'lighthouse',
            external_order_id: chargeId,
            external_item_id: `${chargeId}-sale`,
            item_name: item,
            item_type: 'sale',
            adjustment_type: 'sale',
            quantity: qty,
            total_price: grossSales,
            unit_price: grossSales && qty ? grossSales / qty : null,
            sale_date: dayDateString,
            sale_time: '00:00:00',
            raw_data: rawData,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (saleError) {
            console.error(`[${dayDateString}] [Lighthouse Sync] unified_sales sale insert error:`, saleError);
            results.errors.push(`[${dayDateString}] Sale insert failed for ${item}: ${saleError.message}`);
          }

          if (discount && Math.abs(discount) > 0.0001) {
            const { error: discountError } = await supabase.from('unified_sales').insert({
              restaurant_id: restaurantId,
              pos_system: 'lighthouse',
              external_order_id: chargeId,
              external_item_id: `${chargeId}-discount`,
              item_name: `${item} Discount`,
              item_type: 'discount',
              adjustment_type: 'discount',
              total_price: -discount,
              sale_date: dayDateString,
              sale_time: '00:00:00',
              raw_data: { discount, row },
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            if (discountError) {
              console.error(`[${dayDateString}] [Lighthouse Sync] Discount insert error for ${item}:`, discountError);
              results.errors.push(`[${dayDateString}] Discount insert failed for ${item}: ${discountError.message}`);
            }
          }
        }

        // Small delay to avoid hammering the API
        await new Promise((resolve) => setTimeout(resolve, 100));
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

    const success = results.errors.length === 0;
    return new Response(
      JSON.stringify({
        success,
        results,
      }),
      {
        status: success ? 200 : 207,
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
