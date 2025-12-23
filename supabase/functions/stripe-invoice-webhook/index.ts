import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { updateInvoiceFromStripe } from "../_shared/invoiceSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const webhookSecret = Deno.env.get("STRIPE_INVOICE_WEBHOOK_SECRET") ?? "";

// @ts-expect-error: using future Stripe API version for embedded support
const stripe = new Stripe(stripeSecret, { apiVersion: "2025-08-27.basil" });

const isInvoiceObject = (obj: unknown): obj is Stripe.Invoice => {
  if (!obj || typeof obj !== "object") return false;
  const invoice = obj as Record<string, unknown>;
  return invoice.object === "invoice" && typeof invoice.id === "string" && typeof invoice.status === "string";
};

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

    // Only handle invoice events; ignore the noise but return 200 to Stripe
    if (!event.type.startsWith("invoice.")) {
      console.log("[INVOICE-WEBHOOK] Ignoring non-invoice event:", event.type);
      return new Response(JSON.stringify({ ignored: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const invoiceObject = event.data.object;

    if (!isInvoiceObject(invoiceObject)) {
      console.log("[INVOICE-WEBHOOK] Event is not an invoice or missing fields:", event.type);
      return new Response(JSON.stringify({ ignored: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const invoice = invoiceObject;

    // Find our invoice record
    const { data: invoiceRow } = await supabaseAdmin
      .from("invoices")
      .select("id, paid_at")
      .eq("stripe_invoice_id", invoice.id)
      .maybeSingle();

    if (!invoiceRow) {
      console.log("[INVOICE-WEBHOOK] Invoice not found locally for Stripe ID:", invoice.id);
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    await updateInvoiceFromStripe(
      supabaseAdmin,
      invoiceRow.id,
      invoice,
      { existingInvoice: invoiceRow }
    );

    console.log("[INVOICE-WEBHOOK] Invoice updated from event:", event.type, invoice.id);

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
