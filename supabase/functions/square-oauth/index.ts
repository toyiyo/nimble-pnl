import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

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

    // Determine environment and URLs based on request origin
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/');
    const isPreview = origin && origin.includes('lovableproject.com');
    
    // TEMPORARY: Force sandbox for testing - remove this when ready for production
    const forceSandbox = true;
    
    // Use appropriate credentials based on environment
    const SQUARE_ENVIRONMENT = (isPreview || forceSandbox) ? 'sandbox' : 'production';
    const SQUARE_APPLICATION_ID = (isPreview || forceSandbox)
      ? Deno.env.get('SQUARE_SANDBOX_APPLICATION_ID')
      : Deno.env.get('SQUARE_APPLICATION_ID');
    const SQUARE_APPLICATION_SECRET = (isPreview || forceSandbox)
      ? Deno.env.get('SQUARE_SANDBOX_APPLICATION_SECRET')
      : Deno.env.get('SQUARE_APPLICATION_SECRET');
    
    // Use environment-specific hosts
    const SQUARE_CONNECT_HOST = (isPreview || forceSandbox) ? 'connect.squareupsandbox.com' : 'connect.squareup.com';
    const SQUARE_API_HOST = (isPreview || forceSandbox) ? 'connect.squareupsandbox.com' : 'connect.squareup.com';
    
    let REDIRECT_URI;
    if (isPreview || forceSandbox) {
      REDIRECT_URI = `${origin}/square/callback`;
    } else {
      REDIRECT_URI = 'https://app.easyshifthq.com/square/callback';
    }
    
    console.log('Square OAuth - Action:', action, 'Environment:', SQUARE_ENVIRONMENT, 'Origin:', origin, 'Redirect URI:', REDIRECT_URI);

    if (!SQUARE_APPLICATION_ID || !SQUARE_APPLICATION_SECRET) {
      console.error('Square credentials missing:', {
        hasAppId: !!SQUARE_APPLICATION_ID,
        hasAppSecret: !!SQUARE_APPLICATION_SECRET,
        environment: SQUARE_ENVIRONMENT
      });
      throw new Error(`Square credentials not configured for ${SQUARE_ENVIRONMENT} environment`);
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
        'ITEMS_READ',
        'INVENTORY_READ',
        'MERCHANT_PROFILE_READ',
        'EMPLOYEES_READ',
        'TIMECARDS_READ'
      ].join(' ');

      const authUrl = new URL(`https://${SQUARE_CONNECT_HOST}/oauth2/authorize`);
      authUrl.searchParams.set('client_id', SQUARE_APPLICATION_ID);
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('session', 'false');
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('state', restaurantId); // Use restaurant ID as state

      console.log('Generated Square OAuth URL:', authUrl.toString(), '(Environment:', SQUARE_ENVIRONMENT + ')');

      return new Response(JSON.stringify({
        authorizationUrl: authUrl.toString(),
        environment: SQUARE_ENVIRONMENT,
        debug: {
          clientId: SQUARE_APPLICATION_ID,
          redirectUri: REDIRECT_URI,
          host: SQUARE_CONNECT_HOST
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'callback') {
      if (!code || !state) {
        console.error('Missing callback parameters:', { code: !!code, state: !!state });
        throw new Error('Missing authorization code or state');
      }

      const restaurantId = state; // Restaurant ID passed as state
      console.log('Square callback processing:', { code: code.substring(0, 20) + '...', state, restaurantId });

      // Exchange authorization code for access token
      const tokenRequestBody = {
        client_id: SQUARE_APPLICATION_ID,
        client_secret: SQUARE_APPLICATION_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      };

      console.log('Token exchange request:', {
        client_id: SQUARE_APPLICATION_ID,
        redirect_uri: REDIRECT_URI,
        code_length: code.length
      });

      const tokenResponse = await fetch(`https://${SQUARE_API_HOST}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18',
        },
        body: JSON.stringify(tokenRequestBody),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Square token exchange failed:', {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          error: errorText,
          redirect_uri: REDIRECT_URI
        });
        throw new Error(`Failed to exchange authorization code: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Square token exchange successful');

      // Get merchant info
      const merchantResponse = await fetch(`https://${SQUARE_API_HOST}/v2/merchants`, {
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

      // Encrypt sensitive tokens before storage
      const encryption = await getEncryptionService();
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token ? 
        await encryption.encrypt(tokenData.refresh_token) : null;

      // Store the connection with encrypted tokens
      const { data: connection, error: connectionError } = await supabase
        .from('square_connections')
        .upsert({
          restaurant_id: restaurantId,
          merchant_id: merchant.id,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          scopes: tokenData.scope?.split(' ') || [],
          expires_at: tokenData.expires_at ? new Date(tokenData.expires_at).toISOString() : null,
          connected_at: new Date().toISOString(),
        }, {
          onConflict: 'restaurant_id,merchant_id'
        })
        .select()
        .single();

      // Log security event
      await logSecurityEvent(supabase, 'SQUARE_OAUTH_TOKEN_STORED', null, restaurantId, {
        merchantId: merchant.id,
        scopes: tokenData.scope?.split(' ') || []
      });

      if (connectionError) {
        console.error('Error storing Square connection:', connectionError);
        throw new Error('Failed to store connection');
      }

      // Get and store locations
      const locationsResponse = await fetch(`https://${SQUARE_API_HOST}/v2/locations`, {
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