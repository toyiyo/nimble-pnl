# Claude integration (MCP connector)

EasyShiftHQ connects to Claude as a **custom connector**. The connector is a
remote MCP server. After a user connects it, Claude can answer questions with
live restaurant data: sales, P&L, labor, inventory, recipes, banking, and
schedules.

Design: `docs/superpowers/specs/2026-09-26-claude-mcp-connector-design.md`

## How it works

```text
Claude ──(1) POST /functions/v1/mcp, no token──────────▶ mcp edge function
       ◀─(2) 401 + WWW-Authenticate: resource_metadata ──
       ──(3) GET .../mcp/.well-known/oauth-protected-resource
       ──(4) OAuth 2.1 + dynamic client registration ──▶ Supabase Auth
                     Supabase Auth ──▶ app /oauth/consent (user signs in, allows)
       ◀─(5) access token (Supabase user JWT) ───────────
       ──(6) tools/call + Bearer token ─────────────────▶ mcp ──▶ ai-execute-tool
                                                          (RLS + role gates)
```

| Part | File |
|------|------|
| MCP protocol and tool catalog | `supabase/functions/_shared/mcpHandler.ts` |
| Edge function entry | `supabase/functions/mcp/index.ts` |
| Tool logic and permission gates (not changed) | `supabase/functions/ai-execute-tool/index.ts` |
| Consent page | `src/pages/OAuthConsent.tsx` |
| Consent REST client | `src/lib/oauthConsentApi.ts` |
| Return path after sign-in | `src/lib/oauthReturnPath.ts` |
| Local OAuth server config | `supabase/config.toml` (`[auth.oauth_server]`) |

## Who can use it

- Owners, managers, chefs, and collaborators can connect.
- Staff and kiosk memberships are refused. The in-app assistant is hidden
  for these roles too.
- Each tool keeps the same role and capability gates as the in-app assistant.
  For example, bank transactions need a manager or owner role.

## Tools

| Tool | Access | Notes |
|------|--------|-------|
| `list_restaurants` | read | Call it first. It gives the `restaurant_id` values. |
| `get_kpis`, `get_sales_summary`, `get_daily_sales_totals` | read | Revenue, COGS, labor, prime cost. |
| `get_inventory_status`, `get_inventory_transactions` | read | |
| `get_recipe_analytics` | read | |
| `get_labor_costs`, `get_schedule_overview` | read | Need `view:scheduling` or `view:payroll`. |
| `get_financial_intelligence`, `get_bank_transactions`, `get_financial_statement`, `generate_report` | read | Manager or owner. |
| `get_payroll_summary`, `get_time_punches`, `get_tip_summary` | read | Manager or owner. |
| `get_pending_outflows`, `get_operating_costs`, `get_monthly_trends`, `get_expense_health`, `get_break_even_progress` | read | Manager or owner. |
| `batch_categorize_transactions`, `batch_categorize_pos_sales`, `create_categorization_rule` | **write** | Manager or owner. Marked destructive, so Claude asks before it calls them. |

Every tool except `list_restaurants` takes `restaurant_id`. A user with one
restaurant can omit it.

The connector does not offer `navigate` (UI only) or `get_ai_insights` (it runs
a paid LLM loop with no time limit; Claude does the same analysis from the data
tools).

## Production setup (one time)

Do these steps in order.

