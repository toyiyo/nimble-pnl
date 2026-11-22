# Invoice payment setup: design

Date: 2026-11-22
Branch: `feature/invoice-payment-setup`
Status: Draft for review. This document is STE-aligned.

## 1. Problem

A user cannot send a paid invoice without help. These are the causes:

1. The Invoices page blocks the page until the user adds a customer
   (`src/pages/Invoices.tsx:101-137`). The invoice form already has an
   inline "new customer" option (`src/pages/InvoiceForm.tsx`, value
   `'__new__'`). The block is not necessary.
2. The setup button calls `createAccount('express')`
   (`src/pages/Invoices.tsx:173`, `src/pages/Customers.tsx:87-101`). The
   mutation `onSuccess` only shows the toast "Account Created" and invalidates
   the query (`src/hooks/useStripeConnect.tsx`). It ignores `onboardingUrl`.
   The user does not know that the onboarding continues on `/stripe-account`.
3. The setup buttons are not the same on each page. Customers shows an Alert.
   Invoices shows a small link. InvoiceDetail shows a disabled "Send Invoice"
   button with no next step (`src/pages/InvoiceDetail.tsx:256-270`).
4. The status in `stripe_connected_accounts` changes only when
   `stripe-create-connected-account` runs
   (`supabase/functions/stripe-create-connected-account/index.ts:115-156`).
   No `account.updated` webhook exists. After Stripe approves the account, the
   app can show "not ready" for a long time.

## 2. Goal

One simple path: **Turn on payments → finish the Stripe form in a side panel →
send the invoice.** Do not break the backend. All current edge functions keep
their request and response shapes.

## 3. Non-goals

- Migration to Stripe Accounts v2 and capability checks. (Flag only. See §9.)
- Upgrade of the Stripe API version. (Flag only.)
- Changes to `/stripe-account`. It stays the management page.
- Changes to invoice creation, send, or the invoice webhook.

## 4. Design: frontend

### 4.1 `PaymentSetupCard` (new, `src/components/invoicing/PaymentSetupCard.tsx`)

One card with three states. A pure function chooses the state:

```ts
// src/lib/paymentSetupState.ts
export type PaymentSetupState = 'not_started' | 'pending' | 'ready';
export function getPaymentSetupState(
  account: { charges_enabled: boolean; onboarding_complete: boolean } | null | undefined,
): PaymentSetupState;
```

- `null` or `undefined` → `not_started`.
- `charges_enabled && onboarding_complete` → `ready`. This is the same rule as
  `isReadyForInvoicing` in `src/hooks/useStripeConnect.tsx`.
- All other rows → `pending`.

| State | Title | Text | Owner action | Other roles |
|---|---|---|---|---|
| `not_started` | Turn on payments | Customers pay invoices by card or bank (ACH). Setup takes about 5 minutes. | **Turn on payments** | "Ask the restaurant owner to turn on payments." |
| `pending` | Finish payment setup | Stripe needs more details, or Stripe is checking them. | **Continue setup**, **Check now** | Same text as owner, no buttons. |
| `ready` | Payments are on | Customers can pay your invoices online. | Link: "Manage" → `/stripe-account` | No link. |

Props:

```ts
interface PaymentSetupCardProps {
  restaurantId: string;
  canManage: boolean;      // true only for the owner role
  variant?: 'full' | 'compact'; // compact = one line, for InvoiceDetail
  hideWhenReady?: boolean; // Customers and InvoiceDetail hide the ready state
}
```

Style: the Apple/Notion card from CLAUDE.md
(`rounded-xl border border-border/40 bg-background`). Semantic tokens only.
The `pending` state uses `bg-muted/30` and a `Clock` icon, not a warning
color. The card has `role="region"` and `aria-labelledby` on the title.

Loading state: a `Skeleton` with the card height. Error state: one line
"Payment status is not available." with a **Retry** button that refetches.

### 4.2 `PaymentSetupSheet` (new, `src/components/invoicing/PaymentSetupSheet.tsx`)

- A right-side `Sheet` (`src/components/ui/sheet.tsx`), `sm:max-w-xl`.
- The header has the title "Set up payments" and a `SheetDescription`:
  "Stripe keeps your bank and tax details. EasyShiftHQ does not see them."
- The body renders
  `<StripeEmbeddedConnect restaurantId={…} component="account_onboarding" onCompleted={…} />`
  (`src/components/StripeEmbeddedConnect.tsx`). That component renders no
  Dialog or Sheet, so no overlays stack.
- The sheet mounts `StripeEmbeddedConnect` only when it is open. This stops an
  account session when the user does not open the sheet.
