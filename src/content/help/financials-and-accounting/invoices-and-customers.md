---
title: "Create and Send Invoices to Customers"
category: "financials-and-accounting"
summary: "Build a customer directory, create invoices with line items, set up Stripe payment processing for card or ACH payments, and track invoice status."
audience: ["owner", "manager"]
order: 50
keywords: ["invoice", "customer", "Stripe", "payment", "ACH", "draft", "send", "billing"]
related: ["expenses-and-print-checks", "banking-connect-and-transactions", "financial-statements"]
---

# Create and Send Invoices to Customers

This article covers everything owners and managers need to bill customers from EasyShiftHQ: building a customer directory, creating invoices with line items, setting up Stripe to collect card or ACH payments, and tracking invoice status from draft through paid.

## Before you begin

- You must have an **Owner** or **Manager** role to access Customers and Invoices.
- You need at least one customer in your directory before you can create an invoice. The app will prompt you to add customers first if none exist.
- To send invoices and collect payments, payment processing must be set up through Stripe (see the section below). You can create and save draft invoices without it.

## Manage your customer directory

Your customer directory lives at **Customers** in the navigation. Each customer card shows the name, email, phone, and city/state you have on file.

### Add a customer

1. Go to **Customers**.
2. Click **Add Customer** in the top-right corner.
3. In the form that opens, enter the customer's **Name** (required), **Email**, and **Phone**.
4. Optionally fill in the billing address fields: **Address Line 1**, **Address Line 2**, **City**, **State**, **ZIP Code**.
5. Add any **Notes** you want to keep internally (not visible to the customer on invoices).
6. Click **Create** to save.

### Search for a customer

Use the search box on the Customers page to find a customer by name, email address, or phone number. Results update as you type.

### Edit a customer

On any customer card, click the **edit icon** (pencil). The same form opens with the existing information pre-filled. Make your changes and click **Update**.

### Delete a customer

On any customer card, click the **delete icon** (trash can). A confirmation dialog asks "Are you sure you want to delete this customer? This action cannot be undone." Click **Delete** to confirm or **Cancel** to go back.

## Set up payment processing

To send invoices and collect card or bank (ACH) payments, you need to connect a Stripe account.

**From the Customers page:** If you have customers but payment processing is not yet configured, a banner appears at the top of the customer list: "Enable Invoice Payments." Click **Set up Payment Processing** to begin Stripe Express onboarding.

**From the Invoices page:** A smaller info bar reads "Invoices can be created as drafts. Set up payment processing to send invoices and collect payments." Click **Set up** on that bar.

**From an invoice detail page:** If you open a draft invoice before payment processing is configured, the sidebar shows a "Payment Processing" panel with a **Set up payment processing** button.

Once you complete Stripe's onboarding flow, you are returned to the Invoices page with a confirmation message: "Payment Setup Complete — Your payment processing account has been successfully configured. You can now create and send invoices."

If you leave Stripe's onboarding before finishing, you are returned with a message: "Setup Incomplete — Please complete your payment processing onboarding to start creating invoices."

## Create an invoice

You can start a new invoice two ways:

- **From the Invoices page** (`/invoices`): Click **Create Invoice**.
- **From a customer card**: Click the **Invoice** button on the customer's card. This opens the invoice form with that customer already selected.

### Fill in the invoice form

1. Under **Invoice Details**, choose a customer from the **Customer** dropdown. If the customer does not exist yet, select **New Customer** from the top of the list to open the customer form inline without leaving the page.
2. Optionally set a **Due Date**.
3. Optionally enter a **Description** — a brief summary visible on the invoice.
4. Under **Line Items**, each row has a **Description**, **Qty** (quantity), and **Price** field. The line total is calculated automatically.
5. Click **Add Item** to add more line items. Click the trash icon on any row to remove it (available when there are two or more rows).
6. The running **Total** is shown at the bottom of the Line Items section.
7. Under **Additional Details (Optional)**:
   - **Footer**: text printed at the bottom of the invoice (terms, payment instructions, or notes for the customer).
   - **Internal Memo**: notes for your own records, not visible to the customer.
   - **Processing Fee** toggle: when turned on, the Stripe processing fee is added as a separate line item on the invoice and paid by the customer instead of being absorbed by you.
8. When you are ready, click the submit button:
   - If payment processing is configured: the button reads **Create Invoice**. The invoice is created in Stripe and you are taken to the invoice detail page.
   - If payment processing is not yet configured: the button reads **Save Draft**. The invoice is saved locally as a draft.

> If the selected customer has no email address and payment processing is configured, a warning appears: "This customer doesn't have an email address. An email is required to send invoices." Click **Add Email** to update the customer before continuing.

## View and manage invoices

