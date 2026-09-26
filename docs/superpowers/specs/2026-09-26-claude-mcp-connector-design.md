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

- `ai-execute-tool` already runs 25 data tools under the caller's JWT. It
  creates a client with the caller's `Authorization` header, so RLS applies
  (`supabase/functions/ai-execute-tool/index.ts:3559-3563`).
- It checks the user's membership in the restaurant through
  `user_restaurants` (`supabase/functions/ai-execute-tool/index.ts:3577-3589`).
- It applies role and capability gates before it runs a tool
  (`supabase/functions/ai-execute-tool/index.ts:3589-3644`).
- It dispatches on `tool_name` with a `switch`
  (`supabase/functions/ai-execute-tool/index.ts:3654-3732`).
- `getTools(restaurantId, userRole)` returns the tool schemas that a role can
  use (`supabase/functions/_shared/tools-registry.ts:21`).
- `navigate` is a UI-only tool. It returns an app path and no data
  (`supabase/functions/_shared/tools-registry.ts:25`,
  `supabase/functions/ai-execute-tool/index.ts:50-80`).
- `canUseTool` holds the role gate
  (`supabase/functions/_shared/tools-registry.ts:843`).
- `user_restaurants.restaurant_id` has a foreign key to `restaurants`
  (`src/integrations/supabase/types.ts:10185`). The app embeds
  `restaurant:restaurants(*)` on it (`src/hooks/useRestaurants.tsx:120`).
- The Auth page always sends a signed-in user to `/`
  (`src/pages/Auth.tsx:53-62`). It has no return path.
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
- Signed out: the page keeps its own URL as a return path in
  `sessionStorage`, then goes to `/auth`. After sign-in, `Auth.tsx` reads the
  return path and goes back. The helper accepts only paths that start with
  `/oauth/consent`. This blocks an open redirect.
- Signed in: the page calls `GET /oauth/authorizations/{id}`.
  - Response has only `redirect_url`: consent exists. Go to that URL.
  - Response has `client`: show the client name, the scopes, the user email,
    and the data that the client can read. Show **Allow** and **Deny**.
- Allow or Deny: `POST .../consent`, then go to `redirect_url`.
- The page handles the loading, error, and missing `authorization_id` states.

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
  - `tools/list`: `list_restaurants` plus the union of `getTools(...)` for
    each role that the user holds. Omit `navigate`. Add a
    `restaurant_id` property to each schema. Add annotations:
    `readOnlyHint: true` for read tools, and `readOnlyHint: false`,
    `destructiveHint: false` for the three categorization write tools.
  - `tools/call`:
    - `list_restaurants`: read the caller's `user_restaurants` rows with the
      embedded restaurant name. Return `id`, `name`, `role`.
    - All other tools: forward to `ai-execute-tool` with the caller's
      `Authorization` header. `ai-execute-tool` keeps the single source of
      truth for permission gates and tool logic.
    - If `restaurant_id` is missing and the user has exactly one restaurant,
      use that restaurant. Else return a tool error that tells Claude to call
      `list_restaurants`.
    - Result: a `text` content block with the JSON `data`. A tool failure
      returns `isError: true` with the error message (MCP tool-error form,
      so Claude can read and recover).
  - Unknown method: JSON-RPC error `-32601`.
  - Bad JSON: JSON-RPC error `-32700`.
- Public URLs: the resource URL comes from `MCP_PUBLIC_URL` if set, else
  `${SUPABASE_URL}/functions/v1/mcp`. The issuer comes from
  `MCP_AUTH_ISSUER` if set, else `${SUPABASE_URL}/auth/v1`. Local dev sets
  the overrides, because the edge runtime sees an internal `SUPABASE_URL`.

### 4. Integrations page card

Not in this change. The runbook tells the user how to add the connector URL
in Claude. A later task can add a card to `/integrations`.

## Decided trade-offs

- **Extra network hop.** `tools/call` calls `ai-execute-tool` over HTTP. This
  costs one hop. It keeps one copy of 3,700 lines of tool logic and all
  permission gates. A refactor to a shared module can come later.
- **Token audience.** Supabase OAuth tokens use `aud = authenticated`. They
  are not bound to the MCP resource URL. A token from the web app therefore
  also works at `/mcp`. The permissions are the same as the web app, so this
  gives no new access.
- **Write tools.** The three categorization tools change data. They are
  already open to the in-app assistant for managers and owners. The MCP
  annotations mark them as not read-only, so Claude asks the user before it
  calls them.
- **No SSE.** Stateless JSON responses fit edge functions and their CPU
  limits. The spec permits a JSON-only server.
- **TLA+.** No `run-tla` trigger matches. There are no cursors, locks,
  retries, or concurrent writers in the new code.

## Test plan

- Unit (`tests/unit/mcpHandler.test.ts`): each JSON-RPC method, 401 and
  metadata, notification `202`, forward success and failure, default
  restaurant, schema build, protocol version choice.
- Unit (`tests/unit/oauthReturnPath.test.ts`): the return-path helper
  accepts only `/oauth/consent` paths.
- Unit (`tests/unit/OAuthConsent.test.tsx`): consent page states and the
  approve and deny calls.
- E2E: the full OAuth flow needs a Supabase Auth version with the OAuth
  server on the local stack, and a registered client. See the Phase 8 note in
  the PR.
