# Design: Claude integration (remote MCP connector)

Date: 2026-09-26
Status: Accepted (the `/goal` directive asked for autonomous execution)

## Goal

Let a restaurant owner or manager connect EasyShiftHQ to Claude. Claude then
answers questions about the restaurant with live data: sales, P&L, labor,
inventory, recipes, banking, and schedules. The integration works in
claude.ai, Claude Desktop, and Claude Code as a **custom connector**.

## Approaches that we compared

| # | Approach | Result |
|---|----------|--------|
| A | Remote MCP server (Streamable HTTP) with OAuth 2.1 from Supabase Auth | **Selected.** Claude custom connectors need this shape. Users sign in with their EasyShiftHQ login. No secrets to copy. |
| B | Local MCP server package (stdio) that the user runs | Rejected. Restaurant owners do not run Node. It does not work in claude.ai or on mobile. |
| C | Change the in-app AI chat from OpenRouter to the Claude API | Rejected as the main goal. It does not let a user bring EasyShiftHQ data into Claude. It stays a possible later task. |

## Facts about the current code

- `ai-execute-tool` already runs 24 data tools plus `navigate` under the
  caller's JWT. It
  creates a client with the caller's `Authorization` header, so RLS applies
  (`supabase/functions/ai-execute-tool/index.ts:3559-3563`).
- It checks the user's membership in the restaurant through
  `user_restaurants` (`supabase/functions/ai-execute-tool/index.ts:3577-3589`).
- It applies role and capability gates before it runs a tool
  (`supabase/functions/ai-execute-tool/index.ts:3589-3644`).
- It dispatches on `tool_name` with a `switch`
  (`supabase/functions/ai-execute-tool/index.ts:3654-3732`).
- `getTools(restaurantId, userRole)` returns the tool schemas that a role can
  see (`supabase/functions/_shared/tools-registry.ts:21`). It gives
  `get_labor_costs` (`:238`) and `get_schedule_overview` (`:275`) to every
  role. `ai-execute-tool` then refuses them with 403 when the caller lacks
  `view:scheduling` or `view:payroll`
  (`supabase/functions/ai-execute-tool/index.ts:3601-3622`).
- The in-app assistant is hidden for `staff` and `kiosk`
  (`src/components/ai-chat/AiChatBubble.tsx:89-90`). But `canUseTool` gives
  the basic tools, `get_kpis` included, to every role
  (`supabase/functions/_shared/tools-registry.ts:862-874`).
- The `user_restaurants` SELECT policy lets a member read the rows of
  coworkers (`supabase/migrations/20260411100000_staff_can_view_coworkers.sql:14-17`).
  A membership query must filter on `user_id`, as `ai-execute-tool` does
  (`supabase/functions/ai-execute-tool/index.ts:3580-3582`).
- `navigate` is a UI-only tool. It returns an app path and no data
  (`supabase/functions/_shared/tools-registry.ts:25`,
  `supabase/functions/ai-execute-tool/index.ts:50-80`).
- `canUseTool` holds the role gate
  (`supabase/functions/_shared/tools-registry.ts:843`).
- `user_restaurants.restaurant_id` has a foreign key to `restaurants`
  (`src/integrations/supabase/types.ts:10185`). The app embeds
  `restaurant:restaurants(*)` on it (`src/hooks/useRestaurants.tsx:120`).
- The Auth page sends a signed-in user to `/` or `/?welcome=true`
  (`src/pages/Auth.tsx:53-62`). It has no return path.
- Google and SSO sign-in return to `/`, not to `/auth`
  (`src/pages/Auth.tsx:163`, `src/components/SSOProviderButtons.tsx:18`,
  `src/hooks/useSSO.tsx:76`). Email sign-up confirms at `${origin}/`
  (`src/hooks/useAuth.tsx:173-181`).
- `ProtectedRoute` sends a signed-out user to `/auth`
  (`src/App.tsx:156-158`).
- The installed `@supabase/auth-js` is 2.71.1. It has no `auth.oauth` consent
  API. The consent page must call the Auth REST endpoints directly:
  `GET /auth/v1/oauth/authorizations/{id}` and
  `POST /auth/v1/oauth/authorizations/{id}/consent` with
  `{ "action": "approve" | "deny" }`. (Source: `@supabase/auth-js@2.117.2`,
  `dist/main/GoTrueClient.js`, `_getAuthorizationDetails` and
  `_approveAuthorization`.)

