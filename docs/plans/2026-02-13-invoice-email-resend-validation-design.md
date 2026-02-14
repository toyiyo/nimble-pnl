# Invoice Email, Resend & Validation Improvements

**Date:** 2026-02-13
**Status:** Approved

## Problems

1. **Invoices fail to create when customer has no email.** Stripe requires an email for `collection_method: "send_invoice"`, but our customer form only requires `name`. The error shown is "Edge Function returned a non-2xx status code" — completely unhelpful.
2. **No way to resend a sent invoice.** Once an invoice is `open`, the Send button disappears. If a customer loses the email, the user has no recourse.
3. **No way to share an invoice via link, SMS, or WhatsApp.** The `hosted_invoice_url` is stored but not exposed to users.

## Design

### 1. Email Validation in Invoice Form

**Files:** `src/pages/InvoiceForm.tsx`, `supabase/functions/stripe-create-invoice/index.ts`

When a customer is selected in the invoice form:
- Check if `selectedCustomer.email` exists
- If missing, show an amber warning banner below the customer selector:
  - Style: `bg-amber-500/10 border border-amber-500/20` (matches existing AI suggestion pattern)
  - Text: "This customer doesn't have an email address. An email is required to send invoices."
  - "Add Email" button opens `CustomerFormDialog` in edit mode, pre-filled with the customer
- Disable "Create & Send Invoice" button while customer has no email
- After dialog saves and closes, refetch customer data; warning disappears

**Server-side backup:** Add explicit email validation in `stripe-create-invoice` before calling Stripe API, returning: `"Customer email is required to create an invoice. Please add an email address for this customer."`

### 2. Resend Email + Share Actions

**Files:** `src/pages/InvoiceDetail.tsx`, `src/hooks/useInvoices.ts`, `supabase/functions/stripe-send-invoice/index.ts`

For invoices with status `open` or `paid` that have a `hosted_invoice_url`:

**UI layout:** Primary "Resend Email" button + secondary share dropdown (Share icon):
- **Resend Email** (primary button) — Calls `stripe-send-invoice` edge function. Shows toast: "Invoice email sent to {email}"
- **Copy Link** (dropdown) — Copies `hosted_invoice_url` to clipboard. Toast: "Invoice link copied"
- **Share via SMS** (dropdown) — Opens `sms:?body=...` with pre-filled message
- **Share via WhatsApp** (dropdown) — Opens `https://wa.me/?text=...` with pre-filled message

**Share message template:** "Here's your invoice from {restaurant_name} for ${amount}: {url}"

**Edge function change:** Update `stripe-send-invoice` to allow `open` and `paid` invoices (currently only allows `draft`). For `draft`: finalize then send (existing behavior). For `open`/`paid`: call `stripe.invoices.sendInvoice()` directly.

### 3. Better Error Handling

**Files:** `supabase/functions/stripe-create-invoice/index.ts`, `src/pages/InvoiceForm.tsx`

**Server-side error parser** maps Stripe errors to user-friendly messages:

| Stripe Error | User-Friendly Message | Code |
|---|---|---|
| `"Missing email..."` | "Customer email is required to send invoices. Please add an email address." | `MISSING_EMAIL` |
| `"No such customer..."` | "This customer's Stripe account could not be found. Please try again." | `CUSTOMER_NOT_FOUND` |
| `"cannot currently make live charges"` | "Your Stripe account setup is incomplete. Please finish onboarding in Settings." | `ONBOARDING_INCOMPLETE` |
| Other | Pass through Stripe's `message` field | `STRIPE_ERROR` |

Return structured JSON: `{ error: "message", code: "CODE" }`

**Client-side:** Update `onError` handler in invoice creation mutation to parse response body and display the user-friendly message in toast description. For `MISSING_EMAIL`, also trigger the inline "Add Email" prompt.

## Files to Modify

| File | Change |
|---|---|
| `src/pages/InvoiceForm.tsx` | Email validation banner, disable button, error handling |
| `src/pages/InvoiceDetail.tsx` | Resend button, share dropdown (copy link, SMS, WhatsApp) |
| `src/hooks/useInvoices.ts` | Add `resendInvoice` mutation |
| `supabase/functions/stripe-create-invoice/index.ts` | Pre-validate email, structured error responses |
| `supabase/functions/stripe-send-invoice/index.ts` | Allow open/paid invoices, resend support |

## Out of Scope

- Making email required globally on the customer form (only enforced in invoice flow)
- Email template customization
- Automated reminders / scheduled follow-ups
