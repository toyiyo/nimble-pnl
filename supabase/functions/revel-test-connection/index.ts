import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";

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

    // Read connection via RLS (confirms membership + existence)
    const { data: connection } = await userClient
      .from('revel_connections')
      .select('revel_instance, establishment_id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!connection) return json({ error: 'No Revel connection found' }, 404);

    const service = createClient(supabaseUrl, serviceKey);
    const res = await revelFetch(service, connection.revel_instance, '/external/integrations');
    if (!res.ok) {
      return json({ success: false, error: `Revel access check failed (${res.status})` });
    }

    return json({ success: true, instance: connection.revel_instance });
  } catch (error: any) {
    return json({ success: false, error: error.message }, 200);
  }
});
