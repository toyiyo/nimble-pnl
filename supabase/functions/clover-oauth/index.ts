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

      const tokenUrl = `https://${regionAPIDomains[callbackRegion]}/oauth/v2/token`;
      console.log('Token exchange URL:', tokenUrl);

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(tokenRequestBody),
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

      // Get merchant info using the access token
      const merchantUrl = `https://${regionAPIDomains[callbackRegion]}/v3/merchants/${tokenData.merchant_id}`;
      const merchantResponse = await fetch(merchantUrl, {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
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
      console.log('Merchant ID:', tokenData.merchant_id);

      // Encrypt tokens before storage
      const encryption = await getEncryptionService();
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);

      // Store the connection
      const connectionData = {
        restaurant_id: restaurantId,
        merchant_id: tokenData.merchant_id,
        access_token: encryptedAccessToken,
        region: callbackRegion,
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
        merchantId: tokenData.merchant_id,
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
          location_id: tokenData.merchant_id,
          name: merchantData.name || 'Main Location',
          timezone: merchantData.timezone,
          currency: merchantData.currency || 'USD',
          address: merchantData.address || null,
        }, {
          onConflict: 'restaurant_id,location_id'
        });

      return new Response(JSON.stringify({
        success: true,
        message: 'Clover connection established successfully',
        merchantId: tokenData.merchant_id,
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
