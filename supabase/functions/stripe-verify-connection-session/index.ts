import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[VERIFY-SESSION] Starting session verification");

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the JWT and get user
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    
    if (userError || !user) {
      console.error("[VERIFY-SESSION] Auth error:", userError);
      throw new Error('Unauthorized');
    }

    // Parse request body
    const { sessionId, restaurantId } = await req.json();
    console.log("[VERIFY-SESSION] Session ID:", sessionId, "Restaurant ID:", restaurantId);

    if (!sessionId || !restaurantId) {
      throw new Error('sessionId and restaurantId are required');
    }

    // Verify user has access to this restaurant
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('restaurant_members')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      console.error("[VERIFY-SESSION] Membership check failed:", membershipError);
      throw new Error('Unauthorized - no access to this restaurant');
    }

    if (!['owner', 'manager'].includes(membership.role)) {
      throw new Error('Unauthorized - insufficient permissions');
    }

    // Initialize Stripe
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('Stripe secret key not configured');
    }
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-09-30.clover',
    });

    // Retrieve the Financial Connections session from Stripe
    console.log("[VERIFY-SESSION] Retrieving session from Stripe");
    const session = await stripe.financialConnections.sessions.retrieve(sessionId);
    console.log("[VERIFY-SESSION] Session retrieved, total accounts:", session.accounts?.data?.length || 0);

    if (!session.accounts?.data || session.accounts.data.length === 0) {
      console.log("[VERIFY-SESSION] No accounts linked to this session");
      return new Response(
        JSON.stringify({
          success: false,
          message: 'No accounts were linked during this session',
          accountsProcessed: 0,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Process each linked account
    const results = [];
    for (const account of session.accounts.data) {
      try {
        console.log(`[VERIFY-SESSION] Processing account: ${account.id} - ${account.display_name}`);

        // Check if this account already exists (reconnection case)
        const { data: existingBank, error: checkError } = await supabaseAdmin
          .from('connected_banks')
          .select('id, status')
          .eq('restaurant_id', restaurantId)
          .eq('stripe_financial_account_id', account.id)
          .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error(`[VERIFY-SESSION] Error checking existing bank:`, checkError);
          throw checkError;
        }

        let bankId: string;

        if (existingBank) {
          // Reconnection - update existing record
          console.log(`[VERIFY-SESSION] Reconnecting existing bank: ${existingBank.id}`);
          
          const { error: updateError } = await supabaseAdmin
            .from('connected_banks')
            .update({
              status: 'connected',
              connected_at: new Date().toISOString(),
              disconnected_at: null,
              sync_error: null,
              institution_name: account.institution_name,
              institution_logo_url: account.institution_name ? 
                `https://financialconnections.stripe.com/v1/institution/${account.institution_name.toLowerCase().replace(/\s+/g, '-')}/logo` : 
                null,
            })
            .eq('id', existingBank.id);

          if (updateError) {
            console.error(`[VERIFY-SESSION] Error updating bank:`, updateError);
            throw updateError;
          }

          bankId = existingBank.id;
        } else {
          // New connection - create new record
          console.log(`[VERIFY-SESSION] Creating new bank connection`);
          
          const { data: newBank, error: insertError } = await supabaseAdmin
            .from('connected_banks')
            .insert({
              restaurant_id: restaurantId,
              stripe_financial_account_id: account.id,
              institution_name: account.institution_name,
              institution_logo_url: account.institution_name ? 
                `https://financialconnections.stripe.com/v1/institution/${account.institution_name.toLowerCase().replace(/\s+/g, '-')}/logo` : 
                null,
              status: 'connected',
              connected_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (insertError) {
            console.error(`[VERIFY-SESSION] Error creating bank:`, insertError);
            throw insertError;
          }

          bankId = newBank.id;
        }

        // Store balance information if available
        if (account.balance) {
          console.log(`[VERIFY-SESSION] Storing balance for bank ${bankId}`);
          
          const { error: balanceError } = await supabaseAdmin
            .from('bank_account_balances')
            .upsert({
              connected_bank_id: bankId,
              account_name: account.display_name,
              account_type: account.subcategory || account.category,
              account_mask: account.last4,
              current_balance: account.balance.current?.[Object.keys(account.balance.current)[0]] || 0,
              available_balance: account.balance.cash?.available?.[Object.keys(account.balance.cash.available)[0]] || null,
              currency: Object.keys(account.balance.current || {})[0]?.toUpperCase() || 'USD',
              as_of_date: new Date(account.balance.as_of * 1000).toISOString(),
              is_active: true,
            }, {
              onConflict: 'connected_bank_id,account_mask',
            });

          if (balanceError) {
            console.error(`[VERIFY-SESSION] Error storing balance:`, balanceError);
          }
        }

        // Trigger transaction sync
        console.log(`[VERIFY-SESSION] Triggering transaction sync for bank ${bankId}`);
        try {
          const { error: syncError } = await supabaseAdmin.functions.invoke(
            'stripe-sync-transactions',
            {
              body: { bankId }
            }
          );
          
          if (syncError) {
            console.error(`[VERIFY-SESSION] Transaction sync failed:`, syncError);
          }
        } catch (syncErr) {
          console.error(`[VERIFY-SESSION] Transaction sync error:`, syncErr);
        }

        results.push({
          accountId: account.id,
          displayName: account.display_name,
          status: 'success',
          isReconnection: !!existingBank,
        });

      } catch (accountError) {
        console.error(`[VERIFY-SESSION] Error processing account ${account.id}:`, accountError);
        results.push({
          accountId: account.id,
          displayName: account.display_name,
          status: 'error',
          error: accountError instanceof Error ? accountError.message : 'Unknown error',
        });
      }
    }

    console.log("[VERIFY-SESSION] Processing complete. Results:", results);

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return new Response(
      JSON.stringify({
        success: true,
        accountsProcessed: successCount,
        accountsFailed: errorCount,
        results,
        message: `Successfully connected ${successCount} account(s)${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('[VERIFY-SESSION] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
