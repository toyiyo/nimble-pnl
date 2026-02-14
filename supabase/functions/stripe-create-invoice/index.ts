import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@20.1.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { computeProcessingFeeCents } from "../_shared/invoiceUtils.ts";
import { corsHeaders } from "../_shared/cors.ts";

interface LineItem {
  description: string;
  quantity: number;
  unit_amount: number; // expected in cents from the client
  tax_behavior?: 'inclusive' | 'exclusive' | 'unspecified';
  tax_rate?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[CREATE-INVOICE] Starting invoice creation");

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

    const { 
      restaurantId,
      customerId,
      lineItems,
      dueDate,
      description,
      footer,
      memo,
      passFeesToCustomer,
    } = await req.json() as {
      restaurantId: string;
      customerId: string;
      lineItems: LineItem[];
      dueDate?: string;
      description?: string;
      footer?: string;
      memo?: string;
      passFeesToCustomer?: boolean;
    };
    
    if (!restaurantId || !customerId || !lineItems || lineItems.length === 0) {
      throw new Error("Restaurant ID, customer ID, and line items are required");
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify user has access
    const { data: userRestaurant } = await supabaseAdmin
      .from("user_restaurants")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!userRestaurant || !["owner", "manager"].includes(userRestaurant.role)) {
      throw new Error("Access denied");
    }

    // Get connected account first (needed for customer syncing)
    const { data: connectedAccount } = await supabaseAdmin
      .from("stripe_connected_accounts")
      .select("stripe_account_id, charges_enabled")
      .eq("restaurant_id", restaurantId)
      .single();

    if (!connectedAccount) {
      throw new Error("Restaurant must set up Stripe Connect first");
    }

    if (!connectedAccount.charges_enabled) {
      throw new Error("Stripe Connect account must complete onboarding before creating invoices");
    }

