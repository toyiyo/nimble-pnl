import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
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
    console.log("[SEND-INVOICE] Starting invoice send");

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

    if (invoice.status !== 'draft') {
      throw new Error("Only draft invoices can be sent");
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

    // Finalize the invoice (makes it immutable and ready to send)
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(
      invoice.stripe_invoice_id,
      {},
      {
        stripeAccount: connectedAccount.stripe_account_id,
      }
    );

    // Send the invoice via email
    const sentInvoice = await stripe.invoices.sendInvoice(
      invoice.stripe_invoice_id,
      {},
      {
        stripeAccount: connectedAccount.stripe_account_id,
      }
    );

    console.log("[SEND-INVOICE] Invoice sent:", sentInvoice.id);

    // Update invoice in database
    await supabaseAdmin
      .from("invoices")
      .update({
        status: "open",
        invoice_number: sentInvoice.number,
        hosted_invoice_url: sentInvoice.hosted_invoice_url,
        invoice_pdf_url: sentInvoice.invoice_pdf,
        updated_by: user.id,
      })
      .eq("id", invoiceId);

    return new Response(
      JSON.stringify({
        success: true,
        status: "open",
        hostedInvoiceUrl: sentInvoice.hosted_invoice_url,
        invoicePdfUrl: sentInvoice.invoice_pdf,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SEND-INVOICE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
