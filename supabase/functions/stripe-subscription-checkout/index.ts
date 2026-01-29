import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Stripe Price IDs for each tier/period combination
const PRICE_IDS = {
  starter: {
    monthly: Deno.env.get("STRIPE_PRICE_STARTER_MONTHLY") || "price_1SuxQuD9w6YUNUOUNUnCmY30",
    annual: Deno.env.get("STRIPE_PRICE_STARTER_ANNUAL") || "price_1SuxQuD9w6YUNUOUbTEYjtba",
  },
  growth: {
    monthly: Deno.env.get("STRIPE_PRICE_GROWTH_MONTHLY") || "price_1SuxQvD9w6YUNUOUpgwOabhZ",
    annual: Deno.env.get("STRIPE_PRICE_GROWTH_ANNUAL") || "price_1SuxQvD9w6YUNUOUvdeYY3LS",
  },
  pro: {
    monthly: Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") || "price_1SuxQwD9w6YUNUOU68X5KKWV",
    annual: Deno.env.get("STRIPE_PRICE_PRO_ANNUAL") || "price_1SuxQwD9w6YUNUOUQU80UHw2",
  },
};

// Volume discount coupon IDs
const VOLUME_COUPONS = {
  5: Deno.env.get("STRIPE_COUPON_VOLUME_5") || "ioj9O2Vq",   // 5% off (3-5 locations)
  10: Deno.env.get("STRIPE_COUPON_VOLUME_10") || "DfEkpy0n", // 10% off (6-10 locations)
  15: Deno.env.get("STRIPE_COUPON_VOLUME_15") || "XlP3zupA", // 15% off (11+ locations)
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[SUBSCRIPTION-CHECKOUT] Starting checkout session creation");

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

    console.log("[SUBSCRIPTION-CHECKOUT] User authenticated:", user.id);

    // Get request body
    const { restaurantId, tier, period } = await req.json();

    if (!restaurantId) {
      throw new Error("Restaurant ID is required");
    }

    if (!tier || !['starter', 'growth', 'pro'].includes(tier)) {
      throw new Error("Invalid tier. Must be: starter, growth, or pro");
    }

    if (!period || !['monthly', 'annual'].includes(period)) {
      throw new Error("Invalid period. Must be: monthly or annual");
    }

    console.log("[SUBSCRIPTION-CHECKOUT] Creating checkout for:", { restaurantId, tier, period });

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
      console.error("[SUBSCRIPTION-CHECKOUT] Database error:", accessError);
      throw new Error(`Database error: ${accessError.message}`);
    }

    if (!userRestaurant || userRestaurant.role !== 'owner') {
      throw new Error("Only restaurant owners can manage subscriptions");
    }

    // Get restaurant details
    const { data: restaurant, error: restaurantError } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, stripe_subscription_customer_id, subscription_status")
      .eq("id", restaurantId)
      .single();

    if (restaurantError || !restaurant) {
      throw new Error("Restaurant not found");
    }

    // Count owner's restaurants for volume discount
    const { data: ownerRestaurants, error: countError } = await supabaseAdmin
      .from("user_restaurants")
      .select("restaurant_id")
      .eq("user_id", user.id)
      .eq("role", "owner");

    if (countError) {
      console.error("[SUBSCRIPTION-CHECKOUT] Error counting restaurants:", countError);
    }

    const locationCount = ownerRestaurants?.length || 1;
    console.log("[SUBSCRIPTION-CHECKOUT] Owner has", locationCount, "locations");

    // Determine volume discount coupon
    let couponId: string | undefined;
    if (locationCount >= 11) {
      couponId = VOLUME_COUPONS[15];
    } else if (locationCount >= 6) {
      couponId = VOLUME_COUPONS[10];
    } else if (locationCount >= 3) {
      couponId = VOLUME_COUPONS[5];
    }

    // Get or create Stripe customer
    let customerId = restaurant.stripe_subscription_customer_id;

    if (!customerId) {
      // Create new Stripe customer for subscription billing
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: {
          user_id: user.id,
          restaurant_id: restaurantId,
          restaurant_name: restaurant.name,
        },
      });

      customerId = customer.id;
      console.log("[SUBSCRIPTION-CHECKOUT] Created new Stripe customer:", customerId);

      // Store customer ID on restaurant
      const { error: updateError } = await supabaseAdmin
        .from("restaurants")
        .update({ stripe_subscription_customer_id: customerId })
        .eq("id", restaurantId);

      if (updateError) {
        console.error("[SUBSCRIPTION-CHECKOUT] Failed to store customer ID:", updateError);
        // Continue anyway - we can link it later via webhook
      }
    }

    // Get the price ID for the selected tier and period
    const priceId = PRICE_IDS[tier as keyof typeof PRICE_IDS][period as 'monthly' | 'annual'];
    if (!priceId) {
      throw new Error(`Price not found for tier: ${tier}, period: ${period}`);
    }

    // Build checkout session parameters
    const origin = req.headers.get("origin") || "https://app.easyshifthq.com";
    const checkoutParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1, // Per restaurant billing
        },
      ],
      success_url: `${origin}/settings?tab=subscription&success=true`,
      cancel_url: `${origin}/settings?tab=subscription&canceled=true`,
      metadata: {
        user_id: user.id,
        restaurant_id: restaurantId,
        tier,
        period,
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          restaurant_id: restaurantId,
          tier,
          period,
        },
      },
      // Allow promotion codes in addition to auto-applied volume discount
      allow_promotion_codes: true,
    };

    // Apply volume discount coupon if applicable
    if (couponId) {
      checkoutParams.discounts = [{ coupon: couponId }];
      // Can't use both discounts and allow_promotion_codes
      delete checkoutParams.allow_promotion_codes;
      console.log("[SUBSCRIPTION-CHECKOUT] Applied volume discount coupon:", couponId);
    }

    // If upgrading from trial, add trial_end to immediately charge
    if (restaurant.subscription_status === 'trialing') {
      checkoutParams.subscription_data!.trial_end = 'now';
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create(checkoutParams);

    console.log("[SUBSCRIPTION-CHECKOUT] Checkout session created:", session.id);

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SUBSCRIPTION-CHECKOUT] Error:", errorMessage);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
