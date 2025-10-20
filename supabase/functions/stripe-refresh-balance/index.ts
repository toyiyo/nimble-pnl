import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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

    // Authenticate user
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("User not authenticated");
    }

    // Get request body
    const { bankId } = await req.json();
    
    if (!bankId) {
      throw new Error("Bank ID is required");
    }

    console.log("[REFRESH-BALANCE] Refreshing balance for bank:", bankId);

    // Use service role to fetch bank details
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

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

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, { 
      apiVersion: "2025-08-27.basil" as any
    });

    console.log("[REFRESH-BALANCE] Fetching account from Stripe:", bank.stripe_financial_account_id);

    // Fetch fresh account data from Stripe
    const account = await stripe.financialConnections.accounts.retrieve(
      bank.stripe_financial_account_id
    );

    console.log("[REFRESH-BALANCE] Account retrieved, initial balance:", account.balance);

    // Refresh the balance in Stripe (this triggers a new fetch from the bank)
    let finalAccount = account;
    let refreshNote = null;
    
    try {
      const refreshedAccount = await stripe.financialConnections.accounts.refresh(
        bank.stripe_financial_account_id,
        { features: ['balance'] }
      );
      console.log("[REFRESH-BALANCE] Balance refresh succeeded immediately");
      
      // If refresh succeeded, use the refreshed account data
      if (refreshedAccount && refreshedAccount.balance) {
        finalAccount = refreshedAccount;
        console.log("[REFRESH-BALANCE] Using refreshed balance:", refreshedAccount.balance);
      } else {
        // Refresh initiated but data not immediately available
        console.log("[REFRESH-BALANCE] Refresh initiated, waiting for webhook update");
        refreshNote = "Balance refresh initiated. Updated values will arrive via webhook within 1-2 minutes.";
      }
    } catch (refreshError: any) {
      console.log("[REFRESH-BALANCE] Refresh request sent, balance will update via webhook:", refreshError.message);
      refreshNote = "Balance refresh requested. Updated values will arrive via webhook within 1-2 minutes.";
      // Continue with pre-refresh data as fallback
    }

    // Update balance in our database - create record even if balance is null
    // (E*TRADE and some other institutions don't provide balance immediately)
    
    // Check if we have an existing balance record
    const { data: existingBalance } = await supabaseAdmin
      .from("bank_account_balances")
      .select("id, stripe_financial_account_id")
      .eq("connected_bank_id", bankId)
      .maybeSingle();

    const currentBalance = finalAccount.balance?.current?.usd;
    const availableBalance = finalAccount.balance?.available?.usd;
    const hasBalanceData = currentBalance !== undefined || availableBalance !== undefined;

    const balanceData = {
      account_name: finalAccount.display_name || finalAccount.institution_name,
      account_type: finalAccount.subcategory,
      account_mask: finalAccount.last4,
      current_balance: currentBalance ? currentBalance / 100 : 0,
      available_balance: availableBalance ? availableBalance / 100 : null,
      currency: "USD",
      is_active: true,
      as_of_date: new Date().toISOString(),
      stripe_financial_account_id: bank.stripe_financial_account_id,
    };

    if (existingBalance) {
      // Update existing balance
      const { error: updateError } = await supabaseAdmin
        .from("bank_account_balances")
        .update(balanceData)
        .eq("id", existingBalance.id);

      if (updateError) {
        console.error("[REFRESH-BALANCE] Error updating balance:", updateError);
      } else {
        console.log("[REFRESH-BALANCE] Balance updated:", hasBalanceData ? "with data" : "placeholder created");
      }
    } else {
      // Create new balance record (even if balance is null - webhook will update later)
      const { error: insertError } = await supabaseAdmin
        .from("bank_account_balances")
        .insert({
          connected_bank_id: bankId,
          ...balanceData
        });

      if (insertError) {
        console.error("[REFRESH-BALANCE] Error inserting balance:", insertError);
      } else {
        console.log("[REFRESH-BALANCE] Balance record created:", hasBalanceData ? "with data" : "as placeholder");
      }
    }

    // Update last_sync_at on the bank
    await supabaseAdmin
      .from("connected_banks")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", bankId);

    if (!hasBalanceData) {
      refreshNote = refreshNote || "Balance data not yet available from E*TRADE. Please check back in a few minutes or contact support if this persists.";
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        balance: {
          current: (finalAccount.balance?.current?.usd || 0) / 100,
          available: finalAccount.balance?.available?.usd ? finalAccount.balance.available.usd / 100 : undefined
        },
        source: finalAccount !== account ? "refreshed" : "pre_refresh",
        account_id: finalAccount.id,
        refreshNote,
        usingRefreshedData: finalAccount !== account
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
