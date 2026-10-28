# POS OAuth: sign the `state` and check it in the callback

Date: 2026-10-26
Branch: `claude/lucid-gauss-ztcvg0`
Status: STE-aligned. The user approved the plan in advance (security audit fix 4 of 7).

## Problem

The `state` value in the Square, Clover and Toast OAuth flows has no
signature. The callback trusts it as the restaurant id. An attacker can
send a callback with their own POS `code` and the `state` set to the id of
a different restaurant. The function then writes the attacker's POS
connection to that restaurant with the service role.

## Current code (cited)

- `square-oauth` runs with `verify_jwt = false`
  (`supabase/config.toml:70-71`). `clover-oauth` also runs with
  `verify_jwt = false` (`supabase/config.toml:112-113`). `toast-oauth` has
  no entry in `supabase/config.toml`, so the gateway checks the JWT.
- The functions check the user only for `authorize`
  (`supabase/functions/square-oauth/index.ts:35-47`,
  `supabase/functions/clover-oauth/index.ts:34-44`,
  `supabase/functions/toast-oauth/index.ts:35-47`). The `callback` action
  has no user check.
- The authorize step checks owner or manager in `user_restaurants`
  (`supabase/functions/square-oauth/index.ts:114-124`,
  `supabase/functions/clover-oauth/index.ts:152-162`,
  `supabase/functions/toast-oauth/index.ts:91-101`).
- Square sets `state` to the restaurant id
  (`supabase/functions/square-oauth/index.ts:143`). The callback reads it
  back as the restaurant id (`supabase/functions/square-oauth/index.ts:162`).
- Toast does the same (`supabase/functions/toast-oauth/index.ts:118`,
  `supabase/functions/toast-oauth/index.ts:135`).
- Clover sets `state` to unsigned JSON with `restaurantId` and `region`
  (`supabase/functions/clover-oauth/index.ts:178`). The callback parses it
  with `JSON.parse` (`supabase/functions/clover-oauth/index.ts:195-197`).
- After the token exchange, Square upserts `square_connections`
  (`supabase/functions/square-oauth/index.ts:288-294`) and calls
  `square-sync-data` with `initial_sync`
  (`supabase/functions/square-oauth/index.ts:362-364`). Clover upserts
  `clover_connections` (`supabase/functions/clover-oauth/index.ts:343-349`).
  Toast upserts `toast_connections`
  (`supabase/functions/toast-oauth/index.ts:185-200`).
- The functions log the full authorization URL and the client id
  (`supabase/functions/square-oauth/index.ts:145-147`,
  `supabase/functions/toast-oauth/index.ts:120-121`,
  `supabase/functions/clover-oauth/index.ts:131`,
  `supabase/functions/clover-oauth/index.ts:180`). Square also logs a
  prefix of the application id (`supabase/functions/square-oauth/index.ts:93`).
- The redirect URI comes from the raw `Origin` or `Referer` header when the
  host matches a preview pattern
  (`supabase/functions/square-oauth/index.ts:50-84`,
  `supabase/functions/toast-oauth/index.ts:50-75`,
  `supabase/functions/clover-oauth/index.ts:47-128`). Clover accepts any
  host that contains `vercel.app`
  (`supabase/functions/clover-oauth/index.ts:87-91`).
- The frontend sends `{ action: 'authorize', restaurantId }`
  (`src/hooks/useSquareIntegration.tsx:63-68`) and
  `{ action: 'callback', code, state }`
  (`src/pages/SquareCallback.tsx:77-83`, `src/pages/CloverCallback.tsx:47-53`,
  `src/pages/ToastCallback.tsx:77-83`). The callback pages are not inside
  `ProtectedRoute` (`src/App.tsx:433-435`). The app client keeps the session
  in `localStorage` (`src/integrations/supabase/client.ts:18-24`). supabase-js
  `functions.invoke` sends the session `access_token` as `Bearer`. With no
  session, it sends the anon key as `Bearer`, and `auth.getUser` rejects it.
- The callback pages show a generic message on any error
  (`src/pages/SquareCallback.tsx:102-112`, `src/pages/ToastCallback.tsx:102-112`).
  The Clover page shows the raw error text (`src/pages/CloverCallback.tsx:68-77`).
- The Square and Toast callback pages log the full URL with the `code` and
  the raw `state` to the console (`src/pages/SquareCallback.tsx:27-36`,
  `src/pages/ToastCallback.tsx:27-36`).
- `logSecurityEvent` takes an optional user id
  (`supabase/functions/_shared/encryption.ts:91-96`). The callbacks pass
  `undefined` (`supabase/functions/square-oauth/index.ts:297`).
