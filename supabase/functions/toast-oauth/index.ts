import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';
import {
  getUserIdFromAuthHeader,
  isOwnerOrManager,
  resolveOAuthRequest,
  type OAuthRequestBody,
} from '../_shared/oauthState.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

    const body: OAuthRequestBody = await req.json();
    const authHeader = req.headers.get('Authorization');

    // Every check runs before any credential use or write.
    const gate = await resolveOAuthRequest({
      provider: 'toast',
      body,
      headers: req.headers,
      secret: Deno.env.get('OAUTH_STATE_SECRET'),
      allowedOriginsEnv: Deno.env.get('OAUTH_ALLOWED_ORIGINS'),
      getUserId: () => getUserIdFromAuthHeader(supabase, authHeader),
      isOwnerOrManager: (uid, rid) => isOwnerOrManager(supabase, uid, rid),
    });
    if (!gate.ok) {
      return jsonResponse({ error: gate.error }, gate.status);
    }
    const { appOrigin, userId, restaurantId } = gate;

    // Toast POS OAuth configuration
    const TOAST_CLIENT_ID = Deno.env.get('TOAST_CLIENT_ID');
    const TOAST_CLIENT_SECRET = Deno.env.get('TOAST_CLIENT_SECRET');
    const TOAST_BASE_URL = 'https://ws-api.toasttab.com';
    
    const REDIRECT_URI = `${appOrigin.origin}/toast/callback`;
    
    console.log('Toast OAuth - Action:', gate.action, 'Redirect URI:', REDIRECT_URI);

    if (!TOAST_CLIENT_ID || !TOAST_CLIENT_SECRET) {
      console.error('Toast credentials missing');
      throw new Error('Toast credentials not configured');
    }

    if (gate.action === 'authorize') {
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
      authUrl.searchParams.set('state', gate.signedState);

      return jsonResponse({ authorizationUrl: authUrl.toString() });

    } else {
      // The restaurant comes only from the verified state.

      // Exchange authorization code for access token
      const tokenResponse = await fetch(`${TOAST_BASE_URL}/authentication/v1/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: TOAST_CLIENT_ID,
          client_secret: TOAST_CLIENT_SECRET,
          code: gate.code,
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
      await logSecurityEvent(supabase, 'TOAST_CONNECTED', userId, restaurantId, {
        toast_restaurant_guid: toastRestaurantGuid,
        scopes: tokenData.scope?.split(' ') || [],
      });

      console.log('Toast connection stored successfully for restaurant:', restaurantId);

      return new Response(JSON.stringify({
        success: true,
        restaurantGuid: toastRestaurantGuid,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Toast OAuth error:', error);
    return new Response(JSON.stringify({
      error: (error instanceof Error ? error.message : String(error)) || 'An error occurred during Toast OAuth'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