    // Initialize Stripe client
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2024-12-18.acacia" as any
    });

    // Get customer with Stripe ID
    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("stripe_customer_id, email")
      .eq("id", customerId)
      .eq("restaurant_id", restaurantId)
      .single();

    if (customerError || !customer) {
      throw new Error("Customer not found");
    }

    if (!customer.email) {
      return new Response(
        JSON.stringify({
          error: "Customer email is required to send invoices. Please add an email address for this customer.",
          code: "MISSING_EMAIL"
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    if (!customer.stripe_customer_id) {
      // Auto-sync customer with Stripe
      console.log("[CREATE-INVOICE] Customer not synced with Stripe, syncing now...");

      // Get full customer details for Stripe customer creation
      const { data: fullCustomer, error: fullCustomerError } = await supabaseAdmin
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .eq("restaurant_id", restaurantId)
        .single();

      if (fullCustomerError || !fullCustomer) {
        throw new Error("Failed to fetch customer details for Stripe sync");
      }

      // Create Stripe customer on behalf of connected account
      const stripeCustomer = await stripe.customers.create(
        {
          name: fullCustomer.name,
          email: fullCustomer.email || undefined,
          phone: fullCustomer.phone || undefined,
          address: fullCustomer.billing_address_line1 ? {
            line1: fullCustomer.billing_address_line1,
            line2: fullCustomer.billing_address_line2 || undefined,
            city: fullCustomer.billing_address_city || undefined,
            state: fullCustomer.billing_address_state || undefined,
            postal_code: fullCustomer.billing_address_postal_code || undefined,
            country: fullCustomer.billing_address_country || "US",
          } : undefined,
          metadata: {
            customer_id: customerId,
            restaurant_id: restaurantId,
          },
        },
        {
          stripeAccount: connectedAccount.stripe_account_id,
        }
      );

      console.log("[CREATE-INVOICE] Customer synced with Stripe:", stripeCustomer.id);

      // Update customer record with Stripe ID
      await supabaseAdmin
        .from("customers")
        .update({ stripe_customer_id: stripeCustomer.id })
        .eq("id", customerId);

      // Update the customer object for invoice creation
      customer.stripe_customer_id = stripeCustomer.id;
    }

    // Normalize and calculate totals in cents
    let subtotalCents = 0;
    let taxCents = 0;

    const normalizedLineItems = lineItems.map((item) => {
      const unitAmountCents = Math.max(0, Math.round(item.unit_amount)); // already cents from client
      const lineTotalCents = Math.round(unitAmountCents * item.quantity);

      subtotalCents += lineTotalCents;

      if (item.tax_rate) {
        taxCents += Math.round(lineTotalCents * item.tax_rate);
      }

      return {
        description: item.description,
        quantity: item.quantity,
        unitAmountCents,
        lineTotalCents,
        tax_behavior: item.tax_behavior || "unspecified",
        tax_rate: item.tax_rate ?? null,
      };
    });

    // Add processing fee line item if passFeesToCustomer is enabled
    if (passFeesToCustomer) {
      // Gross-up so the restaurant nets subtotalCents after Stripe fees
      const estimatedFeeCents = computeProcessingFeeCents(subtotalCents);
      subtotalCents += estimatedFeeCents;
      normalizedLineItems.push({
        description: "Processing Fee",
        quantity: 1,
        unitAmountCents: estimatedFeeCents,
        lineTotalCents: estimatedFeeCents,
        tax_behavior: "unspecified",
        tax_rate: null,
      });
    }

    const totalCents = subtotalCents + taxCents;

    // Create invoice in Stripe (empty first)
    const stripeInvoice = await stripe.invoices.create(
      {
        customer: customer.stripe_customer_id,
        auto_advance: false, // Don't automatically finalize (keep as draft)
        collection_method: "send_invoice",
        days_until_due: dueDate ? Math.max(1, Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 30,
        description: description || undefined,
        footer: footer || undefined,
        metadata: {
          restaurant_id: restaurantId,
          customer_id: customerId,
          memo: memo || "",
        },
        payment_settings: {
          payment_method_types: ["card", "us_bank_account"], // Enable card + ACH
        },
      },
      {
        stripeAccount: connectedAccount.stripe_account_id,
      }
    );

    console.log("[CREATE-INVOICE] Stripe invoice created:", stripeInvoice.id);

    // Now add invoice items to the specific invoice
    const stripeLineItems = [];
    for (const item of normalizedLineItems) {
      const invoiceItem = await stripe.invoiceItems.create(
        {
          customer: customer.stripe_customer_id,
          invoice: stripeInvoice.id, // Attach to specific invoice
          description: item.description,
          quantity: item.quantity,
          unit_amount: item.unitAmountCents,
          currency: "usd",
          tax_behavior: item.tax_behavior,
        },
        {
          stripeAccount: connectedAccount.stripe_account_id,
        }
      );

      stripeLineItems.push({
        stripe_invoice_item_id: invoiceItem.id,
        description: item.description,
        quantity: item.quantity,
        unit_amount: item.unitAmountCents, // cents per unit
        amount: item.lineTotalCents, // total for the line in cents
        tax_behavior: item.tax_behavior,
        tax_rate: item.tax_rate,
      });
    }

    // Retrieve the updated invoice with calculated totals
    const updatedInvoice = await stripe.invoices.retrieve(
      stripeInvoice.id,
      {},
      {
        stripeAccount: connectedAccount.stripe_account_id,
      }
    );

    console.log("[CREATE-INVOICE] Invoice totals - subtotal:", updatedInvoice.subtotal, "tax:", updatedInvoice.tax, "total:", updatedInvoice.total);

    // Store invoice in database
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("invoices")
      .insert({
        restaurant_id: restaurantId,
        customer_id: customerId,
        stripe_invoice_id: stripeInvoice.id,
        invoice_number: updatedInvoice.number || null,
        status: "draft",
        currency: "usd",
        subtotal: updatedInvoice.subtotal ?? subtotalCents,
        tax: updatedInvoice.tax ?? taxCents,
        total: updatedInvoice.total ?? totalCents,
        amount_due: updatedInvoice.amount_due ?? totalCents,
        amount_paid: updatedInvoice.amount_paid || 0,
        amount_remaining: updatedInvoice.amount_remaining ?? totalCents,
        due_date: dueDate || null,
        invoice_date: new Date().toISOString().split('T')[0],
        description: description || null,
        footer: footer || null,
        memo: memo || null,
        pass_fees_to_customer: passFeesToCustomer || false,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (invoiceError) {
      console.error("[CREATE-INVOICE] Failed to store invoice:", invoiceError);
      throw new Error(`Failed to store invoice: ${invoiceError.message}`);
    }

    // Store line items
    const lineItemsToInsert = stripeLineItems.map(item => ({
      invoice_id: invoice.id,
      ...item,
    }));

    const { error: lineItemsError } = await supabaseAdmin
      .from("invoice_line_items")
      .insert(lineItemsToInsert);

    if (lineItemsError) {
      console.error("[CREATE-INVOICE] Failed to store line items:", lineItemsError);
      // Attempt cleanup: delete Stripe invoice and DB invoice to avoid partial state
      try {
        await stripe.invoices.del(
          stripeInvoice.id,
          {
            stripeAccount: connectedAccount.stripe_account_id,
          }
        );
      } catch (cleanupErr) {
        console.error("[CREATE-INVOICE] Failed to delete Stripe invoice after line item error:", cleanupErr);
      }

      try {
        await supabaseAdmin.from("invoices").delete().eq("id", invoice.id);
      } catch (dbCleanupErr) {
        console.error("[CREATE-INVOICE] Failed to delete local invoice after line item error:", dbCleanupErr);
      }

      throw new Error(`Failed to store line items: ${lineItemsError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoiceId: invoice.id,
        stripeInvoiceId: stripeInvoice.id,
        status: "draft",
        total: totalCents,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-INVOICE] Error:", errorMessage);

    // Map known Stripe errors to user-friendly messages
    let userMessage = errorMessage;
    let code = "STRIPE_ERROR";

    if (errorMessage.includes("Missing email") || errorMessage.includes("valid email")) {
      userMessage = "Customer email is required to send invoices. Please add an email address.";
      code = "MISSING_EMAIL";
    } else if (errorMessage.includes("No such customer")) {
      userMessage = "This customer's Stripe account could not be found. Please try again.";
      code = "CUSTOMER_NOT_FOUND";
    } else if (errorMessage.includes("cannot currently make live charges")) {
      userMessage = "Your Stripe account setup is incomplete. Please finish onboarding in Settings.";
      code = "ONBOARDING_INCOMPLETE";
    }

    return new Response(
      JSON.stringify({ error: userMessage, code }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  }
});
