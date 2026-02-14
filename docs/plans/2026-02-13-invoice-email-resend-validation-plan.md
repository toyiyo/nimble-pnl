# Invoice Email, Resend & Validation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three invoice issues: cryptic errors when customer lacks email, no way to resend/share sent invoices, and poor Stripe error messages.

**Architecture:** Server-side changes to two edge functions (email validation + resend support), client-side changes to InvoiceForm (validation banner), InvoiceDetail (resend/share buttons), and useInvoices hook (structured error parsing).

**Tech Stack:** Deno edge functions (Stripe SDK), React, React Query, shadcn/ui (DropdownMenu), Lucide icons.

**Design doc:** `docs/plans/2026-02-13-invoice-email-resend-validation-design.md`

---

### Task 1: Add email pre-validation and structured errors to stripe-create-invoice

**Files:**
- Modify: `supabase/functions/stripe-create-invoice/index.ts`

**Step 1: Add email validation after customer fetch**

After line 117 (`throw new Error("Customer not found")`), before the `if (!customer.stripe_customer_id)` block at line 119, add email validation. The customer query at line 108 needs to also select `email`.

Change the customer select at line 111 from:
```typescript
.select("stripe_customer_id")
```
to:
```typescript
.select("stripe_customer_id, email")
```

Then add this check right after the customer-not-found guard (after line 117):

```typescript
if (!customer.email) {
  return new Response(
    JSON.stringify({
      error: "Customer email is required to send invoices. Please add an email address for this customer.",
      code: "MISSING_EMAIL"
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    }
  );
}
```

**Step 2: Add Stripe error parser to the catch block**

Replace the catch block (lines 356-367) with structured error handling:

```typescript
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
      status: 400,
    }
  );
}
```

**Step 3: Verify locally**

Run: `npm run build`
Expected: No TypeScript compilation errors.

**Step 4: Commit**

```bash
git add supabase/functions/stripe-create-invoice/index.ts
git commit -m "feat(invoice): add email pre-validation and structured errors to create-invoice"
```

---

### Task 2: Update stripe-send-invoice to support resending open/paid invoices

**Files:**
- Modify: `supabase/functions/stripe-send-invoice/index.ts`

**Step 1: Expand the status guard to allow open and paid**

Replace the strict draft-only guard at line 100-103:

```typescript
// Only draft invoices can be sent; guard before any Stripe creation
if (invoice.status !== 'draft') {
  throw new Error("Only draft invoices can be sent");
}
```

with a guard that allows draft, open, and paid:

```typescript
// Only draft, open, and paid invoices can be sent/resent
const allowedStatuses = ['draft', 'open', 'paid'];
if (!allowedStatuses.includes(invoice.status)) {
  throw new Error(`Cannot send invoice with status "${invoice.status}". Only draft, open, or paid invoices can be sent.`);
}
```

**Step 2: Add early-return resend path for open/paid invoices**

Right after the status guard from Step 1, add a fast path for already-sent invoices. This goes BEFORE the `if (!invoice.stripe_invoice_id)` block at line 105:

```typescript
// For open/paid invoices, just resend the email via Stripe
if (invoice.status !== 'draft' && invoice.stripe_invoice_id) {
  console.log("[SEND-INVOICE] Resending invoice email for", invoice.status, "invoice");

  const sentInvoice = await stripe.invoices.sendInvoice(
    invoice.stripe_invoice_id,
    {},
    {
      stripeAccount: connectedAccount.stripe_account_id,
    }
  );

  console.log("[SEND-INVOICE] Invoice email resent:", sentInvoice.id);

  return new Response(
    JSON.stringify({
      success: true,
      status: invoice.status,
      hostedInvoiceUrl: sentInvoice.hosted_invoice_url,
      invoicePdfUrl: sentInvoice.invoice_pdf,
      message: "Invoice email resent successfully",
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    }
  );
}
```

**Step 3: Improve error messages in the catch block**

Replace the catch block (lines 292-303) — currently it returns a generic "Internal server error" message that hides all details. Change to:

