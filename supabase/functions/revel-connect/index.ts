import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { getEncryptionService } from "../_shared/encryption.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Normalize a user-supplied Revel URL or subdomain to just the subdomain slug. */
function normalizeInstance(input: string): string {
  return String(input)
    .replace(/^https?:\/\//, '')
    .replace(/\.revelup\.com\/?.*$/, '')
    .replace(/\/.*$/, '')
    .trim()
    .toLowerCase();
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

    const { restaurantId, revelInstance, apiKey, apiSecret, establishmentId } = await req.json();
    if (!restaurantId || !revelInstance || !apiKey || !apiSecret) {
      return json({ error: 'restaurantId, revelInstance, apiKey and apiSecret are required' }, 400);
    }

    // Permission: owner/manager on this restaurant
    const { data: role } = await userClient
      .from('user_restaurants')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'manager'])
      .maybeSingle();
    if (!role) return json({ error: 'Forbidden' }, 403);

    const instance = normalizeInstance(revelInstance);
    if (!instance) return json({ error: 'Could not parse a Revel subdomain from the URL provided' }, 400);

    const service = createClient(supabaseUrl, serviceKey);

    // Validate the credentials against the merchant's own Classic API.
    let res: Response;
    try {
      res = await revelFetch(instance, String(apiKey).trim(), String(apiSecret).trim(), '/resources/Establishment/?limit=1');
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'request timed out (15s)' : (e?.message || 'network error');
      await logSecurityEvent(service, 'REVEL_CONNECT_UNREACHABLE', user.id, restaurantId, { instance, reason });
      return json({ error: `Could not reach https://${instance}.revelup.com (${reason}). Check the Revel URL/subdomain.` }, 502);
    }
    if (!res.ok) {
      const bodySnippet = (await res.text().catch(() => '')).slice(0, 400);
      await logSecurityEvent(service, 'REVEL_CONNECT_VALIDATION_FAILED', user.id, restaurantId, { instance, status: res.status, body: bodySnippet });
      return json({
        error: `Revel rejected GET https://${instance}.revelup.com/resources/Establishment/ (status ${res.status}). Double-check the URL, API key, and secret.`,
        status: res.status,
        revelResponse: bodySnippet,
      }, 400);
    }

    const encryption = await getEncryptionService();
    const apiKeyEncrypted = await encryption.encrypt(String(apiKey).trim());
    const apiSecretEncrypted = await encryption.encrypt(String(apiSecret).trim());

    const { error: upsertError } = await service.from('revel_connections').upsert({
      restaurant_id: restaurantId,
      revel_instance: instance,
      establishment_id: establishmentId ? String(establishmentId).trim() : '',
      api_key_encrypted: apiKeyEncrypted,
      api_secret_encrypted: apiSecretEncrypted,
      is_active: true,
      connection_status: 'connected',
      webhook_active: false,
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,revel_instance,establishment_id' });

    if (upsertError) return json({ error: upsertError.message }, 500);

    await logSecurityEvent(service, 'REVEL_CONNECTED', user.id, restaurantId, { instance });
    return json({ success: true, instance });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
