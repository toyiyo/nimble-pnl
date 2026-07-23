import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { getEncryptionService } from "../_shared/encryption.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    const { restaurantId } = await req.json();
    if (!restaurantId) return json({ error: 'restaurantId is required' }, 400);

    // Membership check via RLS
    const { data: membership } = await userClient
      .from('revel_connections')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!membership) return json({ error: 'No Revel connection found' }, 404);

    // Read encrypted creds with the service role
    const service = createClient(supabaseUrl, serviceKey);
    const { data: conn } = await service
      .from('revel_connections')
      .select('revel_instance, api_key_encrypted, api_secret_encrypted')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!conn?.api_key_encrypted || !conn?.api_secret_encrypted) {
      return json({ success: false, error: 'No Revel credentials stored for this restaurant' });
    }

    const encryption = await getEncryptionService();
    const apiKey = await encryption.decrypt(conn.api_key_encrypted);
    const apiSecret = await encryption.decrypt(conn.api_secret_encrypted);

    let res: Response;
    try {
      res = await revelFetch(conn.revel_instance, apiKey, apiSecret, '/resources/Order/?limit=1');
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'request timed out (15s)' : (e?.message || 'network error');
      return json({ success: false, error: `Could not reach https://${conn.revel_instance}.revelup.com (${reason})` });
    }
    if (!res.ok) {
      const bodySnippet = (await res.text().catch(() => '')).slice(0, 400);
      return json({ success: false, error: `Revel access check failed (${res.status})`, status: res.status, revelResponse: bodySnippet });
    }

    return json({ success: true, instance: conn.revel_instance });
  } catch (error: any) {
    return json({ success: false, error: error.message }, 200);
  }
});
