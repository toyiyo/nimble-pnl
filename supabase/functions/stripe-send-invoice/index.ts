import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
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

    console.log("[SEND-INVOICE] Invoice data:", {
      id: invoice.id,
      stripe_invoice_id: invoice.stripe_invoice_id,
      status: invoice.status
    });

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
      apiVersion: "2024-12-18.acacia" as any
    });

    if (!invoice.stripe_invoice_id) {
      console.log("[SEND-INVOICE] No Stripe invoice ID found, attempting to recreate invoice in Stripe");
      
      // Recreate the invoice in Stripe
      const stripeInvoice = await stripe.invoices.create(
        {
          customer: invoice.customers.stripe_customer_id,
          auto_advance: false,
          collection_method: "send_invoice",
          days_until_due: invoice.due_date ? Math.max(1, Math.ceil((new Date(invoice.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 30,
          description: invoice.description || undefined,
          footer: invoice.footer || undefined,
          metadata: {
            restaurant_id: invoice.restaurant_id,
            customer_id: invoice.customer_id,
            memo: invoice.memo || "",
          },
          payment_settings: {
            payment_method_types: ["card", "us_bank_account"],
          },
        },
        {
          stripeAccount: connectedAccount.stripe_account_id,
        }
      );

      console.log("[SEND-INVOICE] Recreated Stripe invoice:", stripeInvoice.id);

      // Update the invoice in our database with the new Stripe ID
      await supabaseAdmin
        .from("invoices")
        .update({
          stripe_invoice_id: stripeInvoice.id,
          updated_by: user.id,
        })
        .eq("id", invoiceId);

      // Add line items to the recreated invoice
      const { data: lineItems } = await supabaseAdmin
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoiceId);

      if (lineItems && lineItems.length > 0) {
        for (const item of lineItems) {
          await stripe.invoiceItems.create(
            {
              customer: invoice.customers.stripe_customer_id,
              invoice: stripeInvoice.id,
              amount: item.amount,
              currency: "usd",
              description: item.description,
              quantity: item.quantity,
            },
            {
              stripeAccount: connectedAccount.stripe_account_id,
            }
          );
        }
      }

      // Use the newly created invoice
      invoice.stripe_invoice_id = stripeInvoice.id;
    }

    if (invoice.status !== 'draft') {
      throw new Error("Only draft invoices can be sent");
    }

    // Verify the invoice exists in Stripe
    let stripeInvoiceCheck;
    try {
      stripeInvoiceCheck = await stripe.invoices.retrieve(
        invoice.stripe_invoice_id,
        {},
        {
          stripeAccount: connectedAccount.stripe_account_id,
        }
      );
      console.log("[SEND-INVOICE] Stripe invoice verified:", stripeInvoiceCheck.id, "status:", stripeInvoiceCheck.status);
    } catch (stripeError) {
      console.error("[SEND-INVOICE] Stripe invoice not found:", stripeError);
      throw new Error(`Invoice not found in Stripe: ${invoice.stripe_invoice_id}`);
    }

    // Check if invoice is already finalized
    if (stripeInvoiceCheck.status === 'open') {
      console.log("[SEND-INVOICE] Invoice is already open (finalized and sent)");
      // Update our database to match Stripe status
      await supabaseAdmin
        .from("invoices")
        .update({
          status: "open",
          invoice_number: stripeInvoiceCheck.number,
          hosted_invoice_url: stripeInvoiceCheck.hosted_invoice_url,
          invoice_pdf_url: stripeInvoiceCheck.invoice_pdf,
          updated_by: user.id,
        })
        .eq("id", invoiceId);

      return new Response(
        JSON.stringify({
          success: true,
          status: "open",
          hostedInvoiceUrl: stripeInvoiceCheck.hosted_invoice_url,
          invoicePdfUrl: stripeInvoiceCheck.invoice_pdf,
          message: "Invoice was already sent",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Finalize the invoice (makes it immutable and ready to send)
    let finalizedInvoice;
    if (stripeInvoiceCheck.status === 'draft') {
      console.log("[SEND-INVOICE] Finalizing draft invoice");
      finalizedInvoice = await stripe.invoices.finalizeInvoice(
        invoice.stripe_invoice_id,
        {},
        {
          stripeAccount: connectedAccount.stripe_account_id,
        }
      );
    } else {
      console.log("[SEND-INVOICE] Invoice already finalized, using existing data");
      finalizedInvoice = stripeInvoiceCheck;
    }

    // Send the invoice via email
    let sentInvoice;
    if (finalizedInvoice.status === 'open') {
      console.log("[SEND-INVOICE] Invoice already sent");
      sentInvoice = finalizedInvoice;
    } else {
      console.log("[SEND-INVOICE] Sending finalized invoice");
      sentInvoice = await stripe.invoices.sendInvoice(
        invoice.stripe_invoice_id,
        {},
        {
          stripeAccount: connectedAccount.stripe_account_id,
        }
      );
    }

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
