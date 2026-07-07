import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// NOTE: the exact order-list endpoint + query params are confirmed against Revel's data
// dictionary (wide_order) during first live sync. Isolated here so only this URL changes.
function ordersPath(startDate: string, endDate: string): string {
  // Revel filtering uses double-underscore operators (spec/FAQ): created_date__gte / __lte.
  const params = new URLSearchParams({
    'created_date__gte': `${startDate}T00:00:00`,
    'created_date__lte': `${endDate}T23:59:59`,
    'limit': '100',
  });
  return `/resources/Order/?${params.toString()}`;
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

    const { data: connection } = await userClient
      .from('revel_connections')
      .select('revel_instance, establishment_id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!connection) return json({ error: 'No Revel connection found' }, 404);

    const service = createClient(supabaseUrl, serviceKey);

    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const res = await revelFetch(service, connection.revel_instance, ordersPath(start, end));
    if (!res.ok) {
      await service.from('revel_connections')
        .update({ last_error: `sync failed: ${res.status}`, last_error_at: new Date().toISOString() })
        .eq('restaurant_id', restaurantId);
      return json({ error: `Revel order fetch failed (${res.status})` }, 502);
    }

    const body = await res.json();
    const orders: any[] = body.objects ?? body.results ?? body.orders ?? (Array.isArray(body) ? body : []);

    let processed = 0;
    for (const order of orders) {
      try {
        await processOrder(service, order, restaurantId, connection.revel_instance, connection.establishment_id ?? null, { skipUnifiedSalesSync: true });
        processed++;
      } catch (_e) { /* skip a bad order, continue */ }
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
