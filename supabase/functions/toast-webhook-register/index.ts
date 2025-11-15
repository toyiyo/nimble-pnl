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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { restaurantId }: WebhookRegisterRequest = await req.json();

    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    // Get Toast connection
    const { data: connection, error: connError } = await supabase
      .from('toast_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connError || !connection) {
      throw new Error('Toast connection not found');
    }

    // Decrypt access token
    const encryption = await getEncryptionService();
    const accessToken = await encryption.decrypt(connection.access_token);

    // Toast API base URL
    const TOAST_BASE_URL = connection.environment === 'sandbox'
      ? 'https://ws-sandbox-api.eng.toasttab.com'
      : 'https://ws-api.toasttab.com';

    // Webhook endpoint URL
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/toast-webhooks`;

    console.log('Registering Toast webhooks:', {
      restaurantId,
      restaurantGuid: connection.restaurant_guid,
      webhookUrl,
      environment: connection.environment
    });

    // Toast webhook subscription payload
    // Note: Toast uses a subscription model where you register once for all events
    const webhookPayload = {
      eventTypes: [
        'ORDER_CREATED',
        'ORDER_MODIFIED',
        'ORDER_FIRED',
        'ORDER_SENT',
        'ORDER_COMPLETED'
      ],
      url: webhookUrl
    };

    const response = await fetch(`${TOAST_BASE_URL}/config/v2/webhookSubscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Toast-Restaurant-External-ID': connection.restaurant_guid,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Webhook registration failed:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      
      // If webhook already exists, that's okay
      if (response.status === 409 || response.status === 400) {
        console.log('Webhook may already be registered, continuing...');
        return new Response(JSON.stringify({
          success: true,
          message: 'Webhook already registered or registration not needed',
          alreadyExists: true
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`Webhook registration failed: ${response.status} - ${errorText}`);
    }

    const subscriptionData = await response.json();
    console.log('Webhook registered successfully:', subscriptionData);

    return new Response(JSON.stringify({
      success: true,
      message: 'Toast webhooks registered successfully',
      subscription: subscriptionData
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Toast webhook registration error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
