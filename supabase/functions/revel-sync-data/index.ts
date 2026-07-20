import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch, fetchOrderItemsByDate, fetchPaymentsByDate } from "../_shared/revelClient.ts";
import { getEncryptionService } from "../_shared/encryption.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Classic Revel order resource + filter field. UNCONFIRMED against a live account —
// isolated here so switching resource/field is a one-line change once we see real data.
const ORDER_RESOURCE = '/resources/OrderAllInOne/';
const DATE_FIELD = 'created_date';
const PAGE_LIMIT = 100;
const MAX_PAGES = 20; // safety cap per invocation

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function ordersPath(start: string, end: string, offset: number): string {
  const params = new URLSearchParams({
    [`${DATE_FIELD}__gte`]: `${start}T00:00:00`,
    [`${DATE_FIELD}__lte`]: `${end}T23:59:59`,
    limit: String(PAGE_LIMIT),
    offset: String(offset),
    order_by: DATE_FIELD,
  });
  return `${ORDER_RESOURCE}?${params.toString()}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { restaurantId, startDate, endDate } = await req.json();
    if (!restaurantId) return json({ error: 'restaurantId is required' }, 400);

    // Membership via RLS
    const { data: membership } = await userClient
      .from('revel_connections')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!membership) return json({ error: 'No Revel connection found' }, 404);

    const service = createClient(supabaseUrl, serviceKey);
    const { data: conn } = await service
      .from('revel_connections')
      .select('revel_instance, establishment_id, api_key_encrypted, api_secret_encrypted')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!conn?.api_key_encrypted || !conn?.api_secret_encrypted) {
      return json({ error: 'No Revel credentials stored for this restaurant' }, 400);
    }

    const encryption = await getEncryptionService();
    const apiKey = await encryption.decrypt(conn.api_key_encrypted);
    const apiSecret = await encryption.decrypt(conn.api_secret_encrypted);

    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Classic Revel keeps line items in a separate resource — fetch them for the range
    // once and join by order id (Order/OrderAllInOne carry only headers).
    const itemsByOrder = await fetchOrderItemsByDate(conn.revel_instance, apiKey, apiSecret, start, end);
    const paymentsByOrder = await fetchPaymentsByDate(conn.revel_instance, apiKey, apiSecret, start, end);

    let processed = 0;
    let loggedSample = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await revelFetch(conn.revel_instance, apiKey, apiSecret, ordersPath(start, end, page * PAGE_LIMIT));
      if (!res.ok) {
        await service.from('revel_connections')
          .update({ last_error: `sync failed: ${res.status}`, last_error_at: new Date().toISOString() })
          .eq('restaurant_id', restaurantId);
        return json({ error: `Revel order fetch failed (${res.status})` }, 502);
      }
      const body = await res.json();
      const orders: any[] = body.objects ?? body.results ?? (Array.isArray(body) ? body : []);
      if (!loggedSample && orders.length) {
        // One-time shape probe to iterate normalizeOrder against real data.
        console.log('revel-sync-data: first order object sample:', JSON.stringify(orders[0]).slice(0, 3000));
        loggedSample = true;
      }
      for (const order of orders) {
        try {
          const oid = String(order.id ?? order.uuid);
          (order as any).OrderItems = itemsByOrder[oid] || [];
          (order as any).Payments = paymentsByOrder[oid] || [];
          await processOrder(service, order, restaurantId, conn.revel_instance, conn.establishment_id ?? null, { skipUnifiedSalesSync: true });
          processed++;
        } catch (e) {
          console.error(`revel-sync-data: failed to process order for restaurant ${restaurantId}:`, e);
        }
      }
      if (orders.length < PAGE_LIMIT) break;
    }

    const { data: synced } = await service.rpc('sync_revel_to_unified_sales', {
      p_restaurant_id: restaurantId,
      p_start_date: start,
      p_end_date: end,
    });

    await service.from('revel_connections')
      .update({ last_sync_time: new Date().toISOString(), last_error: null, last_error_at: null })
      .eq('restaurant_id', restaurantId);

    return json({ success: true, ordersProcessed: processed, salesSynced: Number(synced) || 0 });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
