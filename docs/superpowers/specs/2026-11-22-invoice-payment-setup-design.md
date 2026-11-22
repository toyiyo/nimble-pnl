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

Props (the card is presentational; it owns no hook and no sheet):

```ts
interface PaymentSetupCardProps {
  setup: ReturnType<typeof usePaymentSetup>; // from the page, one instance per page
  canManage: boolean;      // true only for the owner role
  hideWhenReady?: boolean; // Customers and InvoiceDetail hide the ready state
}
```

Style: the Apple/Notion card from CLAUDE.md
(`rounded-xl border border-border/40 bg-background`). Semantic tokens only.
Title `text-[17px] font-semibold`, body `text-[13px] text-muted-foreground`,
primary button `h-9 px-4 rounded-lg bg-foreground text-background`.
The `pending` state uses `bg-muted/30` and a `Clock` icon (`aria-hidden`), not
a warning color. The card has `role="region"` and `aria-labelledby` on the
title. The status text has `aria-live="polite"`. The primary button is
disabled with `aria-busy="true"` and a spinner while `isStarting`.

Loading state: a `Skeleton` with the card height. Error state: one line
"Payment status is not available." with a **Retry** button that refetches.
When `restaurantId` is `null`, the card shows nothing.

No `variant` prop. InvoiceDetail uses the same card.

Note: `src/components/StripeEmbeddedOnboarding.tsx` also exists. It uses
`bg-white` and a manual start button. The design does not use it.

### 4.2 `PaymentSetupSheet` (new, `src/components/invoicing/PaymentSetupSheet.tsx`)

- A right-side `Sheet` (`src/components/ui/sheet.tsx`). `SheetContent` gets
  `className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh]"`. The default
  `w-3/4` (`sheet.tsx:38-40`) is too narrow for the Stripe form at 375 px.
  The header is fixed. The body is `flex-1 overflow-y-auto px-6 py-5`.
- `SheetContent` gets `onInteractOutside={(e) => e.preventDefault()}`. Stripe
  popups (bank link, document upload) attach to `document.body`, outside the
  sheet. A click in them must not close the sheet. The close button and Esc
  still close it.
- The title uses `text-[17px] font-semibold` (the default is `text-lg`,
  `sheet.tsx:88`).
- The header has the title "Set up payments" and a `SheetDescription`:
  "Stripe keeps your bank and tax details. EasyShiftHQ does not see them."
- The body renders
  `<StripeEmbeddedConnect restaurantId={…} component="account_onboarding" onCompleted={…} />`
  (`src/components/StripeEmbeddedConnect.tsx`). That component renders no
  Dialog or Sheet, so no overlays stack.
- The sheet mounts `StripeEmbeddedConnect` only when it is open. This stops an
  account session when the user does not open the sheet.
- `onCompleted` (the Stripe `onExit`) and the sheet close both call
  `closeSetup()` (§4.3). `onExit` also fires when the user leaves the form
  before the end, so it shows no success toast. After the check, the hook
  shows "Payments are on" when the state is `ready`, and "Stripe is still
  checking your details" when the state is `pending`.
- The page renders one `PaymentSetupSheet`, with props from the one
  `usePaymentSetup` instance of the page.
- Fix in `src/hooks/useStripeEmbeddedConnect.ts:70`: read `options.onReady`
  through a ref and delete `options` from the `useCallback` deps. No caller
  passes `options`. This stops a new `start` on each render.

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

- Each page calls `usePaymentSetup` **one time**. The page passes the result
  to `PaymentSetupCard` and to the one `PaymentSetupSheet`. This follows the
  single dialog rule in CLAUDE.md.
- `openSetup`: if `state === 'not_started'`, call
  `stripe-create-connected-account` with `{ restaurantId, accountType: 'express' }`
  and wait for the result. Then open the sheet. The hook ignores
  `onboardingUrl`, because the sheet replaces the hosted link. A second call
  while `isStarting` is true does nothing. On an error, the hook shows a
  toast and does not open the sheet.
