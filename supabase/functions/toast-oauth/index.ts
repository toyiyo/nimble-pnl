import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ToastOAuthRequest {
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

    const body: ToastOAuthRequest = await req.json();
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

    // Determine environment based on request origin  
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('/').slice(0, 3).join('/');
    let isSandbox = false;
    
    // Securely check if origin is from lovableproject.com or development
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const hostname = originUrl.hostname.toLowerCase();
        isSandbox = hostname === 'lovableproject.com' || 
                   hostname.endsWith('.lovableproject.com') ||
                   hostname.endsWith('.lovable.app') ||
                   hostname.endsWith('.vercel.app') ||
                   hostname === 'localhost';
      } catch (e) {
        console.warn('Invalid origin URL:', origin);
        isSandbox = false;
      }
    }
    
    // Use sandbox for preview/development, production for app.easyshifthq.com
    const TOAST_ENVIRONMENT = isSandbox ? 'sandbox' : 'production';
    const TOAST_CLIENT_ID = isSandbox 
      ? Deno.env.get('TOAST_SANDBOX_CLIENT_ID')
      : Deno.env.get('TOAST_CLIENT_ID');
    const TOAST_CLIENT_SECRET = isSandbox 
      ? Deno.env.get('TOAST_SANDBOX_CLIENT_SECRET')
      : Deno.env.get('TOAST_CLIENT_SECRET');
    
    // Toast API base URLs
    const TOAST_BASE_URL = isSandbox 
      ? 'https://ws-sandbox-api.eng.toasttab.com'
      : 'https://ws-api.toasttab.com';
    
    // Set redirect URI based on environment
    const REDIRECT_URI = isSandbox && origin
      ? `${origin}/toast/callback`
      : 'https://app.easyshifthq.com/toast/callback';
    
    console.log('Toast OAuth - Action:', action, 'Environment:', TOAST_ENVIRONMENT, 'Origin:', origin, 'Redirect URI:', REDIRECT_URI);

    if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET) {
      console.error('Toast credentials missing:', {
        hasClientId: !!TOAST_CLIENT_ID,
        hasClientSecret: !!TOAST_CLIENT_SECRET,
        environment: TOAST_ENVIRONMENT
      });
      throw new Error(`Toast credentials not configured for ${TOAST_ENVIRONMENT} environment`);
    }

    console.log('Toast OAuth action:', action, 'Restaurant ID:', restaurantId);

    if (action === 'authorize') {
      if (!restaurantId) {
        throw new Error('Restaurant ID is required for authorization');
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

      // Generate authorization URL
      // Toast uses a simpler OAuth flow
      const authUrl = new URL(`${TOAST_BASE_URL}/usermgmt/v1/oauth/authorize`);
      authUrl.searchParams.set('client_id', TOAST_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('state', restaurantId); // Use restaurant ID as state

      console.log('Generated Toast OAuth URL:', authUrl.toString());
      console.log('Using environment:', TOAST_ENVIRONMENT);
      console.log('Client ID:', TOAST_CLIENT_ID);
      console.log('Redirect URI:', REDIRECT_URI);

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

      const restaurantId = state; // Restaurant ID passed as state
      console.log('Toast callback processing:', { code: code.substring(0, 20) + '...', state, restaurantId });

      // Exchange authorization code for access token
      const tokenRequestBody = new URLSearchParams({
        client_id: TOAST_CLIENT_ID,
        client_secret: TOAST_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      });

      console.log('Toast token exchange request details:', {
        client_id: TOAST_CLIENT_ID?.substring(0, 15) + '...',
        redirect_uri: REDIRECT_URI,
        code_length: code.length,
        baseUrl: TOAST_BASE_URL,
        environment: TOAST_ENVIRONMENT,
        hasClientSecret: !!TOAST_CLIENT_SECRET
      });

      const tokenResponse = await fetch(`${TOAST_BASE_URL}/usermgmt/v1/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: tokenRequestBody.toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Toast token exchange failed:', {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          error: errorText,
          redirect_uri: REDIRECT_URI
        });
        throw new Error(`Failed to exchange authorization code: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Toast token exchange successful');

      // Get restaurant info using the access token
      const restaurantResponse = await fetch(`${TOAST_BASE_URL}/restaurants/v1/restaurants`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Toast-Restaurant-External-ID': tokenData.restaurantGuid || '',
        },
      });

      if (!restaurantResponse.ok) {
        const errorText = await restaurantResponse.text();
        console.error('Failed to get restaurant information:', {
          status: restaurantResponse.status,
          error: errorText
        });
        throw new Error('Failed to get restaurant information');
      }

      const restaurantData = await restaurantResponse.json();
      console.log('Restaurant data received:', {
        hasRestaurantGuid: !!restaurantData.restaurantGuid,
        hasManagementGroupGuid: !!restaurantData.managementGroupGuid
      });
      
      const toastRestaurantGuid = tokenData.restaurantGuid || restaurantData.restaurantGuid;
      const managementGroupGuid = restaurantData.managementGroupGuid;
      
      if (!toastRestaurantGuid) {
        console.error('No restaurant GUID found in token or restaurant data');
        throw new Error('No restaurant GUID found in Toast response');
      }

      console.log('Successfully extracted restaurant GUID:', toastRestaurantGuid);

      // Encrypt sensitive tokens before storage
      const encryption = await getEncryptionService();
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token ? 
        await encryption.encrypt(tokenData.refresh_token) : null;

      // Store the connection with encrypted tokens
      console.log('Storing Toast connection for restaurant:', restaurantId, 'toast restaurant:', toastRestaurantGuid);
      
      const connectionData = {
        restaurant_id: restaurantId,
        restaurant_guid: toastRestaurantGuid,
        management_group_guid: managementGroupGuid || null,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        scopes: tokenData.scope?.split(' ') || [],
        environment: TOAST_ENVIRONMENT,
        expires_at: tokenData.expires_in ? 
          new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
        connected_at: new Date().toISOString(),
      };
      
      console.log('Connection data to store:', {
        restaurant_id: restaurantId,
        restaurant_guid: toastRestaurantGuid,
        has_access_token: !!encryptedAccessToken,
        has_refresh_token: !!encryptedRefreshToken,
        scopes_count: connectionData.scopes.length,
        expires_at: connectionData.expires_at,
        environment: TOAST_ENVIRONMENT
      });
      
      const { data: connection, error: connectionError } = await supabase
        .from('toast_connections')
        .upsert(connectionData, {
          onConflict: 'restaurant_id,restaurant_guid'
        })
        .select()
        .single();

      // Log security event
      await logSecurityEvent(supabase, 'TOAST_OAUTH_TOKEN_STORED', undefined, restaurantId, {
        restaurantGuid: toastRestaurantGuid,
        scopes: tokenData.scope?.split(' ') || []
      });

      if (connectionError) {
        console.error('Error storing Toast connection - Details:', {
          error: connectionError,
          message: connectionError.message,
          code: connectionError.code,
          hint: connectionError.hint,
          details: connectionError.details
        });
        throw new Error(`Failed to store connection: ${connectionError.message}`);
      }

      // Store location
      await supabase
        .from('toast_locations')
        .upsert({
          connection_id: connection.id,
          restaurant_id: restaurantId,
          location_guid: toastRestaurantGuid,
          name: restaurantData.name || 'Toast Restaurant',
          timezone: restaurantData.timeZone || null,
          currency: 'USD',
          address: restaurantData.address || null,
        }, {
          onConflict: 'restaurant_id,location_guid'
        });

      // Automatically register webhooks for real-time updates
      const webhookResponse = await supabase.functions.invoke('toast-webhook-register', {
        body: { restaurantId }
      });

      if (webhookResponse.error) {
        console.error('Error registering webhooks:', webhookResponse.error);
      } else {
        console.log('Webhooks registered successfully for restaurant:', restaurantId);
      }

      // Trigger initial data sync
      const syncResponse = await supabase.functions.invoke('toast-sync-data', {
        body: { restaurantId, action: 'initial_sync' }
      });

      if (syncResponse.error) {
        console.error('Error triggering initial sync:', syncResponse.error);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Toast connection established successfully',
        restaurantGuid: toastRestaurantGuid,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action');

  } catch (error: any) {
    console.error('Toast OAuth error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
