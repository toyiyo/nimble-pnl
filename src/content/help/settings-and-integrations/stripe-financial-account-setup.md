---
title: "Set Up Stripe for Payments and Payouts"
category: "settings-and-integrations"
summary: "Connect your restaurant to Stripe so you can accept customer payments, receive payouts to your bank account, and manage tax registrations — all without leaving EasyShiftHQ."
audience: ["owner"]
order: 140
keywords: ["Stripe", "payments", "payouts", "payment processing", "tax registration", "Stripe Express", "refunds"]
related: ["business-information-settings", "banking-connect-and-transactions", "invoices-and-customers", "subscription-plans"]
---

# Set Up Stripe for Payments and Payouts

EasyShiftHQ uses Stripe to handle payment processing, bank payouts, and tax compliance for your restaurant. Once connected, you can review transactions, issue refunds, check your balance, and manage tax settings without ever leaving the app.

## Before you begin

- **Owner role required.** Only the restaurant owner can access the Stripe Account Management page. Managers and other staff roles are redirected away automatically.
- Have your business information (legal name, address, tax ID) and bank account details ready — Stripe will ask for these during onboarding.

## Create your Stripe account

If your restaurant has not connected to Stripe yet, you will see the **Stripe Account Management** screen with a setup prompt.

1. In the left navigation, go to **Stripe Account Management** (or navigate directly to `/stripe-account`).
2. Click **Set up Payment Processing**. The button label changes to **Setting up...** while EasyShiftHQ creates your Stripe Express account.
3. Once the account is created, the page title changes to **Financial Account Management** and an embedded Stripe onboarding form appears under a **Complete Account Setup** notice.
4. Fill in all the required information in the Stripe form — business details, banking information, and identity verification as prompted by Stripe.
5. When you finish, Stripe validates your submission. This can take a couple of minutes.
6. Click **Refresh status** to check whether Stripe has finished validating your details without leaving the page. This button appears once the onboarding form is shown.
7. When setup is complete, a **Connected** badge appears in the top-right corner and the full tab navigation becomes available.

> **Note:** If you close the page before finishing onboarding, you can return to `/stripe-account` and the onboarding form will still be waiting. Use **Refresh status** after re-submitting to confirm your details were accepted.

## Manage your account settings

Once the **Connected** badge appears, the page shows five tabs: **Account Setup**, **Payments**, **Payouts**, **Account Details**, and **Tax & Compliance**. The **Account Setup** tab is selected by default.

1. Go to `/stripe-account`.
2. Click the **Account Setup** tab.
3. Use the embedded Stripe panel to update your banking details (the account where payouts are sent), your payout schedule, and any compliance information Stripe requires.

## View payments and issue refunds

1. Go to `/stripe-account`.
2. Click the **Payments** tab.
3. The embedded Stripe panel shows your full transaction history. Use it to find individual payments and issue refunds directly from this view.

## Review payouts and check your balance

1. Go to `/stripe-account`.
2. Click the **Payouts** tab.
3. The left panel (**Payouts**) shows your payout history and payout schedule.
4. The right panel (**Balance**) shows your current balance and available funds.

## View account details

1. Go to `/stripe-account`.
2. Click the **Account Details** tab.
3. Use the embedded Stripe panel to view and manage your account information.

## Manage tax registrations and settings

1. Go to `/stripe-account`.
2. Click the **Tax & Compliance** tab.
3. The left panel (**Tax Registrations**) lets you add, view, and manage your tax registrations and compliance documents.
4. The right panel (**Tax Settings**) lets you configure how tax is collected and reported.

## Tips

- **Stay on the page while onboarding.** The Stripe form is embedded directly in EasyShiftHQ — you do not need to open a separate browser tab.
- **Use Refresh status freely.** Clicking it only re-checks your account status; it does not restart or reset your Stripe setup.
- **The Connected badge is your signal.** All five tabs (Account Setup, Payments, Payouts, Account Details, and Tax & Compliance) become available only after the badge appears. If you still see the onboarding form, Stripe has not yet validated your information.
- **Banking changes take effect at your next payout.** If you update your bank account details in Account Setup, the change applies to the next scheduled payout, not immediately.

## Troubleshooting

**I clicked "Set up Payment Processing" but nothing happened.**
The button disables itself and shows "Setting up..." while the account is being created. Wait a few seconds and the onboarding form should appear. If the page stays blank, refresh the browser and try again.

**The page says "Loading payment interface..." and never finishes.**
This usually means a temporary connection issue with Stripe. Refresh the browser tab. If the problem continues, check your internet connection and try again in a few minutes. A **Retry** button also appears on the page — click it to attempt reconnecting without a full page refresh.

**I completed onboarding but the Connected badge has not appeared.**
Stripe can take a couple of minutes to validate your details. Click **Refresh status** to check again. If the badge still does not appear after five minutes, make sure all required fields in the Stripe form were completed — Stripe sometimes flags missing or mismatched information.

**I see "Complete Account Setup" after returning to the page.**
This means your account was created but onboarding was not fully completed. Finish filling in the Stripe form and click **Refresh status** when done.

**The tabs are missing or I only see an onboarding form.**
The five tabs are only available once your account shows the **Connected** badge. Complete the onboarding steps and click **Refresh status** to confirm Stripe has validated your details.

## Frequently asked questions

**Is my banking information secure?**
Yes. EasyShiftHQ never stores your bank account credentials. All sensitive financial information is handled directly by Stripe, which is a PCI-compliant payment platform. EasyShiftHQ only stores a reference to your Stripe account.

**Can my manager set up Stripe?**
No. The Stripe Account Management page is restricted to the restaurant owner. Managers and other staff are redirected to the home screen if they try to access it.

**How long does Stripe take to send payouts to my bank?**
Payout timing depends on the schedule you configure in the **Account Setup** tab and Stripe's standard processing times. You can review your payout history and upcoming payouts in the **Payouts** tab.

**Can I connect multiple bank accounts?**
Stripe Express supports one primary bank account for payouts. You can update which bank account receives payouts at any time from the **Account Setup** tab.

**What happens if Stripe rejects my information during onboarding?**
Stripe will prompt you to correct any issues directly in the embedded onboarding form. Fix the flagged fields, resubmit, and then click **Refresh status** to confirm the update was accepted.

## Related articles

- [Business Information Settings](/help/business-information-settings)
- [Banking: Connect and Transactions](/help/banking-connect-and-transactions)
- [Invoices and Customers](/help/invoices-and-customers)
- [Subscription Plans](/help/subscription-plans)
