import Stripe from "https://esm.sh/stripe@20.1.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Volume discount coupon IDs (same as in checkout function)
const VOLUME_COUPONS: Record<number, string> = {
  5: Deno.env.get("STRIPE_COUPON_VOLUME_5") || "ioj9O2Vq",   // 5% off (3-5 locations)
  10: Deno.env.get("STRIPE_COUPON_VOLUME_10") || "DfEkpy0n", // 10% off (6-10 locations)
  15: Deno.env.get("STRIPE_COUPON_VOLUME_15") || "XlP3zupA", // 15% off (11+ locations)
};

/**
 * Determines the appropriate volume discount percentage based on location count
 */
function getVolumeDiscountPercent(locationCount: number): number {
  if (locationCount >= 11) return 15;
  if (locationCount >= 6) return 10;
  if (locationCount >= 3) return 5;
  return 0;
}

/**
 * Syncs volume discounts across all subscriptions for an owner.
 * Called when a new subscription is created to ensure all restaurants get the same discount.
 */
async function syncVolumeDiscountsForOwner(
  userId: string,
  supabaseAdmin: SupabaseClient,
  stripe: Stripe
): Promise<void> {
  console.log("[SUBSCRIPTION-WEBHOOK] Syncing volume discounts for owner:", userId);

  // Get all restaurants owned by this user with active subscriptions
  const { data: ownerRestaurants, error: fetchError } = await supabaseAdmin
    .from("user_restaurants")
    .select(`
      restaurant_id,
      restaurants!inner (
        id,
        name,
        stripe_subscription_id,
        subscription_status
      )
    `)
    .eq("user_id", userId)
    .eq("role", "owner");

  if (fetchError) {
    console.error("[SUBSCRIPTION-WEBHOOK] Failed to fetch owner restaurants:", fetchError);
    return;
  }

  if (!ownerRestaurants || ownerRestaurants.length === 0) {
    console.log("[SUBSCRIPTION-WEBHOOK] No restaurants found for owner");
    return;
  }

  const locationCount = ownerRestaurants.length;
  const discountPercent = getVolumeDiscountPercent(locationCount);
  const couponId = discountPercent > 0 ? VOLUME_COUPONS[discountPercent] : null;

  console.log("[SUBSCRIPTION-WEBHOOK] Owner has", locationCount, "locations, discount:", discountPercent + "%");

  // Get all active subscriptions that need updating
  const activeSubscriptions = ownerRestaurants
    .filter((r) => {
      const restaurant = r.restaurants as unknown as {
        stripe_subscription_id: string | null;
        subscription_status: string | null;
      };
      return (
        restaurant.stripe_subscription_id &&
        restaurant.subscription_status &&
        ["active", "trialing"].includes(restaurant.subscription_status)
      );
    })
    .map((r) => {
      const restaurant = r.restaurants as unknown as {
        id: string;
        name: string;
        stripe_subscription_id: string;
      };
      return {
        subscriptionId: restaurant.stripe_subscription_id,
        restaurantName: restaurant.name,
      };
    });

  console.log("[SUBSCRIPTION-WEBHOOK] Found", activeSubscriptions.length, "active subscriptions to update");

  // Update each subscription with the appropriate coupon
  for (const sub of activeSubscriptions) {
    try {
      // Get current subscription to check existing discount
      const subscription = await stripe.subscriptions.retrieve(sub.subscriptionId);

      // Check if coupon already matches
      const currentCouponId = subscription.discount?.coupon?.id;

      if (couponId && currentCouponId === couponId) {
        console.log(`[SUBSCRIPTION-WEBHOOK] Subscription ${sub.subscriptionId} already has correct coupon`);
        continue;
      }

      if (couponId) {
        // Apply or update coupon
        await stripe.subscriptions.update(sub.subscriptionId, {
          coupon: couponId,
        });
        console.log(`[SUBSCRIPTION-WEBHOOK] Applied ${discountPercent}% discount to ${sub.restaurantName} (${sub.subscriptionId})`);
      } else if (currentCouponId && Object.values(VOLUME_COUPONS).includes(currentCouponId)) {
        // Remove volume discount coupon if they dropped below threshold
        // Only remove if it's one of our volume coupons (not a promo code)
        await stripe.subscriptions.deleteDiscount(sub.subscriptionId);
        console.log(`[SUBSCRIPTION-WEBHOOK] Removed volume discount from ${sub.restaurantName} (${sub.subscriptionId})`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SUBSCRIPTION-WEBHOOK] Failed to update subscription ${sub.subscriptionId}:`, errorMsg);
      // Continue with other subscriptions even if one fails
    }
  }

  console.log("[SUBSCRIPTION-WEBHOOK] Volume discount sync completed");
}

// Build price-to-tier mapping from env vars (with production fallbacks)
const priceIdMapping = {
  starterMonthly: Deno.env.get("STRIPE_PRICE_STARTER_MONTHLY") ?? "price_1SuxQuD9w6YUNUOUNUnCmY30",
  starterAnnual: Deno.env.get("STRIPE_PRICE_STARTER_ANNUAL") ?? "price_1SuxQuD9w6YUNUOUbTEYjtba",
  growthMonthly: Deno.env.get("STRIPE_PRICE_GROWTH_MONTHLY") ?? "price_1SuxQvD9w6YUNUOUpgwOabhZ",
  growthAnnual: Deno.env.get("STRIPE_PRICE_GROWTH_ANNUAL") ?? "price_1SuxQvD9w6YUNUOUvdeYY3LS",
  proMonthly: Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? "price_1SuxQwD9w6YUNUOU68X5KKWV",
  proAnnual: Deno.env.get("STRIPE_PRICE_PRO_ANNUAL") ?? "price_1SuxQwD9w6YUNUOUQU80UHw2",
};

console.log("[SUBSCRIPTION-WEBHOOK] Price ID mapping loaded:", priceIdMapping);

export const PRICE_ID_TO_TIER: Record<string, "starter" | "growth" | "pro"> = {
  [priceIdMapping.starterMonthly]: "starter",
  [priceIdMapping.starterAnnual]: "starter",
  [priceIdMapping.growthMonthly]: "growth",
  [priceIdMapping.growthAnnual]: "growth",
  [priceIdMapping.proMonthly]: "pro",
  [priceIdMapping.proAnnual]: "pro",
};

export async function processSubscriptionEvent(
  event: Stripe.Event,
  supabaseAdmin: SupabaseClient,
  stripe: Stripe
) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log("[SUBSCRIPTION-WEBHOOK] Checkout completed:", session.id);

      const restaurantId = session.metadata?.restaurant_id;
      const userId = session.metadata?.user_id;
      const tier = session.metadata?.tier;

      if (!restaurantId || !tier) {
        console.error("[SUBSCRIPTION-WEBHOOK] Missing metadata in checkout session");
        return;
      }

      const subscriptionId = session.subscription as string;

      const { error: updateError } = await supabaseAdmin
        .from("restaurants")
        .update({
          stripe_subscription_id: subscriptionId,
          stripe_subscription_customer_id: session.customer as string,
          subscription_tier: tier,
          subscription_period: session.metadata?.period || "monthly",
        })
        .eq("id", restaurantId);

      if (updateError) {
        console.error("[SUBSCRIPTION-WEBHOOK] Failed to update restaurant:", updateError);
      } else {
        console.log("[SUBSCRIPTION-WEBHOOK] Restaurant updated with subscription:", restaurantId);

        // Sync volume discounts across all owner's subscriptions
        // This ensures all restaurants get the same discount when crossing thresholds
        if (userId) {
          try {
            await syncVolumeDiscountsForOwner(userId, supabaseAdmin, stripe);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error("[SUBSCRIPTION-WEBHOOK] Volume discount sync failed:", errorMsg);
            // Don't fail the whole webhook for this - it's not critical
          }
        }
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      console.log("[SUBSCRIPTION-WEBHOOK] Subscription updated:", subscription.id, subscription.status);

      let restaurantId = subscription.metadata?.restaurant_id;

      if (!restaurantId) {
        const { data: restaurant } = await supabaseAdmin
          .from("restaurants")
          .select("id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (restaurant) {
          restaurantId = restaurant.id;
        } else {
          const { data: restaurantByCustomer } = await supabaseAdmin
            .from("restaurants")
            .select("id")
            .eq("stripe_subscription_customer_id", subscription.customer as string)
            .maybeSingle();

          if (restaurantByCustomer) {
            restaurantId = restaurantByCustomer.id;
          }
        }
      }

      if (!restaurantId) {
        console.error("[SUBSCRIPTION-WEBHOOK] Could not find restaurant for subscription:", subscription.id);
        return;
      }

      let subscriptionStatus: string;
      switch (subscription.status) {
        case "active":
          subscriptionStatus = "active";
          break;
        case "trialing":
          subscriptionStatus = "trialing";
          break;
        case "past_due":
          subscriptionStatus = "past_due";
          break;
        case "canceled":
        case "unpaid":
        case "incomplete_expired":
          subscriptionStatus = "canceled";
          break;
        default:
          subscriptionStatus = "active";
      }

      // Determine tier from price - DON'T trust metadata as Stripe doesn't update it on plan changes
      let tier: string | undefined;
      if (subscription.items.data[0]) {
        const price = subscription.items.data[0].price;
        const priceId = price.id;

        // 1. Try price ID mapping (works for known production/test prices)
        tier = PRICE_ID_TO_TIER[priceId];

        // 2. Fallback: substring detection in price ID
        if (!tier) {
          if (priceId.includes("starter")) tier = "starter";
          else if (priceId.includes("growth")) tier = "growth";
          else if (priceId.includes("pro")) tier = "pro";
        }

        // 3. Fallback: use price amount to determine tier (handles dynamic test prices)
        if (!tier && price.unit_amount) {
          const amount = price.unit_amount;
          // Monthly: $99 = 9900, $199 = 19900, $299 = 29900
          // Annual: $990 = 99000, $1990 = 199000, $2990 = 299000
          if (amount === 9900 || amount === 99000) tier = "starter";
          else if (amount === 19900 || amount === 199000) tier = "growth";
          else if (amount === 29900 || amount === 299000) tier = "pro";
        }

        console.log("[SUBSCRIPTION-WEBHOOK] Tier detection:", { priceId, amount: price.unit_amount, detectedTier: tier });
      }

      // 4. Last resort: fall back to metadata (may be stale after plan changes)
      if (!tier) {
        tier = subscription.metadata?.tier;
        console.log("[SUBSCRIPTION-WEBHOOK] Using metadata tier (may be stale):", tier);
      }

      let period = subscription.metadata?.period;
      if (!period && subscription.items.data[0]) {
        const interval = subscription.items.data[0].price.recurring?.interval;
        period = interval === "year" ? "annual" : "monthly";
      }

      const updateData: Record<string, any> = {
        subscription_status: subscriptionStatus,
        stripe_subscription_id: subscription.id,
      };

      if (tier) updateData.subscription_tier = tier;
      if (period) updateData.subscription_period = period;
      if (subscription.current_period_end) {
        updateData.subscription_ends_at = new Date(subscription.current_period_end * 1000).toISOString();
      }

      // Track scheduled cancellation (cancel_at_period_end)
      if (subscription.cancel_at_period_end && subscription.cancel_at) {
        updateData.subscription_cancel_at = new Date(subscription.cancel_at * 1000).toISOString();
        console.log("[SUBSCRIPTION-WEBHOOK] Subscription scheduled to cancel at:", updateData.subscription_cancel_at);
      } else {
        // Clear scheduled cancellation (user reactivated or never had one)
        updateData.subscription_cancel_at = null;
      }

      if (subscription.status === "trialing" && subscription.trial_end) {
        updateData.trial_ends_at = new Date(subscription.trial_end * 1000).toISOString();
      } else if (subscriptionStatus === "active") {
        updateData.trial_ends_at = null;
      }
      if (subscriptionStatus === "active") {
        updateData.grandfathered_until = null;
      }

      const { error: updateError } = await supabaseAdmin.from("restaurants").update(updateData).eq("id", restaurantId);

      if (updateError) {
        console.error("[SUBSCRIPTION-WEBHOOK] Failed to update restaurant:", updateError);
      } else {
        console.log("[SUBSCRIPTION-WEBHOOK] Restaurant subscription updated:", restaurantId, updateData);
      }
      return;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      console.log("[SUBSCRIPTION-WEBHOOK] Subscription deleted:", subscription.id);

      const { data: restaurant } = await supabaseAdmin
        .from("restaurants")
        .select("id")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();

      if (restaurant) {
        const { error: updateError } = await supabaseAdmin
          .from("restaurants")
          .update({
            subscription_status: "canceled",
            subscription_tier: "starter",
            subscription_ends_at: new Date().toISOString(),
          })
          .eq("id", restaurant.id);

        if (updateError) {
          console.error("[SUBSCRIPTION-WEBHOOK] Failed to update canceled subscription:", updateError);
        } else {
          console.log("[SUBSCRIPTION-WEBHOOK] Restaurant subscription canceled:", restaurant.id);

          // Sync volume discounts - may need to reduce discount tier for remaining restaurants
          const userId = subscription.metadata?.user_id;
          if (userId) {
            try {
              await syncVolumeDiscountsForOwner(userId, supabaseAdmin, stripe);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error("[SUBSCRIPTION-WEBHOOK] Volume discount sync failed:", errorMsg);
            }
          }
        }
      }
      return;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log("[SUBSCRIPTION-WEBHOOK] Payment succeeded:", invoice.id);

      if (invoice.subscription) {
        const { data: restaurant } = await supabaseAdmin
          .from("restaurants")
          .select("id, subscription_status")
          .eq("stripe_subscription_id", invoice.subscription as string)
          .maybeSingle();

        if (restaurant && restaurant.subscription_status === "past_due") {
          const { error: updateError } = await supabaseAdmin
            .from("restaurants")
            .update({ subscription_status: "active" })
            .eq("id", restaurant.id);

          if (updateError) {
            console.error("[SUBSCRIPTION-WEBHOOK] Failed to update status after payment:", updateError);
          } else {
            console.log("[SUBSCRIPTION-WEBHOOK] Restaurant status updated to active after payment:", restaurant.id);
          }
        }
      }
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log("[SUBSCRIPTION-WEBHOOK] Payment failed:", invoice.id);

      if (invoice.subscription) {
        const { data: restaurant } = await supabaseAdmin
          .from("restaurants")
          .select("id")
          .eq("stripe_subscription_id", invoice.subscription as string)
          .maybeSingle();

        if (restaurant) {
          const { error: updateError } = await supabaseAdmin
            .from("restaurants")
            .update({ subscription_status: "past_due" })
            .eq("id", restaurant.id);

          if (updateError) {
            console.error("[SUBSCRIPTION-WEBHOOK] Failed to update status after payment failure:", updateError);
          } else {
            console.log("[SUBSCRIPTION-WEBHOOK] Restaurant marked as past_due:", restaurant.id);
          }
        }
      }
      return;
    }

    default: {
      console.log("[SUBSCRIPTION-WEBHOOK] Unhandled event type:", event.type);
    }
  }
}
