import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getEncryptionService, logSecurityEvent } from "../_shared/encryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Shift4ConnectRequest {
  restaurantId: string;
  secretKey: string;
  merchantId?: string; // Optional - will be fetched from API if not provided
  environment?: 'production' | 'sandbox';
}

/**
 * Validates Shift4 API key by making a test API call
 * Returns merchant information if valid
 */
async function validateShift4Key(secretKey: string, environment: string = 'production'): Promise<any> {
  const baseUrl = environment === 'sandbox' 
    ? 'https://api.sandbox.shift4.com' 
    : 'https://api.shift4.com';

  // Use Basic Auth with secret key as username (password is empty)
  const authHeader = 'Basic ' + btoa(secretKey + ':');

  // Test the key by fetching merchant info
  const response = await fetch(`${baseUrl}/merchants/self`, {
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

  const merchantInfo = await response.json();
  return merchantInfo;
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

    // Validate the API key and fetch merchant info
    console.log('Validating Shift4 API key...');
    const merchantInfo = await validateShift4Key(secretKey, environment);
    
    const actualMerchantId = merchantId || merchantInfo.id || merchantInfo.merchantId;
    
    if (!actualMerchantId) {
      throw new Error('Could not determine merchant ID from API response');
    }

    console.log('Shift4 API key validated successfully:', { 
      merchantId: actualMerchantId,
      merchantName: merchantInfo.name || merchantInfo.companyName,
    });

    // Encrypt the secret key before storing
    const encryption = await getEncryptionService();
    const encryptedSecretKey = await encryption.encrypt(secretKey);

    // Store or update the connection
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
        merchantName: merchantInfo.name || merchantInfo.companyName,
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