## Design

### 1. OAuth 2.1 server (Supabase Auth)

- Enable `[auth.oauth_server]` in `supabase/config.toml` with
  `authorization_url_path = "/oauth/consent"` and
  `allow_dynamic_registration = true`. Claude registers itself as a client
  through dynamic client registration.
- Supabase Auth serves the authorization server metadata. Issuer:
  `https://<project>.supabase.co/auth/v1`.
- Access tokens are normal Supabase user JWTs. RLS therefore applies with no
  change.
- Production: `supabase config push` does not push `[auth.oauth_server]`
  (supabase/cli issue #6367). An operator enables it in the dashboard. The
  runbook in `docs/CLAUDE_INTEGRATION.md` gives the steps.

### 2. Consent page — `/oauth/consent`

- A new public route. It is not inside `ProtectedRoute`, because the app
  chrome and restaurant context are not necessary here.
- Signed out: the page keeps its own URL as a return path, then goes to
  `/auth`. The return path is in `localStorage` with a 15-minute TTL, because
  email confirmation opens a new tab. It is read once.
- The return path is used in four places: the `Auth.tsx` sign-in effect, the
  Google button, the SSO buttons (`redirectPath`), and `emailRedirectTo` in
  `signUp`.
- `src/lib/oauthReturnPath.ts` parses the value with `new URL`. It requires
  the same origin, the exact path `/oauth/consent`, and a safe
  `authorization_id`. It rebuilds the path from these parts. This blocks an
  open redirect.
- The page waits for `useAuth().loading` before it decides that the user is
  signed out.
- Signed in: the page calls `GET /oauth/authorizations/{id}` with the
  `apikey` header and `Authorization: Bearer <access token>`. The query uses
  `retry: false` and no refetch, because an authorization is single use.
  - Response has only `redirect_url`: consent exists. Go to that URL.
  - Response has `client`: show the client name, the host of
    `redirect_uri`, the user email, and what the client can do. Show a
    warning when the host is not a Claude host (`claude.ai`, `claude.com`,
    `localhost`, `127.0.0.1`). Show a warning when the user has no
    restaurant that the connector can read. Show **Allow**, **Deny**, and
    **Use a different account**. Do not load a remote logo.
  - The page says that the client acts as the user, with the user's access.
- Allow or Deny: `POST .../consent`, then go to `redirect_url`. Both buttons
  stay disabled while the request runs and after success.
- States: loading (skeleton), missing `authorization_id`, expired or used
  (400/404/410), session ended (401, with **Sign in again**), network error,
  and decision error.
- `vercel.json` sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`
  for `/oauth/consent`. This blocks clickjacking.

### 3. MCP server — edge function `mcp`

- `verify_jwt = false`. The function authenticates the caller itself, because
  it must return `401` with a `WWW-Authenticate` header. MCP clients use that
  header to find the OAuth server.
- Pure handler in `supabase/functions/_shared/mcpHandler.ts`. Thin Deno entry
  in `supabase/functions/mcp/index.ts`. Unit tests in
  `tests/unit/mcpHandler.test.ts`.
- Transport: Streamable HTTP, stateless, JSON responses only (no SSE).
  - `POST` with a JSON-RPC request: `200` with a JSON-RPC response.
  - `POST` with a notification (no `id`): `202`, empty body.
  - `GET` or `DELETE`: `405`.
  - `OPTIONS`: CORS preflight.
- `GET .../.well-known/oauth-protected-resource`: RFC 9728 metadata with
  `resource`, `authorization_servers`, and `bearer_methods_supported`.
  No auth.
- Auth: every JSON-RPC call needs `Authorization: Bearer <jwt>`. The handler
  checks the token with `auth.getUser(token)`. A missing or bad token gets
  `401` and
  `WWW-Authenticate: Bearer resource_metadata="<metadata URL>"`.
- Methods:
  - `initialize`: return the client's protocol version if it is one of
    `2025-11-25`, `2025-06-18`, `2025-03-26`. Else return `2025-06-18`.
    Capabilities: `tools`. Include short `instructions`.
  - `ping`: empty result.
  - Memberships: the entry reads `user_restaurants` with
    `.eq('user_id', user.id)`. The handler drops `staff`, `kiosk`, and a null
    role from every method.
  - `tools/list`: `list_restaurants` plus the union of `getTools(...)` for
    each role that the user holds. The two capability-gated tools appear for
    every role, as in the in-app assistant. A call without the capability
    gets a tool error from the 403. Omit `navigate`. Add a
    `restaurant_id` property to each schema. Add annotations:
    `readOnlyHint: true` for read tools, and `readOnlyHint: false`,
    `destructiveHint: true` for the three categorization write tools. A
    confirmed batch overwrites categories with no undo
    (`supabase/functions/ai-execute-tool/index.ts:3301-3305`).
  - `tools/call`:
    - `list_restaurants`: read the caller's `user_restaurants` rows with the
      embedded restaurant name. Return `id`, `name`, `role`.
    - All other tools: forward to `ai-execute-tool` with the caller's
      `Authorization` header. `ai-execute-tool` keeps the single source of
      truth for permission gates and tool logic.
    - If `restaurant_id` is missing and the user has exactly one restaurant,
      use that restaurant. Else return a tool error that tells Claude to call
      `list_restaurants`.
    - Result: a `text` content block with the JSON `data`, cut to 100,000
      characters. A tool failure (`ok: false` at any HTTP status) returns
      `isError: true` with the error message (MCP tool-error form, so Claude
      can read and recover).
    - A 401 from the forward gives HTTP 401 with `WWW-Authenticate`, so the
      client refreshes the token.
    - The forward has a 25-second timeout.
  - Unknown method: JSON-RPC error `-32601`.
  - Bad JSON: JSON-RPC error `-32700`. A batch (array): `-32600`.
- Public URLs: the resource URL comes from `MCP_PUBLIC_URL` if set, else
  `${MCP_PUBLIC_SUPABASE_URL or SUPABASE_URL}/functions/v1/mcp`. The issuer
  comes from `MCP_AUTH_ISSUER` if set, else `.../auth/v1`. Local dev can set
  the overrides when the runtime URL is not the URL that Claude reaches.
- Discovery depends on the `resource_metadata` value in `WWW-Authenticate`.
  The RFC 9728 default location at the host root does not route to the
  function. Every 401 sends the header.
- The function uses no service-role key.

### 4. Integrations page card

Not in this change. The runbook tells the user how to add the connector URL
in Claude. A later task can add a card to `/integrations`.

## Decided trade-offs

- **Extra network hop.** `tools/call` calls `ai-execute-tool` over HTTP. This
  costs one hop. It keeps one copy of 3,700 lines of tool logic and all
  permission gates. A refactor to a shared module can come later.
- **Token reach.** The token that Claude holds is a user JWT. It works at
  PostgREST, RPC, and the other edge functions, with the user's RLS access,
  not only at `/mcp`. The consent page says this. The runbook gives the steps
  to stop the access.
- **Staff and kiosk.** The connector refuses these roles, so it gives no data
  that the in-app assistant hides from them.
- **Write tools.** The three categorization tools change data. The in-app
  assistant offers them to managers and owners
  (`supabase/functions/_shared/tools-registry.ts:705-790`, `:877-897`). The
  MCP annotations mark them as destructive, so Claude asks the user before
  it calls them.
- **Signing keys.** `ai-execute-tool` has `verify_jwt = true`
  (`supabase/config.toml:175-176`). The runbook tells the operator to check
  that the gateway accepts an OAuth token before release.
- **No SSE.** Stateless JSON responses fit edge functions and their CPU
  limits. The spec permits a JSON-only server.
- **TLA+.** No `run-tla` trigger matches. There are no cursors, locks,
  retries, or concurrent writers in the new code.

## Test plan

- Unit (`tests/unit/mcpHandler.test.ts`): each JSON-RPC method, 401 and
  metadata, notification `202`, forward success and failure, default
  restaurant, schema build, protocol version choice.
- Unit (`tests/unit/oauthReturnPath.test.ts`): the return-path helper
  accepts only `/oauth/consent` paths, reads once, and expires.
- Unit (`tests/unit/oauthConsentApi.test.ts`): request shape, errors, and
  the redirect host check.
- Unit (`tests/unit/OAuthConsent.test.tsx`): consent page states, the
  approve and deny calls, and the pending state.
- Unit (`tests/unit/AuthConsentReturn.test.tsx`): `Auth.tsx` returns to the
  consent page, and Google gets the consent path.
- E2E: the full OAuth flow needs a Supabase Auth version with the OAuth
  server on the local stack, and a registered client. See the Phase 8 note in
  the PR.
