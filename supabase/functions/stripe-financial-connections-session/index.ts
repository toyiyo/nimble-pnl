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
    console.log("[FC-SESSION] Starting Financial Connections session creation");

    // Initialize Supabase client for auth
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false } }
    );

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

    console.log("[FC-SESSION] User authenticated:", user.id);

    // Get request body
    const { restaurantId } = await req.json();
    
    if (!restaurantId) {
      throw new Error("Restaurant ID is required");
    }

    console.log("[FC-SESSION] Creating session for restaurant:", restaurantId);

    // Use service role to verify access (bypass RLS)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify user has access to restaurant
    const { data: userRestaurant, error: accessError } = await supabaseAdmin
      .from("user_restaurants")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", user.id)
      .maybeSingle();

    console.log("[FC-SESSION] Access check result:", { userRestaurant, accessError });

    if (accessError) {
      console.error("[FC-SESSION] Database error checking access:", accessError);
      throw new Error(`Database error: ${accessError.message}`);
    }

    if (!userRestaurant) {
      console.error("[FC-SESSION] No user_restaurant record found for user:", user.id, "restaurant:", restaurantId);
      throw new Error("User does not have access to this restaurant. Please make sure you are the owner or manager.");
    }

    if (!["owner", "manager"].includes(userRestaurant.role)) {
      throw new Error(`Insufficient permissions. Your role is '${userRestaurant.role}', but 'owner' or 'manager' is required.`);
    }

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, { 
      apiVersion: "2025-08-27.basil" as any
    });

    // Create Financial Connections session
    const origin = req.headers.get("origin") || "http://localhost:3000";
    
    const session = await stripe.financialConnections.sessions.create({
      account_holder: {
        type: "account",
        account: restaurantId, // Use restaurant ID as account reference
      },
      permissions: ["payment_method", "balances", "transactions"],
      filters: {
        countries: ["US"],
      },
      return_url: `${origin}/accounting/banks?restaurant_id=${restaurantId}`,
    });

    console.log("[FC-SESSION] Session created successfully:", session.id);

    return new Response(
      JSON.stringify({
        clientSecret: session.client_secret,
        sessionId: session.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[FC-SESSION] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
