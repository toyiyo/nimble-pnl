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
  `ProtectedRoute` (`src/App.tsx:433-435`), but the user starts the flow
  signed in, so `supabase.functions.invoke` sends the session JWT.
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
   - `r` (optional): the Clover region.
2. `verifyOAuthState(token, secret, provider, nowSeconds?)` returns the
   payload or `null`. It checks the shape, then the signature, then the
   provider, then the expiry. It uses the helpers in `hmacToken.ts`.
3. `parseAllowedOrigins(envValue)` returns a list of exact origins. The list
   always holds `https://app.easyshifthq.com`. The env var
   `OAUTH_ALLOWED_ORIGINS` adds more origins (comma-separated, exact match).
4. `resolveAppOrigin(headers, allowedOrigins)` reads `Origin`, then the origin
   of `Referer`. It returns `{ origin, isProduction }`. An origin that is not
   in the list gives the production origin. The function never puts a raw
   header value into a redirect.
5. `isOwnerOrManager(supabase, userId, restaurantId)` queries
   `user_restaurants` for role `owner` or `manager`.
6. `checkOAuthCallback({ state, authHeader, provider, secret, getUserId, isOwnerOrManager })`
   returns `{ ok: true, restaurantId, userId, region? }` or
   `{ ok: false, status, error }`. The steps:
   1. Verify the state (signature, provider, expiry). Fail: 403.
   2. Get the user from the `Authorization` JWT. Fail: 401.
   3. The JWT user must equal `uid` in the state. Fail: 403. This blocks a
      login-CSRF attack: an attacker cannot make a victim finish a flow that
      the attacker started.
   4. Check owner or manager again for `uid` and `rid`. Fail: 403. A user who
      lost the role in the last 10 minutes cannot finish the flow.

### Changes to the three functions

For `square-oauth`, `clover-oauth` and `toast-oauth`:

- Read `OAUTH_STATE_SECRET`. If it is missing, return 500 before any work.
- `authorize`: keep the user check and the role check. Use
  `isOwnerOrManager`. Set `state` to `signOAuthState(...)`.
- `callback`: call `checkOAuthCallback` first. Return its status on a fail.
  No token exchange, no upsert, no sync call happens before this check.
  Use the `restaurantId` (and the Clover `region`) from the verified state.
- Delete the log lines with the full authorization URL, the client id and
  the application id prefix. Delete the log of the raw `state`.
- Build `REDIRECT_URI` from `resolveAppOrigin`. A non-production allowlisted
  origin selects the sandbox credentials for Square and Clover, as the
  preview hosts do today. Toast uses the origin only for the redirect.

### Frontend

The request shapes do not change. `authorize` still sends `restaurantId`.
`callback` still sends `code` and `state`. The callback pages already send
the session JWT through `supabase.functions.invoke`. No frontend change is
necessary.

### Env vars (document in the PR, do not add values)

- `OAUTH_STATE_SECRET` (required): the HMAC key. Use 32 or more random bytes.
  Set it before the deploy. Without it, the three OAuth flows return 500.
- `OAUTH_ALLOWED_ORIGINS` (optional): extra exact app origins for preview or
  local work, for example `http://localhost:8080`.

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
- `resolveAppOrigin`: production origin, allowlisted preview origin, unknown
  origin, `Referer` fallback, malformed header.

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
