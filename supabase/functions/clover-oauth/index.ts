import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CloverOAuthRequest {
  action: 'authorize' | 'callback';
  restaurantId?: string;
  code?: string;
  state?: string;
  region?: 'na' | 'eu' | 'latam' | 'apac';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: CloverOAuthRequest = await req.json();
    const { action, restaurantId, code, state, region = 'na' } = body;

    const authHeader = req.headers.get('Authorization');
    let user = null;

    if (action === 'authorize') {
      if (!authHeader) {
        throw new Error('No authorization header');
      }

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

    if (origin) {
      try {
        const originUrl = new URL(origin);
        const hostname = originUrl.hostname.toLowerCase();
        isSandbox = hostname === 'lovableproject.com' || 
                   hostname.endsWith('.lovableproject.com') ||
                   hostname.endsWith('.lovable.app') ||
                   hostname.includes('vercel.app') ||
                   hostname === 'localhost';
      } catch (e) {
        console.warn('Invalid origin URL:', origin);
        isSandbox = false;
      }
    }

    const CLOVER_APP_ID = isSandbox
      ? Deno.env.get('CLOVER_SANDBOX_APP_ID')
      : Deno.env.get('CLOVER_APP_ID');
    const CLOVER_APP_SECRET = isSandbox
      ? Deno.env.get('CLOVER_SANDBOX_APP_SECRET')
      : Deno.env.get('CLOVER_APP_SECRET');

    // Regional Clover API domains
    const regionDomains = {
      na: isSandbox ? 'sandbox.dev.clover.com' : 'www.clover.com',
      eu: isSandbox ? 'sandbox.dev.clover.com' : 'www.eu.clover.com',
      latam: isSandbox ? 'sandbox.dev.clover.com' : 'www.la.clover.com',
      apac: isSandbox ? 'sandbox.dev.clover.com' : 'www.clover.com'
    };

    const regionAPIDomains = {
      na: isSandbox ? 'apisandbox.dev.clover.com' : 'api.clover.com',
      eu: isSandbox ? 'apisandbox.dev.clover.com' : 'api.eu.clover.com',
      latam: isSandbox ? 'apisandbox.dev.clover.com' : 'api.la.clover.com',
      apac: isSandbox ? 'apisandbox.dev.clover.com' : 'api.clover.com'
    };

    const CLOVER_DOMAIN = regionDomains[region];
    const CLOVER_API_DOMAIN = regionAPIDomains[region];

    const REDIRECT_URI = isSandbox
      ? `${origin}/clover/callback`
      : 'https://app.easyshifthq.com/clover/callback';

    console.log('Clover OAuth - Action:', action, 'Region:', region, 'Environment:', isSandbox ? 'sandbox' : 'production', 'Origin:', origin);
    console.log('App ID being used:', CLOVER_APP_ID);
    console.log('Domain being used:', CLOVER_DOMAIN);
    console.log('Redirect URI:', REDIRECT_URI);
    console.log('Full hostname:', origin ? new URL(origin).hostname : 'unknown');

    if (!CLOVER_APP_ID || !CLOVER_APP_SECRET) {
      console.error('Clover credentials missing for environment:', isSandbox ? 'sandbox' : 'production');
      throw new Error(`Clover credentials not configured for ${isSandbox ? 'sandbox' : 'production'} environment`);
    }

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

      // Clover OAuth scopes
      const permissions = [
        'ORDERS_R',
        'PAYMENTS_R',
        'INVENTORY_R',
        'MERCHANT_R',
        'EMPLOYEES_R'
      ].join(',');

      const authUrl = new URL(`https://${CLOVER_DOMAIN}/oauth/v2/authorize`);
      authUrl.searchParams.set('client_id', CLOVER_APP_ID);
      authUrl.searchParams.set('scope', permissions);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('state', JSON.stringify({ restaurantId, region }));

      console.log('Generated Clover OAuth URL:', authUrl.toString());
      console.log('Using environment:', isSandbox ? 'sandbox' : 'production');

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

      const stateData = JSON.parse(state);
      const restaurantId = stateData.restaurantId;
      const callbackRegion = stateData.region || 'na';

      console.log('Clover callback processing:', { code: code.substring(0, 20) + '...', state, restaurantId, region: callbackRegion });

      // Exchange authorization code for access token
      const tokenRequestBody = {
        client_id: CLOVER_APP_ID,
        client_secret: CLOVER_APP_SECRET,
        code: code,
        redirect_uri: REDIRECT_URI,
      };

      const callbackAPIDomain = regionAPIDomains[callbackRegion as keyof typeof regionAPIDomains] || regionAPIDomains.na;
      const tokenUrl = `https://${callbackAPIDomain}/oauth/v2/token`;
      console.log('Token exchange URL:', tokenUrl);
      console.log('Callback region:', callbackRegion, 'Using API domain:', callbackAPIDomain);

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(tokenRequestBody),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Clover token exchange failed:', {
          status: tokenResponse.status,
          statusText: tokenResponse.statusText,
          error: errorText,
        });
        throw new Error(`Failed to exchange authorization code: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Clover token exchange successful');
      console.log('Full token data:', JSON.stringify(tokenData, null, 2));
      console.log('Token data keys:', Object.keys(tokenData));
      console.log('Merchant ID from token:', tokenData.merchant_id);
      console.log('Access token exists:', !!tokenData.access_token);

      // Extract merchant ID - it might be in different fields or encoded in the JWT
      let merchantId = tokenData.merchant_uuid || tokenData.merchant_id || tokenData.merchantId || tokenData.mid || tokenData.merchant?.id;
      
      // If not found at top level, try to decode from JWT access token
      if (!merchantId && tokenData.access_token) {
        try {
          // Decode JWT payload (without verification since we trust Clover)
          const base64Payload = tokenData.access_token.split('.')[1];
          const decodedPayload = JSON.parse(atob(base64Payload));
          console.log('Decoded JWT payload:', decodedPayload);
          
          merchantId = decodedPayload.merchant_uuid || decodedPayload.merchant_id || decodedPayload.merchantId;
        } catch (error) {
          console.warn('Failed to decode JWT:', error);
        }
      }
      
      if (!merchantId) {
        console.error('No merchant ID found in token response:', tokenData);
        throw new Error('No merchant ID returned from Clover OAuth');
      }
      
      console.log('Using merchant ID:', merchantId);

      // Get merchant info using the access token (optional - don't fail if this doesn't work)
      let merchantData = {
        name: 'Clover Merchant',
        timezone: null,
        currency: 'USD',
        address: null
      };

      try {
        const merchantUrl = `https://${callbackAPIDomain}/v3/merchants/${merchantId}`;
        console.log('Fetching merchant info from:', merchantUrl);
        
        const merchantResponse = await fetch(merchantUrl, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Accept': 'application/json',
          },
        });

        console.log('Merchant API response status:', merchantResponse.status);
        
        if (merchantResponse.ok) {
          const fetchedMerchantData = await merchantResponse.json();
          console.log('Merchant data keys:', Object.keys(fetchedMerchantData));
          merchantData = fetchedMerchantData;
        } else {
          const errorText = await merchantResponse.text();
          console.warn('Could not fetch merchant information (continuing anyway):', {
            status: merchantResponse.status,
            statusText: merchantResponse.statusText,
            url: merchantUrl,
            error: errorText
          });
        }
      } catch (error) {
        console.warn('Merchant API call failed, using defaults:', error);
      }

      console.log('Using merchant data:', { name: merchantData.name, timezone: merchantData.timezone });

      // Encrypt tokens before storage
      const encryption = await getEncryptionService();
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);
      
      // Encrypt refresh token if present
      let encryptedRefreshToken = null;
      if (tokenData.refresh_token) {
        encryptedRefreshToken = await encryption.encrypt(tokenData.refresh_token);
      }

      // Calculate expiry time (Clover tokens typically expire in 1 year, but check the response)
      let expiresAt = null;
      if (tokenData.expires_in) {
        expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
      } else {
        // Default to 1 year for Clover sandbox tokens if no expires_in provided
        const oneYearFromNow = new Date();
        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
        expiresAt = oneYearFromNow.toISOString();
        console.log('No expires_in provided by Clover, using default 1 year expiry');
      }

      console.log('Token expiry info:', {
        expires_in: tokenData.expires_in,
        expires_at: expiresAt,
        has_refresh_token: !!tokenData.refresh_token
      });

      // Store the connection
      const connectionData = {
        restaurant_id: restaurantId,
        merchant_id: merchantId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        expires_at: expiresAt,
        region: callbackRegion,
        environment: isSandbox ? 'sandbox' : 'production',
        scopes: ['ORDERS_R', 'PAYMENTS_R', 'INVENTORY_R', 'MERCHANT_R', 'EMPLOYEES_R'],
        connected_at: new Date().toISOString(),
      };

      const { data: connection, error: connectionError } = await supabase
        .from('clover_connections')
        .upsert(connectionData, {
          onConflict: 'restaurant_id,merchant_id'
        })
        .select()
        .single();

      await logSecurityEvent(supabase, 'CLOVER_OAUTH_TOKEN_STORED', undefined, restaurantId, {
        merchantId: merchantId,
        region: callbackRegion
      });

      if (connectionError) {
        console.error('Error storing Clover connection:', connectionError);
        throw new Error(`Failed to store connection: ${connectionError.message}`);
      }

      // Store merchant location
      await supabase
        .from('clover_locations')
        .upsert({
          connection_id: connection.id,
          restaurant_id: restaurantId,
          location_id: merchantId,
          name: merchantData.name || 'Main Location',
          timezone: merchantData.timezone,
          currency: merchantData.currency || 'USD',
          address: merchantData.address || null,
        }, {
          onConflict: 'restaurant_id,location_id'
        });

      console.log('Successfully stored Clover connection');

      // Auto-register webhook for real-time updates
      console.log('Auto-registering webhook for restaurant:', restaurantId);
      try {
        const webhookResult = await supabase.functions.invoke(
          'clover-webhook-register',
          {
            body: { restaurantId }
          }
        );

        if (webhookResult.error) {
          console.error('Webhook registration error:', webhookResult.error);
          // Don't fail the entire OAuth flow if webhook registration fails
        } else {
          console.log('Webhook registered successfully:', webhookResult.data);
        }
      } catch (webhookErr) {
        console.error('Failed to register webhook:', webhookErr);
        // Continue even if webhook registration fails
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Clover connection established successfully',
        merchantId: merchantId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action');

  } catch (error: any) {
    console.error('Clover OAuth error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
