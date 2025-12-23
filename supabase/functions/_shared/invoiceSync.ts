import Stripe from "https://esm.sh/stripe@20.1.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

interface InvoiceUpdateExtras {
  stripe_fee_amount?: number;
  stripe_fee_description?: string | null;
  application_fee_amount?: number;
  updated_by?: string;
  existingInvoice?: { paid_at?: string | null };
}

export async function updateInvoiceFromStripe(
  supabaseAdmin: SupabaseClient,
  invoiceId: string,
  stripeInvoice: Stripe.Invoice,
  extras: InvoiceUpdateExtras = {},
) {
  const statusMap: Record<string, string> = {
    draft: "draft",
    open: "open",
    paid: "paid",
    void: "void",
    uncollectible: "uncollectible",
  };

  const mappedStatus = statusMap[stripeInvoice.status ?? ""] ?? "open";

  const updateData: Record<string, unknown> = {
    status: mappedStatus,
    invoice_number: stripeInvoice.number ?? null,
    hosted_invoice_url: stripeInvoice.hosted_invoice_url ?? null,
    invoice_pdf_url: stripeInvoice.invoice_pdf ?? null,
    amount_paid: stripeInvoice.amount_paid ?? 0,
    amount_remaining: stripeInvoice.amount_remaining ?? 0,
    amount_due: stripeInvoice.amount_due ?? 0,
    updated_at: new Date().toISOString(),
  };

  if (extras.updated_by) {
    updateData.updated_by = extras.updated_by;
  }

  if (extras.stripe_fee_amount !== undefined) {
    updateData.stripe_fee_amount = extras.stripe_fee_amount;
  }
  if (extras.stripe_fee_description !== undefined) {
    updateData.stripe_fee_description = extras.stripe_fee_description;
  }
  if (extras.application_fee_amount !== undefined) {
    updateData.application_fee_amount = extras.application_fee_amount;
  }

  if (
    mappedStatus === "paid" &&
    !extras.existingInvoice?.paid_at &&
    stripeInvoice.status_transitions?.paid_at
  ) {
    updateData.paid_at = new Date(stripeInvoice.status_transitions.paid_at * 1000).toISOString();
  }

  const { error } = await supabaseAdmin
    .from("invoices")
    .update(updateData)
    .eq("id", invoiceId);

  if (error) {
    throw new Error(`Failed to update invoice: ${error.message}`);
  }

  return { status: mappedStatus, updateData };
}
