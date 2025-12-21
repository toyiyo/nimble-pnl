import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2025-08-27.basil" as any,
});

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  
  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  try {
    const body = await req.text();
    const webhookSecret = Deno.env.get("STRIPE_INVOICE_WEBHOOK_SECRET");
    
    if (!webhookSecret) {
      console.error("[INVOICE-WEBHOOK] No webhook secret configured");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    
    console.log("[INVOICE-WEBHOOK] Received event:", event.type, event.id);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check if we've already processed this event
    const { data: existingEvent } = await supabaseAdmin
      .from("stripe_events")
      .select("id")
      .eq("event_id", event.id)
      .maybeSingle();

    if (existingEvent) {
      console.log("[INVOICE-WEBHOOK] Event already processed:", event.id);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Store event to prevent duplicate processing
    await supabaseAdmin
      .from("stripe_events")
      .insert({
        event_id: event.id,
        event_type: event.type,
        processed_at: new Date().toISOString(),
      });

    // Handle different invoice events
    switch (event.type) {
      case "invoice.finalized": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoiceFinalized(supabaseAdmin, invoice);
        break;
      }

      case "invoice.sent": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoiceSent(supabaseAdmin, invoice);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentSucceeded(supabaseAdmin, invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(supabaseAdmin, invoice);
        break;
      }

      case "invoice.voided": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoiceVoided(supabaseAdmin, invoice);
        break;
      }

      case "invoice.marked_uncollectible": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoiceUncollectible(supabaseAdmin, invoice);
        break;
      }

      default:
        console.log("[INVOICE-WEBHOOK] Unhandled event type:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[INVOICE-WEBHOOK] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});

async function handleInvoiceFinalized(supabaseAdmin: any, invoice: Stripe.Invoice) {
  console.log("[INVOICE-WEBHOOK] Handling invoice.finalized:", invoice.id);
  
  await supabaseAdmin
    .from("invoices")
    .update({
      status: invoice.status,
      invoice_number: invoice.number,
      hosted_invoice_url: invoice.hosted_invoice_url,
      invoice_pdf_url: invoice.invoice_pdf,
    })
    .eq("stripe_invoice_id", invoice.id);
}

async function handleInvoiceSent(supabaseAdmin: any, invoice: Stripe.Invoice) {
  console.log("[INVOICE-WEBHOOK] Handling invoice.sent:", invoice.id);
  
  await supabaseAdmin
    .from("invoices")
    .update({
      status: "open",
    })
    .eq("stripe_invoice_id", invoice.id);
}

async function handleInvoicePaymentSucceeded(supabaseAdmin: any, invoice: Stripe.Invoice) {
  console.log("[INVOICE-WEBHOOK] Handling invoice.payment_succeeded:", invoice.id);
  
  await supabaseAdmin
    .from("invoices")
    .update({
      status: "paid",
      amount_paid: invoice.amount_paid,
      amount_remaining: invoice.amount_remaining,
      paid_at: new Date().toISOString(),
    })
    .eq("stripe_invoice_id", invoice.id);

  // Record payment
  if (invoice.payment_intent) {
    const paymentIntentId = typeof invoice.payment_intent === 'string' 
      ? invoice.payment_intent 
      : invoice.payment_intent.id;

    const { data: invoiceRecord } = await supabaseAdmin
      .from("invoices")
      .select("id")
      .eq("stripe_invoice_id", invoice.id)
      .single();

    if (invoiceRecord) {
      await supabaseAdmin
        .from("invoice_payments")
        .insert({
          invoice_id: invoiceRecord.id,
          stripe_payment_intent_id: paymentIntentId,
          stripe_charge_id: invoice.charge as string || null,
          amount: invoice.amount_paid,
          currency: invoice.currency,
          payment_method_type: invoice.payment_intent && typeof invoice.payment_intent !== 'string' 
            ? invoice.payment_intent.payment_method_types?.[0] 
            : null,
          status: "succeeded",
        });
    }
  }
}

async function handleInvoicePaymentFailed(supabaseAdmin: any, invoice: Stripe.Invoice) {
  console.log("[INVOICE-WEBHOOK] Handling invoice.payment_failed:", invoice.id);
  
  const { data: invoiceRecord } = await supabaseAdmin
    .from("invoices")
    .select("id")
    .eq("stripe_invoice_id", invoice.id)
    .single();

  if (invoiceRecord && invoice.payment_intent) {
    const paymentIntentId = typeof invoice.payment_intent === 'string' 
      ? invoice.payment_intent 
      : invoice.payment_intent.id;

    await supabaseAdmin
      .from("invoice_payments")
      .insert({
        invoice_id: invoiceRecord.id,
        stripe_payment_intent_id: paymentIntentId,
        amount: invoice.amount_due,
        currency: invoice.currency,
        status: "failed",
        failure_message: invoice.last_finalization_error?.message || "Payment failed",
      });
  }
}

async function handleInvoiceVoided(supabaseAdmin: any, invoice: Stripe.Invoice) {
  console.log("[INVOICE-WEBHOOK] Handling invoice.voided:", invoice.id);
  
  await supabaseAdmin
    .from("invoices")
    .update({
      status: "void",
    })
    .eq("stripe_invoice_id", invoice.id);
}

async function handleInvoiceUncollectible(supabaseAdmin: any, invoice: Stripe.Invoice) {
  console.log("[INVOICE-WEBHOOK] Handling invoice.marked_uncollectible:", invoice.id);
  
  await supabaseAdmin
    .from("invoices")
    .update({
      status: "uncollectible",
    })
    .eq("stripe_invoice_id", invoice.id);
}
