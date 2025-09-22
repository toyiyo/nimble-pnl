import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action } = await req.json();

    if (action === 'register_webhook') {
      console.log('Testing webhook registration...');
      
      // Test webhook registration
      const { data, error } = await supabase.functions.invoke('square-webhook-register', {
        body: { restaurantId: 'bfa36fd2-0aa6-45e3-9faa-bca0c853827c' }
      });

      if (error) {
        console.error('Webhook registration error:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: error.message 
        }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      console.log('Webhook registration result:', data);
      return new Response(JSON.stringify({ 
        success: true, 
        data 
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (action === 'test_webhook_endpoint') {
      console.log('Testing webhook endpoint...');
      
      // Simulate a test webhook payload
      const testPayload = {
        merchant_id: 'MLGJF14V2M88Z',
        type: 'order.updated',
        data: {
          id: 'test-order-123',
          type: 'order'
        },
        event_id: 'test-event-' + Date.now()
      };

      // Test the webhook endpoint
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/square-webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload)
      });

      const result = await response.text();
      console.log('Webhook endpoint test result:', response.status, result);

      return new Response(JSON.stringify({
        success: response.ok,
        status: response.status,
        result
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Invalid action' 
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error: any) {
    console.error('Test error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});