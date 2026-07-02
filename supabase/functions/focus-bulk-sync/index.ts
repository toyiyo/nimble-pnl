/**
 * focus-bulk-sync/index.ts
 *
 * Edge function: cron-triggered round-robin sync of active Focus POS connections.
 *
 * This thin entry point reads Deno environment variables, builds the injectable
 * deps (service-role client, fetch, sleep, now, serviceRoleKey), and delegates
 * all business logic to focusBulkSyncHandler.ts.
 *
 * Auth model: verify_jwt = false (cron callers don't send JWTs). Access is
 * gated by a timing-safe Bearer token check against SUPABASE_SERVICE_ROLE_KEY
 * inside the handler (lesson 2026-05-07).
 *
 * Design ref: plan Task 10; spec §8 (focus-bulk-sync), §9 (sync orchestration);
 * review S5 (LIMIT 5, round-robin).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleBulkSync } from '../_shared/focusBulkSyncHandler.ts';
import { makeFocusHttpFetch } from '../_shared/focusHttpFetch.ts';
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

    // Service-role client: used for all reads + writes (bypasses RLS per review S3).
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const res = await handleBulkSync(req, {
      serviceClient,
      fetch: makeFocusHttpFetch(serviceClient),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      serviceRoleKey: supabaseServiceKey,
      sandboxBaseUrl: Deno.env.get('FOCUS_API_SANDBOX_URL') || undefined,
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
    console.error('focus-bulk-sync: unexpected error:', message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