```typescript
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("[SEND-INVOICE] Error:", errorMessage);

  return new Response(
    JSON.stringify({ error: errorMessage }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    }
  );
}
```

**Step 4: Verify locally**

Run: `npm run build`
Expected: No TypeScript compilation errors.

**Step 5: Commit**

```bash
git add supabase/functions/stripe-send-invoice/index.ts
git commit -m "feat(invoice): support resending email for open/paid invoices"
```

---

### Task 3: Add email validation banner to InvoiceForm

**Files:**
- Modify: `src/pages/InvoiceForm.tsx`

**Step 1: Add state and derive selected customer**

Add these after the existing `showCustomerForm` state (line 53):

```typescript
const [showEditCustomerForm, setShowEditCustomerForm] = useState(false);
```

Add a derived value to find the selected customer object (after the state declarations, around line 54):

```typescript
const selectedCustomer = customers.find(c => c.id === customerId) || null;
const customerMissingEmail = selectedCustomer && !selectedCustomer.email && isReadyForInvoicing;
```

**Step 2: Add the warning banner below the customer selector**

After the closing `</div>` of the `grid gap-4 md:grid-cols-2` div (after line 253, the closing div of the grid containing customer select and due date), add the warning banner:

```tsx
{customerMissingEmail && (
  <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
    <div className="flex items-center gap-2 text-[13px]">
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
      <span className="text-amber-800 dark:text-amber-200">
        This customer doesn't have an email address. An email is required to send invoices.
      </span>
    </div>
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0 h-8 text-[12px]"
      onClick={() => setShowEditCustomerForm(true)}
    >
      Add Email
    </Button>
  </div>
)}
```

**Step 3: Add AlertTriangle to the imports**

Update the lucide-react import (line 21) to include `AlertTriangle`:

```typescript
import { FileText, Plus, Trash2, ArrowLeft, UserPlus, AlertTriangle } from "lucide-react";
```

**Step 4: Disable the submit button when customer has no email**

Change the submit button (line 396) from:

```tsx
<Button type="submit" disabled={isBusy}>
```

to:

```tsx
<Button type="submit" disabled={isBusy || !!customerMissingEmail}>
```

**Step 5: Add the edit customer dialog**

After the existing `CustomerFormDialog` (line 403-407), add a second dialog instance for editing:

```tsx
{/* Edit Customer Dialog (for adding email) */}
{selectedCustomer && (
  <CustomerFormDialog
    open={showEditCustomerForm}
    onOpenChange={setShowEditCustomerForm}
    customer={selectedCustomer}
  />
)}
```

**Step 6: Add Customer import**

Update the useCustomers import (line 4) to also import the Customer type:

```typescript
import { useCustomers, type Customer } from "@/hooks/useCustomers";
```

Note: We don't actually need the `Customer` type directly since `customers` from `useCustomers` already returns typed objects. But we DO need to invalidate/refetch the customers list after editing. The existing `CustomerFormDialog` already calls `updateCustomer` which invalidates the customers query via React Query — so the `customers` array will automatically refresh, updating `selectedCustomer` and clearing the warning banner.

Actually, remove the `Customer` import — it's not needed since `selectedCustomer` is inferred from the `customers` array.

**Step 7: Verify locally**

Run: `npm run build`
Expected: No TypeScript compilation errors. Warning banner shows below customer selector when selecting a customer without email.

**Step 8: Commit**

```bash
git add src/pages/InvoiceForm.tsx
git commit -m "feat(invoice): add email validation banner when customer lacks email"
```

---

### Task 4: Add resend email + share actions to InvoiceDetail

**Files:**
- Modify: `src/pages/InvoiceDetail.tsx`

**Step 1: Add new imports**

Update the lucide-react import (lines 12-28) to add `Share2`, `Copy`, `MessageSquare`, and `RotateCw`:

Add to the existing import list:
```typescript
Share2, Copy, MessageSquare, RotateCw
```

Add shadcn DropdownMenu imports:

