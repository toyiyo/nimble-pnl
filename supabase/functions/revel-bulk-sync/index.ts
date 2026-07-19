import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch, fetchOrderItemsByDate } from "../_shared/revelClient.ts";
import { getEncryptionService } from "../_shared/encryption.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESTAURANTS_PER_RUN = 5;
const BACKFILL_DAYS = 90;
const BATCH_DAYS = 3;
const ORDER_RESOURCE = '/resources/OrderAllInOne/';
const DATE_FIELD = 'created_date';
const PAGE_LIMIT = 200;
const MAX_PAGES = 20;

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

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const encryption = await getEncryptionService();

    const { data: connections } = await service
      .from('revel_connections')
      .select('*')
      .eq('is_active', true)
      .order('last_sync_time', { ascending: true, nullsFirst: true })
      .limit(MAX_RESTAURANTS_PER_RUN);

    let totalProcessed = 0;

    for (const conn of connections ?? []) {
      if (!conn.api_key_encrypted || !conn.api_secret_encrypted) continue;

      let start: string;
      let end: string;
      const today = new Date();

      if (!conn.initial_sync_done) {
        const cursor = conn.sync_cursor ? new Date(conn.sync_cursor) : new Date(today.getTime() - BACKFILL_DAYS * 86400000);
        start = cursor.toISOString().split('T')[0];
        end = new Date(cursor.getTime() + BATCH_DAYS * 86400000).toISOString().split('T')[0];
      } else {
        start = new Date(today.getTime() - 2 * 86400000).toISOString().split('T')[0];
        end = today.toISOString().split('T')[0];
      }

      try {
        const apiKey = await encryption.decrypt(conn.api_key_encrypted);
        const apiSecret = await encryption.decrypt(conn.api_secret_encrypted);

        // Line items live in a separate resource — fetch them for this window once and join by order id.
        const itemsByOrder = await fetchOrderItemsByDate(conn.revel_instance, apiKey, apiSecret, start, end);

        let fetchFailedStatus: number | null = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await revelFetch(conn.revel_instance, apiKey, apiSecret, ordersPath(start, end, page * PAGE_LIMIT));
          if (!res.ok) { fetchFailedStatus = res.status; break; }
          const body = await res.json();
          const orders: any[] = body.objects ?? body.results ?? (Array.isArray(body) ? body : []);
          for (const order of orders) {
            try {
              (order as any).OrderItems = itemsByOrder[String(order.id ?? order.uuid)] || [];
              await processOrder(service, order, conn.restaurant_id, conn.revel_instance, conn.establishment_id ?? null, { skipUnifiedSalesSync: true });
              totalProcessed++;
            } catch (e) {
              console.error(`revel-bulk-sync: failed to process order for restaurant ${conn.restaurant_id}:`, e);
            }
          }
          if (orders.length < PAGE_LIMIT) break;
        }

        if (fetchFailedStatus !== null) {
          // Do NOT advance the cursor on a failed fetch — record and retry next run.
          await service.from('revel_connections')
            .update({ last_error: `bulk fetch failed: ${fetchFailedStatus}`, last_error_at: new Date().toISOString() })
            .eq('id', conn.id);
        } else {
          await service.rpc('sync_revel_to_unified_sales', { p_restaurant_id: conn.restaurant_id, p_start_date: start, p_end_date: end });

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
        }
      } catch (e: any) {
        await service.from('revel_connections')
          .update({ last_error: e?.message ?? 'bulk sync error', last_error_at: new Date().toISOString() })
          .eq('id', conn.id);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    return json({ success: true, restaurants: connections?.length ?? 0, ordersProcessed: totalProcessed });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
