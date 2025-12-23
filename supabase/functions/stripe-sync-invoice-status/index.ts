import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { updateInvoiceFromStripe } from "../_shared/invoiceSync.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[SYNC-INVOICE-STATUS] Starting invoice status sync");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      throw new Error("User not authenticated");
    }

    const { invoiceId } = await req.json();

    if (!invoiceId) {
      throw new Error("Invoice ID is required");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get invoice
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("invoices")
      .select("*, customers(stripe_customer_id)")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      throw new Error("Invoice not found");
    }

    if (!invoice.stripe_invoice_id) {
      throw new Error("Invoice has no Stripe invoice ID");
    }

    // Verify user has access
    const { data: userRestaurant } = await supabaseAdmin
      .from("user_restaurants")
      .select("role")
      .eq("restaurant_id", invoice.restaurant_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!userRestaurant || !["owner", "manager"].includes(userRestaurant.role)) {
      throw new Error("Access denied");
    }

    // Get connected account
    const { data: connectedAccount } = await supabaseAdmin
      .from("stripe_connected_accounts")
      .select("stripe_account_id")
      .eq("restaurant_id", invoice.restaurant_id)
      .single();

    if (!connectedAccount) {
      throw new Error("Restaurant Stripe Connect account not found");
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil" as any
    });

    // Fetch current invoice status from Stripe
    console.log("[SYNC-INVOICE-STATUS] Fetching invoice from Stripe:", invoice.stripe_invoice_id);
    const stripeInvoice = await stripe.invoices.retrieve(
      invoice.stripe_invoice_id,
      {
        expand: ['payment_intent', 'payment_intent.latest_charge', 'payment_intent.latest_charge.balance_transaction']
      },
      {
        stripeAccount: connectedAccount.stripe_account_id,
      }
    );

    console.log("[SYNC-INVOICE-STATUS] Stripe invoice status:", stripeInvoice.status);

    // Extract fee information from Stripe
    let stripeFeeAmount = 0;
    let stripeFeeDescription = null;
    let applicationFeeAmount = 0;

    if (stripeInvoice.payment_intent && typeof stripeInvoice.payment_intent !== 'string') {
      const paymentIntent = stripeInvoice.payment_intent;
      
      // Get application fee if it exists
      if (paymentIntent.application_fee_amount) {
        applicationFeeAmount = paymentIntent.application_fee_amount;
      }

      // Get Stripe fee from the latest charge's balance transaction
      if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== 'string') {
        const charge = paymentIntent.latest_charge;
        if (charge.balance_transaction && typeof charge.balance_transaction !== 'string') {
          const balanceTx = charge.balance_transaction;
          // Stripe fee is the difference between the charge amount and the net amount
          stripeFeeAmount = balanceTx.fee;
          stripeFeeDescription = `Stripe processing fee (${balanceTx.fee_details?.map(d => d.description).join(', ') || 'Standard processing'})`;
        }
      }
    }

    // Map Stripe status to our status
    let status: string;
    switch (stripeInvoice.status) {
      case 'draft':
        status = 'draft';
        break;
      case 'open':
        status = 'open';
        break;
      case 'paid':
        status = 'paid';
        break;
      case 'void':
        status = 'void';
        break;
      case 'uncollectible':
        status = 'uncollectible';
        break;
      default:
        status = invoice.status; // Keep existing status if unknown
    }

    // Update invoice in database with latest Stripe data via shared helper
    const { status: updatedStatus, updateData } = await updateInvoiceFromStripe(
      supabaseAdmin,
      invoiceId,
      stripeInvoice,
      {
        updated_by: user.id,
        existingInvoice: invoice,
        stripe_fee_amount: stripeFeeAmount,
        stripe_fee_description: stripeFeeDescription,
        application_fee_amount: applicationFeeAmount,
      }
    );

    console.log("[SYNC-INVOICE-STATUS] Invoice status updated:", {
      id: invoiceId,
      status: updatedStatus,
      amount_paid: updateData.amount_paid,
      amount_remaining: updateData.amount_remaining,
    });

    return new Response(
      JSON.stringify({
        success: true,
        status,
        invoice_number: updateData.invoice_number,
        amount_paid: updateData.amount_paid,
        amount_remaining: updateData.amount_remaining,
        hosted_invoice_url: updateData.hosted_invoice_url,
        invoice_pdf_url: updateData.invoice_pdf_url,
        stripe_fee_amount: updateData.stripe_fee_amount,
        stripe_fee_description: updateData.stripe_fee_description,
        application_fee_amount: updateData.application_fee_amount,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SYNC-INVOICE-STATUS] Error:", errorMessage);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
