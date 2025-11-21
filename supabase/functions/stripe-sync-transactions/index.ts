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
    console.log("[SYNC-TRANSACTIONS] Starting transaction sync");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    // Check if this is an internal service role call (from webhook) or user call
    const isServiceRoleCall = token === serviceRoleKey;
    
    let userId: string | undefined;

    if (!isServiceRoleCall) {
      // Authenticate user for regular calls
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { auth: { persistSession: false } }
      );

      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
      
      if (authError || !user) {
        throw new Error("User not authenticated");
      }
      
      userId = user.id;
      console.log("[SYNC-TRANSACTIONS] Authenticated user:", userId);
    } else {
      console.log("[SYNC-TRANSACTIONS] Service role call (from webhook)");
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
      serviceRoleKey
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

    // Verify user has access (only for non-service-role calls)
    if (!isServiceRoleCall && userId) {
      const { data: userRestaurant } = await supabaseAdmin
        .from("user_restaurants")
        .select("role")
        .eq("restaurant_id", bank.restaurant_id)
        .eq("user_id", userId)
        .single();

      if (!userRestaurant) {
        throw new Error("User does not have access to this restaurant");
      }
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

    console.log(`[SYNC-TRANSACTIONS] Found ${accountIds.length} account(s) to sync:`, accountIds);

    let needsSubscriptionSetup = false;
    let allTransactions: Stripe.FinancialConnections.Transaction[] = [];

    // Process each account
    for (const accountId of accountIds) {
      console.log(`[SYNC-TRANSACTIONS] Processing account: ${accountId}`);

      // Get current account details to check subscription
      const account = await stripe.financialConnections.accounts.retrieve(accountId);
      const hasTransactionsSub = account.subscriptions?.includes('transactions');
      
      console.log(`[SYNC-TRANSACTIONS] Account ${accountId} has transactions subscription:`, hasTransactionsSub);

      if (!hasTransactionsSub) {
        console.log(`[SYNC-TRANSACTIONS] Subscribing account ${accountId} to transactions for first time`);
        needsSubscriptionSetup = true;
        
        try {
          await stripe.financialConnections.accounts.subscribe(
            accountId,
            { features: ['transactions'] }
          );
          console.log(`[SYNC-TRANSACTIONS] Successfully subscribed ${accountId}`);
        } catch (subscribeError: any) {
          console.error(`[SYNC-TRANSACTIONS] Subscribe error for ${accountId}:`, subscribeError.message);
        }
      } else {
        // Trigger refresh for accounts already subscribed
        try {
          const refreshResult = await stripe.financialConnections.accounts.refresh(
            accountId,
            { features: ['transactions'] }
          );
          console.log(`[SYNC-TRANSACTIONS] Refresh status for ${accountId}:`, refreshResult.transaction_refresh?.status);
        } catch (refreshError: any) {
          console.log(`[SYNC-TRANSACTIONS] Refresh error for ${accountId} (may be normal):`, refreshError.message);
        }

        // Fetch transactions for this account
        try {
          let hasMore = true;
          let startingAfter: string | undefined = undefined;
          
          while (hasMore) {
            const params: any = {
              account: accountId,
              limit: 100,
            };
            
            if (startingAfter) {
              params.starting_after = startingAfter;
            }
            
            const page = await stripe.financialConnections.transactions.list(params);
            allTransactions = allTransactions.concat(page.data);
            hasMore = page.has_more;
            
            if (hasMore && page.data.length > 0) {
              startingAfter = page.data[page.data.length - 1].id;
            }
            
            console.log(`[SYNC-TRANSACTIONS] Fetched ${page.data.length} transactions from ${accountId}, total so far: ${allTransactions.length}`);
          }
        } catch (fetchError: any) {
          console.log(`[SYNC-TRANSACTIONS] No transactions available yet for ${accountId}:`, fetchError.message);
        }
      }
    }

    // If any accounts needed subscription setup, return early
    if (needsSubscriptionSetup) {
      console.log("[SYNC-TRANSACTIONS] One or more accounts needed subscription setup - initial sync will take a few minutes");
      
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
    }

    console.log(`[SYNC-TRANSACTIONS] Total transactions fetched across all accounts: ${allTransactions.length}`);

    let syncedCount = 0;
    let skippedCount = 0;

    // Store each transaction
    for (const txn of allTransactions) {
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

      // Insert new transaction - NO default category set
      // Safely extract merchant_name with optional chaining and type guard
      const merchantName = typeof (txn as any).merchant_name === 'string' 
        ? (txn as any).merchant_name 
        : null;
      
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
          merchant_name: merchantName,
          status: txn.status,
          category_id: null, // No default category - let AI/rules handle it
          is_categorized: false,
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

    // Auto-categorize newly synced transactions using categorization rules
    if (syncedCount > 0) {
      console.log("[SYNC-TRANSACTIONS] Applying categorization rules to", syncedCount, "new transactions");
      
      try {
        // First try to apply categorization rules
        const { data: rulesResult, error: rulesError } = await supabaseAdmin.rpc('apply_rules_to_bank_transactions', {
          p_restaurant_id: bank.restaurant_id
        });

        if (rulesError) {
          console.error("[SYNC-TRANSACTIONS] Error applying rules:", rulesError.message);
        } else if (rulesResult && rulesResult.length > 0) {
          const { applied_count, total_count } = rulesResult[0];
          console.log(`[SYNC-TRANSACTIONS] Applied rules to ${applied_count} of ${total_count} transactions`);
        }
      } catch (error: any) {
        console.error("[SYNC-TRANSACTIONS] Error applying categorization rules:", error.message);
      }
      
      // Skip default categorization - let rules and AI handle it
      console.log("[SYNC-TRANSACTIONS] Skipping default categorization - transactions will be processed by rules/AI");
      
      // Check for reconciliation boundary violations and auto-fix
      try {
        console.log("[SYNC-TRANSACTIONS] Checking reconciliation boundary");
        const { data: checkData, error: checkError } = await supabaseAdmin.rpc('check_reconciliation_boundary', {
          p_restaurant_id: bank.restaurant_id
        });

        if (checkError) {
          console.error("[SYNC-TRANSACTIONS] Error checking reconciliation:", checkError.message);
        } else if (checkData && checkData.has_violation) {
          console.log("[SYNC-TRANSACTIONS] Reconciliation violation detected, applying adjustment");
          const { error: adjustError } = await supabaseAdmin.rpc('apply_reconciliation_adjustment', {
            p_restaurant_id: bank.restaurant_id
          });
          
          if (adjustError) {
            console.error("[SYNC-TRANSACTIONS] Error applying adjustment:", adjustError.message);
          } else {
            console.log("[SYNC-TRANSACTIONS] Reconciliation adjustment applied successfully");
          }
        } else {
          // No violation, just rebuild balances
          console.log("[SYNC-TRANSACTIONS] No reconciliation issues, rebuilding account balances");
          await supabaseAdmin.rpc('rebuild_account_balances', {
            p_restaurant_id: bank.restaurant_id
          });
          console.log("[SYNC-TRANSACTIONS] Account balances rebuilt successfully");
        }
      } catch (error: any) {
        console.error("[SYNC-TRANSACTIONS] Error in reconciliation check/fix:", error.message);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        synced: syncedCount,
        skipped: skippedCount,
        total: allTransactions.length,
        message: syncedCount > 0 ? `Imported and categorized ${syncedCount} new transactions` : undefined
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
