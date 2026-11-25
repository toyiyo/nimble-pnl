// Handle Stripe Connect account creation and status sync.
// No Deno globals here: Vitest imports this file.
import { deriveStatuses } from "./stripeAccountStatus.ts";
import { HttpError, toErrorResponse, isUniqueViolation } from "./httpError.ts";
import { parseAllowedOrigins, resolveAppOrigin } from "./oauthState.ts";

export interface CreateConnectedAccountDeps {
  stripe: any;
  // Service-role client. Verifies access and writes rows.
  db: any;
  // User-scoped auth lookup. Same shape as supabase.auth.getUser.
  getUser: (token: string) => Promise<{ data: { user: any }; error: any }>;
  // Raw value of OAUTH_ALLOWED_ORIGINS.
  allowedOriginsEnv: string | null | undefined;
  corsHeaders: Record<string, string>;
}

export const handleCreateConnectedAccount = async (
  req: Request,
  deps: CreateConnectedAccountDeps,
): Promise<Response> => {
  const { stripe, db, getUser, allowedOriginsEnv, corsHeaders } = deps;

  try {
    console.log("[CREATE-CONNECTED-ACCOUNT] Starting Stripe Connect account creation");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new HttpError(401, "Not authenticated");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await getUser(token);

    if (authError || !user) {
      throw new HttpError(401, "Not authenticated");
    }

    console.log("[CREATE-CONNECTED-ACCOUNT] User authenticated:", user.id);

    // Get request body
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new HttpError(400, "Invalid request body");
    }
    const { restaurantId } = body;
    const statusOnly = body.statusOnly === true;
    
    if (!restaurantId) {
      throw new HttpError(400, "Restaurant ID is required");
    }

    const fetchAccount = async (accountId: string) => {
      return await stripe.accounts.retrieve(accountId);
    };

    console.log("[CREATE-CONNECTED-ACCOUNT] Creating account for restaurant:", restaurantId);

    // Use service role to verify access and manage data

    // Verify user is owner of restaurant
    const { data: userRestaurant, error: accessError } = await db
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
      throw new HttpError(403, "Only restaurant owners can create Stripe Connect accounts");
    }

    // Check if account already exists
    const { data: existingAccount, error: existingAccountError } = await db
      .from("stripe_connected_accounts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (existingAccountError) {
      console.error("[CREATE-CONNECTED-ACCOUNT] Error fetching existing account:", {
        restaurantId,
        error: existingAccountError.message,
      });
      throw new Error(`Database error: ${existingAccountError.message}`);
    }

    if (statusOnly && !existingAccount) {
      return new Response(
        JSON.stringify({ success: true, accountId: null, onboardingComplete: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (existingAccount) {
      console.log("[CREATE-CONNECTED-ACCOUNT] Account already exists:", existingAccount.stripe_account_id);

      // Always check live status from Stripe to ensure database is up to date
      const liveAccount = await fetchAccount(existingAccount.stripe_account_id);

      const liveStatuses = deriveStatuses(liveAccount);
      console.log("[CREATE-CONNECTED-ACCOUNT] Live account status:", liveStatuses);

      // Update database with live status
      const { error: updateError } = await db
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
        // Status-only callers read the row. Fail so they do not show old data.
        if (statusOnly) {
          throw new Error(`Database error: ${updateError.message}`);
        }
      }

      // Status-only mode: return the statuses and create no account link
      if (statusOnly) {
        return new Response(
          JSON.stringify({
            success: true,
            accountId: existingAccount.stripe_account_id,
            onboardingComplete: liveStatuses.onboardingComplete,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
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
    const { data: restaurant, error: restaurantError } = await db
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .single();

    if (restaurantError) {
      throw new Error(`Failed to fetch restaurant: ${restaurantError.message}`);
    }

    // Use existing account or create new one
    let account: any;
    if (existingAccount) {
      // Use existing Stripe account
      account = await fetchAccount(existingAccount.stripe_account_id);
      console.log("[CREATE-CONNECTED-ACCOUNT] Retrieved existing Stripe account:", account.id);
    } else {
      // Create new Stripe Connect account (Accounts v1, Express)
      const accountParams = {
        country: "US",
        email: user.email || undefined,
        business_type: "company",
        business_profile: {
          name: restaurant.name,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
          us_bank_account_ach_payments: { requested: true },
        },
        controller: {
          // Full dashboard allows connected account to pay Stripe fees
          fees: { payer: "account" },
          losses: { payments: "stripe" },
          stripe_dashboard: { type: "full" },
        },
        metadata: {
          restaurant_id: restaurantId,
          restaurant_name: restaurant.name,
          requested_by_user_id: user.id,
        },
      };

      account = await stripe.accounts.create(accountParams, {
        idempotencyKey: "connect-acct-" + restaurantId,
      });
      console.log("[CREATE-CONNECTED-ACCOUNT] Stripe account created:", account.id);

      const accountStatuses = deriveStatuses(account);

      // Store the connected account in database
      const { error: insertError } = await db
        .from("stripe_connected_accounts")
        .insert({
          restaurant_id: restaurantId,
          stripe_account_id: account.id,
          account_type: "express",
          charges_enabled: accountStatuses.chargesEnabled,
          payouts_enabled: accountStatuses.payoutsEnabled,
          details_submitted: accountStatuses.detailsSubmitted,
          onboarding_complete: accountStatuses.onboardingComplete,
        });

      if (insertError) {
        if (isUniqueViolation(insertError)) {
          // A parallel request stored the row first. Use the stored account.
          const { data: raceRow, error: raceError } = await db
            .from("stripe_connected_accounts")
            .select("stripe_account_id")
            .eq("restaurant_id", restaurantId)
            .maybeSingle();
          if (raceError || !raceRow) {
            console.error("[CREATE-CONNECTED-ACCOUNT] Unique violation, but no row found:", {
              restaurantId,
              stripeAccountId: account.id,
              error: raceError?.message,
            });
            throw new Error("Failed to read existing account after unique violation");
          }
          account = await fetchAccount(raceRow.stripe_account_id);
        } else {
          console.error("[CREATE-CONNECTED-ACCOUNT] Failed to store account:", {
            restaurantId,
            stripeAccountId: account.id,
            error: insertError.message,
          });
          throw new Error("Failed to store connected account");
        }
      }
    }

    // Create account link for onboarding
    const { origin } = resolveAppOrigin(
      req.headers,
      parseAllowedOrigins(allowedOriginsEnv)
    );
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}/invoices?refresh=true&account=${account.id}`,
      return_url: `${origin}/invoices?success=true&account=${account.id}`,
      type: "account_onboarding",
      collection_options: {
        fields: "eventually_due",
      },
    });

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
    console.error("[CREATE-CONNECTED-ACCOUNT] Error:", error instanceof Error ? error.message : String(error));
    const { status, body } = toErrorResponse(error);

    return new Response(
      JSON.stringify(body),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status,
      }
    );
  }
};
