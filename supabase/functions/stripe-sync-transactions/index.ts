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
    console.log("[SYNC-TRANSACTIONS] Starting transaction sync");

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

    console.log("[SYNC-TRANSACTIONS] Syncing transactions for bank:", bankId);

    // Use service role for database operations
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

    // Verify user has access
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

    console.log("[SYNC-TRANSACTIONS] Checking account subscription status");

    // Get current account details to check subscription
    const account = await stripe.financialConnections.accounts.retrieve(
      bank.stripe_financial_account_id
    );

    const hasTransactionsSub = account.subscriptions?.includes('transactions');
    console.log("[SYNC-TRANSACTIONS] Has transactions subscription:", hasTransactionsSub);

    if (!hasTransactionsSub) {
      console.log("[SYNC-TRANSACTIONS] Subscribing to transactions for first time");
      
      try {
        await stripe.financialConnections.accounts.subscribe({
          account: bank.stripe_financial_account_id,
          features: ['transactions'],
        });
        console.log("[SYNC-TRANSACTIONS] Successfully subscribed - initial sync will take a few minutes");
        
        return new Response(
          JSON.stringify({ 
            success: true,
            synced: 0,
            skipped: 0,
            total: 0,
            message: "Transaction sync initiated. This will take a few minutes as we fetch your transaction history from the bank. You'll see transactions appear automatically once the sync completes."
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      } catch (subscribeError: any) {
        console.error("[SYNC-TRANSACTIONS] Subscribe error:", subscribeError.message);
        throw new Error(`Failed to subscribe to transactions: ${subscribeError.message}`);
      }
    }

    console.log("[SYNC-TRANSACTIONS] Triggering transaction refresh");

    // Refresh to get latest transactions
    try {
      const refreshResult = await stripe.financialConnections.accounts.refresh({
        account: bank.stripe_financial_account_id,
        features: ['transactions'],
      });
      console.log("[SYNC-TRANSACTIONS] Refresh status:", refreshResult.transaction_refresh?.status);
    } catch (refreshError: any) {
      console.log("[SYNC-TRANSACTIONS] Refresh error (may be normal):", refreshError.message);
    }

    console.log("[SYNC-TRANSACTIONS] Fetching transactions from Stripe");

    // Try to fetch transactions
    let transactions;
    try {
      transactions = await stripe.financialConnections.transactions.list({
        account: bank.stripe_financial_account_id,
        limit: 100, // Get last 100 transactions
      });
      console.log("[SYNC-TRANSACTIONS] Found", transactions.data.length, "transactions");
    } catch (fetchError: any) {
      console.log("[SYNC-TRANSACTIONS] No transactions available yet:", fetchError.message);
      
      return new Response(
        JSON.stringify({ 
          success: true,
          synced: 0,
          skipped: 0,
          total: 0,
          message: "Transaction sync in progress. Transactions are being fetched from your bank and will appear shortly."
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    let syncedCount = 0;
    let skippedCount = 0;

    // Store each transaction
    for (const txn of transactions.data) {
      // Check if transaction already exists
      const { data: existing } = await supabaseAdmin
        .from("bank_transactions")
        .select("id")
        .eq("stripe_transaction_id", txn.id)
        .single();

      if (existing) {
        skippedCount++;
        continue;
      }

      // Insert new transaction
      const { error: insertError } = await supabaseAdmin
        .from("bank_transactions")
        .insert({
          restaurant_id: bank.restaurant_id,
          connected_bank_id: bankId,
          stripe_transaction_id: txn.id,
          transaction_date: new Date(txn.transacted_at * 1000).toISOString(),
          posted_date: txn.posted_at ? new Date(txn.posted_at * 1000).toISOString() : null,
          amount: txn.amount / 100, // Convert cents to dollars
          currency: txn.currency.toLowerCase(),
          description: txn.description,
          merchant_name: (txn as any).merchant_name,
          category: (txn as any).category,
          status: txn.status,
          raw_data: txn,
        });

      if (insertError) {
        console.error("[SYNC-TRANSACTIONS] Error inserting transaction:", insertError);
      } else {
        syncedCount++;
      }
    }

    // Update last_sync_at on the bank
    await supabaseAdmin
      .from("connected_banks")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", bankId);

    console.log("[SYNC-TRANSACTIONS] Sync complete:", syncedCount, "new,", skippedCount, "skipped");

    return new Response(
      JSON.stringify({ 
        success: true,
        synced: syncedCount,
        skipped: skippedCount,
        total: transactions.data.length
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SYNC-TRANSACTIONS] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
