# Design: signup-with-invitation must not change an existing account

Date: 2026-10-26. Security audit fix 1 of 7 (critical). STE-aligned.

## Problem

The edge function `signup-with-invitation` runs with `verify_jwt = false`
(`supabase/config.toml:106-107`). It finds a pending invitation by the token
hash and the email (`supabase/functions/signup-with-invitation/index.ts:37-43`).

Then it reads one page of users with `auth.admin.listUsers()` and compares the
email with exact case (`index.ts:63-64`). When it finds a user, it sets that
user's password and confirms the email with `auth.admin.updateUserById`
(`index.ts:73-82`).

Any signed-in user can create a restaurant and become its owner. The owner can
insert an invitation for any email with a token of the owner's choice. A call to
this function then sets the password of the victim account. This is an account
takeover.

## Decision

1. The function never changes an existing user. It does not call
   `listUsers` or `updateUserById`.
2. The function calls `auth.admin.createUser` only. GoTrue checks the email
   without case and over all users. When GoTrue reports that the email is
   already registered, the function returns HTTP 409 with
   `{ success: false, code: 'account_exists', error: 'Sign in to accept this invitation.' }`.
   The account does not change.
3. The logic moves to an injectable handler,
   `supabase/functions/_shared/signupWithInvitationHandler.ts`. The
   `index.ts` file builds the service-role client and calls the handler.
   Vitest tests the handler with a mock admin client. This follows the
   pattern of `supabase/functions/_shared/focusTestConnectionHandler.ts:1-20`
   and `tests/unit/focusTestConnectionHandler.test.ts:15-19`.
4. The handler detects the duplicate error by `code` (`email_exists`,
   `user_already_exists`) or by the message (`already been registered`,
   `already registered`). Other `createUser` errors keep the current 400
   response.
5. The frontend caller is `src/pages/AcceptInvitation.tsx:268`. Today a non-2xx
   response throws (`AcceptInvitation.tsx:276`) and shows a generic error
   toast. The new code reads the error body. On `account_exists`, the page
   shows a toast "Sign in to accept this invitation." and opens the in-page
   sign-in form (`setShowSignIn(true)`, the same state as
   `AcceptInvitation.tsx:294`). The token stays in the URL
   (`AcceptInvitation.tsx:66`), so the sign-in form and the accept effect
   (`AcceptInvitation.tsx:95-110`) use it. The page clears the password field.
6. A new helper `readFunctionErrorBody` in `src/lib/invitationUtils.ts` reads the
   JSON body of a `FunctionsHttpError` (`error.context`). The same inline
   parse exists in `AcceptInvitation.tsx:126-133`.

## Out of scope

- `accept-invitation` and the `invitations` RLS. Fix 2 changes them.
- A new user that an invitation creates still gets `email_confirm: true`.
  The token proves control of the inbox only when the server makes the
  token. Fix 2 controls who can write the token. This PR notes the risk.

## Tests

- `tests/unit/signupWithInvitationHandler.test.ts`: existing email returns 409
  `account_exists`; `updateUserById` and `listUsers` are never called; a new
  email calls `createUser` and returns 200; an invalid or expired invitation
  returns 400 and does not call `createUser`; a different `createUser` error
  returns 400.
- `tests/unit/invitationUtils.test.ts`: `readFunctionErrorBody` cases.
- `tests/unit/AcceptInvitation.test.tsx`: on `account_exists`, the page shows
  the sign-in form and the "sign in" toast, and does not auto sign in.

## E2E

Justified exception: CI does not run Playwright against a live Supabase for
this flow, and this container has no Supabase CLI. The page test covers the
seam between the page and the function contract. The handler test covers the
server side.

## TLA+

No `run-tla` trigger matches. The change has no concurrent writer, cursor, or
retry state.