- Clover reads `region` from the request body with no check
  (`supabase/functions/clover-oauth/index.ts:29`).
- `_shared/hmacToken.ts` has the `<payload>.<signature>` HMAC-SHA256
  primitives (`supabase/functions/_shared/hmacToken.ts:62-77`).
  `_shared/reviewToken.ts` shows the sign and verify pattern with an expiry
  (`supabase/functions/_shared/reviewToken.ts:33-63`).

## Design

### New module: `supabase/functions/_shared/oauthState.ts`

Pure functions. No Deno globals, so Vitest can import them.

1. `signOAuthState(input, secret, nowSeconds?)` returns a token. The payload is:
   - `p`: the provider (`square`, `clover`, `toast`). A Square state does not
     pass a Clover callback.
   - `rid`: the restaurant id.
   - `uid`: the user id of the caller of `authorize`.
   - `n`: a random nonce (16 bytes, base64url).
   - `exp`: now + 600 seconds (`OAUTH_STATE_TTL_SECONDS`).
   - `o`: the app origin from the allowlist. The callback builds the
     redirect URI and picks sandbox or production from this value only.
   - `r` (optional): the Clover region, one of `na`, `eu`, `latam`, `apac`.
2. `verifyOAuthState(token, secret, provider, nowSeconds?)` returns the
   payload or `null`. It checks the shape (including the region set), then
   the signature, then the provider, then the expiry. It uses the helpers in
   `hmacToken.ts`.
3. `parseAllowedOrigins(envValue)` returns a list of exact origins. The list
   always holds `https://app.easyshifthq.com`. The env var
   `OAUTH_ALLOWED_ORIGINS` adds more origins (comma-separated, exact match).
   Each entry goes through `new URL(x).origin`. The function drops an entry
   that has `*`, a path, or a scheme other than `https:`. It keeps
   `http://localhost:<port>` and `http://127.0.0.1:<port>` for local work.
4. `resolveAppOrigin(headers, allowedOrigins)` reads `Origin`, then the origin
   of `Referer`. It returns `{ origin, isProduction }`. An origin that is not
   in the list gives the production origin. The function never puts a raw
   header value into a redirect.
5. `isOwnerOrManager(supabase, userId, restaurantId)` queries
   `user_restaurants` for role `owner` or `manager` with `.maybeSingle()`.
   A query error gives `false` and a log line.
6. `checkOAuthCallback({ state, authHeader, provider, secret, getUserId, isOwnerOrManager })`
   returns `{ ok: true, restaurantId, userId, region? }` or
   `{ ok: false, status, error }`. The steps:
   1. Verify the state (signature, provider, expiry). Fail: 403.
   2. Get the user from the `Authorization` JWT. A missing header, or a
      token that `auth.getUser` rejects (the anon key), gives 401.
   3. The JWT user must equal `uid` in the state. Fail: 403. A victim who
      is signed in cannot finish a flow that an attacker started. This does
      not bind the flow to one browser of the same user.
   4. Check that `o` is still in the allowlist. Fail: 403.
   5. Check owner or manager again for `uid` and `rid`. Fail: 403. A user who
      lost the role in the last 10 minutes cannot finish the flow.

7. `resolveOAuthRequest(...)` is the one gate for all three functions
   (added after the Phase 7a review, to stop three copies of the checks).
   It checks the secret, the action, the body field types, the JWT, the
   role, the Clover region, and calls `checkOAuthCallback` for a callback.
   It returns `{ ok: false, status, error }` or the checked values. For
   `authorize`, it also returns the signed state, so the secret does not
   leave the module.
8. `verifyOAuthState` rejects a `state` longer than 2048 characters before
   it decodes it. `resolveAppOrigin` logs a warning for an origin that is
   not in the allowlist.

### Changes to the three functions

For `square-oauth`, `clover-oauth` and `toast-oauth`:

- Read `OAUTH_STATE_SECRET`. If it is missing or shorter than 32
  characters, return 500 before any work.
- `authorize`: keep the user check and the role check. Use
  `isOwnerOrManager`. Set `state` to `signOAuthState(...)`.
- `callback`: call `checkOAuthCallback` first. Return its status on a fail.
  No token exchange, no upsert, no sync call happens before this check.
  Use the `restaurantId`, the origin and the Clover `region` from the
  verified state. Pass the verified user id to `logSecurityEvent`.
- Delete the log lines with the full authorization URL, the client id and
  the application id prefix. Delete the log of the raw `state`.
