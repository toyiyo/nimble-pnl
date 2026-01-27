import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { restaurantId, clientId, clientSecret } = await req.json();

    if (!restaurantId || !clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user has permission
    const { data: userRestaurant } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (!userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authenticate with Toast
    const authResponse = await fetch('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: clientId,
        clientSecret: clientSecret,
        userAccessType: 'TOAST_MACHINE_CLIENT'
      })
    });

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('Toast auth failed:', errorText);
      return new Response(JSON.stringify({
        error: 'Authentication failed. Please check your Client ID and Client Secret.',
        details: errorText
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authData = await authResponse.json();
    const accessToken = authData.token.accessToken;

    // Fetch accessible restaurants/locations
    // The Toast API returns restaurants that the credentials have access to
    const restaurantsResponse = await fetch('https://ws-api.toasttab.com/restaurants/v1/restaurants', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!restaurantsResponse.ok) {
      const errorText = await restaurantsResponse.text();
      console.error('Failed to fetch Toast restaurants:', errorText);

      // If we can't fetch the list, return empty - user may need to enter manually
      return new Response(JSON.stringify({
        success: true,
        locations: [],
        message: 'Could not automatically fetch locations. Please enter your Location ID manually.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const restaurantsData = await restaurantsResponse.json();

    // Map to a simpler format
    const locations = (restaurantsData || []).map((r: any) => ({
      guid: r.guid || r.restaurantGuid,
      name: r.name || r.restaurantName,
      location: r.location?.address1 || r.address?.address1 || ''
    }));

    return new Response(JSON.stringify({
      success: true,
      locations: locations
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error fetching Toast locations:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