- `checkStatus`: calls the same function with the new optional flag
  `{ restaurantId, statusOnly: true }` (§5.2 S6). For an existing account, that
  function reads the live account from Stripe and updates the row
  (`stripe-create-connected-account/index.ts:115-156`), then returns with no
  account link. Then the hook invalidates
  `['stripe-connected-account', restaurantId]`. A second call while one runs
  does nothing.
- No timed poll. The status updates come from the webhook (§5), the check on
  sheet close, and the **Check now** button.
- The existing `useStripeConnect` toast "Account Created" stays for the other
  callers. `usePaymentSetup` calls the edge function through a separate
  mutation, so it shows no toast. It shows a toast only on an error.

Unit tests (`tests/unit/paymentSetupState.test.ts`,
`tests/unit/usePaymentSetup.test.ts`): state mapping, `openSetup` order
(create, then open), no create call for an existing account, no second
`openSetup` while `isStarting`, no sheet open on a create error, no parallel
`checkStatus`, `checkStatus` sends `statusOnly: true`, close calls
`checkStatus`.

### 4.4 Page changes

| Page | Change |
|---|---|
| `src/pages/Invoices.tsx` | Delete the customer block (`:101-137`). Replace the info bar (`:162-179`) with `PaymentSetupCard`. Show the card in all states. Delete the `useCustomers` import (used only at `:24` and `:101`). Do not change the header style (out of scope). |
| `src/pages/Customers.tsx` | Replace the Alert (`:87-104`) with `PaymentSetupCard hideWhenReady`. Show it also when the list is empty. |
| `src/pages/InvoiceDetail.tsx` | When not ready, for the owner, the Send button (`:256-270`) is enabled, has the label "Turn on payments to send", and calls `openSetup`. For other roles the button stays disabled, and the visible text "Ask the restaurant owner to turn on payments." shows next to it (no tooltip; a disabled button gets no pointer events). The text has an `id`, and the button has `aria-describedby` with that id. Replace the "Payment Processing" box (`:563-580`) with `PaymentSetupCard hideWhenReady`. |
| `src/pages/InvoiceForm.tsx` | No change. (Optional helper text is out of scope.) |

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
5. `accountId = event.account`. If it is missing → 200 `{ received: true, ignored: true }`
   with a log (a Connect endpoint always sets it). If `event.data.object.id`
   is not equal to `accountId` → 200 `{ received: true, ignored: true }` with
   a log. A retry cannot make a mismatch valid, so no 4xx. (Source binding.)
6. Find the row: `select id from stripe_connected_accounts where
   stripe_account_id = accountId`. No row → 200 `{ received: true, unknown: true }`.
   The log has the account id only. An event can arrive before the insert in
   `stripe-create-connected-account`. That insert already stores the status at
   creation, and "Check now" and the sheet close cover the gap.
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

The Stripe client uses apiVersion `2025-08-27.basil`, the same as
`stripe-invoice-webhook/index.ts:14`. Do not add a third version.

