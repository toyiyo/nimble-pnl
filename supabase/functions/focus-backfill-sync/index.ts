/**
 * focus-backfill-sync/index.ts
 *
 * Edge function: cron-triggered durable backfill engine for Focus POS Lynk connections.
 *
 * This thin entry point reads Deno environment variables, builds the injectable
 * deps (service-role client, sleep, now, serviceRoleKey), and delegates all
 * business logic to focusBackfillSyncHandler.ts.
 *
 * Auth model: verify_jwt = false (cron callers don't send JWTs). Access is
 * gated by a timing-safe Bearer token check against SUPABASE_SERVICE_ROLE_KEY
 * inside the handler (lesson 2026-05-07).
 *
 * Schedule: every 5 minutes — "* /5 * * * *" (idiomatic for fast backfill).
 * No-op when no connections have initial_sync_done=false AND api_key IS NOT NULL.
 *
 * Design ref: plan B4; spec §5.3 (focus-backfill-sync).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleBackfillSync } from '../_shared/focusBackfillSyncHandler.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // ── CORS pre-flight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Fail closed: if either config var is absent the Bearer gate would pass
    // timingSafeEqual('', '') — reject immediately before creating any client.
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('focus-backfill-sync: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role client: used for all reads + writes (bypasses RLS).
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const res = await handleBackfillSync(req, {
      serviceClient,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      serviceRoleKey: supabaseServiceKey,
      sandboxBaseUrl: Deno.env.get('FOCUS_API_SANDBOX_URL') || undefined,
    });

    // Attach CORS headers to the handler's response.
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsHeaders,
        ...Object.fromEntries(res.headers.entries()),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('focus-backfill-sync: unexpected error:', message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
