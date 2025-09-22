import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { logSecurityEvent } from '../_shared/encryption.ts';

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

    console.log('Square webhook setup started:', { restaurantId });

    // Verify Square connection exists for this restaurant
    const { data: connection, error: connectionError } = await supabase
      .from('square_connections')
      .select('merchant_id')
      .eq('restaurant_id', restaurantId)
      .single();

    if (connectionError || !connection) {
      throw new Error('Square connection not found');
    }

    // Check if application-wide webhook already exists
    const personalAccessToken = Deno.env.get('SQUARE_PERSONAL_ACCESS_TOKEN');
    
    if (!personalAccessToken) {
      throw new Error('Square personal access token not configured');
    }

    // Always use production Square API
    const apiBaseUrl = 'https://connect.squareup.com/v2';
    
    console.log('Checking existing application webhooks');

    // Check existing webhooks for the entire application
    const existingWebhooksResponse = await fetch(`${apiBaseUrl}/webhooks`, {
      headers: {
        'Authorization': `Bearer ${personalAccessToken}`,
        'Square-Version': '2024-12-18',
      },
    });

    if (!existingWebhooksResponse.ok) {
      const errorText = await existingWebhooksResponse.text();
      console.error('Failed to fetch webhooks:', errorText);
      throw new Error(`Failed to check existing webhooks: ${existingWebhooksResponse.status} - ${errorText}`);
    }

    const webhooksData = await existingWebhooksResponse.json();
    console.log('Existing webhooks:', webhooksData);

    // Our application webhook configuration
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/square-webhooks`;
    const webhookName = 'EasyShift Restaurant P&L Webhook';
    
    // Event types we want to subscribe to
    const eventTypes = [
      'order.created',
      'order.updated', 
      'payment.updated',
      'refund.updated',
      'inventory.count.updated'
    ];

    // Check if our application webhook already exists
    const existingWebhook = webhooksData.subscriptions?.find((webhook: any) => 
      webhook.notification_url === webhookUrl && webhook.name === webhookName
    );

    let webhookId: string;
    let webhookResult: string;

    if (existingWebhook) {
      console.log('Application webhook already exists:', existingWebhook.id);
      webhookId = existingWebhook.id;
      webhookResult = 'already_configured';
    } else {
      console.log('Creating application-wide webhook');
      
      // Create the application webhook that will receive events from ALL merchants
      const createResponse = await fetch(`${apiBaseUrl}/webhooks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${personalAccessToken}`,
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
        console.error('Failed to create webhook:', createResponse.status, errorData);
        throw new Error(`Failed to create webhook: ${createResponse.status} - ${errorData}`);
      }

      const webhookData = await createResponse.json();
      webhookId = webhookData.subscription.id;
      webhookResult = 'created';
      console.log('Application webhook created successfully:', webhookId);
    }

    // Log security event
    await logSecurityEvent(supabase, 'SQUARE_WEBHOOK_SETUP', null, restaurantId, {
      merchantId: connection.merchant_id,
      webhookId,
      result: webhookResult
    });

    // Test the webhook
    const testResponse = await fetch(`${apiBaseUrl}/webhooks/${webhookId}/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${personalAccessToken}`,
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
      const errorDetails = await testResponse.text();
      console.log('Webhook test failed:', testResponse.status, errorDetails);
    }

    return new Response(JSON.stringify({
      success: true,
      webhookId,
      eventTypes,
      testResult,
      webhookUrl,
      message: webhookResult === 'already_configured' 
        ? 'Application webhook already configured - your restaurant is ready to receive Square events'
        : 'Application webhook created successfully - your restaurant is ready to receive Square events'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Square webhook setup error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    return new Response(JSON.stringify({
      error: error.message,
      details: error.stack,
      timestamp: new Date().toISOString()
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});