```typescript
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

**Step 2: Add the resend handler**

After the existing `handleSendInvoice` function (after line 122), add:

```typescript
const handleResendInvoice = async () => {
  try {
    await sendInvoiceAsync(invoice.id);
    toast({
      title: "Invoice Email Sent",
      description: `Invoice email resent to ${invoice.customers?.email || 'the customer'}.`,
    });
  } catch (err) {
    console.error('Error resending invoice:', err);
  }
};
```

**Step 3: Add share handlers**

After `handleResendInvoice`, add:

```typescript
const handleCopyLink = async () => {
  if (invoice.hosted_invoice_url) {
    await navigator.clipboard.writeText(invoice.hosted_invoice_url);
    toast({
      title: "Link Copied",
      description: "Invoice link copied to clipboard.",
    });
  }
};

const getShareMessage = () => {
  const restaurantName = selectedRestaurant?.restaurant?.name || 'us';
  const amount = formatCurrency(invoice.total / 100, invoice.currency);
  return `Here's your invoice from ${restaurantName} for ${amount}: ${invoice.hosted_invoice_url}`;
};

const handleShareSMS = () => {
  const message = encodeURIComponent(getShareMessage());
  window.open(`sms:?body=${message}`, '_blank');
};

const handleShareWhatsApp = () => {
  const message = encodeURIComponent(getShareMessage());
  window.open(`https://wa.me/?text=${message}`, '_blank');
};
```

**Step 4: Add resend + share buttons for open/paid invoices**

In the header action area (inside the `<div className="flex gap-2">` at line 178), after the draft-only block (after line 211) and before the sync button block (line 213), add:

```tsx
{(invoice.status === 'open' || invoice.status === 'paid') && invoice.hosted_invoice_url && (
  <>
    <Button
      variant="outline"
      onClick={handleResendInvoice}
      disabled={isSending}
    >
      <RotateCw className={`h-4 w-4 mr-2 ${isSending ? 'animate-spin' : ''}`} />
      {isSending ? 'Sending...' : 'Resend Email'}
    </Button>

    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Share invoice">
          <Share2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCopyLink}>
          <Copy className="h-4 w-4 mr-2" />
          Copy Link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareSMS}>
          <MessageSquare className="h-4 w-4 mr-2" />
          Share via SMS
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShareWhatsApp}>
          <Send className="h-4 w-4 mr-2" />
          Share via WhatsApp
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </>
)}
```

**Step 5: Verify locally**

Run: `npm run build`
Expected: No TypeScript compilation errors. Open/paid invoices show "Resend Email" button + Share dropdown.

**Step 6: Commit**

```bash
git add src/pages/InvoiceDetail.tsx
git commit -m "feat(invoice): add resend email and share actions for open/paid invoices"
```

---

### Task 5: Improve error handling in useInvoices hook

**Files:**
- Modify: `src/hooks/useInvoices.tsx`

**Step 1: Update createInvoice mutation error handler**

The current `onError` handler (lines 231-238) shows `error.message`, but when `supabase.functions.invoke` fails with a non-2xx status, the error is a generic `FunctionsHttpError` and the structured JSON body is lost.

The issue is that `supabase.functions.invoke` returns `{ data, error }` where on non-2xx, `error` is set but `data` may also contain the response body. We need to check `data` for our structured error.

Replace the `mutationFn` of `createInvoiceMutation` (lines 204-218) to capture the response body:

```typescript
mutationFn: async (data: InvoiceFormData) => {
  if (!restaurantId) {
    throw new Error("No restaurant selected");
  }

  const { data: result, error } = await supabase.functions.invoke(
    'stripe-create-invoice',
    {
      body: {
        restaurantId,
        ...data,
      }
    }
  );

  if (error) {
    // Try to extract structured error from response
    const serverError = result?.error || error.message;
    throw new Error(serverError);
  }

  return result;
},
```

Wait — `supabase.functions.invoke` actually throws on non-2xx only if you use `.then()`. With `{ data, error }` destructuring, `error` is populated and `data` is null for non-2xx responses. The response body isn't accessible through this pattern.

Let me check the actual Supabase functions behavior. With `supabase.functions.invoke`, for non-2xx responses:
- `error` is a `FunctionsHttpError` with `.message` = "Edge Function returned a non-2xx status code"
- The actual response body is accessible via `error.context` on newer versions, or we need to use a different approach.

The better approach: use `fetch` directly instead of `supabase.functions.invoke` to get the full response, OR check if the error object has context.

The cleanest fix: switch the edge function to return 200 with an error field in the body (Supabase edge function pattern), OR use raw fetch.

Actually the simplest approach: Change the edge function to **always return 200** but include `success: false` and the error message. This is the cleanest pattern for Supabase functions where the SDK swallows error bodies.

**Revised approach — change the edge function error responses to return 200 with error payload:**

In `stripe-create-invoice/index.ts`, the email validation early return and the catch block should return status 200 (not 400) so the Supabase client passes through the body:

For the email validation return:
```typescript
status: 200,  // Return 200 so supabase client passes the body through
```

For the catch block:
```typescript
status: 200,  // Return 200 so supabase client passes the body through
```

Then in the client, check for `result.error`:

Replace `createInvoiceMutation.mutationFn` (lines 204-218):

```typescript
mutationFn: async (data: InvoiceFormData) => {
  if (!restaurantId) {
    throw new Error("No restaurant selected");
  }

  const { data: result, error } = await supabase.functions.invoke(
    'stripe-create-invoice',
    {
      body: {
        restaurantId,
        ...data,
      }
    }
  );

  if (error) throw error;
  if (result?.error) throw new Error(result.error);

  return result;
},
```

And similarly update `sendInvoiceMutation.mutationFn` (lines 243-248):

```typescript
mutationFn: async (invoiceId: string) => {
  const { data, error } = await supabase.functions.invoke(
    'stripe-send-invoice',
    { body: { invoiceId } }
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return data;
},
```

**Step 2: Update both edge functions to return 200 for errors**

In `stripe-create-invoice/index.ts`:
- The email validation early return: change `status: 400` to `status: 200`
- The catch block: change `status: 400` to `status: 200`

In `stripe-send-invoice/index.ts`:
- The catch block: change `status: 400` to `status: 200`

**Step 3: Verify locally**

Run: `npm run build`
Expected: No TypeScript compilation errors. When invoice creation fails, the toast now shows the actual Stripe error message instead of "Edge Function returned a non-2xx status code".

**Step 4: Commit**

```bash
git add src/hooks/useInvoices.tsx supabase/functions/stripe-create-invoice/index.ts supabase/functions/stripe-send-invoice/index.ts
git commit -m "feat(invoice): structured error messages for invoice creation and sending"
```

---

### Task 6: Final build verification and manual testing

**Step 1: Run full build**

Run: `npm run build`
Expected: Clean build with no new errors.

**Step 2: Manual test checklist**

Test these scenarios in the dev environment:

1. **Email validation banner:**
   - Create a customer without email
   - Start a new invoice, select that customer
   - Verify amber warning banner appears
   - Verify "Create Invoice" button is disabled
   - Click "Add Email", verify CustomerFormDialog opens in edit mode
   - Add email, save — verify banner disappears and button enables

2. **Resend email:**
   - Open an already-sent (status=open) invoice
   - Verify "Resend Email" button appears
   - Click it — verify toast shows success message
   - Check customer's email for the resent invoice

3. **Share actions:**
   - On an open/paid invoice, click the Share dropdown
   - Verify "Copy Link" copies the URL to clipboard
   - Verify "Share via SMS" opens the SMS app with pre-filled message
   - Verify "Share via WhatsApp" opens WhatsApp with pre-filled message

4. **Error messages:**
   - Try to create an invoice with a customer that somehow bypasses client validation
   - Verify the toast shows the specific Stripe error, not "Edge Function returned a non-2xx status code"

**Step 3: Commit all if any fixups needed**

```bash
git add -A
git commit -m "fix(invoice): final adjustments from manual testing"
```