- `onCompleted` (the Stripe `onExit`) and the sheet close both call
  `checkStatus()` (§4.3) and close the sheet.

### 4.3 `usePaymentSetup` (new hook, `src/hooks/usePaymentSetup.ts`)

The hook wraps `useStripeConnect` and adds one flow:

```ts
export function usePaymentSetup(restaurantId: string | null): {
  state: PaymentSetupState;
  isLoading: boolean;
  error: Error | null;
  isSheetOpen: boolean;
  openSetup: () => Promise<void>;  // creates the account if needed, then opens the sheet
  closeSetup: () => void;          // closes the sheet and calls checkStatus
  checkStatus: () => Promise<void>;
  isChecking: boolean;
  isStarting: boolean;
};
```

- `openSetup`: if `state === 'not_started'`, call
  `stripe-create-connected-account` with `{ restaurantId, accountType: 'express' }`
  and wait for the result. Then open the sheet. The hook ignores
  `onboardingUrl`, because the sheet replaces the hosted link.
- `checkStatus`: calls the same function. For an existing account, that
  function reads the live account from Stripe and updates the row
  (`stripe-create-connected-account/index.ts:115-156`). Then the hook
  invalidates `['stripe-connected-account', restaurantId]`. A second call
  while one runs does nothing.
- Bounded poll: after the sheet closes and the state is `pending`, the hook
  calls `checkStatus` every 30 s, **maximum 6 times** (3 minutes). The poll
  stops when the state is `ready`, when the component unmounts, or when the
  count is at the maximum. The webhook (§5) is the main update path. The poll
  only helps in the first minutes.
- The existing `useStripeConnect` toast "Account Created" stays for the other
  callers. `usePaymentSetup` calls the edge function through a separate
  mutation, so it shows no toast. It shows a toast only on an error.

Unit tests (`tests/unit/paymentSetupState.test.ts`,
`tests/unit/usePaymentSetup.test.ts`): state mapping, `openSetup` order
(create, then open), no create call for an existing account, poll stops at the
maximum, poll stops at `ready`, no parallel `checkStatus`.

### 4.4 Page changes

| Page | Change |
|---|---|
| `src/pages/Invoices.tsx` | Delete the customer block (`:101-137`). Replace the info bar (`:162-179`) with `PaymentSetupCard`. Show the card in all states. Delete the unused `useCustomers` import if no other code uses it. Replace the gradient header classes with the semantic card style. |
| `src/pages/Customers.tsx` | Replace the Alert (`:87-101`) with `PaymentSetupCard hideWhenReady`. Show it also when the list is empty. |
| `src/pages/InvoiceDetail.tsx` | When not ready, the "Send Invoice" button (`:256-270`) is enabled and opens the setup sheet for the owner. For other roles it stays disabled with a tooltip "Ask the restaurant owner to turn on payments." Replace the "Payment Processing" box (`:563-580`) with `PaymentSetupCard variant="compact" hideWhenReady`. |
| `src/pages/InvoiceForm.tsx` | No change to logic. Under the submit button, when not ready, show the text "This saves a draft. Turn on payments to send it." |

The `?success` and `?refresh` handlers in `Invoices.tsx:32-57` stay. The
hosted link from `/stripe-account` can still return to these URLs.

### 4.5 Role check in the client

`canManage` comes from the role in `useRestaurantContext()`
(`selectedRestaurant.role === 'owner'`). This is only for the UI. The server
already refuses other roles
(`stripe-create-connected-account/index.ts:84-98`,
`stripe-create-account-session/index.ts:53`).

## 5. Design: backend

### 5.1 New edge function `stripe-connect-webhook`

Files:

- `supabase/functions/stripe-connect-webhook/index.ts` (thin: env, Stripe
  client, service-role client, call the handler).
- `supabase/functions/_shared/stripeConnectWebhookHandler.ts` (logic, no Deno
  globals, so Vitest can import it).
- `supabase/functions/_shared/stripeAccountStatus.ts` (the `deriveStatuses`
  logic, moved from `stripe-create-connected-account/index.ts:35-47`. Both
  functions import it. The logic does not change.)
- `supabase/config.toml`: `[functions.stripe-connect-webhook] verify_jwt = false`.

Pattern: the same as `stripe-invoice-webhook/index.ts`.

Flow:

1. If `STRIPE_CONNECT_WEBHOOK_SECRET` is empty → 500 "Webhook not configured".
   No processing.
2. If the `stripe-signature` header is missing → 400.
3. `stripe.webhooks.constructEventAsync(rawBody, signature, secret)`. On
   failure → 400 "Invalid signature". The body is read with `req.text()`
   before any parse.
