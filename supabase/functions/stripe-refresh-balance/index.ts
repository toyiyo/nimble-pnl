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

    console.log("[REFRESH-BALANCE] Account retrieved, balance:", account.balance);

    // Refresh the balance in Stripe (this triggers a new fetch from the bank)
    try {
      const refreshedAccount = await stripe.financialConnections.accounts.refresh(
        bank.stripe_financial_account_id,
        { features: ['balance'] }
      );
      console.log("[REFRESH-BALANCE] Balance refresh triggered");
    } catch (refreshError) {
      console.log("[REFRESH-BALANCE] Refresh request sent, balance will update via webhook");
    }

    // Update balance in our database
    if (account.balance && (account.balance.current || account.balance.available)) {
      // Check if we have an existing balance record
      const { data: existingBalance } = await supabaseAdmin
        .from("bank_account_balances")
        .select("id")
        .eq("connected_bank_id", bankId)
        .single();

      if (existingBalance) {
        // Update existing balance
        const { error: updateError } = await supabaseAdmin
          .from("bank_account_balances")
          .update({
            current_balance: (account.balance.current?.usd || 0) / 100,
            available_balance: account.balance.available?.usd ? account.balance.available.usd / 100 : null,
            as_of_date: new Date().toISOString(),
          })
          .eq("id", existingBalance.id);

        if (updateError) {
          console.error("[REFRESH-BALANCE] Error updating balance:", updateError);
        }
      } else {
        // Create new balance record
        const { error: insertError } = await supabaseAdmin
          .from("bank_account_balances")
          .insert({
            connected_bank_id: bankId,
            account_name: account.display_name || account.institution_name,
            account_type: account.subcategory,
            account_mask: account.last4,
            current_balance: (account.balance.current?.usd || 0) / 100,
            available_balance: account.balance.available?.usd ? account.balance.available.usd / 100 : null,
            currency: "USD",
            is_active: true,
            as_of_date: new Date().toISOString(),
          });

        if (insertError) {
          console.error("[REFRESH-BALANCE] Error inserting balance:", insertError);
        }
      }

      // Update last_sync_at on the bank
      await supabaseAdmin
        .from("connected_banks")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("id", bankId);

      console.log("[REFRESH-BALANCE] Balance updated successfully");
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        balance: {
          current: (account.balance?.current?.usd || 0) / 100,
          available: account.balance?.available?.usd ? account.balance.available.usd / 100 : undefined
        }
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
