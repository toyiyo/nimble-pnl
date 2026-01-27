import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decode JWT payload without verification (just to read claims)
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

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
    const accessToken = authData.token?.accessToken;

    // Log the full auth response structure to help debug
    console.log('Toast auth response structure:', JSON.stringify({
      hasToken: !!authData.token,
      tokenKeys: authData.token ? Object.keys(authData.token) : [],
      topLevelKeys: Object.keys(authData),
      // Check for restaurant info in the response
      restaurants: authData.restaurants,
      restaurantGuids: authData.restaurantGuids,
      scope: authData.scope,
    }));

    // Try to decode the JWT to find restaurant GUIDs in claims
    if (accessToken) {
      const tokenPayload = decodeJwtPayload(accessToken);
      console.log('JWT payload:', JSON.stringify(tokenPayload));

      // Check common claim names for restaurant GUIDs
      const possibleLocations =
        tokenPayload?.restaurantGuids ||
        tokenPayload?.restaurants ||
        tokenPayload?.['toast-restaurant-external-ids'] ||
        tokenPayload?.externalIds ||
        tokenPayload?.scope;

      if (Array.isArray(possibleLocations)) {
        const locations = possibleLocations.map((guid: string, index: number) => ({
          guid: guid,
          name: `Location ${index + 1}`,
          location: ''
        }));

        return new Response(JSON.stringify({
          success: true,
          locations: locations,
          message: 'Found restaurant GUIDs in authentication token'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // If we can't find locations in the token, return empty with helpful message
    return new Response(JSON.stringify({
      success: true,
      locations: [],
      credentialsValid: true,
      message: 'Credentials are valid. Please enter your Restaurant External ID manually - find it in your Toast credential details under "Edit Location IDs".'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching Toast locations:', errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