4. If `event.type !== 'account.updated'` → 200 `{ received: true, ignored: true }`.
5. `accountId = event.account ?? event.data.object.id`. If they are both
   present and not equal → 400. (Source binding: a Connect event names the
   connected account in `event.account`.)
6. Find the row: `select id, restaurant_id from stripe_connected_accounts where
   stripe_account_id = accountId`. No row → 200 `{ received: true, unknown: true }`.
   Stripe does not retry, and the log has the account id only.
7. **Do not trust the payload for state.** Call
   `stripe.accounts.retrieve(accountId)` with the platform key and derive the
   statuses from the live object. This fixes events that arrive out of order
   and duplicate deliveries: each update writes the current live state, so the
   update is idempotent.
8. `update stripe_connected_accounts set charges_enabled, payouts_enabled,
   details_submitted, onboarding_complete, updated_at = now() where
   stripe_account_id = accountId`. The update never changes
   `restaurant_id`, `stripe_account_id`, or `account_type`.
9. Return 200. On a Stripe or DB error → 500 with the body
   `{ error: "Webhook processing failed" }`. The log has the detail. Stripe
   retries a 500.

Unit tests (`tests/unit/stripeConnectWebhookHandler.test.ts`): missing secret,
missing signature, bad signature, ignored type, account mismatch, unknown
account, live re-fetch used (payload says `charges_enabled: false`, live says
`true` → row gets `true`), DB error → 500, no raw error text in the response.

Deploy steps (the user does these; I cannot do them):

1. In Stripe Dashboard → Developers → Webhooks, add an endpoint with
   "Listen to events on Connected accounts". URL:
   `https://<project>.supabase.co/functions/v1/stripe-connect-webhook`.
   Event: `account.updated`.
2. Set the secret: `supabase secrets set STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…`.
3. Deploy the function.

Until step 2 is done, the function returns 500 and changes nothing. The
"Check now" button and the poll still work without the webhook.

### 5.2 Security fixes in existing functions (no change to the success shape)

| ID | File | Change |
|---|---|---|
| S2 | `stripe-create-account-session/index.ts:75-84` | Stop the spread of `components` from the request body. Use a server allowlist: `account_onboarding`, `account_management`, `notification_banner`, `payments`, `payouts`, `documents`. No client sends `components` today (`src/hooks/useStripeEmbeddedConnect.ts:28-31` sends only `{ restaurantId }`), so no caller breaks. |
| S3 | `stripe-create-connected-account/index.ts:257-267`, `stripe-create-account-session/index.ts:98-104` | Return a fixed message to the client. Keep the detail in `console.error`. A non-owner gets 403, not 500. The client reads `error.message` from `supabase.functions.invoke`, so it still gets a message. |
| S4 | `stripe-create-connected-account/index.ts:232-241` | Build the account-link return URLs from `resolveAppOrigin(req.headers, parseAllowedOrigins(Deno.env.get('OAUTH_ALLOWED_ORIGINS')))` (`_shared/oauthState.ts:151-192`). The raw `origin` header no longer goes into a redirect. |
| S5 | `stripe-create-connected-account/index.ts:224-228` | If the insert fails, log the Stripe account id with the error and return 500. If the error is a unique violation on `restaurant_id` (a second click), read the row that exists and continue with that account. |

### 5.3 New migration: owner write path on `stripe_connected_accounts` (S1)

`supabase/migrations/<timestamp>_stripe_connected_accounts_select_only.sql`:

- `DROP POLICY IF EXISTS "Owners can manage connected accounts" ON public.stripe_connected_accounts;`
  (created in `20251221000001_create_invoicing_tables.sql:224-232`).
- Keep the SELECT policy for members (`:215-222`) and the deny-anon policy
  (`20260110000000_fix_rls_anonymous_access.sql:197`).
- No grant change for `service_role`. All writes come from edge functions with
  the service role, which bypasses RLS.

pgTAP test `supabase/tests/stripe_connected_accounts_rls.sql`:

- An owner can SELECT the row for the owner's restaurant.
- An owner UPDATE of `charges_enabled` changes 0 rows.
- An owner INSERT throws an RLS error.
- A member of a different restaurant sees 0 rows.

Before the merge, I check in production (read-only SELECT) that no client code
and no other function writes this table with a user token:
`grep -rn "stripe_connected_accounts" src` shows reads only.

## 6. Security review (plan), security-audit skill, guidance mode

Method: the Cloudflare `security-audit` skill in guidance mode. I read
`SKILL.md`, `WEB-PROTOCOL-AND-AUTH.md`, and `PROTOCOLS-RPC-AND-MESSAGING.md`.
I made no live probes. Each item names the principal, the resource, and the
result.

