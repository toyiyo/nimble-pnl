import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const webhookSecret = Deno.env.get("STRIPE_INVOICE_WEBHOOK_SECRET") ?? "";

// @ts-expect-error: using future Stripe API version for embedded support
const stripe = new Stripe(stripeSecret, { apiVersion: "2025-08-27.basil" });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!webhookSecret) {
    return new Response("Missing STRIPE_INVOICE_WEBHOOK_SECRET", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown webhook error";
    console.error("[INVOICE-WEBHOOK] Signature verification failed:", message);
    return new Response(message, { status: 400 });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    switch (event.type) {
      case "invoice.created":
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.payment_action_required":
      case "invoice.marked_uncollectible":
      case "invoice.voided": {
        const invoice = event.data.object as Stripe.Invoice;

        const statusMap: Record<string, string> = {
          draft: "draft",
          open: "open",
          paid: "paid",
          void: "void",
          uncollectible: "uncollectible",
        };

        const mappedStatus = statusMap[invoice.status ?? ""] ?? "open";

        const updateData: Record<string, unknown> = {
          status: mappedStatus,
          invoice_number: invoice.number,
          hosted_invoice_url: invoice.hosted_invoice_url,
          invoice_pdf_url: invoice.invoice_pdf,
          amount_due: invoice.amount_due ?? 0,
          amount_paid: invoice.amount_paid ?? 0,
          amount_remaining: invoice.amount_remaining ?? 0,
          stripe_fee_amount: invoice.total_tax_amounts?.reduce((sum, tax) => sum + (tax.amount ?? 0), 0) ?? undefined,
          updated_at: new Date().toISOString(),
        };

        if (mappedStatus === "paid" && invoice.status_transitions?.paid_at) {
          updateData.paid_at = new Date(invoice.status_transitions.paid_at * 1000).toISOString();
        }

        const { error } = await supabaseAdmin
          .from("invoices")
          .update(updateData)
          .eq("stripe_invoice_id", invoice.id);

        if (error) {
          console.error("[INVOICE-WEBHOOK] Failed to update invoice:", error.message);
          throw new Error(error.message);
        }

        break;
      }
      default:
        console.log("[INVOICE-WEBHOOK] Unhandled event type:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[INVOICE-WEBHOOK] Error handling event:", message);
    return new Response("Webhook processing error", { status: 500 });
  }
});
