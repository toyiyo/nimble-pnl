import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
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
    console.log("[CUSTOMER-PORTAL] Creating portal session");

    // Initialize Supabase client for auth
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil" as any,
    });

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      throw new Error("User not authenticated");
    }

    console.log("[CUSTOMER-PORTAL] User authenticated:", user.id);

    // Get request body
    const { restaurantId } = await req.json();

    if (!restaurantId) {
      throw new Error("Restaurant ID is required");
    }

    // Use service role for database operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify user is owner of restaurant
    const { data: userRestaurant, error: accessError } = await supabaseAdmin
      .from("user_restaurants")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (accessError) {
      console.error("[CUSTOMER-PORTAL] Database error:", accessError);
      throw new Error(`Database error: ${accessError.message}`);
    }

    if (!userRestaurant || userRestaurant.role !== 'owner') {
      throw new Error("Only restaurant owners can access billing portal");
    }

    // Get restaurant's Stripe customer ID
    const { data: restaurant, error: restaurantError } = await supabaseAdmin
      .from("restaurants")
      .select("stripe_subscription_customer_id, name")
      .eq("id", restaurantId)
      .single();

    if (restaurantError || !restaurant) {
      throw new Error("Restaurant not found");
    }

    if (!restaurant.stripe_subscription_customer_id) {
      throw new Error("No billing account found. Please subscribe to a plan first.");
    }

    // Create customer portal session
    const origin = req.headers.get("origin") || "https://app.easyshifthq.com";
    const session = await stripe.billingPortal.sessions.create({
      customer: restaurant.stripe_subscription_customer_id,
      return_url: `${origin}/settings?tab=subscription`,
    });

    console.log("[CUSTOMER-PORTAL] Portal session created:", session.id);

    return new Response(
      JSON.stringify({
        success: true,
        url: session.url,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CUSTOMER-PORTAL] Error:", errorMessage);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
