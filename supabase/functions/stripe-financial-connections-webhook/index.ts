import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    console.log("[FC-WEBHOOK] Event type:", event.type);

    // Initialize Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Handle different event types
    switch (event.type) {
      case "financial_connections.account.created": {
        const account = event.data.object as Stripe.FinancialConnections.Account;
        console.log("[FC-WEBHOOK] Account connected:", account.id);

        // Extract restaurant ID from account holder reference
        const restaurantId = account.account_holder?.account;
        
        if (!restaurantId) {
          console.error("[FC-WEBHOOK] No restaurant ID in account holder");
          break;
        }

        // Store connected bank info
        const { error: bankError } = await supabaseClient
          .from("connected_banks")
          .insert({
            restaurant_id: restaurantId,
            stripe_financial_account_id: account.id,
            institution_name: account.institution_name,
            status: "connected",
            connected_at: new Date().toISOString(),
          });

        if (bankError) {
          console.error("[FC-WEBHOOK] Error storing bank:", bankError);
          throw bankError;
        }

        // Store account balance info
        if (account.balance) {
          const { error: balanceError } = await supabaseClient
            .from("bank_account_balances")
            .insert({
              connected_bank_id: account.id,
              account_name: account.display_name || account.institution_name,
              account_type: account.subcategory,
              account_mask: account.last4,
              current_balance: account.balance.current?.usd || 0,
              available_balance: account.balance.available?.usd,
              currency: "USD",
              is_active: true,
              as_of_date: new Date().toISOString(),
            });

          if (balanceError) {
            console.error("[FC-WEBHOOK] Error storing balance:", balanceError);
          }
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
          // Update balance
          const { error: balanceError } = await supabaseClient
            .from("bank_account_balances")
            .update({
              current_balance: account.balance.current?.usd || 0,
              available_balance: account.balance.available?.usd,
              as_of_date: new Date().toISOString(),
            })
            .eq("connected_bank_id", bank.id);

          if (balanceError) {
            console.error("[FC-WEBHOOK] Error updating balance:", balanceError);
          } else {
            console.log("[FC-WEBHOOK] Balance updated successfully");
          }
        }
        break;
      }

      default:
        console.log("[FC-WEBHOOK] Unhandled event type:", event.type);
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
