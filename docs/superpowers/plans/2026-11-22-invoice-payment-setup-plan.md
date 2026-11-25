# Plan: simple invoice payment setup

Design: `docs/superpowers/specs/2026-11-22-invoice-payment-setup-design.md`
Branch: `feature/invoice-payment-setup`

Use TDD for each task: write the failing test, run it, write the code, run it
again. The design doc is authoritative. Do not change the behavior that the
design does not name. Commit each task with explicit paths only.

## Task 1. Lock connected-account writes (pgTAP first)

1. Write `supabase/tests/stripe_connected_accounts_select_only.test.sql`
   (design §5.3). Run as `authenticated` with JWT claims, the same as
   `supabase/tests/10_invoicing_tables.sql:279-283`.
   - Owner, manager, and staff can SELECT the row of their restaurant.
   - Owner UPDATE of `charges_enabled` throws a permission error.
   - Owner INSERT throws a permission error.
   - A member of a different restaurant sees 0 rows.
   - The policy "Owners can manage connected accounts" does not exist.
2. Run `npm run test:db`. Expect a failure.
3. Write `supabase/migrations/20261122120000_stripe_connected_accounts_select_only.sql`:
   - `DROP POLICY IF EXISTS "Owners can manage connected accounts" ON public.stripe_connected_accounts;`
   - `REVOKE INSERT, UPDATE, DELETE ON public.stripe_connected_accounts FROM authenticated;`
   - Do not change the SELECT policy or the `service_role` grants.
4. Change `supabase/tests/10_invoicing_tables.sql`:
   - `:109-114`: assert that the dropped policy does not exist.
   - `:279-287`: seed row `a101` as the `postgres` role (`RESET ROLE` first, then set the role back).
   - `:301-312`: run the `charges_enabled` update as the `postgres` role.
   - Fix the `plan(N)` count.
5. Run `npm run db:reset` and `npm run test:db`. Expect a pass.

## Task 2. Shared account status helper

1. Write `tests/unit/stripeAccountStatus.test.ts` for `deriveStatuses(account)`.
   Copy the cases from the current logic at
   `supabase/functions/stripe-create-connected-account/index.ts:35-47`.
2. Move `deriveStatuses` to `supabase/functions/_shared/stripeAccountStatus.ts`.
   No Deno globals in this file.
3. Import it in `stripe-create-connected-account/index.ts`. No behavior change.

## Task 3. Harden stripe-create-connected-account (S3, S4, S5, S6)

Put the testable logic in pure helpers in `supabase/functions/_shared/`
(no Deno globals), and test them in `tests/unit/`. Keep `index.ts` thin.

1. Add `supabase/functions/_shared/httpError.ts` with
   `class HttpError { status; publicMessage }` and a helper that maps an
   unknown error to `{ status, body }`: `HttpError` → its status and public
   message; other → 500 "Request failed". Test it in `tests/unit/httpError.test.ts`.
2. S3: in `stripe-create-connected-account/index.ts`, throw
   `HttpError(401, ...)` on an auth failure and `HttpError(403, ...)` for a
   non-owner. The catch at `:257-267` returns only the public message and logs
   the detail with `console.error`.
3. S4: build the account-link return and refresh URLs from
   `resolveAppOrigin(req.headers, parseAllowedOrigins(Deno.env.get('OAUTH_ALLOWED_ORIGINS')))`
   (`_shared/oauthState.ts:151-192`). Do not read the raw `origin` header for a redirect.
4. S5: pass `{ idempotencyKey: 'connect-acct-' + restaurantId }` to
   `stripe.accounts.create` (`:206`). If the insert (`:224-228`) fails with a
   unique violation (`23505`) on `restaurant_id`, read the existing row and
   continue. For other insert errors, log the Stripe account id and throw.
5. S6: add the optional body flag `statusOnly`. With a row: update the
   statuses and return `{ success: true, accountId, onboardingComplete }` with
   no account link. With no row: return
   `{ success: true, accountId: null, onboardingComplete: false }` and create
   nothing. Without the flag, the response stays the same as today.
6. Run `npm run test` and `npm run typecheck`.

## Task 4. Harden stripe-create-account-session (S2, S3)

1. In `supabase/functions/stripe-create-account-session/index.ts:75-84`,
   delete the `...components` spread from the request body. Keep all 7
   default keys: `account_onboarding`, `account_management`, `payouts`,
   `payments`, `balances`, `tax_registrations`, `tax_settings`.
2. Use `HttpError` from Task 3: 401 for auth, 403 for a non-owner, other →
   500 "Request failed". The catch at `:98-104` returns only the public message.
3. Run `npm run typecheck`.

## Task 5. Webhook handler (unit tests first)

1. Write `tests/unit/stripeAccountUpdatedHandler.test.ts` (design §5.1).
   Inject a fake Stripe client and a fake DB. Cases:
   - `event.account` missing → 200 ignored;
   - `data.object.id` not equal to `event.account` → 200 ignored;
   - no row for the account → 200 `{ received: true, unknown: true }`;
   - success: calls `accounts.retrieve(event.account)`, updates only the
     status columns by `stripe_account_id`, returns 200;
   - Stripe error or DB error → 500 "Webhook processing failed".
