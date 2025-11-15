import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookRegisterRequest {
  restaurantId: string;
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const body: WebhookRegisterRequest = await req.json();
    const { restaurantId } = body;

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
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

    // Get SpotOn connection
    const { data: connection, error: connectionError } = await supabase
      .from('spoton_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('SpotOn connection not found');
    }

    const encryption = await getEncryptionService();
    let apiKey = '';
    let accessToken = '';

    // Decrypt credentials
    if (connection.api_key_encrypted) {
      apiKey = await encryption.decrypt(connection.api_key_encrypted);
    } else if (connection.access_token) {
      accessToken = await encryption.decrypt(connection.access_token);
    } else {
      throw new Error('No valid credentials found');
    }

    const SPOTON_BASE_URL = 'https://enterprise.appetize.com';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const webhookUrl = `${supabaseUrl}/functions/v1/spoton-webhooks`;

    // Events to subscribe to
    const events = [
      'order.created',
      'order.updated',
      'order.cancelled',
      'menu.updated',
      'item.availability_changed'
    ];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    } else if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // Register webhook with SpotOn
    const registerResponse = await fetch(`${SPOTON_BASE_URL}/webhooks/api/register`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        url: webhookUrl,
        events: events,
        location_id: connection.location_id
      }),
    });

    if (!registerResponse.ok) {
      const errorText = await registerResponse.text();
      console.error('Failed to register webhook:', errorText);
      throw new Error(`Failed to register webhook: ${registerResponse.status}`);
    }

    const webhookData = await registerResponse.json();
    console.log('Webhook registered successfully:', webhookData);

    // Store webhook registration details
    await supabase
      .from('spoton_webhook_subscriptions')
      .upsert({
        connection_id: connection.id,
        restaurant_id: restaurantId,
        webhook_id: webhookData.id || webhookData.webhook_id,
        webhook_url: webhookUrl,
        events: events,
        registered_at: new Date().toISOString(),
      }, {
        onConflict: 'connection_id'
      });

    return new Response(JSON.stringify({
      success: true,
      message: 'Webhooks registered successfully',
      events: events
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Webhook registration error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
