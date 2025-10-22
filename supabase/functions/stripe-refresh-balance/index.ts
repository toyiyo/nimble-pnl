import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[REFRESH-BALANCE] Starting balance refresh");

    // Get request body
    const { bankId } = await req.json();
    
    if (!bankId) {
      throw new Error("Bank ID is required");
    }

    // Use service role to fetch bank details
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check if this is a service role call (from webhook or other internal function)
    const authHeader = req.headers.get("Authorization");
    const isServiceRole = authHeader?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

    if (!isServiceRole) {
      // Regular user call - authenticate and verify access
      console.log("[REFRESH-BALANCE] Authenticating user request");
      
      if (!authHeader) {
        throw new Error("No authorization header provided");
      }

      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { auth: { persistSession: false } }
      );

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
      
      if (authError || !user) {
        throw new Error("User not authenticated");
      }

      // Get bank connection details
      const { data: bank, error: bankError } = await supabaseAdmin
        .from("connected_banks")
        .select("*, restaurant_id")
        .eq("id", bankId)
        .single();

      if (bankError || !bank) {
        throw new Error("Bank not found");
      }

      // Verify user has access to this restaurant
      const { data: userRestaurant } = await supabaseAdmin
        .from("user_restaurants")
        .select("role")
        .eq("restaurant_id", bank.restaurant_id)
        .eq("user_id", user.id)
        .single();

      if (!userRestaurant) {
        throw new Error("User does not have access to this restaurant");
      }
    } else {
      console.log("[REFRESH-BALANCE] Service role call - skipping user authentication");
    }

    console.log("[REFRESH-BALANCE] Refreshing balance for bank:", bankId);

    // Get bank connection details (already fetched for user calls, fetch for service role)
    const { data: bank, error: bankError } = await supabaseAdmin
      .from("connected_banks")
      .select("*, restaurant_id")
      .eq("id", bankId)
      .single();

    if (bankError || !bank) {
      throw new Error("Bank not found");
    }

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, { 
      apiVersion: "2025-08-27.basil" as any
    });

    // Get all Stripe account IDs for this bank connection from balances table
    const { data: balanceRecords } = await supabaseAdmin
      .from("bank_account_balances")
      .select("stripe_financial_account_id, account_name")
      .eq("connected_bank_id", bankId)
      .not("stripe_financial_account_id", "is", null);

    // Extract unique account IDs
    const accountIds = [...new Set(
      balanceRecords?.map(b => b.stripe_financial_account_id).filter(Boolean) || []
    )];

    // If no account IDs found in balances, fall back to primary one from connected_banks
    if (accountIds.length === 0 && bank.stripe_financial_account_id) {
      accountIds.push(bank.stripe_financial_account_id);
    }

    console.log(`[REFRESH-BALANCE] Found ${accountIds.length} account(s) to refresh:`, accountIds);

    const results = [];
    let totalRefreshed = 0;
    let totalFailed = 0;
    let globalRefreshNote = null;

    // Refresh each account
    for (const accountId of accountIds) {
      try {
        console.log(`[REFRESH-BALANCE] Processing account: ${accountId}`);
        
        // Fetch fresh account data from Stripe
        const account = await stripe.financialConnections.accounts.retrieve(accountId);
        console.log(`[REFRESH-BALANCE] Account retrieved: ${account.display_name || accountId}`);

        // Refresh the balance in Stripe (this triggers a new fetch from the bank)
        let finalAccount = account;
        let accountRefreshNote = null;
        
        try {
          const refreshedAccount = await stripe.financialConnections.accounts.refresh(
            accountId,
            { features: ['balance'] }
          );
          console.log(`[REFRESH-BALANCE] Balance refresh succeeded for ${accountId}`);
          
          if (refreshedAccount && refreshedAccount.balance) {
            finalAccount = refreshedAccount;
          } else {
            accountRefreshNote = "Balance refresh initiated. Updated values will arrive via webhook within 1-2 minutes.";
          }
        } catch (refreshError: any) {
          console.log(`[REFRESH-BALANCE] Refresh request sent for ${accountId}, balance will update via webhook:`, refreshError.message);
          accountRefreshNote = "Balance refresh requested. Updated values will arrive via webhook within 1-2 minutes.";
        }

        const currentBalance = finalAccount.balance?.current?.usd;
        const availableBalance = finalAccount.balance?.available?.usd;
        const hasBalanceData = currentBalance !== undefined || availableBalance !== undefined;

        const balanceData = {
          account_name: finalAccount.display_name || finalAccount.institution_name,
          account_type: finalAccount.subcategory,
          account_mask: finalAccount.last4,
          current_balance: currentBalance == null ? 0 : currentBalance / 100,
          available_balance: availableBalance == null ? null : availableBalance / 100,
          currency: "USD",
          is_active: true,
          as_of_date: new Date().toISOString(),
          stripe_financial_account_id: accountId,
        };

        // Update balance record for this specific account
        const { error: upsertError } = await supabaseAdmin
          .from("bank_account_balances")
          .upsert({
            connected_bank_id: bankId,
            ...balanceData
          }, {
            onConflict: 'stripe_financial_account_id'
          });

        if (upsertError) {
          console.error(`[REFRESH-BALANCE] Error upserting balance for ${accountId}:`, upsertError);
          totalFailed++;
          results.push({
            accountId,
            accountName: finalAccount.display_name,
            success: false,
            error: upsertError.message
          });
        } else {
          console.log(`[REFRESH-BALANCE] Balance updated for ${accountId}:`, hasBalanceData ? "with data" : "placeholder created");
          totalRefreshed++;
          results.push({
            accountId,
            accountName: finalAccount.display_name,
            success: true,
            balance: {
              current: balanceData.current_balance,
              available: balanceData.available_balance
            },
            hasData: hasBalanceData
          });
          
          if (accountRefreshNote && !globalRefreshNote) {
            globalRefreshNote = accountRefreshNote;
          }
        }

      } catch (error: any) {
        console.error(`[REFRESH-BALANCE] Error processing account ${accountId}:`, error.message);
        totalFailed++;
        results.push({
          accountId,
          success: false,
          error: error.message
        });
      }
    }

    // Update last_sync_at on the bank
    const { error: syncError } = await supabaseAdmin
      .from("connected_banks")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", bankId);

    if (syncError) {
      console.error(`[REFRESH-BALANCE] Failed to update last_sync_at for bank ${bankId}:`, syncError);
    }

    console.log(`[REFRESH-BALANCE] Complete: ${totalRefreshed} refreshed, ${totalFailed} failed`);

    return new Response(
      JSON.stringify({ 
        success: true,
        totalAccounts: accountIds.length,
        refreshed: totalRefreshed,
        failed: totalFailed,
        results,
        refreshNote: globalRefreshNote,
        message: totalRefreshed > 0 
          ? `Refreshed ${totalRefreshed} account${totalRefreshed > 1 ? 's' : ''}` 
          : totalFailed > 0 
            ? "Failed to refresh accounts" 
            : "No accounts to refresh"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[REFRESH-BALANCE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
