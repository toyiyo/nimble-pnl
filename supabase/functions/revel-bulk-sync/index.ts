import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch, fetchOrderItemsByDate, fetchPaymentsByDate } from "../_shared/revelClient.ts";
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
// Wall-clock budget for a targeted (single-restaurant) run so a fresh connect
// backfills as many 3-day batches as fit, then the cron finishes the rest.
const TARGETED_BUDGET_MS = 110_000;

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

/**
 * Sync ONE date-window batch for a connection, then advance its backfill cursor.
 * Mutates conn.sync_cursor / conn.initial_sync_done in memory so a caller can loop.
 * Returns how many orders were processed and whether the backfill is now complete.
 */
async function processConnectionBatch(service: any, encryption: any, conn: any): Promise<{ processed: number; done: boolean; failed: boolean }> {
  const today = new Date();
  let start: string;
  let end: string;

  if (!conn.initial_sync_done) {
    const cursor = conn.sync_cursor ? new Date(conn.sync_cursor) : new Date(today.getTime() - BACKFILL_DAYS * 86400000);
    start = cursor.toISOString().split('T')[0];
    end = new Date(cursor.getTime() + BATCH_DAYS * 86400000).toISOString().split('T')[0];
  } else {
    start = new Date(today.getTime() - 2 * 86400000).toISOString().split('T')[0]; // 48h incremental
    end = today.toISOString().split('T')[0];
  }

  let processed = 0;
  try {
    const apiKey = await encryption.decrypt(conn.api_key_encrypted);
    const apiSecret = await encryption.decrypt(conn.api_secret_encrypted);

    const itemsByOrder = await fetchOrderItemsByDate(conn.revel_instance, apiKey, apiSecret, start, end);
    const paymentsByOrder = await fetchPaymentsByDate(conn.revel_instance, apiKey, apiSecret, start, end);

    let fetchFailedStatus: number | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await revelFetch(conn.revel_instance, apiKey, apiSecret, ordersPath(start, end, page * PAGE_LIMIT));
      if (!res.ok) { fetchFailedStatus = res.status; break; }
      const body = await res.json();
      const orders: any[] = body.objects ?? body.results ?? (Array.isArray(body) ? body : []);
      for (const order of orders) {
        try {
          const oid = String(order.id ?? order.uuid);
          (order as any).OrderItems = itemsByOrder[oid] || [];
          (order as any).Payments = paymentsByOrder[oid] || [];
          await processOrder(service, order, conn.restaurant_id, conn.revel_instance, conn.establishment_id ?? null, { skipUnifiedSalesSync: true });
          processed++;
        } catch (e) {
          console.error(`revel-bulk-sync: failed to process order for restaurant ${conn.restaurant_id}:`, e);
        }
      }
      if (orders.length < PAGE_LIMIT) break;
    }

    if (fetchFailedStatus !== null) {
      await service.from('revel_connections')
        .update({ last_error: `bulk fetch failed: ${fetchFailedStatus}`, last_error_at: new Date().toISOString() })
        .eq('id', conn.id);
      return { processed, done: false, failed: true };
    }

    await service.rpc('sync_revel_to_unified_sales', { p_restaurant_id: conn.restaurant_id, p_start_date: start, p_end_date: end });

    const update: Record<string, unknown> = { last_sync_time: new Date().toISOString(), last_error: null, last_error_at: null };
    if (!conn.initial_sync_done) {
      const nextCursor = new Date(new Date(end).getTime() + 86400000);
      if (nextCursor >= today) {
        update.initial_sync_done = true;
        update.sync_cursor = null;
        conn.initial_sync_done = true;
        conn.sync_cursor = null;
      } else {
        update.sync_cursor = nextCursor.toISOString();
        conn.sync_cursor = nextCursor.toISOString();
      }
    }
    await service.from('revel_connections').update(update).eq('id', conn.id);
    return { processed, done: !!conn.initial_sync_done, failed: false };
  } catch (e: any) {
    await service.from('revel_connections')
      .update({ last_error: e?.message ?? 'bulk sync error', last_error_at: new Date().toISOString() })
      .eq('id', conn.id);
    return { processed, done: false, failed: true };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Optional { restaurantId } targets one connection (used by revel-connect to kick off
  // the initial backfill immediately). No body = cron round-robin over all connections.
  let restaurantId: string | undefined;
  try {
    const body = await req.json();
    restaurantId = body?.restaurantId;
  } catch (_e) { /* no body */ }

  try {
    const encryption = await getEncryptionService();
    let totalProcessed = 0;

    if (restaurantId) {
      const { data: conn } = await service
        .from('revel_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();

      if (!conn?.api_key_encrypted || !conn?.api_secret_encrypted) {
        return json({ error: 'No Revel credentials for that restaurant' }, 400);
      }

      // Loop batches until the 90-day backfill is done or we run out of time budget;
      // any remainder is picked up by the next cron run.
      const startedAt = Date.now();
      let iterations = 0;
      while (Date.now() - startedAt < TARGETED_BUDGET_MS && iterations < 40) {
        iterations++;
        const wasBackfilling = !conn.initial_sync_done;
        const r = await processConnectionBatch(service, encryption, conn);
        totalProcessed += r.processed;
        if (r.failed) break;
        if (!wasBackfilling) break; // already caught up: one incremental batch is enough
        if (r.done) break;          // backfill just completed
      }
      return json({ success: true, mode: 'targeted', restaurantId, ordersProcessed: totalProcessed, initialSyncDone: !!conn.initial_sync_done });
    }

    // Cron: atomically claim a batch of DUE connections (FOR UPDATE SKIP LOCKED via
    // claim_revel_sync_batch) so parallel cron workers never touch the same restaurant.
    const { data: connections } = await service.rpc('claim_revel_sync_batch', { p_limit: MAX_RESTAURANTS_PER_RUN });

    for (const conn of connections ?? []) {
      if (!conn.api_key_encrypted || !conn.api_secret_encrypted) continue;
      const r = await processConnectionBatch(service, encryption, conn);
      totalProcessed += r.processed;

      if (r.failed) {
        // Exponential backoff (5→60 min) so a persistently failing connection doesn't hog slots.
        const failures = (conn.consecutive_failures ?? 0) + 1;
        const backoffMin = Math.min(60, 5 * Math.pow(2, Math.min(failures, 4)));
        await service.from('revel_connections')
          .update({ consecutive_failures: failures, next_attempt_at: new Date(Date.now() + backoffMin * 60000).toISOString() })
          .eq('id', conn.id);
      } else if ((conn.consecutive_failures ?? 0) > 0) {
        await service.from('revel_connections')
          .update({ consecutive_failures: 0, next_attempt_at: null })
          .eq('id', conn.id);
      }
      await new Promise((res) => setTimeout(res, 1000));
    }

    return json({ success: true, mode: 'cron', restaurants: connections?.length ?? 0, ordersProcessed: totalProcessed });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
