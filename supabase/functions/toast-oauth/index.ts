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
    
    // Toast POS OAuth configuration
    const TOAST_CLIENT_ID = Deno.env.get('TOAST_CLIENT_ID');
    const TOAST_CLIENT_SECRET = Deno.env.get('TOAST_CLIENT_SECRET');
    const TOAST_BASE_URL = 'https://ws-api.toasttab.com';
    
    // Set redirect URI based on environment
    const REDIRECT_URI = isPreview
      ? `${origin}/toast/callback`
      : 'https://app.easyshifthq.com/toast/callback';
    
    console.log('Toast OAuth - Action:', action, 'Origin:', origin, 'Redirect URI:', REDIRECT_URI);

    if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET) {
      console.error('Toast credentials missing');
      throw new Error('Toast credentials not configured');
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

      // Generate authorization URL for Toast POS
      // Note: Toast uses OAuth 2.0 with partner-specific scopes
      const scopes = [
        'orders:read',
        'menus:read',
        'payments:read',
        'restaurant:read'
      ].join(' ');

      const authUrl = new URL(`${TOAST_BASE_URL}/authentication/v1/authorize`);
      authUrl.searchParams.set('client_id', TOAST_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('state', restaurantId); // Use restaurant ID as state

      console.log('Generated Toast OAuth URL:', authUrl.toString());
      console.log('Client ID:', TOAST_CLIENT_ID);
      console.log('Redirect URI:', REDIRECT_URI);

      return new Response(JSON.stringify({
        authorizationUrl: authUrl.toString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'callback') {
      if (!code || !state) {
        throw new Error('Authorization code and state are required for callback');
      }

      const restaurantId = state; // State is the restaurant ID

      // Exchange authorization code for access token
      const tokenResponse = await fetch(`${TOAST_BASE_URL}/authentication/v1/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: TOAST_CLIENT_ID,
          client_secret: TOAST_CLIENT_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', errorText);
        throw new Error(`Failed to exchange authorization code: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Token exchange successful');

      // Get restaurant information from Toast
      const restaurantResponse = await fetch(`${TOAST_BASE_URL}/restaurants/v1/restaurants`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Toast-Restaurant-External-ID': tokenData.restaurantGuid || '',
        },
      });

      if (!restaurantResponse.ok) {
        console.error('Failed to fetch Toast restaurant info');
        throw new Error('Failed to fetch restaurant information from Toast');
      }

      const restaurantData = await restaurantResponse.json();
      const toastRestaurantGuid = restaurantData[0]?.guid || tokenData.restaurantGuid;

      // Encrypt the tokens
      const encryption = await getEncryptionService();
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token 
        ? await encryption.encrypt(tokenData.refresh_token) 
        : null;

      // Store connection in database
      const { error: insertError } = await supabase
        .from('toast_connections')
        .upsert({
          restaurant_id: restaurantId,
          toast_restaurant_guid: toastRestaurantGuid,
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: tokenData.expires_in 
            ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
            : null,
          scopes: tokenData.scope?.split(' ') || [],
          connected_at: new Date().toISOString(),
        }, {
          onConflict: 'restaurant_id,toast_restaurant_guid',
        });

      if (insertError) {
        console.error('Failed to store Toast connection:', insertError);
        throw new Error('Failed to store connection');
      }

      // Log security event
      await logSecurityEvent(supabase, {
        event_type: 'toast_connected',
        restaurant_id: restaurantId,
        details: {
          toast_restaurant_guid: toastRestaurantGuid,
          scopes: tokenData.scope?.split(' ') || [],
        },
      });

      console.log('Toast connection stored successfully for restaurant:', restaurantId);

      return new Response(JSON.stringify({
        success: true,
        restaurantGuid: toastRestaurantGuid,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error('Invalid action');

  } catch (error: any) {
    console.error('Toast OAuth error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'An error occurred during Toast OAuth'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