Go to **Invoices** (`/invoices`) to see all your invoices listed in order from most recent to oldest.

### Filter by status

Use the status buttons — **All**, **Draft**, **Open**, **Paid** — to narrow the list. The active filter is highlighted.

Invoice statuses you may see:

| Status | Meaning |
|---|---|
| Draft | Created and saved, not yet sent |
| Open (shown as "Sent" on the detail page) | Sent to the customer, awaiting payment |
| Paid | Payment received in full |
| Void | Cancelled invoice |
| Uncollectible | Marked as unable to collect |

### Search invoices

Type in the search box to filter by invoice number, customer name, or email address.

### Open an invoice

Click any row in the invoice list to open the invoice detail page.

### Actions on the invoice detail page

The buttons available depend on the invoice status:

**Draft invoices:**
- **Preview** — shows a formatted preview of how the invoice will look.
- **Edit** — reopens the invoice form so you can change line items, due date, or other details. Editing is only available for drafts.
- **Send Invoice** (or **Create & Send Invoice** if not yet in Stripe) — sends the invoice to the customer by email and changes the status to Open. Only available when payment processing is configured.

**Open and Paid invoices (when a hosted Stripe link is available):**
- **Resend Email** — sends the invoice email again.
- Share button (arrow icon) — opens a menu with **Copy Link**, **Share via SMS**, and **Share via WhatsApp** options to share the Stripe-hosted invoice link.

**Any invoice sent through Stripe (has a hosted link):**
- **View Invoice** — opens the Stripe-hosted invoice page in a new tab.
- **Download PDF** — downloads the invoice as a PDF (available when the PDF has been generated by Stripe).

A refresh icon (circular arrows) appears for any invoice that has a Stripe ID and lets you manually pull the latest payment status from Stripe.

## Tips

- Add the customer's email address before sending an invoice. Without it, the invoice cannot be sent.
- Use the **Footer** field for payment terms or thank-you notes that appear on the customer-facing invoice. Use **Internal Memo** for notes only your team needs to see.
- The **Processing Fee** toggle lets you decide per invoice whether Stripe's card and ACH fees are passed to the customer or absorbed by your restaurant.
- You can create as many drafts as you need before setting up Stripe. Once payment processing is configured, you can send any existing draft.

## Troubleshooting

**The Invoices page shows "Get Started with Invoicing" and an "Add Customers" button instead of my invoices.**
You have no customers in your directory yet. Go to Customers and add at least one customer before returning to create an invoice.

**The Send Invoice button is greyed out on a draft invoice.**
Payment processing has not been set up. Look for the "Set up payment processing" button in the sidebar of the invoice detail page and complete Stripe onboarding.

**I selected a customer but see a warning about a missing email address.**
The customer record has no email address, which is required to send invoices via Stripe. Click **Add Email** in the warning banner to update the customer record before sending.

**The invoice status still shows Open after the customer paid.**
Click the circular-arrows refresh icon on the invoice detail page to pull the latest status from Stripe. Open invoices also sync automatically when you visit the detail page.

**I returned from Stripe setup and saw a "Setup Incomplete" message.**
You left Stripe's onboarding before finishing all required steps. Click **Set up** on the info bar on the Invoices page (or **Set up Payment Processing** on the Customers page) to resume where you left off.

**I can't edit an invoice.**
Only Draft invoices can be edited. Once an invoice has been sent (status Open) or paid, editing is not available. You would need to void the invoice in Stripe and create a new one.

## Frequently asked questions

**What payment methods can my customers use?**
Customers can pay by credit card or US bank account (ACH), depending on how your Stripe account is configured during onboarding.

**Is a customer's email address required to add them to the directory?**
No. Email is optional when creating or editing a customer. However, an email address is required to send an invoice — Stripe uses it to deliver the invoice to your customer.

**Can I create an invoice if I haven't set up Stripe yet?**
Yes. Without Stripe configured, the submit button reads "Save Draft" and the invoice is saved locally in Draft status. You can view, edit, and preview the draft at any time. Once Stripe is set up, you can send the draft from the invoice detail page.

**Can I delete an invoice?**
Only Draft invoices can be deleted. Once an invoice is sent or paid, deletion is not available from within EasyShiftHQ.

**How do I know when a customer has paid?**
The invoice status changes from Open to Paid automatically when Stripe confirms the payment. EasyShiftHQ syncs the status when you open the invoice detail page. You can also click the refresh icon to check manually.

## Related articles

- [Track Expenses, Upload Invoices, and Print Checks](/help/expenses-and-print-checks)
- [Connect Your Bank and Manage Transactions](/help/banking-connect-and-transactions)
- [View and Export Financial Statements](/help/financial-statements)
- [Roles and What Each One Can Access](/help/roles-and-permissions)
