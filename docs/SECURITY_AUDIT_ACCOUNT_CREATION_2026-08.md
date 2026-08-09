# Security Audit — User Account Creation (August 2026)

**Scope:** self-service registration, the identity layer, tenant bootstrap, and
every path a new account reaches.
**Target:** production project `ncdujvdgqtaunuyigflp`.
**Date:** 2026-08-07.
**Method:** 4 parallel finders over the codebase, then 10 parallel adversarial
verifiers. Every finding below survived a live production check or a
line-by-line re-read. Findings that failed verification are in
[Refuted](#refuted--do-not-re-investigate).

**Remediation plan:** `docs/plans/2026-08-08-account-creation-security-plan.md`
**Dashboard work:** `docs/SUPABASE_AUTH_HARDENING_CHECKLIST.md`

---

## Trigger for this audit

The user saw a live card-testing attack at another company. Bots made thousands
of accounts and used the product as a free card-validation oracle. The user
asked four questions. Here are the measured answers.

| Question | Verified answer |
|---|---|
| Can bots make thousands of accounts? | **Yes.** No CAPTCHA, no invite gate, no bot defense. |
| Can they authorize many cards without a purchase? | **No.** This codebase has no card-tokenizing endpoint. See [Refuted](#refuted--do-not-re-investigate). |
| Is there IP throttling? | **No** application-layer throttle exists. |
| Is there email validation? | **No.** Auto-confirm is ON in production. |

### Measured production state, 2026-08-07

Of 72 real (non-`test.com`) email signups, 71 show `email_confirmed_at` set.
Only **3** ever had a confirmation email queued. 53 confirmed within 2 seconds
of `created_at`. A human cannot open an inbox in 2 seconds.
**Email verification does not gate account creation today.**

Other measurements:

- 154 of 280 accounts use `test.com` (RFC 2606 reserved, non-deliverable), all
  unconfirmed. They account for every signup burst window found. This looks
  like the E2E suite. Confirm before you delete them.
- 169 of 280 accounts (60%) never joined a restaurant.
- 226 accounts use the `email` provider. 54 use `google`.
- One user owns 19 restaurants. One owns 15. This is **legitimate** —
  `stripe-subscription-checkout/index.ts:168-176` has a volume-discount ladder
  at 3, 6, and 11+ locations.

---

## Findings

| # | Severity | Title | Location | Confidence |
|---|---|---|---|---|
| 1 | CRITICAL | Any user can self-grant `owner` on any restaurant | `user_restaurants` RLS | 10/10 |
| 2 | HIGH | An owner can self-upgrade their subscription tier | `restaurants` RLS | 9/10 |
| 3 | HIGH | Unauthenticated cross-tenant POS hijack (Square) | `square-oauth` | 9/10 |
| 4 | HIGH | Unauthenticated cross-tenant POS hijack (Clover) | `clover-oauth` | 9/10 |
| 5 | HIGH | Auth bypass on a missing header | `shift4-sync-data` | 9/10 |
| 6 | HIGH | Raw invitation token in the logs | `validate-invitation` | 9/10 |
| 7 | HIGH | No email verification, no bot defense | `Auth.tsx` / Auth settings | 9/10 |
| 8 | MEDIUM | `get_users_by_ids` returns any email to `anon` | RPC grant | 8/10 |
| 9 | MEDIUM | Unbounded tenant and trial creation | `create_restaurant_with_owner` | 9/10 |
| 10 | MEDIUM | Cross-tenant notification trigger (IDOR) | 2 edge functions | 8/10 |
| 11 | MEDIUM | AI-cost functions have no subscription check | 10 edge functions | 8/10 |
| 12 | LOW | No password policy at signup | `Auth.tsx` | 8/10 |

---

### Vuln 1 — CRITICAL — Any user can self-grant `owner` on any restaurant

**Location:** `supabase/migrations/20250915210020_774bc2c1-abb6-4f03-b10f-5cfc85e9b772.sql:61-64`
**Category:** `rls_privilege_escalation`

`public.user_restaurants` has two permissive INSERT policies. Their effective OR
reduces to `with_check: (user_id = auth.uid())`. Neither checks `role` or
`restaurant_id`. The RESTRICTIVE guard `"Prevent self-escalation to privileged
roles"` has `cmd = 'UPDATE'`, so it never applies to INSERT.

Live production evidence:

```
policyname: "Owners can manage restaurant associations"
  permissive: PERMISSIVE  cmd: ALL
  with_check: ((user_id = auth.uid()) OR is_restaurant_owner(restaurant_id, auth.uid()))
policyname: "Users can insert their own restaurant associations"
  permissive: PERMISSIVE  cmd: INSERT
  with_check: (user_id = auth.uid())
policyname: "Prevent self-escalation to privileged roles"
  permissive: RESTRICTIVE  cmd: UPDATE      <-- UPDATE only
  with_check: (is_restaurant_owner(restaurant_id, auth.uid())
               OR ((role = ANY (ARRAY['staff','kiosk']))
                   AND ((role_id IS NULL) OR (role_id = builtin_role_id_for(role)))))
```

`pg_trigger` shows one trigger, `user_restaurants_sync_role_id`, `BEFORE UPDATE`
only. `has_table_privilege('authenticated','public.user_restaurants','INSERT')`
returns `true`.

**Exploit:** Any signed-up user runs this through PostgREST.

```sql
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES (auth.uid(), '<victim restaurant_id>', 'owner');
```

The forged row satisfies `is_restaurant_owner()`. **113 policy definitions**
across the migration history depend on that function. The attacker gains owner
access to the victim's P&L, payroll, bank connections, and inventory. They then
pass the `FOR ALL` policy on `user_restaurants` and can delete the real owner's
membership row.

**Known:** `supabase/migrations/20260730180000_close_role_id_self_escalation.sql:37-40`
documents this exact gap and says the team deferred it. It is still open.

---

### Vuln 2 — HIGH — An owner can self-upgrade their subscription tier

**Location:** `supabase/migrations/20250916223011_7793a7c0-1807-4a7e-b125-c458b98bd032.sql:56-65`
**Category:** `broken_access_control`

The policy `"Owners and managers can update their restaurants"` is `FOR UPDATE`
with `with_check: null`. Postgres then reuses `USING` for the new row. `USING`
tests only membership and role, keyed on `restaurants.id`, which an UPDATE never
changes. So the policy validates *who* writes, never *which columns*.

`public.restaurants` holds `subscription_tier`, `subscription_status`,
`subscription_period`, `subscription_ends_at`, `subscription_cancel_at`,
`trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`,
`stripe_subscription_customer_id`.

The only trigger is `update_restaurants_updated_at`, a timestamp stamper.

**Exploit:** Every self-serve signup becomes owner of its own restaurant.

```js
supabase.from('restaurants')
  .update({ subscription_tier: 'pro', subscription_status: 'active' })
  .eq('id', restaurantId)
```

The live definition of `has_subscription_feature()` reads these columns
directly. The write unlocks `ai_assistant`, `ops_inbox`, `weekly_brief`,
`financial_intelligence`, `inventory_automation`, `scheduling`, and
`multi_location_dashboard`.

For any restaurant with `stripe_subscription_id IS NULL`, no webhook ever
reconciles it. The free upgrade persists forever.

---

### Vuln 3 — HIGH — Unauthenticated cross-tenant POS hijack (Square)

**Location:** `supabase/functions/square-oauth/index.ts:34-47, 162, 288-294`
**Category:** `broken_authz`

`verify_jwt = false` (`supabase/config.toml:61-62`). The handler calls
`supabase.auth.getUser(token)` only when `action === 'authorize'`. The
`callback` branch has no guard.

Line 162 reads `const restaurantId = state`. `state` is the raw restaurant id,
not a server-issued nonce. No pending-state table exists in any migration.
Line 288 upserts `square_connections` with the service-role client, which
bypasses RLS.

**Exploit:** An attacker with no EasyShiftHQ account completes Square consent
with their own merchant account. They POST straight to the function URL.

```json
{"action":"callback","code":"<their code>","state":"<victim restaurant_id>"}
```

Lines 362-364 then fire `square-sync-data` with `action: initial_sync`. The
attacker's sales data flows into the victim's `unified_sales` table and P&L. The
rogue connection stays in the sync rotation.

This is integrity poison, not data theft. The victim's real connection survives,
because the unique key is `(restaurant_id, merchant_id)`.

---

### Vuln 4 — HIGH — Unauthenticated cross-tenant POS hijack (Clover)

**Location:** `supabase/functions/clover-oauth/index.ts:34-45, 195-196, 343-349`
**Category:** `broken_authz`

Identical pattern to Vuln 3. `verify_jwt = false`
(`supabase/config.toml:103-104`). Auth runs only on `authorize`. Line 195 does
`JSON.parse(state).restaurantId` on attacker-supplied JSON. Line 343 upserts
`clover_connections` with the service role.

**Worse than Vuln 3:** lines 378-397 auto-register a Clover webhook for the
victim restaurant. That gives the attacker a persistent push channel into the
victim's data pipeline, not one sync.

---

### Vuln 5 — HIGH — Auth bypass on a missing header

**Location:** `supabase/functions/shift4-sync-data/index.ts:102-107, 222`
**Category:** `broken_authz`

`verify_jwt = false` (`supabase/config.toml:160-161`). `authenticateUser()`
opens with `if (!authHeader) return null;` instead of a throw. The
`user_restaurants` role check lives **inside** that function, after the early
return. Line 222 stores the result as `userId` and never checks it. `userId`
feeds optional logging only.

Sibling functions get this right:

- `supabase/functions/toast-sync-data/index.ts:371-374`
- `supabase/functions/sling-sync-data/index.ts:259-262`

Both return 401 on a missing header.

**Exploit:** An anonymous caller POSTs with no `Authorization` header.

```json
{"restaurantId":"<uuid>","action":"initial_sync"}
```

The function decrypts that restaurant's stored Shift4 credentials server-side,
calls the real Shift4 API, and writes sales rows and sync state. The response
returns counts only. This is an unauthorized privileged action, not
exfiltration. The practical attacker population is anyone who ever held an
account at that restaurant, because they know the UUID.

---

### Vuln 6 — HIGH — Raw invitation token in the logs

**Location:** `supabase/functions/validate-invitation/index.ts:32`
**Category:** `secret_in_logs`

```ts
console.log('Plain token from URL:', token);
```

This prints the unhashed 32-byte invitation token. The database stores only its
SHA-256 hash. The plaintext should exist only in the outbound email. Line 77
also logs the plaintext email.

**Exploit:** The token is the only secret that gates `signup-with-invitation`.
That function calls `admin.updateUserById(existingUser.id, { password, ... })`
at `supabase/functions/signup-with-invitation/index.ts:72-82`. It overwrites the
password of an **existing** account.

Verification found no single-use marker. `signup-with-invitation` never writes
`invitations.status`. Only `accept-invitation/index.ts:174-183` does, and the
frontend calls it after a separate manual sign-in. So the token stays `pending`
and replayable for up to its full 7-day life.

Anyone with log or log-drain access reads the token and the email, then takes
over that account.

**Scope:** Exploitation needs log access. This is an insider or lateral-movement
finding, not remote. A grep of all other edge functions found no further
plaintext-secret logs. Everything else logs a boolean, a length, or a truncated
prefix.

---

### Vuln 7 — HIGH — No email verification, no bot defense

**Location:** `src/pages/Auth.tsx:131-158` → `src/hooks/useAuth.tsx:170-194`
**Category:** `authn_bot_defense_missing`

`signUp` calls `supabase.auth.signUp` directly from the public form. A
repo-wide grep for `captcha`, `turnstile`, `hcaptcha`, `recaptcha` returns zero
hits. No disposable-email blocklist. No email normalization. No invite gate.

Production auto-confirm is ON. See [Measured production state](#measured-production-state-2026-08-07).

The client never reads `email_confirmed_at`. `handleAuthStateChange`
(`src/hooks/useAuth.tsx:51-62`) treats any session as fully logged in.

**Exploit:** A script drives `supabase.auth.signUp` for thousands of throwaway
addresses, optionally `+`-aliased against one mailbox. Each account is instantly
confirmed. It can then call `create_restaurant_with_owner` (Vuln 9) and reach
every ungated AI endpoint (Vuln 11).

---

### Vuln 8 — MEDIUM — `get_users_by_ids` returns any email to `anon`

**Location:** `supabase/migrations/20260104000001_add_get_users_by_ids_function.sql:1-25`
**Category:** `broken_authz_rpc`

The function is `SECURITY DEFINER`. It selects `id, email,
raw_user_meta_data->>'full_name'` from `auth.users` for arbitrary
caller-supplied UUIDs. It has no `auth.uid()` check and no membership check. The
migration grants EXECUTE to `authenticated` but never revokes the default
`PUBLIC` grant.

Live check: `has_function_privilege('anon', ...)` returns `true`. A control
comparison against `assign_membership_role`, which does revoke, returns `false`.
This proves the grant state is real. `public` is API-exposed
(`supabase/config.toml:7`), so it is callable as
`POST /rest/v1/rpc/get_users_by_ids`.

**Exploit:** The realistic path is authenticated, not anonymous. Verification
found no anon-reachable source of a valid `auth.users.id`. `profiles` has an
explicit `"Deny anonymous access to profiles"` policy. But any low-privilege
authenticated user who picks up a teammate UUID from normal in-app data can
replay it. The function has no restaurant scope, so it returns emails for users
**outside** their tenant.

---

### Vuln 9 — MEDIUM — Unbounded tenant and trial creation

**Location:** `supabase/migrations/20260129000000_add_subscription_system.sql:367-420`
**Category:** `missing_authz_limit`

`create_restaurant_with_owner` is `SECURITY DEFINER`, callable by
`authenticated`. It has no cap, no cooldown, and no email-confirmation check.
Each call writes a `restaurants` row with `subscription_tier = 'growth'`,
`subscription_status = 'trialing'`, and a 14-day trial. It then grants the
caller `owner`.

The only guard is `pg_advisory_xact_lock` for a 5-second same-name dedup. A
counter appended to the name defeats it. The client-side `canCreateRestaurant`
flag in `src/contexts/RestaurantContext.tsx:96` does not constrain the RPC.

**Warning: do not set a low cap.** Live data shows users who own 19 and 15
restaurants. That is legitimate multi-unit use.

---

### Vuln 10 — MEDIUM — Cross-tenant notification trigger (IDOR)

**Location:** `supabase/functions/send-time-off-notification/index.ts` and
`supabase/functions/send-shift-notification/index.ts:229-241`
**Category:** `idor`

Both use a service-role client, which bypasses RLS.

`send-time-off-notification` has no auth check at all. A grep for
`getUser|user_restaurants|authHeader|role` returns one hit, and it is an
**outbound** header at line 293.

`send-shift-notification` does require a JWT (lines 107-120). But the
`created`/`modified` path at lines 229-241 fetches the shift by `shiftId` alone.
Its own sibling branch at lines 136-149 has the ownership check, with a comment
that explains it closes this exact bug class. The fix never reached the primary
path.

**Impact limits, stated honestly:** No victim data returns to the attacker. The
responses carry only `{ success, recipients: <count> }` and
`{ message, emailId }`. Both ids are `gen_random_uuid()` primary keys, so the
attacker must already know the id. This is a cross-tenant action trigger, not
exfiltration.

---

### Vuln 11 — MEDIUM — AI-cost functions have no subscription check

**Locations:** `supabase/functions/` — `process-receipt`, `enhanced-ocr`,
`grok-ocr`, `ai-categorize-pos-sales`, `ai-categorize-transactions`,
`enhance-product-ai`, `grok-recipe-enhance`, `process-expense-invoice`,
`process-bank-statement`, `process-asset-document`
**Category:** `missing_authz_spend`

Only `generate-weekly-brief-worker/index.ts:79` calls
`has_subscription_feature()`. Every other AI function listed calls OpenRouter or
Grok with no tier check.

`ai-chat-stream` checks `user_restaurants.role` but never calls
`has_subscription_feature` server-side. The Pro gate lives only in
`src/components/ai-chat/AiChatPanel.tsx:41`, which is client-side and
bypassable.

**Exploit:** Any authenticated member of any restaurant, on any tier, calls
these functions directly and spends the OpenRouter budget. Combined with Vuln 7,
a bot fleet reaches them with no payment and no email proof.

**This is the real dollar-cost exposure** — more so than the Stripe path.

**Correction to the first report:** A growth trial does **not** unlock the AI
features. `ai_assistant`, `ops_inbox`, and `weekly_brief` require `pro` exactly.
The exposure is that these endpoints have no gate at all.

---

### Vuln 12 — LOW — No password policy at signup

**Location:** `src/pages/Auth.tsx:323-331`
**Category:** `weak_password_policy`

The signup password field has no `minLength`, no regex, and no zod schema. It
has only `required`. Compare `src/pages/ResetPassword.tsx:13-17`, which requires
8+ characters with mixed case and a digit.

The Supabase security advisor also reports **Leaked Password Protection
Disabled**, so breached passwords are accepted.

---

## Refuted — do not re-investigate

| Claim | Verdict | Why |
|---|---|---|
| **This app is a card-testing oracle** | **REFUTED (9/10)** | A grep for `SetupIntent`, `PaymentIntent`, `paymentMethods.attach`, `confirmCardSetup`, `confirmCardPayment`, `CardElement`, `PaymentElement`, `createPaymentMethod`, `tokens.create` returns **zero matches**. All card entry happens on Stripe-hosted Checkout, behind Stripe Radar. There is no `$0` authorization path. The backend never sees a card number and never returns a live/dead signal. |
| Stripe webhooks are forgeable | REFUTED | All three verify the signature with `constructEventAsync` before they trust the body: `stripe-subscription-webhook/index.ts:49`, `stripe-invoice-webhook/index.ts:39`, `stripe-financial-connections-webhook/index.ts:41`. The `test_local` bypass is gated on a deployment-controlled env check. |
| `toast-oauth` callback hijack | REFUTED (7/10) | Same code pattern as Vulns 3-4. But `verify_jwt` defaults to `true`, and the callback writes columns the January 2026 Standard-API migration deleted (`20260106120000_toast_standard_api_migration.sql:6-44`). The write fails. Delete it as dead code. |
| `square-webhooks` fail-open signature | REFUTED (7/10) | The fail-open control flow is real (`index.ts:31, 77-80`). But every handler re-fetches from Square's live API with the tenant's own OAuth token before a write (`index.ts:239, 427, 467`). No field from a forged body reaches the database. |
| `revel-bulk-sync` anonymous trigger | REFUTED (7/10) | Reduces to a forced sync (excluded as resource use) plus a boolean connection-exists oracle, gated behind an unguessable UUID with no leak path. |
| Invitation flows allow tenant escalation | REFUTED | `accept-invitation/index.ts:104-106` hard-checks `user.email !== invitation.email` and re-derives `role` server-side. `signup-with-invitation` matches token and email together. Tokens are 256-bit and hashed at rest. |
| Signup trigger reads attacker metadata | REFUTED | `handle_new_user()` (`20250915204511_...sql:49-60`) is `SECURITY DEFINER` with `search_path` pinned. It reads only `full_name` from `raw_user_meta_data`. It writes no role and no tenant. **Use this function as the template for new RPCs.** |

---

## Systemic findings from the Supabase advisor feed

The advisor returned 382 security lints. **No ERROR-level items exist.** All are
WARN or INFO.

| Item | Count | Link |
|---|---|---|
| Public can execute SECURITY DEFINER function (`anon`) | 146 | [lint 0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) |
| Signed-in users can execute SECURITY DEFINER function | 153 | [lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| Function search path mutable | 73 | [lint 0011](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) |
| Extension in public | 4 | [lint 0014](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) |
| RLS enabled, no policy | 5 | [lint 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) |
| Leaked password protection disabled | 1 | [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |

Most of the 146 `anon`-executable functions self-gate on `auth.uid()`, so they
are not exploitable today. That safety relies on every author who remembers.
`supabase/migrations/20260507120200_users_in_trial_email_window_rpc.sql:96-97`
shows the correct pattern.

**Also noted:** `profiles.role` is self-updatable and vestigial. No policy and
no function reads it. Delete it before a future feature trusts it.
