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

    // Verify user has access to this restaurant (using user_restaurants table)
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('user_restaurants')
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

        // Fetch full account with institution so we can store icon/logo
        const accountWithInstitution = await stripe.financialConnections.accounts.retrieve(
          account.id,
          { expand: ["institution"] }
        );
        const institutionLogoUrl = accountWithInstitution.institution?.icon?.default 
          || accountWithInstitution.institution?.logo?.default 
          || (account.institution_name 
            ? `https://financialconnections.stripe.com/v1/institution/${account.institution_name.toLowerCase().replace(/\s+/g, '-')}/logo`
            : null);

        // Identity-safe reconnect matching (design §4.2), identical to the
        // account.created webhook path: relink the connected_banks row matching
        // (restaurant, institution, account_mask) if one exists in a
        // reconnectable state, else insert a new row — conflict-aware for
        // double-submitted Link flows. This converges on the same row and
        // clears deactivated_at regardless of whether this function or the
        // webhook runs first. The previous lookup here keyed on
        // stripe_financial_account_id = account.id, but Stripe ROTATES the fca_
        // on reconnect, so it missed the pre-reconnect row, fell through to an
        // INSERT, and left the old row's deactivated_at set — keeping the bank
        // stuck requires_reauth after a completed reconnect (incident 2026-07-24).
        const { data: reconnectData, error: reconnectError } = await supabaseAdmin
          .rpc('reconnect_connected_bank', {
            p_restaurant_id: restaurantId,
            p_stripe_financial_account_id: account.id,
            p_institution_name: account.institution_name,
            p_institution_logo_url: institutionLogoUrl,
            p_account_mask: account.last4 ?? null,
          })
          .single();

        if (reconnectError || !reconnectData) {
          console.error(`[VERIFY-SESSION] Error reconnecting bank:`, reconnectError);
          throw reconnectError ?? new Error('reconnect_connected_bank returned no row');
        }

        const reconnectRow = reconnectData as { id: string; created_at: string; connected_at: string };
        const bankId: string = reconnectRow.id;
        // Best-effort telemetry flag for the response only (not used for logic):
        // a fresh insert stamps created_at == connected_at, a relink keeps the
        // original (older) created_at while connected_at is now().
        const isReconnection =
          new Date(reconnectRow.connected_at).getTime() -
            new Date(reconnectRow.created_at).getTime() > 2000;
        console.log(`[VERIFY-SESSION] ${isReconnection ? 'Reconnected' : 'Connected'} bank ${bankId}`);

        // Store balance information if available, via the identity-safe RPC.
        // One Stripe balance row per bank (partial unique index); the RPC rotates
        // the fca_ in place on reconnect instead of inserting a duplicate
        // (incident 2026-07-24). PostgREST cannot express the partial index's
        // WHERE predicate, so this must be an RPC rather than a REST upsert.
        if (account.balance) {
          console.log(`[VERIFY-SESSION] Storing balance for bank ${bankId}`);

          const { error: balanceError } = await supabaseAdmin
            .rpc('upsert_stripe_bank_balance', {
              p_connected_bank_id: bankId,
              p_stripe_financial_account_id: account.id,
              p_account_name: account.display_name,
              p_account_type: account.subcategory || account.category,
              p_account_mask: account.last4,
              p_current_balance: account.balance.current?.[Object.keys(account.balance.current)[0]] || 0,
              p_available_balance: account.balance.cash?.available?.[Object.keys(account.balance.cash.available)[0]] ?? null,
              p_currency: Object.keys(account.balance.current || {})[0]?.toUpperCase() || 'USD',
              p_is_active: true,
              p_as_of_date: new Date(account.balance.as_of * 1000).toISOString(),
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

        // Trigger initial balance refresh to ensure it appears immediately
        console.log(`[VERIFY-SESSION] Triggering initial balance refresh for bank ${bankId}`);
        try {
          const { error: balanceError } = await supabaseAdmin.functions.invoke(
            'stripe-refresh-balance',
            {
              body: { bankId }
            }
          );
          
          if (balanceError) {
            console.error(`[VERIFY-SESSION] Balance refresh failed:`, balanceError);
          }
        } catch (balanceErr) {
          console.error(`[VERIFY-SESSION] Balance refresh error:`, balanceErr);
        }

        results.push({
          accountId: account.id,
          displayName: account.display_name,
          status: 'success',
          isReconnection,
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
