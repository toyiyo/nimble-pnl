import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { computeAsOfDate } from "../_shared/bankBalanceAsOf.ts";

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

    // Enumerate the account to refresh from connected_banks' CURRENT fca_ —
    // the single source of truth for which Stripe account is live. Deriving
    // this from bank_account_balances instead used to pick up a stale old-fca_
    // row left by a reconnect (incident 2026-07-24). A connected_banks row is
    // 1:1 with a real account, so there is exactly one live account id here.
    const accountIds = bank.stripe_financial_account_id
      ? [bank.stripe_financial_account_id]
      : [];

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

        // Never invent a date: only include `as_of_date` in the payload when
        // Stripe actually supplied `balance.as_of`. Omitting the key leaves
        // whatever value is already persisted untouched on conflict, rather
        // than stamping `now()` (design §4.4).
        const asOfDate = computeAsOfDate(finalAccount.balance?.as_of);

        const balanceData = {
          account_name: finalAccount.display_name || finalAccount.institution_name,
          account_type: finalAccount.subcategory,
          account_mask: finalAccount.last4,
          current_balance: currentBalance == null ? 0 : currentBalance / 100,
          available_balance: availableBalance == null ? null : availableBalance / 100,
          currency: "USD",
          is_active: true,
          ...(asOfDate !== undefined ? { as_of_date: asOfDate } : {}),
          stripe_financial_account_id: accountId,
        };

        // Update balance record for this specific account via the identity-safe
        // RPC. One Stripe row per bank; Stripe rotates fca_ ids on reconnect, so
        // a plain upsert keyed on the fca_ would orphan the pre-reconnect row
        // (incident 2026-07-24). The RPC rotates the fca_ in place. as_of_date
        // is omitted when Stripe gave no balance.as_of (null => keep persisted).
        const { error: upsertError } = await supabaseAdmin
          .rpc("upsert_stripe_bank_balance", {
            p_connected_bank_id: bankId,
            p_stripe_financial_account_id: accountId,
            p_account_name: balanceData.account_name,
            p_account_type: balanceData.account_type,
            p_account_mask: balanceData.account_mask,
            p_current_balance: balanceData.current_balance,
            p_available_balance: balanceData.available_balance,
            p_currency: balanceData.currency,
            p_is_active: balanceData.is_active,
            p_as_of_date: asOfDate ?? null,
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
