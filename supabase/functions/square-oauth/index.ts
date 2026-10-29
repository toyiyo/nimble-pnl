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
      provider: 'square',
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

    // An allowlisted preview origin uses the Square sandbox.
    const isPreview = !appOrigin.isProduction;
    const SQUARE_ENVIRONMENT = isPreview ? 'sandbox' : 'production';
    const SQUARE_APPLICATION_ID = isPreview 
      ? Deno.env.get('SQUARE_SANDBOX_APPLICATION_ID')
      : Deno.env.get('SQUARE_APPLICATION_ID');
    const SQUARE_APPLICATION_SECRET = isPreview 
      ? Deno.env.get('SQUARE_SANDBOX_APPLICATION_SECRET')
      : Deno.env.get('SQUARE_APPLICATION_SECRET');
    
    // Use correct Square API domains
    const SQUARE_BASE_URL = isPreview 
      ? 'https://connect.squareupsandbox.com' 
      : 'https://connect.squareup.com';
    
    const REDIRECT_URI = `${appOrigin.origin}/square/callback`;

    console.log('Square OAuth - Action:', gate.action, 'Environment:', SQUARE_ENVIRONMENT, 'Redirect URI:', REDIRECT_URI);

    if (!SQUARE_APPLICATION_ID || !SQUARE_APPLICATION_SECRET) {
      console.error('Square credentials missing:', {
        hasAppId: !!SQUARE_APPLICATION_ID,
        hasAppSecret: !!SQUARE_APPLICATION_SECRET,
        environment: SQUARE_ENVIRONMENT
      });
      throw new Error(`Square credentials not configured for ${SQUARE_ENVIRONMENT} environment`);
    }

    if (gate.action === 'authorize') {
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

      const authUrl = new URL(`${SQUARE_BASE_URL}/oauth2/authorize`);
      authUrl.searchParams.set('client_id', SQUARE_APPLICATION_ID);
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('session', 'false');
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('state', gate.signedState);

      return jsonResponse({ authorizationUrl: authUrl.toString() });

    } else {
      // The restaurant comes only from the verified state.
      console.log('Square callback processing for restaurant:', restaurantId);

      // Exchange authorization code for access token
      const tokenRequestBody = {
        client_id: SQUARE_APPLICATION_ID,
        client_secret: SQUARE_APPLICATION_SECRET,
        code: gate.code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI, // Must match exactly what's in Square app settings
      };

      console.log('Square token exchange request details:', {
        redirect_uri: REDIRECT_URI,
        baseUrl: SQUARE_BASE_URL,
        environment: SQUARE_ENVIRONMENT,
        hasClientSecret: !!SQUARE_APPLICATION_SECRET
      });

      const tokenResponse = await fetch(`${SQUARE_BASE_URL}/oauth2/token`, {
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
      const merchantResponse = await fetch(`${SQUARE_BASE_URL}/v2/merchants`, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Square-Version': '2024-12-18',
        },
      });

      if (!merchantResponse.ok) {
        const errorText = await merchantResponse.text();
        console.error('Failed to get merchant information:', {
          status: merchantResponse.status,
          error: errorText
        });
        throw new Error('Failed to get merchant information');
      }

      const merchantData = await merchantResponse.json();
      console.log('Full merchant response:', JSON.stringify(merchantData, null, 2));
      
      // Square API can return merchant data in different formats
      let merchant = null;
      
      if (merchantData.merchant) {
        // Check if merchant is an array (common Square API format)
        if (Array.isArray(merchantData.merchant) && merchantData.merchant.length > 0) {
          merchant = merchantData.merchant[0];
        } else {
          // Single merchant object
          merchant = merchantData.merchant;
        }
      } else if (merchantData.merchants && merchantData.merchants.length > 0) {
        // Multiple merchants response - take the first one
        merchant = merchantData.merchants[0];
      } else {
        console.error('Invalid merchant response - no merchant found:', merchantData);
        throw new Error('No merchant found in Square response');
      }
      
      if (!merchant || (!merchant.id && !merchant.merchant_id)) {
        console.error('Merchant object structure:', {
          merchant: merchant,
          hasId: !!merchant?.id,
          hasMerchantId: !!merchant?.merchant_id,
          merchantKeys: merchant ? Object.keys(merchant) : 'merchant is null/undefined'
        });
        throw new Error('No merchant ID found in Square merchant object');
      }
      
      // Handle different merchant ID property names
      const merchantId = merchant.id || merchant.merchant_id;
      console.log('Successfully extracted merchant ID:', merchantId);

      // Encrypt sensitive tokens before storage
      const encryption = await getEncryptionService();
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);
      const encryptedRefreshToken = tokenData.refresh_token ? 
        await encryption.encrypt(tokenData.refresh_token) : null;

      // Store the connection with encrypted tokens
      // Use service role to bypass RLS for this backend operation
      console.log('Storing Square connection for restaurant:', restaurantId, 'merchant:', merchant.id);
      
      const connectionData = {
        restaurant_id: restaurantId,
        merchant_id: merchantId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        scopes: tokenData.scope?.split(' ') || [],
        expires_at: tokenData.expires_at ? new Date(tokenData.expires_at).toISOString() : null,
        connected_at: new Date().toISOString(),
      };
      
      console.log('Connection data to store:', {
        restaurant_id: restaurantId,
        merchant_id: merchantId,
        has_access_token: !!encryptedAccessToken,
        has_refresh_token: !!encryptedRefreshToken,
        scopes_count: connectionData.scopes.length,
        expires_at: connectionData.expires_at
      });
      
      const { data: connection, error: connectionError } = await supabase
        .from('square_connections')
        .upsert(connectionData, {
          onConflict: 'restaurant_id,merchant_id'
        })
        .select()
        .single();

      // Log security event
      await logSecurityEvent(supabase, 'SQUARE_OAUTH_TOKEN_STORED', userId, restaurantId, {
        merchantId: merchantId,
        scopes: tokenData.scope?.split(' ') || []
      });

      if (connectionError) {
        console.error('Error storing Square connection - Details:', {
          error: connectionError,
          message: connectionError.message,
          code: connectionError.code,
          hint: connectionError.hint,
          details: connectionError.details
        });
        throw new Error(`Failed to store connection: ${connectionError.message}`);
      }

      // Get and store locations
      const locationsResponse = await fetch(`${SQUARE_BASE_URL}/v2/locations`, {
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

      // Check webhook status (does NOT auto-create - webhook should be pre-configured)
      const webhookResponse = await supabase.functions.invoke('square-webhook-register', {
        body: { restaurantId, action: 'status' }
      });

      if (webhookResponse.error) {
        console.error('Error checking webhook status:', webhookResponse.error);
      } else {
        const webhookData = webhookResponse.data;
        if (webhookData?.matchingWebhook) {
          console.log('Webhook configured correctly for restaurant:', restaurantId);
        } else {
          console.warn('Webhook not configured - run square-webhook-register with action: "create"');
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
  } catch (error) {
    console.error('Square OAuth error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
