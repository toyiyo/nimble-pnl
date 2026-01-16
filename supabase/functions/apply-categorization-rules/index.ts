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
      throw new Error('No authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { restaurantId, applyTo = 'both', batchLimit = 100 } = await req.json();
    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }
    
    console.log(`Applying rules to ${applyTo} for restaurant ${restaurantId} (batch limit: ${batchLimit})`);


    // Verify user has access to this restaurant
    const { data: userRestaurant, error: accessError } = await supabaseClient
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (accessError || !userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
      throw new Error('Access denied');
    }

    let bankResults = { applied_count: 0, total_count: 0 };
    let posResults = { applied_count: 0, total_count: 0 };

    // Apply rules to bank transactions
    if (applyTo === 'bank_transactions' || applyTo === 'both') {
      console.log('Applying rules to bank transactions...');
      const { data: bankData, error: bankError } = await supabaseClient
        .rpc('apply_rules_to_bank_transactions', {
          p_restaurant_id: restaurantId,
          p_batch_limit: batchLimit
        });

      if (bankError) {
        console.error('Error applying rules to bank transactions:', bankError);
        throw new Error(`Failed to apply rules to bank transactions: ${bankError.message}`);
      }

      if (bankData && bankData.length > 0) {
        bankResults = bankData[0];
        console.log(`Bank transactions result: ${bankResults.applied_count} applied of ${bankResults.total_count} processed`);
      }
    }

    // Apply rules to POS sales
    if (applyTo === 'pos_sales' || applyTo === 'both') {
      console.log('Applying rules to POS sales...');
      const { data: posData, error: posError } = await supabaseClient
        .rpc('apply_rules_to_pos_sales', {
          p_restaurant_id: restaurantId,
          p_batch_limit: batchLimit
        });

      if (posError) {
        console.error('Error applying rules to POS sales:', posError);
        throw new Error(`Failed to apply rules to POS sales: ${posError.message}`);
      }

      if (posData && posData.length > 0) {
        posResults = posData[0];
        console.log(`POS sales result: ${posResults.applied_count} applied of ${posResults.total_count} processed`);
      }
    }

    const totalApplied = bankResults.applied_count + posResults.applied_count;
    const totalProcessed = bankResults.total_count + posResults.total_count;

    let message = '';
    if (applyTo === 'both') {
      message = `Applied rules to ${totalApplied} of ${totalProcessed} transactions (${bankResults.applied_count} bank, ${posResults.applied_count} POS)`;
    } else if (applyTo === 'bank_transactions') {
      message = `Applied rules to ${bankResults.applied_count} of ${bankResults.total_count} bank transactions`;
    } else {
      message = `Applied rules to ${posResults.applied_count} of ${posResults.total_count} POS sales`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message,
        count: totalApplied,
        details: {
          bank: bankResults,
          pos: posResults
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
