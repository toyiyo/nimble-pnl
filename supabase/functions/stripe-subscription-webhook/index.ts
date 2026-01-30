import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { processSubscriptionEvent } from "./subscription-handler.ts";

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

    // Allow bypassing signature check for local testing with "test_local" signature
    // SAFEGUARD: Only allow in non-production environments
    const isLocalEnv = Deno.env.get("SUPABASE_URL")?.includes("localhost") ||
                       Deno.env.get("SUPABASE_URL")?.includes("127.0.0.1") ||
                       Deno.env.get("DENO_ENV") === "development";

    if (signature === "test_local" && isLocalEnv) {
      console.log("[SUBSCRIPTION-WEBHOOK] Bypassing signature check for local testing");
      event = JSON.parse(body) as Stripe.Event;
    } else if (signature === "test_local") {
      // Reject test_local in production
      console.error("[SUBSCRIPTION-WEBHOOK] test_local signature rejected in production");
      return new Response("Invalid signature", { status: 400 });
    } else {
      try {
        // Use constructEventAsync for Deno runtime (SubtleCrypto requires async)
        event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("[SUBSCRIPTION-WEBHOOK] Signature verification failed:", errorMessage);
        return new Response(`Webhook signature verification failed: ${errorMessage}`, { status: 400 });
      }
    }
    

    console.log("[SUBSCRIPTION-WEBHOOK] Event received:", event.type, event.id);

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await processSubscriptionEvent(event, supabaseAdmin);

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
    // Don't expose internal error details in response
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
});