Unit tests (`tests/unit/stripeConnectWebhookHandler.test.ts`): missing secret,
missing signature, bad signature, ignored type, missing `event.account`,
account mismatch, unknown
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
| S2 | `stripe-create-account-session/index.ts:75-84` | Delete the `...components` spread from the request body. Keep the server default object as it is (all 7 keys: `account_onboarding`, `account_management`, `payouts`, `payments`, `balances`, `tax_registrations`, `tax_settings`). `src/pages/StripeAccountManagement.tsx:230,272,290` uses `balances`, `tax_registrations`, `tax_settings`. No client sends `components` in the body (`src/hooks/useStripeEmbeddedConnect.ts:28-31`). |
| S3 | `stripe-create-connected-account/index.ts:257-267`, `stripe-create-account-session/index.ts:98-104` | Add a small typed error (`class HttpError { status; publicMessage }`). Auth failure → 401, non-owner → 403, other → 500 "Request failed". Return only `publicMessage`. Keep the detail in `console.error`. The status does not come from message text. |
| S4 | `stripe-create-connected-account/index.ts:232-241` | Build the account-link return URLs from `resolveAppOrigin(req.headers, parseAllowedOrigins(Deno.env.get('OAUTH_ALLOWED_ORIGINS')))` (`_shared/oauthState.ts:151-192`). The raw `origin` header no longer goes into a redirect. Local and preview hosts must be in `OAUTH_ALLOWED_ORIGINS`; other hosts return to production. The new sheet does not use this link. |
| S5 | `stripe-create-connected-account/index.ts:206,224-228` | Pass `{ idempotencyKey: 'connect-acct-' + restaurantId }` to `stripe.accounts.create`. Two parallel calls then get the same Stripe account. If the insert fails with a unique violation on `restaurant_id`, read the row that exists and continue. If it fails for another reason, log the Stripe account id with the error and return 500. Stripe keeps an idempotency key for 24 h; after that, the existing-row path at `:115` covers a new call. |
| S6 | `stripe-create-connected-account/index.ts:115-156` | Add an optional body flag `statusOnly`. When it is `true` and a row exists, the function updates the statuses and returns `{ success: true, accountId, onboardingComplete }` with no account link. Old callers do not send the flag and get the same response as today. When no row exists, `statusOnly` returns `{ success: true, accountId: null, onboardingComplete: false }` and creates nothing. |

### 5.3 New migration: owner write path on `stripe_connected_accounts` (S1)

`supabase/migrations/<timestamp>_stripe_connected_accounts_select_only.sql`:

- `DROP POLICY IF EXISTS "Owners can manage connected accounts" ON public.stripe_connected_accounts;`
  (created in `20251221000001_create_invoicing_tables.sql:224-232`).
- Keep the SELECT policy for members (`:215-222`) and the deny-anon policy
  (`20260110000000_fix_rls_anonymous_access.sql:197`).
- `REVOKE INSERT, UPDATE, DELETE ON public.stripe_connected_accounts FROM authenticated;`
  (the grant is at `20251221000001_create_invoicing_tables.sql:384`). A policy
  added later by mistake then cannot open the write path again.
- No grant change for `service_role`. All writes come from edge functions with
  the service role, which bypasses RLS.

Evidence that no other writer exists (reviewer check): the only `src/` runtime
reference is the SELECT at `src/hooks/useStripeConnect.tsx:37`. Only
`stripe-create-connected-account` writes the table, with the service role. No
SQL function or trigger writes it, except the `updated_at` trigger.

pgTAP test `supabase/tests/stripe_connected_accounts_select_only.test.sql`.
It runs as `authenticated` with JWT claims set, the same as
`10_invoicing_tables.sql:279-283`:

- An owner, a manager, and a staff member can SELECT the row of their
  restaurant.
- An owner UPDATE of `charges_enabled` throws a permission error (grant
  revoked).
- An owner INSERT throws a permission error.
- A member of a different restaurant sees 0 rows.
- The policy "Owners can manage connected accounts" does not exist.

Change to the existing test `supabase/tests/10_invoicing_tables.sql`:

- `:109-114` asserts that the dropped policy exists. Change it to assert that
  the policy does not exist.
- `:279-287` inserts the row `a101` as an owner with `lives_ok`. Change it to
  seed the row as the `postgres` role. Later tests use this row.
- `:301-312` updates `charges_enabled` as an owner to test the `updated_at`
  trigger. Run this update as the `postgres` role.
- Fix the `plan(N)` count.

## 6. Security review (plan), security-audit skill, guidance mode

Method: the Cloudflare `security-audit` skill in guidance mode. I read
`SKILL.md`, `WEB-PROTOCOL-AND-AUTH.md`, and `PROTOCOLS-RPC-AND-MESSAGING.md`.
I made no live probes. Each item names the principal, the resource, and the
result.

