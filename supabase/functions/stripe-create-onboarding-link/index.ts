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

    const { restaurantId, returnUrl } = await req.json();
    if (!restaurantId) {
      throw new Error("Restaurant ID is required");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify ownership
    const { data: userRestaurant } = await supabaseAdmin
      .from("user_restaurants")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!userRestaurant || userRestaurant.role !== "owner") {
      throw new Error("Only restaurant owners can manage Stripe onboarding");
    }

    // Fetch connected account
    const { data: connectedAccount, error: accountError } = await supabaseAdmin
      .from("stripe_connected_accounts")
      .select("stripe_account_id")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (accountError || !connectedAccount) {
      throw new Error("Stripe Connect account not found for this restaurant");
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" as any });

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: connectedAccount.stripe_account_id,
      refresh_url: returnUrl || `${Deno.env.get("VITE_APP_URL") || "http://localhost:5173"}/settings`,
      return_url: returnUrl || `${Deno.env.get("VITE_APP_URL") || "http://localhost:5173"}/settings`,
      type: "account_onboarding",
    });

    return new Response(
      JSON.stringify({
        success: true,
        url: accountLink.url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-ACCOUNT-ONBOARDING-LINK] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});