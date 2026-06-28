/**
 * focus-sync-data/index.ts
 *
 * Edge function: manually trigger a Focus POS sync for one business day.
 *
 * This thin entry point handles CORS pre-flight, builds the injectable deps
 * (user-scoped client + service-role client + fetch), and delegates all
 * business logic to focusSyncDataHandler.ts.
 *
 * Sync mode is determined by the connection row:
 *   - initial_sync_done=false → backfill (one cursor day per call, up to 90 days)
 *   - initial_sync_done=true  → incremental (last 2 business days, idempotent)
 *
 * Auth model: verify_jwt = false (so the function receives the raw JWT and
 * validates it itself via userClient.auth.getUser() — mirroring
 * focus-save-connection and focus-test-connection). The caller MUST still
 * send a valid Supabase JWT in the Authorization header; the handler returns
 * 401 if it is missing or invalid.
 *
 * Design ref: Plan Task 9; spec §8 (focus-sync-data), §9 (sync orchestration).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleSyncData } from '../_shared/focusSyncDataHandler.ts';

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
    const authHeader = req.headers.get('Authorization') ?? '';

    // User-scoped client: passes the caller's JWT so auth.getUser() validates it.
    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client: used for all reads + writes (bypasses RLS per review S3).
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const res = await handleSyncData(req, {
      userClient,
      serviceClient,
      fetch: globalThis.fetch,
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
    console.error('focus-sync-data: unexpected error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
