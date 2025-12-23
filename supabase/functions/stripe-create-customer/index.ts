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
    console.log("[CREATE-CUSTOMER] Starting customer creation");

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

    const { customerId } = await req.json();
    
    if (!customerId) {
      throw new Error("Customer ID is required");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get customer details
    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("*, restaurants(stripe_customer_id)")
      .eq("id", customerId)
      .single();

    if (customerError || !customer) {
      throw new Error("Customer not found");
    }

    // Verify user has access
    const { data: userRestaurant } = await supabaseAdmin
      .from("user_restaurants")
      .select("role")
      .eq("restaurant_id", customer.restaurant_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!userRestaurant || !["owner", "manager"].includes(userRestaurant.role)) {
      throw new Error("Access denied");
    }

    // If already has Stripe customer, return it
    if (customer.stripe_customer_id) {
      console.log("[CREATE-CUSTOMER] Customer already exists:", customer.stripe_customer_id);
      return new Response(
        JSON.stringify({
          success: true,
          stripeCustomerId: customer.stripe_customer_id,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Get connected account for this restaurant
    const { data: connectedAccount } = await supabaseAdmin
      .from("stripe_connected_accounts")
      .select("stripe_account_id")
      .eq("restaurant_id", customer.restaurant_id)
      .single();

    if (!connectedAccount) {
      throw new Error("Restaurant must set up Stripe Connect first");
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, { 
      apiVersion: "2025-08-27.basil" as any
    });

    // Create Stripe customer on behalf of connected account
    const stripeCustomer = await stripe.customers.create(
      {
        name: customer.name,
        email: customer.email || undefined,
        phone: customer.phone || undefined,
        address: customer.billing_address_line1 ? {
          line1: customer.billing_address_line1,
          line2: customer.billing_address_line2 || undefined,
          city: customer.billing_address_city || undefined,
          state: customer.billing_address_state || undefined,
          postal_code: customer.billing_address_postal_code || undefined,
          country: customer.billing_address_country || "US",
        } : undefined,
        metadata: {
          customer_id: customerId,
          restaurant_id: customer.restaurant_id,
        },
      },
      {
        stripeAccount: connectedAccount.stripe_account_id,
      }
    );

    console.log("[CREATE-CUSTOMER] Stripe customer created:", stripeCustomer.id);

    // Update customer record with Stripe ID
    await supabaseAdmin
      .from("customers")
      .update({ stripe_customer_id: stripeCustomer.id })
      .eq("id", customerId);

    return new Response(
      JSON.stringify({
        success: true,
        stripeCustomerId: stripeCustomer.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-CUSTOMER] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