| ID | Severity | Principal → resource | Result | Fix |
|---|---|---|---|---|
| S1 | High | A restaurant owner (authenticated) → `stripe_connected_accounts` row of the owner's restaurant | The `FOR ALL` policy lets the owner set `charges_enabled = true` or change `stripe_account_id` from the browser. The UI then shows "ready" for an account that Stripe did not approve. `stripe-create-invoice` reads `charges_enabled` from this row (`:85-93`), so the server gate is also false. A different `stripe_account_id` could point invoices at a different Connect account. | §5.3 |
| S2 | Medium | An owner → Stripe account session | The client can turn on components that the product does not offer (body spread at `:84`). | §5.2 S2 |
| S3 | Low | Any caller → error text | Raw Stripe or DB messages go back in the 500 body. | §5.2 S3 |
| S4 | Low | An attacker who controls a page that an owner visits → account-link return URL | The return URL uses the request `Origin` header. Browsers set `Origin`, so the risk is low, but a raw header must not choose a redirect (`WEB-PROTOCOL-AND-AUTH.md`, "Host, Forwarded, … Origin … are trust decisions"). | §5.2 S4 |
| S5 | Low | Platform → Stripe accounts | An insert error leaves a Stripe account with no row. A second click can create a second Stripe account. | §5.2 S5 |
| W1 | Design | Internet → `stripe-connect-webhook` | The endpoint is public (`verify_jwt = false`). The signature check is the only gate. | Fail closed when the secret is empty. Verify with the raw body. Own secret, not shared with the invoice webhook. |
| W2 | Design | Stripe redelivery → row state | Events can arrive twice or out of order (`PROTOCOLS-RPC-AND-MESSAGING.md`, "Duplicate delivery", "Older state … overwrites"). | Re-fetch the live account. Do not use the payload state. |
| W3 | Design | A signed event for account A → row for account B | Source binding. | Match on `event.account`. Reject a mismatch with `data.object.id`. The update changes only status columns. |
| W4 | Design | Public webhook → service-role client | The handler has the service role. | The handler runs one parameterized update by `stripe_account_id`. It reads no other table. It returns no row data. |

Out of scope, flag only:

- F1. Stripe recommends Accounts v2 and capability checks (`card_payments`,
  `transfers` active), not only `charges_enabled`.
- F2. The API versions differ: `2025-08-27.basil` and `2024-12-18.acacia`.
  The latest is `2026-09-30.endive`.
- F3. Stripe recommends a restricted key (`rk_`) for the platform key.

## 7. Tests

- Vitest: `paymentSetupState`, `usePaymentSetup`, `stripeConnectWebhookHandler`,
  `stripeAccountStatus` (moved logic, same cases).
- pgTAP: `stripe_connected_accounts_rls.sql`.
- Manual check in the browser (Phase 7): Invoices with 0 customers shows the
  list and the card. The button opens the sheet. Close calls the check.
  InvoiceDetail Send on a draft opens the sheet.

## 8. Risks

- R1. Dropping the owner policy breaks a client write that I did not find.
  Mitigation: the grep in §5.3, and the pgTAP test.
- R2. `useStripeEmbeddedConnect` puts `options` in the `useCallback` deps
  (`src/hooks/useStripeEmbeddedConnect.ts:70`), and the default is a new `{}`
  each render. If `StripeEmbeddedConnect` starts in an effect on `start`, the
  session can start again on each render. I check this in the build and fix it
  with a stable default if necessary.
- R3. The webhook needs a dashboard step. Until then, the poll and "Check now"
  keep the old behavior.

## 9. Files

New:
`src/lib/paymentSetupState.ts`, `src/hooks/usePaymentSetup.ts`,
`src/components/invoicing/PaymentSetupCard.tsx`,
`src/components/invoicing/PaymentSetupSheet.tsx`,
`supabase/functions/stripe-connect-webhook/index.ts`,
`supabase/functions/_shared/stripeConnectWebhookHandler.ts`,
`supabase/functions/_shared/stripeAccountStatus.ts`,
`supabase/migrations/<ts>_stripe_connected_accounts_select_only.sql`,
`supabase/tests/stripe_connected_accounts_rls.sql`, unit tests in §7.

Changed:
`src/pages/Invoices.tsx`, `src/pages/Customers.tsx`,
`src/pages/InvoiceDetail.tsx`, `src/pages/InvoiceForm.tsx`,
`supabase/functions/stripe-create-connected-account/index.ts`,
`supabase/functions/stripe-create-account-session/index.ts`,
`supabase/config.toml`.
