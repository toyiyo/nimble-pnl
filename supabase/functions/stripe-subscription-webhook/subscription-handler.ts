import Stripe from "https://esm.sh/stripe@20.1.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

export async function processSubscriptionEvent(event: Stripe.Event, supabaseAdmin: SupabaseClient) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log("[SUBSCRIPTION-WEBHOOK] Checkout completed:", session.id);

      const restaurantId = session.metadata?.restaurant_id;
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