2. Run the test. Expect a failure.
3. Write `supabase/functions/_shared/stripeAccountUpdatedHandler.ts` with no
   Deno globals. It takes `(event, deps)` where `deps` has the Stripe client
   and the DB client. Use `deriveStatuses` from Task 2.
4. Run the test. Expect a pass.

## Task 6. Route the event in the existing invoice webhook

1. In `supabase/functions/stripe-invoice-webhook/index.ts`, after the
   signature check, call `handleAccountUpdated` when
   `event.type === 'account.updated'`. Keep the invoice path the same.
   Do not add a new function, a new `config.toml` block, or a new secret.
2. Run `npm run typecheck`.

## Task 7. Payment setup state helper

1. Write `tests/unit/paymentSetupState.test.ts` for
   `getPaymentSetupState(account)`:
   - `null` or `undefined` → `not_started`;
   - `charges_enabled && onboarding_complete` → `ready`;
   - all other rows → `pending`.
2. Write `src/lib/paymentSetupState.ts`.

## Task 8. Stable onReady in useStripeEmbeddedConnect

1. Add a test in `tests/unit/useStripeEmbeddedConnect.test.ts`: a rerender
   with a new `options` object does not change the `start` identity.
2. In `src/hooks/useStripeEmbeddedConnect.ts:70`, read `options.onReady`
   through a ref. Delete `options` from the `useCallback` deps.

## Task 9. usePaymentSetup hook

1. Write `tests/unit/usePaymentSetup.test.ts` (design §4.3). Mock
   `supabase.functions.invoke` and `useStripeConnect`. Cases:
   - the state maps from the account row;
   - `openSetup` for `not_started` calls `stripe-create-connected-account`
     with `{ restaurantId, accountType: 'express' }`, then opens the sheet;
   - `openSetup` for an existing account opens the sheet with no create call;
   - a second `openSetup` while `isStarting` does nothing;
   - a create error shows a toast and does not open the sheet;
   - `checkStatus` sends `{ restaurantId, statusOnly: true }`, then
     invalidates `['stripe-connected-account', restaurantId]`;
   - no parallel `checkStatus`;
   - `closeSetup` closes the sheet and calls `checkStatus`;
   - the toast after the check: "Payments are on" for `ready`,
     "Stripe is still checking your details" for `pending`.
2. Write `src/hooks/usePaymentSetup.ts`. It returns
   `{ state, isLoading, error, refetch, isSheetOpen, openSetup, closeSetup, checkStatus, isChecking, isStarting }`.
   No timed poll.

## Task 10. PaymentSetupCard and PaymentSetupSheet

1. Write `src/components/invoicing/PaymentSetupCard.tsx` (design §4.1).
   Props: `{ setup, canManage, hideWhenReady? }`. Three states, loading
   skeleton, error line with **Retry**, nothing when there is no restaurant.
   Use the exact copy, the type scale, `role="region"`, `aria-labelledby`,
   `aria-live="polite"`, `aria-busy` while `isStarting`. Semantic tokens only.
2. Write `src/components/invoicing/PaymentSetupSheet.tsx` (design §4.2).
   `SheetContent className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh]"`,
   `onInteractOutside={(e) => e.preventDefault()}`, fixed header with the
   title and `SheetDescription`, scroll body. Mount
   `StripeEmbeddedConnect component="account_onboarding"` only while open.
   `onExit` and close call `closeSetup()`.
3. Optional render test in `tests/unit/PaymentSetupCard.test.tsx` for the
   three states and the non-owner text.

## Task 11. Invoices page

1. In `src/pages/Invoices.tsx`, delete the customer block (`:101-137`) and the
   `useCustomers` import.
2. Call `usePaymentSetup` one time. Replace the info bar (`:162-179`) with
   `PaymentSetupCard` and render one `PaymentSetupSheet`.
   `canManage = selectedRestaurant?.role === 'owner'`.
3. Delete the imports that are not used after the change. Do not change the header style.

## Task 12. Customers page

1. In `src/pages/Customers.tsx`, call `usePaymentSetup` one time. Replace the
   Alert (`:87-104`) with `PaymentSetupCard hideWhenReady` and one
   `PaymentSetupSheet`. Show the card also when the customer list is empty.

## Task 13. InvoiceDetail page

1. In `src/pages/InvoiceDetail.tsx`, call `usePaymentSetup` one time and
   render one `PaymentSetupSheet`.
2. Send button (`:256-270`) when payments are not ready:
   - owner: enabled, label "Turn on payments to send", calls `openSetup`;
   - other roles: disabled, with visible text
     "Ask the restaurant owner to turn on payments." next to it. The text has
     an `id`. The button has `aria-describedby` with that id. No tooltip.
3. Replace the "Payment Processing" box (`:563-580`) with
   `PaymentSetupCard hideWhenReady`.

## Task 14. Checks

1. Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`, `npm run build`.

## Task 15. Ship

1. Review, simplify, verify, QA, PR, CI (workflow `dev-build-and-ship.js`).
   The PR body lists the deploy steps: add `account.updated` to the existing
   `stripe-invoice-webhook` endpoint, `OAUTH_ALLOWED_ORIGINS`, and the
   function deploy.