- `authorize` builds `REDIRECT_URI` from `resolveAppOrigin` and signs the
  origin into the state. `callback` builds `REDIRECT_URI` from the signed
  origin. A non-production allowlisted origin selects the sandbox credentials
  for Square and Clover, as the preview hosts do today. Toast uses the origin
  only for the redirect.
- Clover `authorize` rejects a `region` outside `na`, `eu`, `latam`, `apac`.

### Frontend

The request shapes do not change. `authorize` still sends `restaurantId`.
`callback` still sends `code` and `state`.

- New helper `src/lib/oauthCallbackError.ts`:
  `describeOAuthCallbackError(error, providerName)` reads
  `error.context.status`. On 401 it returns "Sign in, then connect
  <provider> again." On 403 it returns "This connection link expired or
  belongs to a different account. Start the connection again." Other
  errors give "Failed to complete the <provider> connection."
- The three callback pages show this message.
- Delete the console logs of the full URL, the `code` and the raw `state`
  in `SquareCallback.tsx` and `ToastCallback.tsx`. Delete the unused
  `const restaurantId = state`.

### Sign in, then come back (added after review: QA-1)

The callback needs the session of the user who started the connect. On a
phone, the native app (`capacitor.config.ts` bundles `dist`) has its session
under its own origin. The provider returns to
`https://app.easyshifthq.com/<pos>/callback` in the phone browser, where the
user is often signed out. The old flow passed there only because the callback
had no auth check.

- `src/lib/oauthReturnPath.ts` already keeps a safe return path for the
  consent page (`saveConsentReturnPath` / `takeConsentReturnPath`, `src/lib/oauthReturnPath.ts:133-172`), and `Auth.tsx` sends a
  signed-in user to it (`src/pages/Auth.tsx:54-59`). The module now also
  accepts the three POS callback paths. It rebuilds each path from a checked
  `code` and a checked signed `state`, and drops every other parameter.
- New `src/lib/posCallbackSignIn.ts`: `redirectToSignInIfSignedOut` saves the
  callback URL and opens `/auth` when the page has no session.
- Each callback page calls it before the edge function. After sign-in, the
  Auth page returns the user to the callback URL, and the page finishes the
  connect. The user must sign in as the user who started the connect, or the
  callback gives 403.
- Limit: the provider `code` expires after a few minutes. A slow sign-in gives
  the generic error, and the user taps Connect again.

### Env vars (document in the PR, do not add values)

- `OAUTH_STATE_SECRET` (required): the HMAC key. Use 32 or more random bytes.
  Set it before the deploy. Without it, the three OAuth flows return 500.
- `OAUTH_ALLOWED_ORIGINS` (optional): extra exact app origins for preview or
  local work, for example `http://localhost:8080`.

### Rollout note

A user who is in an OAuth flow at deploy time has an unsigned `state`. The
callback rejects it with 403. The user clicks Connect again.

## Tests

`tests/unit/oauthState.test.ts`:

- A good token passes and returns the payload.
- A changed payload or signature fails.
- An expired token fails.
- A token for a different provider fails.
- A wrong secret fails. Malformed input fails.
- A changed restaurant id fails (the payload changes, so the signature fails).
- `checkOAuthCallback`: bad state gives 403, no JWT gives 401, a JWT for a
  different user gives 403, a user who is not owner or manager gives 403, a
  good call returns the restaurant id from the state. The reject cases
  assert that the role check does not run when an earlier check fails.
- `checkOAuthCallback`: the anon key (rejected by `getUser`) gives 401. A
  signed origin that left the allowlist gives 403.
- A Clover region outside the set fails.
- `resolveAppOrigin`: production origin, allowlisted preview origin, unknown
  origin, `Referer` fallback, malformed header.
- `parseAllowedOrigins`: drops wildcards, paths and `http:` hosts other than
  localhost.

`tests/unit/oauthCallbackError.test.ts`: 401, 403, other status, plain
`Error`.

E2E: a justified exception. The flow needs live Square, Clover or Toast
OAuth servers. CI has no credentials for them. The unit tests cover every
reject path of the callback through `checkOAuthCallback`.

## TLA+ check

The change has no concurrent writers, cursors, locks or retries. The
`run-tla` triggers do not match.

## Decided trade-offs

- Preview hosts now need an exact entry in `OAUTH_ALLOWED_ORIGINS`. A
  wildcard such as `*.lovableproject.com` matches hosts that other Lovable
  users control, so the design does not allow wildcards.
- The nonce is not stored. A replay inside 10 minutes needs a valid POS
  `code` for the same user and restaurant. The provider makes each `code`
  single-use. A store for nonces adds a table for little gain.
