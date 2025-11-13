import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ToastConnectRequest {
  action: 'connect' | 'test';
  restaurantId: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string; // e.g., https://ws-api.toasttab.com
  restaurantGuid?: string;
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

    const body: ToastConnectRequest = await req.json();
    const { action, restaurantId, clientId, clientSecret, apiUrl, restaurantGuid } = body;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }
    
    // Get user from auth header
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Invalid authentication');
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

    console.log('Toast Standard API - Action:', action, 'Restaurant ID:', restaurantId);

    if (action === 'test' || action === 'connect') {
      // Use client credentials grant to get access token
      const tokenRequestBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      });

      console.log('Attempting to get access token from:', apiUrl);

      const tokenResponse = await fetch(`${apiUrl}/usermgmt/v1/oauth/token`, {
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
        });
        throw new Error(`Failed to authenticate with Toast: ${errorText}`);
      }

      const tokenData = await tokenResponse.json();
      console.log('Toast token exchange successful');

      // Get restaurant info using the access token
      let restaurantData = null;
      let detectedRestaurantGuid = restaurantGuid;

      try {
        const restaurantResponse = await fetch(`${apiUrl}/restaurants/v1/restaurants`, {
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
          },
        });

        if (restaurantResponse.ok) {
          restaurantData = await restaurantResponse.json();
          console.log('Restaurant data received');
          
          // Extract restaurant GUID from response
          if (restaurantData && restaurantData.length > 0) {
            detectedRestaurantGuid = restaurantData[0].guid || detectedRestaurantGuid;
          }
        } else {
          console.warn('Could not fetch restaurant information:', restaurantResponse.status);
        }
      } catch (error) {
        console.warn('Error fetching restaurant info:', error);
      }

      if (action === 'test') {
        // Just test the connection and return success
        return new Response(JSON.stringify({
          success: true,
          message: 'Toast credentials are valid',
          restaurantGuid: detectedRestaurantGuid,
          restaurantData: restaurantData ? restaurantData[0] : null,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // action === 'connect' - Store the credentials
      if (!detectedRestaurantGuid) {
        throw new Error('Could not determine Toast restaurant GUID. Please provide it manually.');
      }

      // Encrypt sensitive credentials before storage
      const encryption = await getEncryptionService();
      const encryptedClientId = await encryption.encrypt(clientId);
      const encryptedClientSecret = await encryption.encrypt(clientSecret);
      const encryptedAccessToken = await encryption.encrypt(tokenData.access_token);

      // Store the connection
      const connectionData = {
        restaurant_id: restaurantId,
        restaurant_guid: detectedRestaurantGuid,
        management_group_guid: null,
        client_id: encryptedClientId,
        client_secret: encryptedClientSecret,
        api_url: apiUrl,
        access_token: encryptedAccessToken,
        scopes: ['read_only'],
        environment: 'production', // Standard API is always production
        expires_at: tokenData.expires_in ? 
          new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
        connected_at: new Date().toISOString(),
      };
      
      console.log('Storing Toast connection for restaurant:', restaurantId);
      
      const { data: connection, error: connectionError } = await supabase
        .from('toast_connections')
        .upsert(connectionData, {
          onConflict: 'restaurant_id,restaurant_guid'
        })
        .select()
        .single();

      // Log security event
      await logSecurityEvent(supabase, 'TOAST_CREDENTIALS_STORED', undefined, restaurantId, {
        restaurantGuid: detectedRestaurantGuid,
        apiUrl: apiUrl
      });

      if (connectionError) {
        console.error('Error storing Toast connection:', connectionError);
        throw new Error(`Failed to store connection: ${connectionError.message}`);
      }

      // Store location if we have restaurant data
      if (restaurantData && restaurantData.length > 0) {
        const restaurant = restaurantData[0];
        await supabase
          .from('toast_locations')
          .upsert({
            connection_id: connection.id,
            restaurant_id: restaurantId,
            location_guid: detectedRestaurantGuid,
            name: restaurant.name || 'Toast Restaurant',
            timezone: restaurant.timeZone || null,
            currency: 'USD',
            address: restaurant.address || null,
          }, {
            onConflict: 'restaurant_id,location_guid'
          });
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
        restaurantGuid: detectedRestaurantGuid,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action');

  } catch (error: any) {
    console.error('Toast connection error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
