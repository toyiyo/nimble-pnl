// Public edge function — receives one-click unsubscribe POSTs from the
// /unsubscribe page. JWT verification is disabled in config.toml because
// the request is authorized by the HMAC token, not Supabase auth.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  processUnsubscribe,
  type UnsubInsertFn,
} from '../_shared/unsubscribeHandler.ts';
import type { UnsubList } from '../_shared/unsubscribeToken.ts';

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' };

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: JSON_HEADERS }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tokenSecret = Deno.env.get('UNSUBSCRIBE_TOKEN_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !tokenSecret) {
    console.error('[unsubscribe-email] missing required env');
    return new Response(
      JSON.stringify({ error: 'Service not configured' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  let body: { token?: string; list?: UnsubList };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: JSON_HEADERS }
    );
  }
  if (!body.token || !body.list) {
    return new Response(
      JSON.stringify({ error: 'Missing token or list' }),
      { status: 400, headers: JSON_HEADERS }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const insert: UnsubInsertFn = async (row) => {
    const { error } = await supabase
      .from('email_unsubscribes')
      .upsert(row, { onConflict: 'user_id,list', ignoreDuplicates: true });
    return { error: error ? { message: error.message } : null };
  };

  const result = await processUnsubscribe(
    { token: body.token, list: body.list },
    { secret: tokenSecret, insert }
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: JSON_HEADERS,
  });
});
