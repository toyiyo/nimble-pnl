/**
 * focus-test-connection/index.ts
 *
 * Edge function: test an existing Focus POS connection by fetching yesterday's
 * Revenue Center report and writing the result to connection_status.
 *
 * This thin entry point handles CORS pre-flight, builds the injectable deps
 * (user-scoped client + service-role client + fetch), and delegates all
 * business logic to focusTestConnectionHandler.ts.
 *
 * Auth model: verify_jwt = false (so the function receives the raw JWT and
 * validates it itself via userClient.auth.getUser() — mirroring
 * focus-save-connection). The caller MUST still send a valid Supabase JWT
 * in the Authorization header; the handler returns 401 if it is missing or
 * invalid.
 *
 * Design ref: Plan Task 8; spec §8 (focus-test-connection).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleTestConnection } from '../_shared/focusTestConnectionHandler.ts';
// Deno server runtime does NOT have globalThis.DOMParser (browser-only API).
// Import deno_dom so we can pass a working DOMParser to parseRevenueCenterReport.
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.43/deno-dom-wasm.ts';

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

    const res = await handleTestConnection(req, {
      userClient,
      serviceClient,
      fetch: globalThis.fetch,
      domParser: new DOMParser(),
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
    console.error('focus-test-connection: unexpected error:', message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
