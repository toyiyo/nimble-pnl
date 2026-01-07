import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getEncryptionService } from "../_shared/encryption.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { restaurantId } = await req.json();

    if (!restaurantId) {
      return new Response(JSON.stringify({ error: 'Missing restaurantId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get connection
    const { data: connection, error: connectionError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .single();

    if (connectionError || !connection) {
      return new Response(JSON.stringify({ error: 'No Toast connection found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Decrypt credentials
    const encryption = await getEncryptionService();
    const clientSecret = await encryption.decrypt(connection.client_secret_encrypted);

    // Get access token
    const authResponse = await fetch('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: connection.client_id,
        clientSecret: clientSecret,
        userAccessType: 'TOAST_MACHINE_CLIENT'
      })
    });

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      throw new Error(`Authentication failed: ${errorText}`);
    }

    const authData = await authResponse.json();
    const accessToken = authData.token.accessToken;
    
    // Cache token
    const encryptedToken = await encryption.encrypt(accessToken);
    const expiresAt = new Date(Date.now() + (authData.token.expiresIn * 1000));
    
    await supabase.from('toast_connections').update({
      access_token_encrypted: encryptedToken,
      token_expires_at: expiresAt.toISOString(),
      token_fetched_at: new Date().toISOString(),
      connection_status: 'connected',
      last_error: null,
      last_error_at: null
    }).eq('id', connection.id);

    // Test API by fetching restaurant info
    const restaurantResponse = await fetch(
      `https://ws-api.toasttab.com/restaurants/v1/restaurants/${connection.toast_restaurant_guid}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Toast-Restaurant-External-ID': connection.toast_restaurant_guid
        }
      }
    );

    if (!restaurantResponse.ok) {
      const errorText = await restaurantResponse.text();
      throw new Error(`Restaurant API test failed: ${errorText}`);
    }

    const restaurantData = await restaurantResponse.json();

    return new Response(JSON.stringify({
      success: true,
      restaurantName: restaurantData.name || restaurantData.restaurantName,
      restaurantGuid: connection.toast_restaurant_guid
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error testing Toast connection:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
