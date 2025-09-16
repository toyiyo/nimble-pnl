import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SquareOAuthRequest {
  action: 'authorize' | 'callback';
  restaurantId?: string;
  code?: string;
  state?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: SquareOAuthRequest = await req.json();
    const { action, restaurantId, code, state } = body;

    const authHeader = req.headers.get('Authorization');
    let user = null;
    
    // For 'authorize' action, we need authentication
    if (action === 'authorize') {
      if (!authHeader) {
        throw new Error('No authorization header');
      }
      
      // Get user from auth header
      const token = authHeader.replace('Bearer ', '');
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authUser) {
        throw new Error('Invalid authentication');
      }
      user = authUser;
    }

    const SQUARE_APPLICATION_ID = Deno.env.get('SQUARE_APPLICATION_ID');
    const SQUARE_APPLICATION_SECRET = Deno.env.get('SQUARE_APPLICATION_SECRET');
    const REDIRECT_URI = `${req.headers.get('origin')}/square/callback`;

    if (!SQUARE_APPLICATION_ID || !SQUARE_APPLICATION_SECRET) {
      throw new Error('Square credentials not configured');
    }

    console.log('Square OAuth action:', action, 'Restaurant ID:', restaurantId);

    if (action === 'authorize') {
      if (!restaurantId) {
        throw new Error('Restaurant ID is required for authorization');
      }

      // Verify user has access to this restaurant
      const { data: userRestaurant, error: accessError } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId)
        .in('role', ['owner', 'manager'])
        .single();

      if (accessError || !userRestaurant) {
        throw new Error('Access denied to restaurant');
      }

      // Generate authorization URL
      const scopes = [
        'ORDERS_READ',
        'PAYMENTS_READ', 
        'REFUNDS_READ',
        'ITEMS_READ',
        'INVENTORY_READ',
        'BUSINESS_READ',
        'TEAM_READ',
        'LABOR_READ'
      ].join(' ');

      const authUrl = new URL('https://connect.squareup.com/oauth2/authorize');
      authUrl.searchParams.set('client_id', SQUARE_APPLICATION_ID);
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('session', 'false');
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('state', restaurantId); // Use restaurant ID as state

      console.log('Generated Square OAuth URL:', authUrl.toString());

      return new Response(JSON.stringify({
        authorizationUrl: authUrl.toString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'callback') {
      if (!code || !state) {
        throw new Error('Missing authorization code or state');
      }

      const restaurantId = state; // Restaurant ID passed as state

      // For callback, we don't require user authentication since they might lose session during OAuth flow
      // We'll verify restaurant access later when needed

      // Exchange authorization code for access token
      const tokenResponse = await fetch('https://connect.squareup.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18',
        },
        body: JSON.stringify({
          client_id: SQUARE_APPLICATION_ID,
          client_secret: SQUARE_APPLICATION_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Square token exchange failed:', errorText);
        throw new Error('Failed to exchange authorization code');
      }

      const tokenData = await tokenResponse.json();
      console.log('Square token exchange successful');

      // Get merchant info
      const merchantResponse = await fetch('https://connect.squareup.com/v2/merchants', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Square-Version': '2024-12-18',
        },
      });

      if (!merchantResponse.ok) {
        throw new Error('Failed to get merchant information');
      }

      const merchantData = await merchantResponse.json();
      const merchant = merchantData.merchant;

      console.log('Retrieved merchant info:', merchant.id);

      // Store the connection
      const { data: connection, error: connectionError } = await supabase
        .from('square_connections')
        .upsert({
          restaurant_id: restaurantId,
          merchant_id: merchant.id,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          scopes: tokenData.scope?.split(' ') || [],
          expires_at: tokenData.expires_at ? new Date(tokenData.expires_at).toISOString() : null,
          connected_at: new Date().toISOString(),
        }, {
          onConflict: 'restaurant_id,merchant_id'
        })
        .select()
        .single();

      if (connectionError) {
        console.error('Error storing Square connection:', connectionError);
        throw new Error('Failed to store connection');
      }

      // Get and store locations
      const locationsResponse = await fetch('https://connect.squareup.com/v2/locations', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Square-Version': '2024-12-18',
        },
      });

      if (locationsResponse.ok) {
        const locationsData = await locationsResponse.json();
        const locations = locationsData.locations || [];

        console.log(`Found ${locations.length} Square locations`);

        // Store locations
        for (const location of locations) {
          await supabase
            .from('square_locations')
            .upsert({
              connection_id: connection.id,
              restaurant_id: restaurantId,
              location_id: location.id,
              name: location.name,
              timezone: location.timezone,
              currency: location.currency,
              address: location.address || null,
            }, {
              onConflict: 'restaurant_id,location_id'
            });
        }
      }

      // Trigger initial data sync
      const syncResponse = await supabase.functions.invoke('square-sync-data', {
        body: { restaurantId, action: 'initial_sync' }
      });

      if (syncResponse.error) {
        console.error('Error triggering initial sync:', syncResponse.error);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Square connection established successfully',
        merchantId: merchant.id,
        locationsCount: merchantData.locations?.length || 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action');

  } catch (error: any) {
    console.error('Square OAuth error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});