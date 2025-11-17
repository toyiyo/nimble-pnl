import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEncryptionService, logSecurityEvent } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Shift4ConnectRequest {
  restaurantId: string;
  secretKey: string;
  merchantId?: string; // Optional - can be provided for tracking purposes
  environment?: 'production' | 'sandbox';
}

/**
 * Validates Shift4 API key by making a test API call
 * Note: Shift4 uses the same URL for both test and production.
 * The difference is in the API key prefix (sk_test_ vs sk_live_).
 * Returns an empty object on success (no merchant info available from this endpoint).
 */
async function validateShift4Key(secretKey: string, environment: string = 'production'): Promise<any> {
  // Shift4 uses the same base URL for both test and production environments
  const baseUrl = 'https://api.shift4.com';

  // Use Basic Auth with secret key as username (password is empty)
  const authHeader = 'Basic ' + btoa(secretKey + ':');

  // Test the key by listing charges (with limit 1 to minimize data transfer)
  // This is the recommended way to validate API keys per Shift4 documentation
  const response = await fetch(`${baseUrl}/charges?limit=1`, {
    method: 'GET',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Invalid Shift4 API key: ${errorText}`);
  }

  // Return empty object since we only need to validate the key
  // Shift4 doesn't have a merchant info endpoint
  return {};
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const body: Shift4ConnectRequest = await req.json();
    const { restaurantId, secretKey, merchantId, environment = 'production' } = body;

    if (!restaurantId || !secretKey) {
      throw new Error('Restaurant ID and Secret Key are required');
    }

    console.log('Shift4 connection request:', { restaurantId, environment, hasMerchantId: !!merchantId });

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: restaurantError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (restaurantError || !userRestaurant) {
      throw new Error('Access denied: User does not have access to this restaurant');
    }

    if (!['owner', 'manager'].includes(userRestaurant.role)) {
      throw new Error('Access denied: Only owners and managers can connect POS systems');
    }

    // Validate the API key
    console.log('Validating Shift4 API key...');
    await validateShift4Key(secretKey, environment);
    
    // Use provided merchantId or generate one from the secret key for tracking
    // The API key itself identifies the merchant account
    const actualMerchantId = merchantId || `shift4_${secretKey.substring(0, 12)}`;

    console.log('Shift4 API key validated successfully:', { 
      merchantId: actualMerchantId,
    });

    // Encrypt the secret key before storing
    const encryption = await getEncryptionService();
    const encryptedSecretKey = await encryption.encrypt(secretKey);

    // Store or update the connection (one connection per restaurant+merchant)
    const { data: connection, error: connectionError } = await supabase
      .from('shift4_connections')
      .upsert({
        restaurant_id: restaurantId,
        merchant_id: actualMerchantId,
        secret_key: encryptedSecretKey,
        environment,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'restaurant_id,merchant_id',
      })
      .select()
      .single();

    if (connectionError) {
      console.error('Failed to store connection:', connectionError);
      throw new Error(`Failed to store connection: ${connectionError.message}`);
    }

    // Log security event
    await logSecurityEvent(supabase, 'SHIFT4_CONNECTION_CREATED', user.id, restaurantId, {
      merchantId: actualMerchantId,
      environment,
    });

    console.log('Shift4 connection stored successfully:', connection.id);

    return new Response(
      JSON.stringify({
        success: true,
        connectionId: connection.id,
        merchantId: actualMerchantId,
        environment,
        message: 'Shift4 connection established successfully',
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error: any) {
    console.error('Shift4 connection error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
