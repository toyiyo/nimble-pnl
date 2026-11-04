# Plan: Claude integration (remote MCP connector)

Design: `docs/superpowers/specs/2026-09-26-claude-mcp-connector-design.md`

Do the tasks in order. Each task follows RED → GREEN → REFACTOR → COMMIT.

## Task 1 — MCP tool catalog

- Test: `tests/unit/mcpHandler.test.ts` — `buildMcpTools(roles)`.
  - It omits `navigate`.
  - It adds `restaurant_id` to each input schema.
  - It returns the union of tools for several roles, with no duplicates.
  - It marks the three categorization tools as not read-only.
  - It always includes `list_restaurants`.
- Code: `supabase/functions/_shared/mcpHandler.ts`.

## Task 2 — JSON-RPC transport and auth

- Test: `handleMcpRequest(req, deps)`.
  - `OPTIONS` gives a CORS preflight.
  - `GET .../.well-known/oauth-protected-resource` gives RFC 9728 metadata.
  - `GET /mcp` gives `405`.
  - No token or a bad token gives `401` with `WWW-Authenticate`.
  - Bad JSON gives `-32700`. An unknown method gives `-32601`.
  - A notification gives `202`.
  - `initialize` chooses the protocol version. `ping` gives `{}`.
- Code: same file.

## Task 3 — `tools/call`

- Test:
  - `list_restaurants` returns id, name, and role.
  - A forward sends `tool_name`, `arguments` without `restaurant_id`, and
    `restaurant_id` to `ai-execute-tool`, with the caller's token.
  - A missing `restaurant_id` uses the only restaurant, or gives a tool error.
  - An `ok: false` or a non-2xx response gives `isError: true`.
  - An unknown tool gives `isError: true`.
- Code: same file.

## Task 4 — Deno entry and config

- `supabase/functions/mcp/index.ts`: wire real deps (Supabase client,
  `fetch`, env).
- `supabase/config.toml`: `[functions.mcp] verify_jwt = false` and
  `[auth.oauth_server]`.

## Task 5 — OAuth return path helper

- Test: `tests/unit/oauthReturnPath.test.ts`.
  - It accepts `/oauth/consent?authorization_id=x`.
  - It rejects `//evil.com`, `https://evil.com`, `/`, and `/oauth/consentx`.
  - It saves, reads, and clears the value in `sessionStorage`.
- Code: `src/lib/oauthReturnPath.ts`.

## Task 6 — Consent page

- Test: `tests/unit/OAuthConsent.test.tsx`.
  - No `authorization_id`: error state.
  - Signed out: it saves the return path and goes to `/auth`.
  - Details: it shows the client name and the Allow and Deny buttons.
  - Allow and Deny post the correct action and go to `redirect_url`.
  - A response with only `redirect_url` goes there at once.
- Code: `src/pages/OAuthConsent.tsx`, `src/lib/oauthConsentApi.ts`, route
  in `src/App.tsx`, return path read in `src/pages/Auth.tsx`.

## Task 7 — Runbook

- `docs/CLAUDE_INTEGRATION.md`: enable the OAuth server, deploy, add the
  connector in claude.ai, Claude Desktop, and Claude Code, the tool list, and
  troubleshooting.

## Task 8 — Verify

- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- `deno check` on the new function if Deno is available.
