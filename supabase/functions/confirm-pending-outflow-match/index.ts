import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Create client with service role for atomic operations
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Authenticate user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { pendingOutflowId, bankTransactionId } = await req.json();

    if (!pendingOutflowId || !bankTransactionId) {
      throw new Error('Missing required parameters');
    }

    // Verify user has access to this pending outflow
    const { data: pendingOutflow, error: poCheckError } = await supabaseClient
      .from('pending_outflows')
      .select('restaurant_id')
      .eq('id', pendingOutflowId)
      .single();

    if (poCheckError || !pendingOutflow) {
      throw new Error('Pending outflow not found');
    }

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: accessError } = await supabaseClient
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', pendingOutflow.restaurant_id)
      .single();

    if (accessError || !userRestaurant) {
      throw new Error('Access denied');
    }

    const now = new Date().toISOString();

    // Perform both updates atomically using service role
    // If either fails, the other won't be committed
    const { error: poError } = await supabaseClient
      .from('pending_outflows')
      .update({
        status: 'cleared',
        linked_bank_transaction_id: bankTransactionId,
        cleared_at: now,
      })
      .eq('id', pendingOutflowId);

    if (poError) {
      throw new Error(`Failed to update pending outflow: ${poError.message}`);
    }

    const { error: btError } = await supabaseClient
      .from('bank_transactions')
      .update({
        is_categorized: true,
        matched_at: now,
      })
      .eq('id', bankTransactionId);

    if (btError) {
      // Rollback the pending outflow update
      await supabaseClient
        .from('pending_outflows')
        .update({
          status: 'pending',
          linked_bank_transaction_id: null,
          cleared_at: null,
        })
        .eq('id', pendingOutflowId);

      throw new Error(`Failed to update bank transaction: ${btError.message}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        pendingOutflowId, 
        bankTransactionId 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error confirming match:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: error.message === 'Unauthorized' || error.message === 'Access denied' ? 401 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});