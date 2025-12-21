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
    console.log("[CREATE-CONNECTED-ACCOUNT] Starting Stripe Connect account creation");

    // Initialize Supabase client for auth
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Initialize Stripe early
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2024-12-18.acacia" as any
    });

    const deriveStatuses = (acct: any) => {
      const chargesEnabled =
        acct?.charges_enabled ??
        acct?.configuration?.merchant?.capabilities?.card_payments?.status === "active";

      const payoutsEnabled =
        acct?.payouts_enabled ??
        acct?.configuration?.merchant?.capabilities?.transfers?.status === "active";

      const requirementsSatisfied = Array.isArray(acct?.requirements?.currently_due)
        ? acct.requirements.currently_due.length === 0
        : undefined;

      const detailsSubmitted =
        acct?.details_submitted ??
        requirementsSatisfied ??
        false;

      const onboardingComplete = Boolean(detailsSubmitted && chargesEnabled);

      return {
        chargesEnabled: Boolean(chargesEnabled),
        payoutsEnabled: Boolean(payoutsEnabled),
        detailsSubmitted: Boolean(detailsSubmitted),
        onboardingComplete,
      };
    };

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

    console.log("[CREATE-CONNECTED-ACCOUNT] User authenticated:", user.id);

    // Get request body
    const { restaurantId, accountType = 'standard' } = await req.json();
    
    if (!restaurantId) {
      throw new Error("Restaurant ID is required");
    }

    if (accountType !== 'standard') {
      console.log("[CREATE-CONNECTED-ACCOUNT] Overriding requested account type to standard/full dashboard to align with Connect v2 guidance");
    }

    const includeFields = [
      "configuration.merchant",
      "configuration.recipient",
      "identity",
      "defaults",
    ];

    const fetchAccount = async (accountId: string) => {
      try {
        return await stripe.v2.core.accounts.retrieve(
          accountId,
          { include: includeFields as any }
        );
      } catch (err) {
        console.warn("[CREATE-CONNECTED-ACCOUNT] v2 account retrieval failed, falling back to v1:", err);
        return await stripe.accounts.retrieve(accountId);
      }
    };

    console.log("[CREATE-CONNECTED-ACCOUNT] Creating account for restaurant:", restaurantId);

    // Use service role to verify access and manage data
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
      console.error("[CREATE-CONNECTED-ACCOUNT] Database error:", accessError);
      throw new Error(`Database error: ${accessError.message}`);
    }

    if (!userRestaurant || userRestaurant.role !== 'owner') {
      throw new Error("Only restaurant owners can create Stripe Connect accounts");
    }

    // Check if account already exists
    const { data: existingAccount } = await supabaseAdmin
      .from("stripe_connected_accounts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (existingAccount) {
      console.log("[CREATE-CONNECTED-ACCOUNT] Account already exists:", existingAccount.stripe_account_id);

      // Always check live status from Stripe to ensure database is up to date
      const liveAccount = await fetchAccount(existingAccount.stripe_account_id);

      const liveStatuses = deriveStatuses(liveAccount);
      console.log("[CREATE-CONNECTED-ACCOUNT] Live account status:", liveStatuses);

      // Update database with live status
      const { error: updateError } = await supabaseAdmin
        .from("stripe_connected_accounts")
        .update({
          charges_enabled: liveStatuses.chargesEnabled,
          payouts_enabled: liveStatuses.payoutsEnabled,
          details_submitted: liveStatuses.detailsSubmitted,
          onboarding_complete: liveStatuses.onboardingComplete,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAccount.id);

      if (updateError) {
        console.error("[CREATE-CONNECTED-ACCOUNT] Failed to update account status:", updateError);
      }

      // Check if onboarding is now complete
      const isOnboardingComplete = liveStatuses.onboardingComplete;

      if (isOnboardingComplete) {
        return new Response(
          JSON.stringify({
            success: true,
            accountId: existingAccount.stripe_account_id,
            onboardingComplete: true,
            message: "Stripe Connect account is already set up",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      // If onboarding is not complete, create a new onboarding link
      console.log("[CREATE-CONNECTED-ACCOUNT] Onboarding incomplete, creating new link");
    }

    // Get restaurant details for account setup
    const { data: restaurant, error: restaurantError } = await supabaseAdmin
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .single();

    if (restaurantError) {
      throw new Error(`Failed to fetch restaurant: ${restaurantError.message}`);
    }

    // Use existing account or create new one
    let account;
    if (existingAccount) {
      // Use existing Stripe account
      account = await fetchAccount(existingAccount.stripe_account_id);
      console.log("[CREATE-CONNECTED-ACCOUNT] Retrieved existing Stripe account:", account.id);
    } else {
      // Create new Stripe Connect account (Accounts v2, full dashboard)
      const accountParams = {
        dashboard: "full",
        defaults: {
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
          },
        },
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true },
              us_bank_account_ach_payments: { requested: true },
              transfers: { requested: true },
            },
          },
        },
        identity: {
          country: "US",
        },
        include: includeFields,
        metadata: {
          restaurant_id: restaurantId,
          restaurant_name: restaurant.name,
          requested_by_user_id: user.id,
        },
      };

      account = await stripe.v2.core.accounts.create(accountParams as any);
      console.log("[CREATE-CONNECTED-ACCOUNT] Stripe account created:", account.id);

      const accountStatuses = deriveStatuses(account);

      // Store the connected account in database
      const { error: insertError } = await supabaseAdmin
        .from("stripe_connected_accounts")
        .insert({
          restaurant_id: restaurantId,
          stripe_account_id: account.id,
          account_type: "standard",
          charges_enabled: accountStatuses.chargesEnabled,
          payouts_enabled: accountStatuses.payoutsEnabled,
          details_submitted: accountStatuses.detailsSubmitted,
          onboarding_complete: accountStatuses.onboardingComplete,
        });

      if (insertError) {
        console.error("[CREATE-CONNECTED-ACCOUNT] Failed to store account:", insertError);
        // Don't fail the request - account was created in Stripe
        // User can try to link it again later
      }
    }

    // Create account link for onboarding
    const origin = req.headers.get("origin") || "http://localhost:3000";
    let accountLink;
    try {
      accountLink = await stripe.v2.core.accountLinks.create({
        account: account.id,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["merchant"],
            refresh_url: `${origin}/invoices?refresh=true&account=${account.id}`,
            return_url: `${origin}/invoices?success=true&account=${account.id}`,
          },
        },
      });
    } catch (linkError) {
      console.warn("[CREATE-CONNECTED-ACCOUNT] v2 account link creation failed, falling back to v1:", linkError);
      accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${origin}/invoices?refresh=true&account=${account.id}`,
        return_url: `${origin}/invoices?success=true&account=${account.id}`,
        type: "account_onboarding",
      });
    }

    console.log("[CREATE-CONNECTED-ACCOUNT] Onboarding link created");

    return new Response(
      JSON.stringify({
        success: true,
        accountId: account.id,
        onboardingUrl: accountLink.url,
        message: "Stripe Connect account created successfully",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-CONNECTED-ACCOUNT] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
