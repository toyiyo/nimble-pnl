import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[FC-WEBHOOK] Received webhook");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, { 
      apiVersion: "2025-08-27.basil" as any
    });

    // Verify webhook signature
    const signature = req.headers.get("stripe-signature");
    const webhookSecret = Deno.env.get("STRIPE_FINANCIAL_CONNECTIONS_WEBHOOK_SECRET");
    
    if (!signature || !webhookSecret) {
      console.error("[FC-WEBHOOK] Missing signature or webhook secret");
      return new Response(
        JSON.stringify({ error: "Webhook signature verification failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    console.log("[FC-WEBHOOK] Event type:", event.type);

    // Initialize Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check if event has already been processed (idempotency)
    const { data: existingEvent, error: eventCheckError } = await supabaseClient
      .from("stripe_events")
      .select("stripe_event_id")
      .eq("stripe_event_id", event.id)
      .maybeSingle();

    if (eventCheckError) {
      console.error("[FC-WEBHOOK] Error checking event:", eventCheckError);
      throw eventCheckError;
    }

    if (existingEvent) {
      console.log("[FC-WEBHOOK] Event already processed:", event.id);
      return new Response(
        JSON.stringify({ received: true, message: "Event already processed" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log("[FC-WEBHOOK] Processing new event:", event.id);

    // Handle different event types
    switch (event.type) {
      case "financial_connections.account.created": {
        const account = event.data.object as Stripe.FinancialConnections.Account;
        console.log("[FC-WEBHOOK] Account connected:", account.id);

        // Get customer ID from account holder
        const customerId = account.account_holder?.customer;
        
        if (!customerId) {
          console.error("[FC-WEBHOOK] No customer ID in account holder");
          break;
        }

        // Fetch customer to get restaurant ID from metadata
        const customer = await stripe.customers.retrieve(customerId);
        const restaurantId = (customer as any).metadata?.restaurant_id;
        
        if (!restaurantId) {
          console.error("[FC-WEBHOOK] No restaurant ID in customer metadata");
          break;
        }

        console.log("[FC-WEBHOOK] Restaurant ID from customer metadata:", restaurantId);

        // Store connected bank info using upsert to handle duplicate events
        const { data: bankData, error: bankError } = await supabaseClient
          .from("connected_banks")
          .upsert({
            restaurant_id: restaurantId,
            stripe_financial_account_id: account.id,
            institution_name: account.institution_name,
            institution_logo_url: null,
            status: "connected",
            connected_at: new Date().toISOString(),
            last_sync_at: new Date().toISOString(),
          }, {
            onConflict: "stripe_financial_account_id",
            ignoreDuplicates: false, // Update existing record
          })
          .select()
          .single();

        if (bankError) {
          console.error("[FC-WEBHOOK] Error storing/updating bank:", bankError);
          throw bankError;
        }

        console.log("[FC-WEBHOOK] Bank stored/updated with ID:", bankData.id);

        // Trigger initial transaction sync
        console.log("[FC-WEBHOOK] Triggering initial transaction sync...");
        try {
          const syncResponse = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-sync-transactions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ bankId: bankData.id }),
            }
          );
          
          if (syncResponse.ok) {
            console.log("[FC-WEBHOOK] Initial sync triggered successfully");
          } else {
            const errorText = await syncResponse.text();
            console.error("[FC-WEBHOOK] Failed to trigger initial sync:", errorText);
          }
        } catch (syncError) {
          console.error("[FC-WEBHOOK] Error triggering sync:", syncError);
        }

        // Fetch account details with balance from Stripe (since webhook may not include it)
        let balanceData = account.balance;
        if (!balanceData) {
          console.log("[FC-WEBHOOK] No balance in event, fetching from Stripe...");
          try {
            const fullAccount = await stripe.financialConnections.accounts.retrieve(account.id);
            balanceData = fullAccount.balance;
            console.log("[FC-WEBHOOK] Fetched balance:", balanceData);
          } catch (fetchError) {
            console.error("[FC-WEBHOOK] Error fetching account details:", fetchError);
          }
        }

        // Store account balance info using upsert to handle duplicate events
        // Create balance record even if balance is null (E*TRADE returns null initially)
        const currentBalance = balanceData?.current?.usd;
        const availableBalance = balanceData?.available?.usd;
        const hasBalanceData = currentBalance !== undefined || availableBalance !== undefined;

        const { error: balanceError } = await supabaseClient
          .from("bank_account_balances")
          .upsert({
            connected_bank_id: bankData.id,
            stripe_financial_account_id: account.id,
            account_name: account.display_name || account.institution_name,
            account_type: account.subcategory,
            account_mask: account.last4,
            current_balance: currentBalance ? currentBalance / 100 : 0,
            available_balance: availableBalance ? availableBalance / 100 : null,
            currency: "USD",
            is_active: true,
            as_of_date: new Date().toISOString(),
          }, {
            onConflict: "stripe_financial_account_id",
            ignoreDuplicates: false, // Update existing record
          });

        if (balanceError) {
          console.error("[FC-WEBHOOK] Error storing/updating balance:", balanceError);
        } else {
          console.log("[FC-WEBHOOK] Balance record", hasBalanceData ? "stored with data" : "created as placeholder");
        }

        // Record event as processed after successful handling
        const { error: recordError } = await supabaseClient
          .from("stripe_events")
          .insert({
            stripe_event_id: event.id,
            event_type: event.type,
          });

        if (recordError) {
          console.error("[FC-WEBHOOK] Error recording event:", recordError);
          // Don't throw - bank is created, just log the error
        } else {
          console.log("[FC-WEBHOOK] Event recorded as processed");
        }

        console.log("[FC-WEBHOOK] Bank account created successfully");
        break;
      }

      case "financial_connections.account.disconnected": {
        const account = event.data.object as Stripe.FinancialConnections.Account;
        console.log("[FC-WEBHOOK] Account disconnected:", account.id);

        // Update bank status
        const { error: updateError } = await supabaseClient
          .from("connected_banks")
          .update({
            status: "disconnected",
            disconnected_at: new Date().toISOString(),
          })
          .eq("stripe_financial_account_id", account.id);

        if (updateError) {
          console.error("[FC-WEBHOOK] Error updating bank:", updateError);
          throw updateError;
        }

        // Record event as processed
        const { error: recordError } = await supabaseClient
          .from("stripe_events")
          .insert({
            stripe_event_id: event.id,
            event_type: event.type,
          });

        if (recordError) {
          console.error("[FC-WEBHOOK] Error recording event:", recordError);
        }

        console.log("[FC-WEBHOOK] Bank status updated to disconnected");
        break;
      }

      case "financial_connections.account.refreshed_balance": {
        const account = event.data.object as Stripe.FinancialConnections.Account;
        console.log("[FC-WEBHOOK] Balance refreshed:", account.id);

        // Find the connected bank
        const { data: bank } = await supabaseClient
          .from("connected_banks")
          .select("id")
          .eq("stripe_financial_account_id", account.id)
          .single();

        if (bank && account.balance) {
          // Update balance using stripe_financial_account_id for precise targeting
          const { error: balanceError } = await supabaseClient
            .from("bank_account_balances")
            .update({
              current_balance: (account.balance.current?.usd || 0) / 100,
              available_balance: account.balance.available?.usd ? account.balance.available.usd / 100 : null,
              as_of_date: new Date().toISOString(),
            })
            .eq("stripe_financial_account_id", account.id)
            .eq("connected_bank_id", bank.id); // Keep as safety filter

          if (balanceError) {
            console.error("[FC-WEBHOOK] Error updating balance:", balanceError);
          } else {
            console.log("[FC-WEBHOOK] Balance updated successfully");
          }

          // Record event as processed
          const { error: recordError } = await supabaseClient
            .from("stripe_events")
            .insert({
              stripe_event_id: event.id,
              event_type: event.type,
            });

          if (recordError) {
            console.error("[FC-WEBHOOK] Error recording event:", recordError);
          }
        }
        break;
      }

      case "financial_connections.account.refreshed_transactions": {
        const account = event.data.object as Stripe.FinancialConnections.Account;
        console.log("[FC-WEBHOOK] Transactions refreshed for account:", account.id);

        // Find the connected bank
        const { data: bank } = await supabaseClient
          .from("connected_banks")
          .select("id")
          .eq("stripe_financial_account_id", account.id)
          .single();

        if (bank) {
          console.log("[FC-WEBHOOK] Triggering transaction sync and balance refresh for bank:", bank.id);
          
          // Trigger transaction sync to pull the new transactions
          try {
            const syncResponse = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-sync-transactions`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({ bankId: bank.id }),
              }
            );
            
            if (syncResponse.ok) {
              const syncResult = await syncResponse.json();
              console.log("[FC-WEBHOOK] Transaction sync completed:", syncResult);
            } else {
              const errorText = await syncResponse.text();
              console.error("[FC-WEBHOOK] Transaction sync failed:", errorText);
            }
          } catch (syncError) {
            console.error("[FC-WEBHOOK] Error triggering transaction sync:", syncError);
          }

          // Also refresh balance to keep it in sync with transactions
          try {
            const balanceResponse = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/stripe-refresh-balance`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({ bankId: bank.id }),
              }
            );
            
            if (balanceResponse.ok) {
              console.log("[FC-WEBHOOK] Balance refresh triggered successfully");
            } else {
              const errorText = await balanceResponse.text();
              console.error("[FC-WEBHOOK] Balance refresh failed:", errorText);
            }
          } catch (balanceError) {
            console.error("[FC-WEBHOOK] Error triggering balance refresh:", balanceError);
          }

          // Record event as processed
          const { error: recordError } = await supabaseClient
            .from("stripe_events")
            .insert({
              stripe_event_id: event.id,
              event_type: event.type,
            });

          if (recordError) {
            console.error("[FC-WEBHOOK] Error recording event:", recordError);
          }
        } else {
          console.error("[FC-WEBHOOK] Bank not found for account:", account.id);
        }
        break;
      }

      default:
        console.log("[FC-WEBHOOK] Unhandled event type:", event.type);
        // Still record unhandled events to prevent reprocessing
        await supabaseClient
          .from("stripe_events")
          .insert({
            stripe_event_id: event.id,
            event_type: event.type,
          });
    }

    return new Response(
      JSON.stringify({ received: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[FC-WEBHOOK] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
