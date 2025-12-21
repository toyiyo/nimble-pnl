import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LineItem {
  description: string;
  quantity: number;
  unit_amount: number;
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
    } = await req.json() as {
      restaurantId: string;
      customerId: string;
      lineItems: LineItem[];
      dueDate?: string;
      description?: string;
      footer?: string;
      memo?: string;
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

    // Get customer with Stripe ID
    const { data: customer, error: customerError } = await supabaseAdmin
      .from("customers")
      .select("stripe_customer_id")
      .eq("id", customerId)
      .eq("restaurant_id", restaurantId)
      .single();

    if (customerError || !customer) {
      throw new Error("Customer not found");
    }

    if (!customer.stripe_customer_id) {
      throw new Error("Customer must be synced with Stripe first");
    }

    // Get connected account
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

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeKey, { 
      apiVersion: "2025-08-27.basil" as any
    });

    // Calculate totals
    let subtotal = 0;
    let tax = 0;

    // Create invoice items in Stripe
    const stripeLineItems = [];
    for (const item of lineItems) {
      const itemAmount = Math.round(item.quantity * item.unit_amount);
      subtotal += itemAmount;

      const invoiceItem = await stripe.invoiceItems.create(
        {
          customer: customer.stripe_customer_id,
          description: item.description,
          quantity: item.quantity,
          unit_amount: item.unit_amount,
          currency: "usd",
          tax_behavior: item.tax_behavior || "unspecified",
        },
        {
          stripeAccount: connectedAccount.stripe_account_id,
        }
      );

      stripeLineItems.push({
        stripe_invoice_item_id: invoiceItem.id,
        description: item.description,
        quantity: item.quantity,
        unit_amount: item.unit_amount,
        amount: itemAmount,
        tax_behavior: item.tax_behavior || "unspecified",
        tax_rate: item.tax_rate || null,
      });

      // Calculate tax if provided
      if (item.tax_rate) {
        tax += Math.round(itemAmount * item.tax_rate);
      }
    }

    const total = subtotal + tax;

    // Create invoice in Stripe
    const stripeInvoice = await stripe.invoices.create(
      {
        customer: customer.stripe_customer_id,
        auto_advance: false, // Don't automatically finalize (keep as draft)
        collection_method: "send_invoice",
        days_until_due: dueDate ? Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 30,
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
        on_behalf_of: connectedAccount.stripe_account_id,
        transfer_data: {
          destination: connectedAccount.stripe_account_id,
        },
      },
      {
        stripeAccount: connectedAccount.stripe_account_id,
      }
    );

    console.log("[CREATE-INVOICE] Stripe invoice created:", stripeInvoice.id);

    // Store invoice in database
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("invoices")
      .insert({
        restaurant_id: restaurantId,
        customer_id: customerId,
        stripe_invoice_id: stripeInvoice.id,
        invoice_number: stripeInvoice.number || null,
        status: "draft",
        currency: "usd",
        subtotal,
        tax,
        total,
        amount_due: total,
        amount_paid: 0,
        amount_remaining: total,
        due_date: dueDate || null,
        invoice_date: new Date().toISOString().split('T')[0],
        description: description || null,
        footer: footer || null,
        memo: memo || null,
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
      // Don't fail the request - invoice was created
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoiceId: invoice.id,
        stripeInvoiceId: stripeInvoice.id,
        status: "draft",
        total,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-INVOICE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
