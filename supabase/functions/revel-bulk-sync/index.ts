import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESTAURANTS_PER_RUN = 5;
const BACKFILL_DAYS = 90;
const BATCH_DAYS = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function ordersPath(startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    'created_date__gte': `${startDate}T00:00:00`,
    'created_date__lte': `${endDate}T23:59:59`,
    'limit': '200',
  });
  return `/resources/Order/?${params.toString()}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // Round-robin: oldest last_sync_time first
    const { data: connections } = await service
      .from('revel_connections')
      .select('*')
      .eq('is_active', true)
      .order('last_sync_time', { ascending: true, nullsFirst: true })
      .limit(MAX_RESTAURANTS_PER_RUN);

    let totalProcessed = 0;

    for (const conn of connections ?? []) {
      // Determine the window: initial backfill vs incremental
      let start: string;
      let end: string;
      const today = new Date();

      if (!conn.initial_sync_done) {
        const cursor = conn.sync_cursor ? new Date(conn.sync_cursor) : new Date(today.getTime() - BACKFILL_DAYS * 86400000);
        start = cursor.toISOString().split('T')[0];
        end = new Date(cursor.getTime() + BATCH_DAYS * 86400000).toISOString().split('T')[0];
      } else {
        start = new Date(today.getTime() - 2 * 86400000).toISOString().split('T')[0]; // 48h incremental
        end = today.toISOString().split('T')[0];
      }

      try {
        const res = await revelFetch(service, conn.revel_instance, ordersPath(start, end));
        if (res.ok) {
          const body = await res.json();
          const orders: any[] = body.objects ?? body.results ?? body.orders ?? (Array.isArray(body) ? body : []);
          for (const order of orders) {
            try {
              await processOrder(service, order, conn.restaurant_id, conn.revel_instance, conn.establishment_id ?? null, { skipUnifiedSalesSync: true });
              totalProcessed++;
            } catch (_e) { /* continue */ }
          }
          await service.rpc('sync_revel_to_unified_sales', { p_restaurant_id: conn.restaurant_id, p_start_date: start, p_end_date: end });
        }

        // Advance cursor / mark backfill complete
        const update: Record<string, unknown> = { last_sync_time: new Date().toISOString(), last_error: null, last_error_at: null };
        if (!conn.initial_sync_done) {
          const nextCursor = new Date(new Date(end).getTime() + 86400000);
          if (nextCursor >= today) {
            update.initial_sync_done = true;
            update.sync_cursor = null;
          } else {
            update.sync_cursor = nextCursor.toISOString();
          }
        }
        await service.from('revel_connections').update(update).eq('id', conn.id);
      } catch (e: any) {
        await service.from('revel_connections')
          .update({ last_error: e?.message ?? 'bulk sync error', last_error_at: new Date().toISOString() })
          .eq('id', conn.id);
      }

      // Gentle pacing between merchants (rate-limit friendliness)
      await new Promise((r) => setTimeout(r, 2000));
    }

    return json({ success: true, restaurants: connections?.length ?? 0, ordersProcessed: totalProcessed });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