| ID | Severity | Principal → resource | Result | Fix |
|---|---|---|---|---|
| S1 | High | A restaurant owner (authenticated) → `stripe_connected_accounts` row of the owner's restaurant | The `FOR ALL` policy lets the owner set `charges_enabled = true` or change `stripe_account_id` from the browser. The UI then shows "ready" for an account that Stripe did not approve. `stripe-create-invoice` reads `charges_enabled` from this row (`:82-98`), so the server gate is also false. A different `stripe_account_id` could point invoices at a different Connect account. | §5.3 |
| S2 | Medium | An owner → Stripe account session | The client can turn on components that the product does not offer (body spread at `:84`). | §5.2 S2 |
| S3 | Low | Any caller → error text | Raw Stripe or DB messages go back in the 500 body. | §5.2 S3 |
| S4 | Low | An attacker who controls a page that an owner visits → account-link return URL | The return URL uses the request `Origin` header. Browsers set `Origin`, so the risk is low, but a raw header must not choose a redirect (`WEB-PROTOCOL-AND-AUTH.md`, "Host, Forwarded, … Origin … are trust decisions"). | §5.2 S4 |
| S5 | Low | Platform → Stripe accounts | An insert error leaves a Stripe account with no row. Two parallel clicks can create two Stripe accounts. | §5.2 S5 (idempotency key) |
| S6 | Low | Owner UI → Stripe API | Each status check creates an unused account link. | §5.2 S6 |
| W1 | Design | Internet → `stripe-connect-webhook` | The endpoint is public (`verify_jwt = false`). The signature check is the only gate. | Fail closed when the secret is empty. Verify with the raw body. Own secret, not shared with the invoice webhook. |
| W2 | Design | Stripe redelivery → row state | Events can arrive twice or out of order (`PROTOCOLS-RPC-AND-MESSAGING.md`, "Duplicate delivery", "Older state … overwrites"). | Re-fetch the live account. Do not use the payload state. |
| W3 | Design | A signed event for account A → row for account B | Source binding. | Require `event.account`. Ignore a mismatch with `data.object.id`. The update changes only status columns. |
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
- pgTAP: `stripe_connected_accounts_select_only.test.sql`, and the changed
  `10_invoicing_tables.sql`.
- Manual check in the browser (Phase 7): Invoices with 0 customers shows the
  list and the card. The button opens the sheet. Close calls the check.
  InvoiceDetail Send on a draft opens the sheet. At 375 px the sheet is full
  width and the header stays visible. In the Stripe test form, open a step
  with a popup (bank link). A click in the popup does not close the sheet.

## 8. Risks

- R1. Dropping the owner policy breaks a client write that I did not find.
  Mitigation: the grep in §5.3, and the pgTAP test.
- R2. `useStripeEmbeddedConnect` puts `options` in the `useCallback` deps
  (`src/hooks/useStripeEmbeddedConnect.ts:70`). The guard in
  `StripeEmbeddedConnect.tsx:42-46` stops an endless loop, but StrictMode can
  start two sessions. Decision: fix it (§4.2).
- R3. The webhook needs a dashboard step. Until then, "Check now" and the
  check on sheet close update the status.
- R4. The Radix focus trap and the Stripe iframe can conflict. The manual
  check in §7 covers this.

## 9. Files

New:
`src/lib/paymentSetupState.ts`, `src/hooks/usePaymentSetup.ts`,
`src/components/invoicing/PaymentSetupCard.tsx`,
`src/components/invoicing/PaymentSetupSheet.tsx`,
`supabase/functions/stripe-connect-webhook/index.ts`,
`supabase/functions/_shared/stripeConnectWebhookHandler.ts`,
`supabase/functions/_shared/stripeAccountStatus.ts`,
`supabase/migrations/<ts>_stripe_connected_accounts_select_only.sql`,
`supabase/tests/stripe_connected_accounts_select_only.test.sql`, unit tests in §7.

Changed:
`src/pages/Invoices.tsx`, `src/pages/Customers.tsx`,
`src/pages/InvoiceDetail.tsx`, `src/hooks/useStripeEmbeddedConnect.ts`,
`supabase/tests/10_invoicing_tables.sql`,
`supabase/functions/stripe-create-connected-account/index.ts`,
`supabase/functions/stripe-create-account-session/index.ts`,
`supabase/config.toml`.
