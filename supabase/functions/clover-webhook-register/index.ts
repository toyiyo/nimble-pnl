import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookSetupRequest {
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

    const body: WebhookSetupRequest = await req.json();
    const { restaurantId } = body;

    console.log('Clover webhook setup started:', { restaurantId });

    // Get Clover connection details
    const { data: connection, error: connectionError } = await supabase
      .from('clover_connections')
      .select('merchant_id, access_token, environment, region')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Clover connection not found');
    }

    // Decrypt the access token
    const encryption = await getEncryptionService();
    const decryptedAccessToken = await encryption.decrypt(connection.access_token);

    // Determine API base URL based on environment and region
    const isProduction = connection.environment === 'production';
    let apiBaseUrl: string;
    
    if (isProduction) {
      if (connection.region === 'eu') {
        apiBaseUrl = 'https://api.eu.clover.com/v3';
      } else {
        apiBaseUrl = 'https://api.clover.com/v3';
      }
    } else {
      apiBaseUrl = 'https://sandbox.dev.clover.com/v3';
    }

    console.log('Using Clover API:', { apiBaseUrl, environment: connection.environment, region: connection.region });

    // Our webhook configuration
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/clover-webhooks`;
    
    // Event types we want to subscribe to
    const eventTypes = ['O', 'P']; // Orders and Payments
    
    console.log('Checking existing webhooks');

    // Check existing webhooks for this merchant
    const existingWebhooksResponse = await fetch(
      `${apiBaseUrl}/merchants/${connection.merchant_id}/webhooks`,
      {
        headers: {
          'Authorization': `Bearer ${decryptedAccessToken}`,
        },
      }
    );

    if (!existingWebhooksResponse.ok) {
      const errorText = await existingWebhooksResponse.text();
      console.error('Failed to fetch webhooks:', errorText);
      throw new Error(`Failed to check existing webhooks: ${existingWebhooksResponse.status} - ${errorText}`);
    }

    const webhooksData = await existingWebhooksResponse.json();
    console.log('Existing webhooks:', webhooksData);

    // Check if webhook already exists for our URL
    const existingWebhook = webhooksData.elements?.find((webhook: any) => 
      webhook.url === webhookUrl
    );

    let webhookId: string;
    let webhookResult: string;

    if (existingWebhook) {
      console.log('Webhook already exists:', existingWebhook.id);
      webhookId = existingWebhook.id;
      webhookResult = 'already_configured';
      
      // Update event types if needed
      const currentEventTypes = existingWebhook.eventTypes || [];
      const missingEventTypes = eventTypes.filter(et => !currentEventTypes.includes(et));
      
      if (missingEventTypes.length > 0) {
        console.log('Updating webhook with missing event types:', missingEventTypes);
        const updateResponse = await fetch(
          `${apiBaseUrl}/merchants/${connection.merchant_id}/webhooks/${webhookId}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${decryptedAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              eventTypes: [...currentEventTypes, ...missingEventTypes]
            }),
          }
        );

        if (!updateResponse.ok) {
          console.warn('Failed to update webhook event types:', await updateResponse.text());
        } else {
          console.log('Webhook event types updated successfully');
        }
      }
    } else {
      console.log('Creating new webhook');
      
      // Create the webhook
      const createResponse = await fetch(
        `${apiBaseUrl}/merchants/${connection.merchant_id}/webhooks`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${decryptedAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: webhookUrl,
            eventTypes: eventTypes,
            enabled: true
          }),
        }
      );

      if (!createResponse.ok) {
        const errorData = await createResponse.text();
        console.error('Failed to create webhook:', createResponse.status, errorData);
        throw new Error(`Failed to create webhook: ${createResponse.status} - ${errorData}`);
      }

      const webhookData = await createResponse.json();
      webhookId = webhookData.id;
      webhookResult = 'created';
      console.log('Webhook created successfully:', webhookId);
    }

    // Log security event
    await logSecurityEvent(supabase, 'CLOVER_WEBHOOK_SETUP', undefined, restaurantId, {
      merchantId: connection.merchant_id,
      webhookId,
      result: webhookResult
    });

    return new Response(JSON.stringify({
      success: true,
      webhookId,
      eventTypes,
      webhookUrl,
      message: webhookResult === 'already_configured' 
        ? 'Webhook already configured - your restaurant is ready to receive Clover events'
        : 'Webhook created successfully - your restaurant is ready to receive Clover events'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Clover webhook setup error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    return new Response(JSON.stringify({
      error: "An unexpected error occurred while setting up Clover webhook.",
      timestamp: new Date().toISOString()
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
