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

    // Webhook configuration
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
    const existingWebhooksResponse = await fetch('https://connect.squareup.com/v2/webhooks', {
      headers: {
        'Authorization': `Bearer ${decryptedAccessToken}`,
        'Square-Version': '2024-12-18',
      },
    });

    if (!existingWebhooksResponse.ok) {
      throw new Error(`Failed to fetch existing webhooks: ${existingWebhooksResponse.status}`);
    }

    const existingWebhooks = await existingWebhooksResponse.json();
    const existingWebhook = existingWebhooks.subscriptions?.find((webhook: any) => 
      webhook.notification_url === webhookUrl && webhook.name === webhookName
    );

    let webhookId: string;

    if (existingWebhook) {
      console.log('Webhook already exists, updating:', existingWebhook.id);
      webhookId = existingWebhook.id;
      
      // Update existing webhook
      const updateResponse = await fetch(`https://connect.squareup.com/v2/webhooks/${webhookId}`, {
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
      const createResponse = await fetch('https://connect.squareup.com/v2/webhooks', {
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
    const testResponse = await fetch(`https://connect.squareup.com/v2/webhooks/${webhookId}/test`, {
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
    if (testResponse.ok) {
      testResult = 'success';
      console.log('Webhook test successful');
    } else {
      testResult = 'failed';
      console.log('Webhook test failed:', testResponse.status);
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