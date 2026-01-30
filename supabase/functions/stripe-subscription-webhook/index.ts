import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// No CORS headers needed for webhooks - they come from Stripe servers
serve(async (req) => {
  console.log("[SUBSCRIPTION-WEBHOOK] Received webhook request");

  try {
    // Verify webhook signature
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.error("[SUBSCRIPTION-WEBHOOK] No signature provided");
      return new Response("No signature", { status: 400 });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_SUBSCRIPTION_WEBHOOK_SECRET");

    if (!stripeKey || !webhookSecret) {
      console.error("[SUBSCRIPTION-WEBHOOK] Missing configuration");
      return new Response("Server configuration error", { status: 500 });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil" as any,
    });

    const body = await req.text();
    let event: Stripe.Event;

    try {
      // Use constructEventAsync for Deno runtime (SubtleCrypto requires async)
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[SUBSCRIPTION-WEBHOOK] Signature verification failed:", errorMessage);
      return new Response(`Webhook signature verification failed: ${errorMessage}`, { status: 400 });
    }

    console.log("[SUBSCRIPTION-WEBHOOK] Event received:", event.type, event.id);

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Process event based on type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("[SUBSCRIPTION-WEBHOOK] Checkout completed:", session.id);

        // Extract metadata
        const restaurantId = session.metadata?.restaurant_id;
        const tier = session.metadata?.tier;

        if (!restaurantId || !tier) {
          console.error("[SUBSCRIPTION-WEBHOOK] Missing metadata in checkout session");
          break;
        }

        // Get subscription ID from the session
        const subscriptionId = session.subscription as string;

        // Update restaurant with subscription info
        const { error: updateError } = await supabaseAdmin
          .from("restaurants")
          .update({
            stripe_subscription_id: subscriptionId,
            stripe_subscription_customer_id: session.customer as string,
            subscription_tier: tier,
            subscription_status: 'active',
            subscription_period: session.metadata?.period || 'monthly',
            trial_ends_at: null, // Clear trial since they're now paying
          })
          .eq("id", restaurantId);

        if (updateError) {
          console.error("[SUBSCRIPTION-WEBHOOK] Failed to update restaurant:", updateError);
        } else {
          console.log("[SUBSCRIPTION-WEBHOOK] Restaurant updated with subscription:", restaurantId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("[SUBSCRIPTION-WEBHOOK] Subscription updated:", subscription.id, subscription.status);

        // Find restaurant by subscription ID or customer ID
        let restaurantId = subscription.metadata?.restaurant_id;

        if (!restaurantId) {
          // Try to find by subscription ID
          const { data: restaurant } = await supabaseAdmin
            .from("restaurants")
            .select("id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle();

          if (restaurant) {
            restaurantId = restaurant.id;
          } else {
            // Try to find by customer ID
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
          break;
        }

        // Map Stripe subscription status to our status
        let subscriptionStatus: string;
        switch (subscription.status) {
          case 'active':
            subscriptionStatus = 'active';
            break;
          case 'trialing':
            subscriptionStatus = 'trialing';
            break;
          case 'past_due':
            subscriptionStatus = 'past_due';
            break;
          case 'canceled':
          case 'unpaid':
          case 'incomplete_expired':
            subscriptionStatus = 'canceled';
            break;
          default:
            subscriptionStatus = 'active'; // Default to active for other states
        }

        // Determine tier from price metadata or subscription metadata
        let tier = subscription.metadata?.tier;
        if (!tier && subscription.items.data[0]) {
          const priceId = subscription.items.data[0].price.id;
          // Map price IDs to tiers
          if (priceId.includes('starter') || priceId === 'price_1SuxQuD9w6YUNUOUNUnCmY30' || priceId === 'price_1SuxQuD9w6YUNUOUbTEYjtba') {
            tier = 'starter';
          } else if (priceId.includes('growth') || priceId === 'price_1SuxQvD9w6YUNUOUpgwOabhZ' || priceId === 'price_1SuxQvD9w6YUNUOUvdeYY3LS') {
            tier = 'growth';
          } else if (priceId.includes('pro') || priceId === 'price_1SuxQwD9w6YUNUOU68X5KKWV' || priceId === 'price_1SuxQwD9w6YUNUOUQU80UHw2') {
            tier = 'pro';
          }
        }

        // Determine period from price
        let period = subscription.metadata?.period;
        if (!period && subscription.items.data[0]) {
          const interval = subscription.items.data[0].price.recurring?.interval;
          period = interval === 'year' ? 'annual' : 'monthly';
        }

        // Update restaurant
        const updateData: Record<string, any> = {
          subscription_status: subscriptionStatus,
          stripe_subscription_id: subscription.id,
        };

        if (tier) {
          updateData.subscription_tier = tier;
        }
        if (period) {
          updateData.subscription_period = period;
        }

        // Set subscription end date
        if (subscription.current_period_end) {
          updateData.subscription_ends_at = new Date(subscription.current_period_end * 1000).toISOString();
        }

        // Clear grandfathering if they're now paying
        if (subscriptionStatus === 'active') {
          updateData.grandfathered_until = null;
        }

        const { error: updateError } = await supabaseAdmin
          .from("restaurants")
          .update(updateData)
          .eq("id", restaurantId);

        if (updateError) {
          console.error("[SUBSCRIPTION-WEBHOOK] Failed to update restaurant:", updateError);
        } else {
          console.log("[SUBSCRIPTION-WEBHOOK] Restaurant subscription updated:", restaurantId, updateData);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("[SUBSCRIPTION-WEBHOOK] Subscription deleted:", subscription.id);

        // Find restaurant
        const { data: restaurant } = await supabaseAdmin
          .from("restaurants")
          .select("id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (restaurant) {
          // Mark as canceled but keep at starter tier (basic access)
          const { error: updateError } = await supabaseAdmin
            .from("restaurants")
            .update({
              subscription_status: 'canceled',
              subscription_tier: 'starter', // Downgrade to starter
              subscription_ends_at: new Date().toISOString(),
            })
            .eq("id", restaurant.id);

          if (updateError) {
            console.error("[SUBSCRIPTION-WEBHOOK] Failed to update canceled subscription:", updateError);
          } else {
            console.log("[SUBSCRIPTION-WEBHOOK] Restaurant subscription canceled:", restaurant.id);
          }
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[SUBSCRIPTION-WEBHOOK] Payment succeeded:", invoice.id);

        if (invoice.subscription) {
          // Find restaurant and ensure status is active
          const { data: restaurant } = await supabaseAdmin
            .from("restaurants")
            .select("id, subscription_status")
            .eq("stripe_subscription_id", invoice.subscription as string)
            .maybeSingle();

          if (restaurant && restaurant.subscription_status === 'past_due') {
            const { error: updateError } = await supabaseAdmin
              .from("restaurants")
              .update({ subscription_status: 'active' })
              .eq("id", restaurant.id);

            if (updateError) {
              console.error("[SUBSCRIPTION-WEBHOOK] Failed to update status after payment:", updateError);
            } else {
              console.log("[SUBSCRIPTION-WEBHOOK] Restaurant status updated to active after payment:", restaurant.id);
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("[SUBSCRIPTION-WEBHOOK] Payment failed:", invoice.id);

        if (invoice.subscription) {
          // Find restaurant and mark as past_due
          const { data: restaurant } = await supabaseAdmin
            .from("restaurants")
            .select("id")
            .eq("stripe_subscription_id", invoice.subscription as string)
            .maybeSingle();

          if (restaurant) {
            const { error: updateError } = await supabaseAdmin
              .from("restaurants")
              .update({ subscription_status: 'past_due' })
              .eq("id", restaurant.id);

            if (updateError) {
              console.error("[SUBSCRIPTION-WEBHOOK] Failed to update status after payment failure:", updateError);
            } else {
              console.log("[SUBSCRIPTION-WEBHOOK] Restaurant marked as past_due:", restaurant.id);
            }
          }
        }
        break;
      }

      default:
        console.log("[SUBSCRIPTION-WEBHOOK] Unhandled event type:", event.type);
    }

    // Always return 200 to acknowledge receipt
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SUBSCRIPTION-WEBHOOK] Unexpected error:", errorMessage);

    // Still return 200 to prevent Stripe from retrying
    // Errors should be logged and handled separately
    return new Response(JSON.stringify({ received: true, error: errorMessage }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
