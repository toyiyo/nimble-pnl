import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getEncryptionService, logSecurityEvent } from '../_shared/encryption.ts';

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

    const body: WebhookRegisterRequest = await req.json();
    const { restaurantId } = body;

    console.log('Square webhook registration started:', { restaurantId });

    // Get Square connection and decrypt tokens
    const { data: connection, error: connectionError } = await supabase
      .from('square_connections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Square connection not found');
    }

    // Decrypt the access token
    const encryption = await getEncryptionService();
    const decryptedAccessToken = await encryption.decrypt(connection.access_token);

    // Log security event for webhook registration
    await logSecurityEvent(supabase, 'SQUARE_WEBHOOK_REGISTRATION', null, restaurantId, {
      merchantId: connection.merchant_id
    });

    // Always use production Square API
    const apiBaseUrl = 'https://connect.squareup.com/v2';
    
    console.log('Using Square Production API:', { 
      apiBaseUrl, 
      merchantId: connection.merchant_id 
    });

    // Webhook configuration - register for Supabase edge function endpoint
    // This single endpoint will handle webhooks from all environments
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/square-webhooks`;
    const webhookName = `Restaurant P&L Webhook - ${restaurantId}`;
    
    // Event types we want to subscribe to
    const eventTypes = [
      'order.created',
      'order.updated',
      'payment.updated',
      'refund.updated',
      'inventory.count.updated'
    ];

    // Check if webhook already exists
    const existingWebhooksResponse = await fetch(`${apiBaseUrl}/webhooks`, {
      headers: {
        'Authorization': `Bearer ${decryptedAccessToken}`,
        'Square-Version': '2024-12-18',
      },
    });

    let existingWebhook = null;
    
    if (existingWebhooksResponse.ok) {
      const existingWebhooks = await existingWebhooksResponse.json();
      existingWebhook = existingWebhooks.subscriptions?.find((webhook: any) => 
        webhook.notification_url === webhookUrl && webhook.name === webhookName
      );
    } else if (existingWebhooksResponse.status === 404) {
      // No webhooks exist yet - this is normal for first-time setup
      console.log('No existing webhooks found (404) - will create new webhook');
    } else {
      // Other errors should still be thrown
      const errorText = await existingWebhooksResponse.text();
      throw new Error(`Failed to fetch existing webhooks: ${existingWebhooksResponse.status} - ${errorText}`);
    }

    let webhookId: string;

    if (existingWebhook) {
      console.log('Webhook already exists, updating:', existingWebhook.id);
      webhookId = existingWebhook.id;
      
      // Update existing webhook
      const updateResponse = await fetch(`${apiBaseUrl}/webhooks/${webhookId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${decryptedAccessToken}`,
          'Square-Version': '2024-12-18',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: {
            name: webhookName,
            notification_url: webhookUrl,
            event_types: eventTypes,
            enabled: true
          }
        }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.text();
        throw new Error(`Failed to update webhook: ${updateResponse.status} - ${errorData}`);
      }

      console.log('Webhook updated successfully');
    } else {
      console.log('Creating new webhook');
      
      // Create new webhook
      const createResponse = await fetch(`${apiBaseUrl}/webhooks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${decryptedAccessToken}`,
          'Square-Version': '2024-12-18',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: {
            name: webhookName,
            notification_url: webhookUrl,
            event_types: eventTypes,
            enabled: true
          }
        }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.text();
        throw new Error(`Failed to create webhook: ${createResponse.status} - ${errorData}`);
      }

      const webhookData = await createResponse.json();
      webhookId = webhookData.subscription.id;
      console.log('Webhook created successfully:', webhookId);
    }

    // Test the webhook
    const testResponse = await fetch(`${apiBaseUrl}/webhooks/${webhookId}/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decryptedAccessToken}`,
        'Square-Version': '2024-12-18',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'order.updated'
      }),
    });

    let testResult = 'unknown';
    let testDetails = null;
    if (testResponse.ok) {
      testResult = 'success';
      testDetails = await testResponse.json();
      console.log('Webhook test successful:', testDetails);
    } else {
      testResult = 'failed';
      const errorDetails = await testResponse.text();
      testDetails = { error: errorDetails, status: testResponse.status };
      console.log('Webhook test failed:', testResponse.status, errorDetails);
    }

    return new Response(JSON.stringify({
      success: true,
      webhookId,
      eventTypes,
      testResult,
      webhookUrl
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Square webhook registration error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});