import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEncryptionService, logSecurityEvent } from "../_shared/encryption.ts";

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

const withRetry = async <T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
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
 * Fetch ticket detail (closed) from Lighthouse API
 */
async function fetchLighthouseTicketDetails(token: string, start: string, end: string, locations: number[], locale = 'en-US'): Promise<any> {
  const url = 'https://lighthouse-api.harbortouch.com/api/v1/reports/echo-pro/ticket-detail-closed';
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
      'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt-PT;q=0.7,pt;q=0.6',
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
    throw new Error(`Lighthouse ticket detail fetch failed: ${errorText}`);
  }
  return await response.json();
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

      // Shared currency parser
      const parseCurrency = (value: string | number | null | undefined): number => {
        if (value === null || value === undefined) return 0;
        if (typeof value === 'number') return value;
        const cleaned = String(value).replace(/[^0-9.-]/g, '');
        const parsed = parseFloat(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      // Resolve start/end for one call in restaurant timezone
      const startParts = getLocalYMD(startDay, restaurantTimezone);
      const endParts = getLocalYMD(endDay, restaurantTimezone);
      const rangeStart = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day, 0, 0, 0));
      const rangeEnd = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day, 23, 59, 59, 999));
      const rangeStartIso = rangeStart.toISOString();
      const rangeEndIso = rangeEnd.toISOString();
      const fallbackDateString = `${startParts.year}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`;

      // Table lacks a matching unique constraint for column-based upsert, so delete+insert to keep rows idempotent.
      const replaceUnifiedSale = async (payload: any) => {
        await supabase
          .from('unified_sales')
          .delete()
          .eq('restaurant_id', payload.restaurant_id)
          .eq('pos_system', payload.pos_system)
          .eq('external_order_id', payload.external_order_id)
          .eq('external_item_id', payload.external_item_id);

        return supabase.from('unified_sales').insert(payload);
      };

      const parseTicketDateTime = (value: string | undefined | null) => {
        if (!value || typeof value !== 'string') return null;
        const [mdy, timeRaw] = value.trim().split(/\\s+/);
        if (!mdy || !timeRaw) return null;
        const [mm, dd, yyyy] = mdy.split('/').map((n) => parseInt(n, 10));
        const timeMatch = timeRaw.match(/(\\d{1,2}):(\\d{2})(AM|PM)/i);
        if (!mm || !dd || !yyyy || !timeMatch) return null;
        let [, hh, min, ampm] = timeMatch;
        let hour = parseInt(hh, 10);
        const minute = parseInt(min, 10);
        if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
        if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
        const dateStr = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
        const jsDate = new Date(Date.UTC(yyyy, mm - 1, dd, hour, minute, 0));
        return { dateStr, timeStr, jsDate };
      };

      let salesSummary;
      try {
        salesSummary = await withRetry(
          () => fetchLighthouseTicketDetails(
            lighthouseToken,
            rangeStartIso,
            rangeEndIso,
            locations,
            'en-US'
          ),
          3,
          750
        );
      } catch (err: any) {
        console.error(`[${fallbackDateString}] Lighthouse fetch failed:`, err?.message || err);
        results.errors.push(`[${fallbackDateString}] Lighthouse fetch failed: ${err?.message || err}`);
        throw err;
      }

      const tickets = Array.isArray(salesSummary.rows) ? salesSummary.rows : [];

      for (const ticket of tickets) {
        // Skip voided tickets
        if (ticket.status && typeof ticket.status === 'string' && ticket.status.toLowerCase().includes('void')) {
          continue;
        }

        const orderNumber = ticket.orderNumber || ticket.order || ticket.ticket || ticket.ticketNumber;
        if (!orderNumber) {
          continue;
        }

        const parsedCompleted = parseTicketDateTime(ticket.completed || ticket.opened);
        const saleDateString = parsedCompleted?.dateStr || fallbackDateString;
        const saleTimeString = parsedCompleted?.timeStr || '00:00:00';
        const createdDate = parsedCompleted?.jsDate || rangeStart;

        const locationId = locations[0] ?? null;
        const merchantId = locationId !== null ? String(locationId) : 'unknown';
        const chargeId = `${orderNumber}-${merchantId}-${saleDateString}`;

        // Only grandTotal is required for charge upsert
        const grandTotal = parseCurrency(ticket.grandTotal);

        const rawData = ticket;

        const { error: chargeError } = await supabase.from('shift4_charges').upsert({
          restaurant_id: restaurantId,
          charge_id: chargeId,
          merchant_id: merchantId,
          amount: Math.round(grandTotal * 100),
          currency: 'USD',
          status: 'completed',
          refunded: false,
          captured: true,
          created_at_ts: Math.floor(createdDate.getTime() / 1000),
          created_time: createdDate.toISOString(),
          service_date: saleDateString,
          service_time: saleTimeString,
          description: `Ticket ${orderNumber}`,
          tip_amount: 0,
          raw_json: rawData,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'restaurant_id,charge_id',
        });
        if (chargeError) {
          console.error(`[${saleDateString}] [Lighthouse Sync] shift4_charges upsert error:`, chargeError);
          results.errors.push(`[${saleDateString}] Charge upsert failed for ticket ${orderNumber}: ${chargeError.message}`);
          continue;
        } else {
          results.chargesSynced++;
        }

        let lineIndex = 0;

        // Items
        const items = Array.isArray(ticket.items) ? ticket.items : [];
        for (const item of items) {
          if (item.status && typeof item.status === 'string' && item.status.toLowerCase().includes('void')) {
            continue;
          }
          const qty = Number(item.qty) || 0;
          const itemSubtotal = parseCurrency(item.subtotal);
          const itemName = item.name || 'Item';
          const discount = parseCurrency(item.discountTotal);
          const sur = parseCurrency(item.surTotal);

          const { error: saleError } = await replaceUnifiedSale({
            restaurant_id: restaurantId,
            pos_system: 'lighthouse',
            external_order_id: chargeId,
            external_item_id: `${chargeId}-item-${lineIndex}`,
            item_name: itemName,
            item_type: 'sale',
            adjustment_type: null,
            quantity: qty || 1,
            total_price: itemSubtotal,
            unit_price: itemSubtotal && qty ? itemSubtotal / qty : null,
            sale_date: saleDateString,
            sale_time: saleTimeString,
            raw_data: item,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (saleError) {
            console.error(`[${saleDateString}] [Lighthouse Sync] unified_sales item insert error:`, saleError);
            results.errors.push(`[${saleDateString}] Item insert failed for ${itemName}: ${saleError.message}`);
          }

          // Item-level discount
          if (discount && Math.abs(discount) > 0.0001) {
            const { error: discountError } = await replaceUnifiedSale({
              restaurant_id: restaurantId,
              pos_system: 'lighthouse',
              external_order_id: chargeId,
              external_item_id: `${chargeId}-item-discount-${lineIndex}`,
              item_name: `${itemName} Discount`,
              item_type: 'discount',
              adjustment_type: 'discount',
              total_price: -Math.abs(discount),
              sale_date: saleDateString,
              sale_time: saleTimeString,
              raw_data: item,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            if (discountError) {
              console.error(`[${saleDateString}] [Lighthouse Sync] Item discount insert error for ${itemName}:`, discountError);
              results.errors.push(`[${saleDateString}] Item discount insert failed for ${itemName}: ${discountError.message}`);
            }
          }

          // Item-level surcharge
          if (sur && Math.abs(sur) > 0.0001) {
            const { error: feeError } = await replaceUnifiedSale({
              restaurant_id: restaurantId,
              pos_system: 'lighthouse',
              external_order_id: chargeId,
              external_item_id: `${chargeId}-item-fee-${lineIndex}`,
              item_name: `${itemName} Surcharge`,
              item_type: 'service_charge',
              adjustment_type: 'service_charge',
              total_price: sur,
              sale_date: saleDateString,
              sale_time: saleTimeString,
              raw_data: item,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            if (feeError) {
              console.error(`[${saleDateString}] [Lighthouse Sync] Item surcharge insert error for ${itemName}:`, feeError);
              results.errors.push(`[${saleDateString}] Item surcharge insert failed for ${itemName}: ${feeError.message}`);
            }
          }

          lineIndex++;
        }

        // Ticket-level discounts
        const ticketDiscounts = Array.isArray(ticket.ticketDiscounts) ? ticket.ticketDiscounts : [];
        for (const [idx, d] of ticketDiscounts.entries()) {
          const name = Array.isArray(d) ? d[0] : (d?.name || 'Ticket Discount');
          const amount = Array.isArray(d) ? parseCurrency(d[1]) : parseCurrency(d?.amount);
          if (!amount) continue;
          const { error } = await replaceUnifiedSale({
            restaurant_id: restaurantId,
            pos_system: 'lighthouse',
            external_order_id: chargeId,
            external_item_id: `${chargeId}-discount-${idx}`,
            item_name: name,
            item_type: 'discount',
            adjustment_type: 'discount',
            total_price: -Math.abs(amount),
            sale_date: saleDateString,
            sale_time: saleTimeString,
            raw_data: d,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (error) {
            console.error(`[${saleDateString}] [Lighthouse Sync] Ticket discount insert error for ${name}:`, error);
            results.errors.push(`[${saleDateString}] Ticket discount insert failed for ${name}: ${error.message}`);
          }
        }

        // Ticket-level fees/surcharges
        const ticketFees = Array.isArray(ticket.ticketFees) ? ticket.ticketFees : [];
        for (const [idx, f] of ticketFees.entries()) {
          const name = Array.isArray(f) ? f[0] : (f?.name || 'Fee');
          const amount = Array.isArray(f) ? parseCurrency(f[4] ?? f[1]) : parseCurrency(f?.grandTotal || f?.amount);
          if (!amount) continue;
          const { error } = await replaceUnifiedSale({
            restaurant_id: restaurantId,
            pos_system: 'lighthouse',
            external_order_id: chargeId,
            external_item_id: `${chargeId}-fee-${idx}`,
            item_name: name,
            item_type: 'service_charge',
            adjustment_type: 'service_charge',
            total_price: amount,
            sale_date: saleDateString,
            sale_time: saleTimeString,
            raw_data: f,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (error) {
            console.error(`[${saleDateString}] [Lighthouse Sync] Fee insert error for ${name}:`, error);
            results.errors.push(`[${saleDateString}] Fee insert failed for ${name}: ${error.message}`);
          }
        }

        // Ticket-level taxes
        const ticketTaxes = Array.isArray(ticket.ticketTaxes) ? ticket.ticketTaxes : [];
        for (const [idx, t] of ticketTaxes.entries()) {
          const name = Array.isArray(t) ? t[0] : (t?.name || 'Tax');
          const amount = Array.isArray(t) ? parseCurrency(t[1]) : parseCurrency(t?.amount);
          if (!amount) continue;
          const { error } = await replaceUnifiedSale({
            restaurant_id: restaurantId,
            pos_system: 'lighthouse',
            external_order_id: chargeId,
            external_item_id: `${chargeId}-tax-${idx}`,
            item_name: name,
            item_type: 'tax',
            adjustment_type: 'tax',
            total_price: amount,
            sale_date: saleDateString,
            sale_time: saleTimeString,
            raw_data: t,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (error) {
            console.error(`[${saleDateString}] [Lighthouse Sync] Tax insert error for ${name}:`, error);
            results.errors.push(`[${saleDateString}] Tax insert failed for ${name}: ${error.message}`);
          }
        }

        // Ticket-level tips from payments
        const payments = Array.isArray(ticket.ticketPayments) ? ticket.ticketPayments : [];
        for (const [idx, p] of payments.entries()) {
          const tipAmount = Array.isArray(p) ? parseCurrency(p[3]) : parseCurrency(p?.tip);
          if (!tipAmount) continue;
          const tenderType = Array.isArray(p) ? p[0] : (p?.tenderType || 'Tip');
          const { error } = await replaceUnifiedSale({
            restaurant_id: restaurantId,
            pos_system: 'lighthouse',
            external_order_id: chargeId,
            external_item_id: `${chargeId}-tip-${idx}`,
            item_name: `${tenderType} Tip`,
            item_type: 'tip',
            adjustment_type: 'tip',
            total_price: tipAmount,
            sale_date: saleDateString,
            sale_time: saleTimeString,
            raw_data: p,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (error) {
            console.error(`[${saleDateString}] [Lighthouse Sync] Tip insert error for ${tenderType}:`, error);
            results.errors.push(`[${saleDateString}] Tip insert failed for ${tenderType}: ${error.message}`);
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
