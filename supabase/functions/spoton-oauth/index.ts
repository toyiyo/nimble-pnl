import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SpotOnOAuthRequest {
  action: 'authorize' | 'callback' | 'connect_with_key';
  restaurantId?: string;
  code?: string;
  state?: string;
  apiKey?: string;
  locationId?: string;
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

    const body: SpotOnOAuthRequest = await req.json();
    const { action, restaurantId, code, state, apiKey, locationId } = body;

    const authHeader = req.headers.get('Authorization');
    let user = null;
    
    // For 'authorize' and 'connect_with_key' actions, we need authentication
    if (action === 'authorize' || action === 'connect_with_key') {
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

    // Determine environment based on request origin  
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/');
    let isPreview = false;
    
    // Securely check if origin is from lovableproject.com
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const hostname = originUrl.hostname.toLowerCase();
        // Only match if hostname is exactly lovableproject.com or a subdomain
        isPreview = hostname === 'lovableproject.com' || hostname.endsWith('.lovableproject.com');
      } catch (e) {
        // Invalid URL, default to production
        console.warn('Invalid origin URL:', origin);
        isPreview = false;
      }
    }
    
    // SpotOn API configuration
    const SPOTON_BASE_URL = 'https://enterprise.appetize.com';
    const SPOTON_CLIENT_ID = Deno.env.get('SPOTON_CLIENT_ID');
    const SPOTON_CLIENT_SECRET = Deno.env.get('SPOTON_CLIENT_SECRET');
    
    // Set redirect URI based on environment
    const REDIRECT_URI = isPreview
      ? `${origin}/spoton/callback`
      : 'https://app.easyshifthq.com/spoton/callback';
    
    console.log('SpotOn OAuth - Action:', action, 'Origin:', origin, 'Redirect URI:', REDIRECT_URI);

    if (action === 'connect_with_key') {
      // Direct API key connection (common for SpotOn)
      if (!restaurantId || !apiKey || !locationId) {
        throw new Error('Restaurant ID, API key, and location ID are required');
      }

      // Verify user has access to this restaurant
      const { data: userRestaurant, error: accessError } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', user?.id)
        .eq('restaurant_id', restaurantId)
        .in('role', ['owner', 'manager'])
        .single();

      if (accessError || !userRestaurant) {
        throw new Error('Access denied to restaurant');
      }

      // Test the API key before storing
      const testResponse = await fetch(`${SPOTON_BASE_URL}/ordering/api/orders`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!testResponse.ok) {
        throw new Error('Invalid API key or insufficient permissions');
      }

      // Encrypt API key before storage
      const encryption = await getEncryptionService();
      const encryptedApiKey = await encryption.encrypt(apiKey);

      // Store the connection with encrypted API key
      const connectionData = {
        restaurant_id: restaurantId,
        location_id: locationId,
        api_key_encrypted: encryptedApiKey,
        connected_at: new Date().toISOString(),
      };
      
      const { data: connection, error: connectionError } = await supabase
        .from('spoton_connections')
        .upsert(connectionData, {
          onConflict: 'restaurant_id,location_id'
        })
        .select()
        .single();

      // Log security event
      await logSecurityEvent(supabase, 'SPOTON_API_KEY_STORED', user?.id, restaurantId, {
        locationId: locationId
      });

      if (connectionError) {
        console.error('Error storing SpotOn connection:', connectionError);
        throw new Error(`Failed to store connection: ${connectionError.message}`);
      }

      // Trigger initial data sync
      const syncResponse = await supabase.functions.invoke('spoton-sync-data', {
        body: { restaurantId, action: 'initial_sync' }
      });

      if (syncResponse.error) {
        console.error('Error triggering initial sync:', syncResponse.error);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'SpotOn connection established successfully',
        locationId: locationId
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'authorize') {
      if (!restaurantId) {
        throw new Error('Restaurant ID is required for authorization');
      }

      if (!SPOTON_CLIENT_ID || !SPOTON_CLIENT_SECRET) {
        throw new Error('SpotOn OAuth credentials not configured');
      }

      // Verify user has access to this restaurant
      const { data: userRestaurant, error: accessError } = await supabase
        .from('user_restaurants')
        .select('role')
        .eq('user_id', user?.id)
        .eq('restaurant_id', restaurantId)
        .in('role', ['owner', 'manager'])
        .single();

      if (accessError || !userRestaurant) {
        throw new Error('Access denied to restaurant');
      }

      // Generate authorization URL for OAuth flow
      const scopes = ['orders:read', 'menu:read', 'reporting:read'].join(' ');

      const authUrl = new URL(`${SPOTON_BASE_URL}/oauth/authorize`);
      authUrl.searchParams.set('client_id', SPOTON_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('state', restaurantId); // Use restaurant ID as state

      console.log('Generated SpotOn OAuth URL:', authUrl.toString());

      return new Response(JSON.stringify({
        authorizationUrl: authUrl.toString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'callback') {
      if (!code || !state) {
        console.error('Missing callback parameters:', { code: !!code, state: !!state });
        throw new Error('Missing authorization code or state');
      }

      if (!SPOTON_CLIENT_ID || !SPOTON_CLIENT_SECRET) {
        throw new Error('SpotOn OAuth credentials not configured');
      }

      const restaurantId = state; // Restaurant ID passed as state
      console.log('SpotOn callback processing:', { state, restaurantId });

      // Exchange authorization code for access token
      const tokenRequestBody = {
        client_id: SPOTON_CLIENT_ID,
        client_secret: SPOTON_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      };

      const tokenResponse = await fetch(`${SPOTON_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tokenRequestBody),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('SpotOn token exchange failed:', errorText);
        throw new Error(`Failed to exchange authorization code: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('SpotOn token exchange successful');

      // Get location/merchant info
      const locationResponse = await fetch(`${SPOTON_BASE_URL}/api/locations`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!locationResponse.ok) {
        const errorText = await locationResponse.text();
        console.error('Failed to get location information:', errorText);
        throw new Error('Failed to get location information');
      }

      const locationData = await locationResponse.json();
      const locationId = locationData.locations?.[0]?.id || locationData.location?.id;

      if (!locationId) {
        throw new Error('No location ID found in SpotOn response');
      }

      // Encrypt sensitive tokens before storage
      const encryption = await getEncryptionService();
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token ? 
        await encryption.encrypt(tokenData.refresh_token) : null;

      // Store the connection with encrypted tokens
      const connectionData = {
        restaurant_id: restaurantId,
        location_id: locationId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: tokenData.expires_at ? new Date(tokenData.expires_at).toISOString() : null,
        connected_at: new Date().toISOString(),
      };
      
      const { data: connection, error: connectionError } = await supabase
        .from('spoton_connections')
        .upsert(connectionData, {
          onConflict: 'restaurant_id,location_id'
        })
        .select()
        .single();

      // Log security event
      await logSecurityEvent(supabase, 'SPOTON_OAUTH_TOKEN_STORED', undefined, restaurantId, {
        locationId: locationId
      });

      if (connectionError) {
        console.error('Error storing SpotOn connection:', connectionError);
        throw new Error(`Failed to store connection: ${connectionError.message}`);
      }

      // Trigger initial data sync
      const syncResponse = await supabase.functions.invoke('spoton-sync-data', {
        body: { restaurantId, action: 'initial_sync' }
      });

      if (syncResponse.error) {
        console.error('Error triggering initial sync:', syncResponse.error);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'SpotOn connection established successfully',
        locationId: locationId
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action');

  } catch (error: any) {
    console.error('SpotOn OAuth error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
