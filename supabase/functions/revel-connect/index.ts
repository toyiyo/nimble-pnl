import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";

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

    const { restaurantId, revelInstance, establishmentId } = await req.json();
    if (!restaurantId || !revelInstance) return json({ error: 'restaurantId and revelInstance are required' }, 400);

    // Permission: owner/manager on this restaurant
    const { data: role } = await userClient
      .from('user_restaurants')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'manager'])
      .maybeSingle();
    if (!role) return json({ error: 'Forbidden' }, 403);

    const service = createClient(supabaseUrl, serviceKey);

    // Normalize instance: strip protocol + '.revelup.com' if user pasted a full URL.
    const instance = String(revelInstance)
      .replace(/^https?:\/\//, '')
      .replace(/\.revelup\.com\/?.*$/, '')
      .replace(/\/.*$/, '')
      .trim()
      .toLowerCase();

    // Validate we actually have partner access to this instance.
    const res = await revelFetch(service, instance, '/external/integrations');
    if (!res.ok) {
      await logSecurityEvent(service, 'REVEL_CONNECT_VALIDATION_FAILED', user.id, restaurantId, { instance, status: res.status });
      return json({ error: `Could not verify Revel access for "${instance}". Ensure you authorized EasyShiftHQ in your Revel account.` }, 400);
    }

    const { error: upsertError } = await service.from('revel_connections').upsert({
      restaurant_id: restaurantId,
      revel_instance: instance,
      establishment_id: establishmentId ? String(establishmentId).trim() : '',
      is_active: true,
      connection_status: 'connected',
      webhook_active: true,
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
