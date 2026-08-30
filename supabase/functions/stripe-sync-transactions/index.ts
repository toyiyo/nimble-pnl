import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  decideAccountAction,
  resultForNeedsReauth,
  resultForSubscribing,
  resultForRefresh,
  shouldStampLastSyncAt,
  computeDataCurrentThrough,
  type AccountSyncResult,
} from "../_shared/bankSyncAccountDecision.ts";

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

    // Enumerate the account to sync from connected_banks' CURRENT fca_ — the
    // single source of truth for which Stripe account is live. Deriving this
    // from bank_account_balances instead used to pick up a stale old-fca_ row
    // left by a reconnect, retrieve that dead account, see it inactive, and
    // re-flag the whole bank requires_reauth seconds after the user finished
    // reconnecting (incident 2026-07-24). A connected_banks row is 1:1 with a
    // real account, so there is exactly one live account id here.
    const accountIds = bank.stripe_financial_account_id
      ? [bank.stripe_financial_account_id]
      : [];

    console.log(`[SYNC-TRANSACTIONS] Found ${accountIds.length} account(s) to sync:`, accountIds);

    let allTransactions: Stripe.FinancialConnections.Transaction[] = [];
    const accountResults: AccountSyncResult[] = [];
    // Accounts whose transactions were fetched this run; each entry's final
    // AccountSyncResult is pushed after insert, once its real synced count
    // is known (design §4.3.4 — per-account results, not a bank-wide
    // synced: 0 whenever one account in the mix is still cold).
    const pendingFetchAccounts: Array<{ accountId: string; refreshStatus: string | undefined }> = [];
    let anyNeedsReauth = false;

    // Process each account
    for (const accountId of accountIds) {
      console.log(`[SYNC-TRANSACTIONS] Processing account: ${accountId}`);

      // Get current account details to check status + subscription
      const account = await stripe.financialConnections.accounts.retrieve(accountId);
      const hasTransactionsSub = !!account.subscriptions?.includes('transactions');

      console.log(`[SYNC-TRANSACTIONS] Account ${accountId} status:`, account.status, 'transactions subscription:', hasTransactionsSub);

      const action = decideAccountAction({ accountStatus: account.status, hasTransactionsSub });

      if (action.kind === 'needs_reauth') {
        console.log(`[SYNC-TRANSACTIONS] Account ${accountId} is not active (status: ${account.status}) - flagging for reauth, skipping fetch`);
        anyNeedsReauth = true;
        accountResults.push(resultForNeedsReauth(accountId));
        continue;
      }

      if (action.kind === 'subscribe') {
        console.log(`[SYNC-TRANSACTIONS] Subscribing account ${accountId} to transactions for first time`);

        try {
          await stripe.financialConnections.accounts.subscribe(
            accountId,
            { features: ['transactions'] }
          );
          console.log(`[SYNC-TRANSACTIONS] Successfully subscribed ${accountId}`);
        } catch (subscribeError: any) {
          console.error(`[SYNC-TRANSACTIONS] Subscribe error for ${accountId}:`, subscribeError.message);
        }

        accountResults.push(resultForSubscribing(accountId));
        continue;
      }

      // action.kind === 'refresh_and_fetch': already-subscribed, active account.
      let refreshStatus: string | undefined;
      try {
        const refreshResult = await stripe.financialConnections.accounts.refresh(
          accountId,
          { features: ['transactions'] }
        );
        refreshStatus = refreshResult.transaction_refresh?.status;
        console.log(`[SYNC-TRANSACTIONS] Refresh status for ${accountId}:`, refreshStatus);
      } catch (refreshError: any) {
        console.log(`[SYNC-TRANSACTIONS] Refresh error for ${accountId} (may be normal):`, refreshError.message);
      }

      if (refreshStatus === 'failed') {
        // Hard signal (design §4.3.2): don't continue into a paginated
        // fetch that will just return nothing.
        console.log(`[SYNC-TRANSACTIONS] Refresh failed for ${accountId} - skipping fetch`);
        accountResults.push(resultForRefresh(accountId, refreshStatus, 0));
        continue;
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

      pendingFetchAccounts.push({ accountId, refreshStatus });
    }

    console.log(`[SYNC-TRANSACTIONS] Total transactions fetched across all accounts: ${allTransactions.length}`);

    // Query tombstones to filter out previously deleted transactions
    const allStripeIds = allTransactions.map(t => t.id);
    let tombstonedIds = new Set<string>();

    if (allStripeIds.length > 0) {
      const { data: tombstones } = await supabaseAdmin
        .from("deleted_bank_transactions")
        .select("external_transaction_id")
        .eq("restaurant_id", bank.restaurant_id)
        .in("external_transaction_id", allStripeIds);

      if (tombstones && tombstones.length > 0) {
        tombstonedIds = new Set(
          tombstones.map(t => t.external_transaction_id).filter((id): id is string => id !== null)
        );
        console.log(`[SYNC-TRANSACTIONS] Found ${tombstonedIds.size} tombstoned transactions to skip`);
      }
    }

    let syncedCount = 0;
    let skippedCount = 0;
    const syncedByAccount = new Map<string, number>();

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

      // Skip transactions that were previously deleted (tombstoned)
      if (tombstonedIds.has(txn.id)) {
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
        syncedByAccount.set(txn.account, (syncedByAccount.get(txn.account) ?? 0) + 1);
      }
    }

    // Finalize per-account results for accounts whose transactions were
    // actually fetched this run, now that their real synced counts are known.
    for (const { accountId, refreshStatus } of pendingFetchAccounts) {
      accountResults.push(resultForRefresh(accountId, refreshStatus, syncedByAccount.get(accountId) ?? 0));
    }

    // Stamp truth, not intent (design §4.3.3). last_sync_at only advances
    // when at least one account actually completed a successful
    // refresh+fetch this run — never unconditionally.
    const bankUpdate: Record<string, unknown> = {};

    if (anyNeedsReauth) {
      // COALESCE-preserving deactivated_at (first outage wins the clock) and
      // sync_error are only expressible via this RPC, not a plain REST
      // update — same reason stripe-financial-connections-webhook's
      // `deactivated` branch uses it (design §4.1/§4.3.1).
      const { error: deactivateError } = await supabaseAdmin.rpc("mark_connected_bank_deactivated", {
        p_stripe_financial_account_id: bank.stripe_financial_account_id,
        p_sync_error: "Stripe reports one or more accounts on this connection are no longer active. Reconnect to resume syncing.",
      });

      if (deactivateError) {
        console.error("[SYNC-TRANSACTIONS] Error marking bank requires_reauth:", deactivateError);
      }
    }

    const refreshFailures = accountResults.filter((r) => r.status === 'refresh_failed');
    if (refreshFailures.length > 0 && !anyNeedsReauth) {
      // Only set here when reauth didn't already write a more specific
      // sync_error above — a bank can't be "needs reauth" and "refresh
      // failed for an unrelated reason" at the same time in the UI.
      bankUpdate.sync_error = refreshFailures.map((r) => r.error).join('; ');
    } else if (refreshFailures.length === 0 && !anyNeedsReauth) {
      // Every account's refresh attempt this run succeeded — clear any
      // sync_error left over from a prior transient failure. Nothing else
      // clears this once set: mark_connected_bank_reactivated only fires on
      // the Stripe `account.reactivated` webhook, not on a later plain sync
      // where the account simply recovers on its own. Without this, a single
      // transient refresh hiccup permanently stains an otherwise healthy,
      // successfully-syncing bank with a stale destructive error message.
      bankUpdate.sync_error = null;
    }

    if (shouldStampLastSyncAt(accountResults)) {
      bankUpdate.last_sync_at = new Date().toISOString();

      // Recompute data_current_through = MAX(transaction_date) over the rows
      // we actually hold for this bank (backward index scan on
      // idx_bank_transactions_bank_date). This is the value the UI prints —
      // never last_sync_at.
      const { data: latestTxn } = await supabaseAdmin
        .from("bank_transactions")
        .select("transaction_date")
        .eq("connected_bank_id", bankId)
        .order("transaction_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const dataCurrentThrough = computeDataCurrentThrough([latestTxn?.transaction_date]);
      if (dataCurrentThrough) {
        bankUpdate.data_current_through = dataCurrentThrough;
      }
    }

    if (Object.keys(bankUpdate).length > 0) {
      const { error: bankUpdateError } = await supabaseAdmin
        .from("connected_banks")
        .update(bankUpdate)
        .eq("id", bankId);

      if (bankUpdateError) {
        console.error("[SYNC-TRANSACTIONS] Error updating bank:", bankUpdateError);
      }
    }

    console.log("[SYNC-TRANSACTIONS] Sync complete:", syncedCount, "new,", skippedCount, "skipped");

    // Auto-categorize newly synced transactions using categorization rules
    if (syncedCount > 0) {
      console.log("[SYNC-TRANSACTIONS] Applying categorization rules to", syncedCount, "new transactions");
      
      try {
        // Internal engine: the public RPC's auth check raises for service-role callers
        // (auth.uid() is NULL). Batch limit 1000 keeps a single call inside edge-fn
        // statement budget; the sync runs frequently so large imports drain over cycles.
        // p_skip_rebuild=true: this function already calls rebuild_account_balances
        // explicitly below (after check_reconciliation_boundary), so skipping the
        // internal engine's default rebuild avoids a redundant second call.
        const { data: rulesResult, error: rulesError } = await supabaseAdmin.rpc('apply_rules_to_bank_transactions_internal', {
          p_restaurant_id: bank.restaurant_id,
          p_batch_limit: 1000,
          p_skip_rebuild: true,
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

      // Best-effort: link newly synced transactions to open pending outflows.
      // p_skip_rebuild=true for the same reason as the rules call above - the
      // explicit rebuild_account_balances call below covers it. A failure here
      // logs and does not fail the sync.
      try {
        const { data: linkResult, error: linkError } = await supabaseAdmin.rpc('auto_link_pending_outflows_internal', {
          p_restaurant_id: bank.restaurant_id,
          p_batch_limit: 100,
          p_skip_rebuild: true,
        });

        if (linkError) {
          console.error("[SYNC-TRANSACTIONS] Error auto-linking pending outflows:", linkError.message);
        } else if (linkResult && linkResult.length > 0) {
          const { linked_count, candidate_count } = linkResult[0];
          console.log(`[SYNC-TRANSACTIONS] Auto-linked ${linked_count} of ${candidate_count} pending outflow candidates`);
        }
      } catch (error: any) {
        console.error("[SYNC-TRANSACTIONS] Error auto-linking pending outflows:", error.message);
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

    const needsReauth = accountResults
      .filter((r) => r.status === 'needs_reauth')
      .map((r) => r.accountId);
    const stillSubscribing = accountResults.some((r) => r.status === 'subscribing');

    let message: string | undefined;
    if (syncedCount > 0) {
      message = `Imported and categorized ${syncedCount} new transactions`;
    } else if (stillSubscribing) {
      message = "Transaction sync initiated for one or more accounts. This will take a few minutes as we fetch your transaction history from the bank. You'll see transactions appear automatically once the sync completes.";
    } else if (needsReauth.length > 0) {
      message = "One or more accounts need to be reconnected before they can sync.";
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: syncedCount,
        skipped: skippedCount,
        total: allTransactions.length,
        accounts: accountResults,
        needsReauth,
        message,
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