1. **Enable the OAuth 2.1 server.** `supabase config push` does not push
   `[auth.oauth_server]` (supabase/cli#6367). In the Supabase dashboard, open
   **Authentication → OAuth Server**. Then set:
   - OAuth server: **enabled**.
   - Authorization path: `/oauth/consent`.
   - Dynamic client registration: **enabled**.
2. **Check the site URL.** In **Authentication → URL Configuration**, the site
   URL must be the app URL (`https://app.easyshifthq.com`). Supabase builds
   the consent URL from the site URL and the authorization path.
3. **Allow the return URL.** In **Authentication → URL Configuration →
   Redirect URLs**, add `https://app.easyshifthq.com/oauth/consent**`.
   Google, SSO, and email confirmation return to this URL.
4. **Deploy.** A merge to `main` deploys the `mcp` function
   (`.github/workflows/deploy-supabase.yml`) and the app (Vercel).
5. **Use the EasyShiftHQ domain.** Vercel proxies `https://app.easyshifthq.com/mcp`
   to the `mcp` function (`vercel.json`). After the app deploy, set the Supabase
   secret `MCP_PUBLIC_URL` to `https://app.easyshifthq.com/mcp`. Then remove
   and add every existing connector again with the new URL: the metadata
   `resource` changes, and clients refuse a resource that does not match the
   URL they connect to.
6. **Check the token path.** `ai-execute-tool` has `verify_jwt = true`. If the
   project uses asymmetric JWT signing keys, check that the gateway accepts
   an OAuth access token. Do the "Smoke test" below before you announce the
   connector.

The function needs no new secrets. It reads `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, which Supabase sets. Optional overrides:

| Env | Use |
|-----|-----|
| `MCP_PUBLIC_SUPABASE_URL` | Public project URL, when `SUPABASE_URL` is internal. |
| `MCP_PUBLIC_URL` | Full public URL of the MCP endpoint. |
| `MCP_AUTH_ISSUER` | OAuth issuer. Default: `<public URL>/auth/v1`. |

## Connect Claude or ChatGPT

The connector URL is:

```text
https://app.easyshifthq.com/mcp
```

Before the `MCP_PUBLIC_URL` secret is set, use the function URL
`https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/mcp`.

- **claude.ai and Claude Desktop:** open **Settings → Connectors → Add custom
  connector**. Enter the name `EasyShiftHQ` and the URL. Click **Connect**,
  sign in to EasyShiftHQ, and click **Allow**.
- **Claude Code:** run the command below, then run `/mcp` and select
  `easyshifthq` to sign in.

  ```bash
  claude mcp add --transport http easyshifthq https://app.easyshifthq.com/mcp
  ```
- **ChatGPT:** turn on developer mode (**Settings → Apps & Connectors →
  Advanced settings**), then create a connector with the URL and OAuth
  authentication. The consent page allows the `chatgpt.com` callback.

Example questions:

- "What were my net sales and prime cost last week?"
- "Which recipes have the lowest margin this month?"
- "Which inventory items are low on stock?"
- "Compare labor cost this month to last month."

## Stop the access

1. In EasyShiftHQ, open **Integrations → AI assistants and connected apps**.
2. Click **Revoke** next to the app. Supabase Auth deletes the grant, and the
   tokens of that app stop working.
3. In Claude or ChatGPT, delete the connector.

## Consent page protections

- The page shows the host of the redirect URL.
- A `claude.ai`, `claude.com`, or `chatgpt.com` host over HTTPS gets
  **Allow**. The list is `TRUSTED_REDIRECT_HOSTS` in
  `src/lib/oauthConsentApi.ts`. Add a host there to support another assistant.
- A loopback host (`localhost`, `127.0.0.1`) gets **Allow** and a note. Claude
  Code and Claude Desktop use it.
- Any other host gets **Deny** only. Dynamic registration is open, so any
  party can register a client named "Claude" or "ChatGPT". The host check stops a phishing
  client from getting a token.
- The page does not work inside a frame, and Vercel sends
  `frame-ancestors 'none'` for `/oauth/*`.
- Optional hardening: turn off dynamic registration, then register Claude's
  client by hand. Give users the client ID for the claude.ai **Advanced
  settings** or for `claude mcp add --client-id`.

## Smoke test

Run these requests after a deploy. Replace `$TOKEN` with a user access token.

```bash
URL=https://app.easyshifthq.com/mcp

# 1. No token: expect 401 and a WWW-Authenticate header.
curl -si -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' | grep -i -E '^HTTP|www-authenticate'

# 2. Metadata: expect JSON with authorization_servers.
curl -s "$URL/.well-known/oauth-protected-resource"

# 3. Authorization server metadata: expect registration_endpoint.
curl -s https://ncdujvdgqtaunuyigflp.supabase.co/.well-known/oauth-authorization-server/auth/v1

# 4. A tool call with a token.
curl -s -X POST "$URL" -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_restaurants","arguments":{}}}'
```

## Local development

1. Run `npm run dev:full`. The local config enables the OAuth server.
2. The local `site_url` is `http://localhost:3000`, but Vite serves on port
   `8080`. For an OAuth test, set `site_url = "http://localhost:8080"` in
   `supabase/config.toml`, then run `supabase stop` and `supabase start`. Do
   not commit that change.
3. Use the MCP Inspector (`npx @modelcontextprotocol/inspector`) with the URL
   `http://127.0.0.1:54321/functions/v1/mcp`.

## List in the Claude Connectors Directory

Submit at [claude.ai/directory/manage](https://claude.ai/directory/manage) →
**Submit new** → **MCP connector**. Any paid Claude plan can submit.

| Requirement | Where it is |
|-------------|-------------|
| HTTPS server on the EasyShiftHQ domain | `https://app.easyshifthq.com/mcp` (setup step 5) |
| OAuth with dynamic client registration | Supabase OAuth server (setup step 1) |
| A `title` and `readOnlyHint` or `destructiveHint` on every tool | `MCP_TOOL_TITLES` and `MCP_WRITE_TOOLS` in `supabase/functions/_shared/mcpHandler.ts` |
| Tool descriptions describe the tool and do not tell Claude how to behave | `tools-registry.ts`, `payHidden.ts`. A unit test in `tests/unit/mcpHandler.test.ts` checks it. The preview-first rule for write tools is in the server instructions (`mcpHandler.ts`) and the in-app prompt (`ai-chat-stream`). |
| Public privacy policy URL | Owner: legal. Must cover collection, use, storage, sharing, retention, and a contact. |
| Public documentation with setup steps and at least 3 example prompts | Publish this page's "Connect" and "Example questions" as a help article. |
| Support contact, icon, company details | Portal fields |
| Reviewer test account with a fully populated restaurant | A demo login with sales, labor, inventory, and banking data |
| Every tool tested in Claude | Portal step **Test & launch** |

Escalations: `mcp-review@anthropic.com`.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Claude says "Authorization with EasyShiftHQ failed" after **Allow**, and the Auth log shows `HS256 is not supported for ID token signing`. | Claude asked for `openid`. `mcp` must advertise `scope="email offline_access"` and never `openid`. Do not rotate to asymmetric keys to fix it: that can break the `verify_jwt = true` functions. |
| Claude says that it cannot find the OAuth server. | The OAuth server is off, or dynamic registration is off. Do setup step 1. |
| The consent page shows "This request expired". | The authorization is single use and expires. Start the connection again in Claude. |
| After Google sign-in, the user lands on the dashboard. | The redirect URL is not allowed. Do setup step 3. |
| `list_restaurants` is empty. | The user has only staff or kiosk memberships. |
| A tool returns "You don't have permission to use …". | The role or capability gate refused the call. This is correct behaviour. |
