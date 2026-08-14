# Account Creation Security Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Each task below is one session and one PR.** Do not batch tasks. Start
> every session with the `development-workflow` skill (`/dev`).
> Read the evidence for a task in the audit before you write code.

**Goal:** Close the 12 confirmed findings from the August 2026 account-creation
security audit.
**Architecture:** Fix each hole at the layer that owns it. RLS holes get a
migration and a pgTAP test. Edge-function holes get a server-side check that
matches the pattern in `toast-sync-data/index.ts:371-374`. Client holes get a
zod schema and a Vitest test.
**Tech Stack:** Supabase PostgreSQL (pgTAP), Deno edge functions, React,
TypeScript, Vitest, Playwright.
**Audit / evidence doc:** `docs/SECURITY_AUDIT_ACCOUNT_CREATION_2026-08.md`
**Dashboard work (user, not agents):** `docs/SUPABASE_AUTH_HARDENING_CHECKLIST.md`

---

## Track split

| Track | Owner | Content |
|---|---|---|
| **A — code** | Claude Code sessions | Tasks 1-11 below. Migrations, edge functions, frontend. |
| **B — hosted settings** | Jose, in the Supabase dashboard | `docs/SUPABASE_AUTH_HARDENING_CHECKLIST.md`. Confirm email, CAPTCHA, leaked-password protection, auth rate limits. |

**Two hard dependencies, and they point in opposite directions:**

1. Task 8 (signup hardening) needs Track B step **B1** (Confirm email) first.
2. Track B step **B2** (CAPTCHA **enforcement**) needs Task 8 **deployed**
   first. Reverse of what an earlier version of this plan said.

Warning: do not switch on CAPTCHA enforcement before the client sends a token.
`src/hooks/useAuth.tsx:125` and `:177` call `signInWithPassword` and `signUp`
with no `captchaToken`. `src/pages/AcceptInvitation.tsx:163-166` does the same.
Enforcement before the deploy breaks every password sign-up and sign-in.

B2 therefore splits in two. Provision the provider and the site key at any
time. Switch on enforcement only after Task 8 ships.

Every other task is independent. Do them in any order, but keep the severity
order below if you have no other reason to reorder.

---

## Order

| Order | Task | Severity | Type |
|---|---|---|---|
| 1 | `user_restaurants` INSERT guard | CRITICAL | migration |
| 2 | `restaurants` subscription column guard | HIGH | migration |
| 3 | POS OAuth callback authz (Square + Clover) | HIGH | edge fn |
| 4 | `shift4-sync-data` missing-header bypass | HIGH | edge fn |
| 5 | Invitation token log + single use | HIGH | edge fn |
| 6 | AI-cost subscription gates | MEDIUM | edge fn |
| 7 | Notification IDOR | MEDIUM | edge fn |
| 8 | Signup hardening (CAPTCHA, verify, password) | HIGH | frontend |
| 9 | `get_users_by_ids` revoke and scope | MEDIUM | migration |
| 10 | Cap `create_restaurant_with_owner` | MEDIUM | migration |
| 11 | Systemic: REVOKE sweep + `search_path` pin | MEDIUM | migration |

---

### Task 1: Block self-grant of `owner` on `user_restaurants` — DONE

Audit: Vuln 1. Shipped in
[PR #725](https://github.com/toyiyo/nimble-pnl/pull/725).

Design: `docs/superpowers/specs/2026-08-08-user-restaurants-insert-guard-design.md`.
Plan: `docs/superpowers/plans/2026-08-08-user-restaurants-insert-guard-plan.md`.

**Files:**
- Create: `supabase/migrations/20260808100000_restrict_user_restaurants_insert.sql`
- Test: `supabase/tests/user_restaurants_insert_guard.test.sql`
- Delete: the dead `__inviteCollaborator` helper in
  `tests/helpers/e2e-supabase.ts`

**The shipped policy differs from the draft below it.** The draft mirrored the
UPDATE guard and allowed `role IN ('staff','kiosk')`. That branch is wrong for
INSERT. For UPDATE it permits a **downgrade** of a membership that already
exists. For INSERT it permits a stranger to **join** a tenant they have no
relationship with, and many tenant policies treat any `user_restaurants` row as
authorization.

Research answered the self-join question: **no product flow needs the
permissive INSERT grant at all.** `src/` holds 7 `.select(` and 2 `.delete(`
call sites on the table and zero `.insert(`. All five real writers bypass RLS —
`create_restaurant_with_owner` is `SECURITY DEFINER` owned by `postgres`, and
`accept-invitation`, `scim-v2`, and `create-kiosk-service-account` use the
service-role key.

- [x] **Step 1: Write the pgTAP test first.** 11 cases. Every deny case pins
      SQLSTATE `42501`. `UNIQUE(user_id, restaurant_id)` raises `23505` before
      RLS raises `42501`, so a bare `throws_ok` passes even with the guard
      deleted.
- [x] **Step 2: Drop the permissive policy and add a RESTRICTIVE one.**

      ```sql
      DROP POLICY IF EXISTS "Users can insert their own restaurant associations"
        ON public.user_restaurants;

      DROP POLICY IF EXISTS "Only owners can insert restaurant associations"
        ON public.user_restaurants;

      CREATE POLICY "Only owners can insert restaurant associations"
        ON public.user_restaurants
        AS RESTRICTIVE
        FOR INSERT
        TO public
        WITH CHECK (is_restaurant_owner(restaurant_id, auth.uid()));
      ```

      Effective INSERT check afterwards:
      `is_restaurant_owner(restaurant_id, auth.uid())`.
- [ ] **Step 4: Run `npm run test:db`.** All pgTAP suites must pass, not only
      the new one. 113 policies depend on `is_restaurant_owner()`.
- [ ] **Step 5: Run the permissions E2E suite.** `npm run test:e2e`.
- [ ] **Step 6: Remove the stale deferral note** at
      `supabase/migrations/20260730180000_close_role_id_self_escalation.sql:37-40`
      — add a follow-up comment in the new migration that points back to it.

---

### Task 2: Stop owners from writing their own subscription tier — DONE

Audit: Vuln 2. Shipped in
[PR #736](https://github.com/toyiyo/nimble-pnl/pull/736).
Retrospective in [PR #737](https://github.com/toyiyo/nimble-pnl/pull/737).

Design: `docs/superpowers/specs/2026-08-09-restaurant-billing-column-guard-design.md`.
Plan: `docs/superpowers/plans/2026-08-09-restaurant-billing-column-guard-plan.md`.

**Files, all 16 that PR #736 changed.** The guard needs more than a migration.
A server-side block alone leaves the client free to send a write that now
fails, so the task also added a type barrier and a service-role test path.

*Server guard:*
- Create: `supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql`
  (the draft below named `20260807000001_...`; the shipped file uses the later
  timestamp)
- Create: `supabase/tests/restaurant_billing_columns.test.sql`
- Change: `supabase/tests/20260129000000_subscription_system.sql`

*Client type barrier — blocks the write before it reaches the database:*
- Change: `src/hooks/useRestaurants.tsx` (the `RestaurantUpdate` type)
- Change: `src/pages/RestaurantSettings.tsx`
- Change: `src/components/settings/GeofenceSettings.tsx`
- Create: `tests/unit/types/restaurantUpdateBillingColumns.test.ts`

*Test path — the browser role can no longer set a tier, so E2E needs
`service_role`:*
- Create: `tests/helpers/e2e-service-role.ts`
- Create: `tests/unit/e2e-service-role.test.ts`
- Create: `tests/e2e/subscription-tier-guard.spec.ts`
- Change: `tests/helpers/e2e-supabase.ts`

*CI gate — no job compiled `src` before this task, so the type barrier gated
nothing:*
- Create: `tsconfig.typetest.json`
- Change: `.github/workflows/unit-tests.yml`
- Change: `package.json`

*Design record:*
- Create: `docs/superpowers/specs/2026-08-09-restaurant-billing-column-guard-design.md`
- Create: `docs/superpowers/plans/2026-08-09-restaurant-billing-column-guard-plan.md`

**The shipped guard blocks two writer shapes, not one.** The draft below says
"the writer is not the service role". The trigger tests two things in order.
First it checks `current_user IN ('authenticated', 'anon')`. Then, for any
other role, it reads `request.jwt.claims ->> 'role'`.

That second test matters. Inside a `SECURITY DEFINER` function, `current_user`
becomes the function owner, but the JWT claim still says `authenticated`. The
first test alone would let such a function through. The second test stops it.

The second test also blocked a fixture `UPDATE` in an existing pgTAP test. The
harness runs as `postgres`, so the first test was false. But the harness kept
an `authenticated` JWT claim from an earlier assertion. That claim made the
second test true. The fix clears the claim before each guarded write. It
restores the claim after, because the assertions below need `auth.uid()`.

**A pre-merge audit found no regression.** No production `SECURITY DEFINER`
function updates `public.restaurants`. `create_restaurant_with_owner` only
INSERTs, and the trigger is `BEFORE UPDATE`. All 15 `cron.job` entries run as
`postgres` with no JWT claim. All 10 Stripe edge-function writes use
`service_role`. The 3 client write sites pass explicit column lists.

<details>
<summary>Original steps, kept for the record</summary>

- [x] **Step 1: Write the pgTAP test.** Cases:
      - An owner UPDATE that changes `subscription_tier` **fails**.
      - An owner UPDATE that changes only `name`, `address`, or `timezone`
        **succeeds**.
      - A service-role UPDATE that changes `subscription_tier` **succeeds** —
        the Stripe webhooks need this.
      - Repeat for `subscription_status`, `subscription_period`,
        `subscription_ends_at`, `subscription_cancel_at`, `trial_ends_at`,
        `stripe_customer_id`, `stripe_subscription_id`,
        `stripe_subscription_customer_id`.
- [x] **Step 2: Add a BEFORE UPDATE trigger** on `public.restaurants`. Raise an
      exception when any billing column changes and the writer is not the
      service role. Prefer a trigger over a policy split. A policy cannot
      compare `OLD` to `NEW`.
- [x] **Step 3: Confirm the writer test works in this project.** Test both
      `auth.role()` and `current_setting('request.jwt.claims', true)` inside
      pgTAP. Migrations run as `postgres`, so the trigger must allow `postgres`
      too or later migrations break.
- [x] **Step 4: Grep every caller.** Confirm no frontend or non-webhook edge
      function writes these columns. Search for `subscription_tier`,
      `trial_ends_at`, and `stripe_customer_id`.
- [x] **Step 5: Run `npm run test:db` and the subscription E2E flow.**

</details>

---

### Task 3: Require ownership on the POS OAuth callbacks

Audit: Vulns 3 and 4. One PR — the two functions share the bug.

**Files:**
- Modify: `supabase/functions/square-oauth/index.ts`
- Modify: `supabase/functions/clover-oauth/index.ts`
- Create: `supabase/migrations/20260807000002_add_oauth_state_nonces.sql`
- Delete: `supabase/functions/toast-oauth/` (dead code — see the audit's refuted list)

- [ ] **Step 1: Add an `oauth_state_nonces` table.** Columns: `state` (text,
      primary key, from `gen_random_uuid()`), `restaurant_id`, `user_id`,
      `provider`, `created_at`, `expires_at` (10 minutes), `consumed_at`. Enable
      RLS and add no policy. Only the service role touches it.
- [ ] **Step 2: In the `authorize` branch of both functions,** insert a nonce
      row after the existing auth check passes. Return that nonce as `state`.
      Stop putting `restaurantId` in `state`.
- [ ] **Step 3: In the `callback` branch of both functions,** look up the
      nonce. Reject when it is missing, expired, or already consumed. Read
      `restaurant_id` from the row, never from the request. Mark it consumed in
      the same transaction.
- [ ] **Step 4: Do not remove `verify_jwt = false`.** The OAuth provider
      redirects the browser back with no JWT. The nonce is the control.
- [ ] **Step 5: Delete `toast-oauth`.** Its callback writes columns that
      `20260106120000_toast_standard_api_migration.sql:6-44` dropped. Remove
      the `[functions.toast-oauth]` block from `supabase/config.toml` too.
- [ ] **Step 6: Test the full connect flow** for Square and Clover against a
      sandbox merchant. Verify the old `state = <restaurant_id>` payload now
      returns an error.

---

### Task 4: Fix the missing-header auth bypass in `shift4-sync-data`

Audit: Vuln 5. Small and self-contained.

**Files:**
- Modify: `supabase/functions/shift4-sync-data/index.ts`

- [ ] **Step 1: Add the header guard before the call,** to match
      `supabase/functions/toast-sync-data/index.ts:371-374`:

      ```ts
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return jsonResponse({ error: 'Missing authorization' }, 401);
      }
      ```

- [ ] **Step 2: Change `authenticateUser` to throw, not return null,** on a
      missing header. The `return null` at line 102 is the root cause. A
      function named `authenticateUser` must never return a success-shaped value
      for an unauthenticated caller.
- [ ] **Step 3: Grep every other edge function for `return null` inside an auth
      helper.** Fix any sibling with the same shape in this PR.
- [ ] **Step 4: Verify.** POST with no header must return 401. POST as a
      `staff` member must return 403. POST as an owner must still sync.

---

### Task 5: Stop the invitation-token leak and make tokens single-use

Audit: Vuln 6.

**Files:**
- Modify: `supabase/functions/validate-invitation/index.ts`
- Modify: `supabase/functions/signup-with-invitation/index.ts`
- Create: a migration that adds `invitations.signup_claimed_at timestamptz`

**Warning: do not set `status = 'accepted'` in `signup-with-invitation`.** The
create-account path is two calls, not one. `signup-with-invitation` only makes
the auth account (`src/pages/AcceptInvitation.tsx:211-219`). The user then
signs in, and `AcceptInvitation.tsx:129` calls `accept-invitation`, which
selects `.eq('status', 'pending')` (`accept-invitation/index.ts:71`) before it
inserts the membership row. An early `accepted` makes that second call reject
the token, and the new user never joins the restaurant.

Claim the invitation with a **separate** column instead. `status` stays
`pending`, so `accept-invitation` still works.

- [ ] **Step 1: Delete the plaintext logs.** Remove
      `console.log('Plain token from URL:', token)` at line 32. Remove the
      plaintext email log at line 77. Log a boolean or a hash prefix if you
      need the trace.
- [ ] **Step 2: Add `invitations.signup_claimed_at timestamptz` (nullable).**
      One column. No change to `status`.
- [ ] **Step 3: Claim the row BEFORE the password mutation.** Order matters.
      `signup-with-invitation/index.ts:73` calls
      `admin.updateUserById` to set the password on an account that already
      exists. Two concurrent redemptions of a leaked token can both validate
      the pending invitation and both change the password. A conditional
      status update placed **after** the mutation cannot undo the loser's
      password write, so the live password can belong to a request the
      function reported as rejected.

      Claim first:

      ```ts
      const { data: claimed } = await supabaseAdmin
        .from('invitations')
        .update({ signup_claimed_at: new Date().toISOString() })
        .eq('id', invitation.id)
        .is('signup_claimed_at', null)
        .eq('status', 'pending')
        .select('id');

      if (!claimed?.length) return errorResponse('Invalid or expired invitation', 400);
      ```

      The row lock inside that one UPDATE serializes the two callers. Exactly
      one gets a row back.
- [ ] **Step 4: Release the claim on failure.** If `updateUserById` or
      `createUser` fails, set `signup_claimed_at` back to `NULL`. A real
      invitee must be able to retry after a transient error.
- [ ] **Step 5: Reject an already-claimed token in `validate-invitation`,**
      so the UI does not show a form that cannot succeed.
- [ ] **Step 6: Audit the remaining logs in both files** for any other secret
      or PII.
- [ ] **Step 7: Test.** Three cases.
      - Redeem an invitation through the create-account path, then replay the
        same token. The replay must fail.
      - After `signup-with-invitation` succeeds, `accept-invitation` must still
        grant the membership. This is the regression the warning above
        describes.
      - Fire two concurrent `signup-with-invitation` calls with the same token
        and different passwords. Exactly one must succeed, and the live
        password must be the winner's.

---

### Task 6: Gate the AI-cost edge functions on the subscription tier

Audit: Vuln 11. This is the largest real dollar exposure.

**Files:**
- Modify: `supabase/functions/process-receipt/index.ts`
- Modify: `supabase/functions/enhanced-ocr/index.ts`
- Modify: `supabase/functions/grok-ocr/index.ts`
- Modify: `supabase/functions/ai-categorize-pos-sales/index.ts`
- Modify: `supabase/functions/ai-categorize-transactions/index.ts`
- Modify: `supabase/functions/enhance-product-ai/index.ts`
- Modify: `supabase/functions/grok-recipe-enhance/index.ts`
- Modify: `supabase/functions/process-expense-invoice/index.ts`
- Modify: `supabase/functions/process-bank-statement/index.ts`
- Modify: `supabase/functions/process-asset-document/index.ts`
- Modify: `supabase/functions/ai-chat-stream/index.ts`
- Create: `supabase/functions/_shared/requireSubscriptionFeature.ts`

- [ ] **Step 1: Decide the feature key for each function first.** Write the map
      into the plan before you touch code. `has_subscription_feature()` (see
      `20260217210000_gate_ops_weekly_brief_pro.sql:10-101`) knows
      `financial_intelligence`, `inventory_automation`, `scheduling`,
      `ai_alerts`, `multi_location_dashboard`, `recipe_profitability`,
      `ai_assistant`, `ops_inbox`, `weekly_brief`. Add a key if none fits.
- [ ] **Step 2: Write the shared helper.** Follow the call pattern already used
      at `generate-weekly-brief-worker/index.ts:79`. It must return a 402 or 403
      JSON response, never throw an unhandled error.
- [ ] **Step 3: Add the check to each function,** after the auth check and
      before the first AI call.
- [ ] **Step 4: Add the server-side gate to `ai-chat-stream`.** Today the Pro
      gate lives only at `src/components/ai-chat/AiChatPanel.tsx:41`, which is
      client-side and bypassable.
- [ ] **Step 5: Check the free-tier product promise before you ship.** Some of
      these run receipt OCR, which may be a free-tier feature. Confirm the
      intended tier with the product owner. Do not lock out paying customers.
- [ ] **Step 6: Test each function** on a `free`, a `growth`, and a `pro`
      restaurant.

---

### Task 7: Add tenant checks to the notification functions

Audit: Vuln 10.

**Files:**
- Modify: `supabase/functions/send-time-off-notification/index.ts`
- Modify: `supabase/functions/send-shift-notification/index.ts`

- [ ] **Step 1: Add a full auth check to `send-time-off-notification`.** It has
      none today. Read the JWT, resolve the request's `restaurant_id`, then
      check `user_restaurants`.
- [ ] **Step 2: Add the ownership check to the `created`/`modified` path** of
      `send-shift-notification` at lines 229-241. Copy the check its own sibling
      branch already has at lines 136-149, which returns
      `errorResponse('Access denied', 403)`.
- [ ] **Step 3: Extract the check into one helper** used by both branches, so
      the fix cannot drift out of one path again.
- [ ] **Step 4: Test.** A member of restaurant A must get 403 for a shift or a
      request that belongs to restaurant B.

---

### Task 8: Harden the signup form

Audit: Vulns 7 and 12.

> **BLOCKED until Track B step B1 is done**, and until B2 provisions the
> CAPTCHA provider and the site key. This code cannot send a token before the
> key exists.
>
> **Warning: B2 enforcement must stay OFF until this task deploys.** The switch
> is the last step, not the first. See "Track split" above.

**Files:**
- Modify: `src/pages/Auth.tsx`
- Modify: `src/hooks/useAuth.tsx`
- Modify: `src/pages/AcceptInvitation.tsx`
- Modify: `tests/e2e/helpers/e2e-supabase.ts`
- Create: `src/lib/validation/signupSchema.ts`
- Test: `tests/unit/signupSchema.test.ts`

`src/pages/AcceptInvitation.tsx:163-166` calls `supabase.auth.signInWithPassword`
direct, not through `useAuth`. `/accept-invitation` is a live authentication
path. Miss it, and every existing invitee fails CAPTCHA at the invitation
screen.

- [ ] **Step 1: Write the zod password schema and its Vitest test.** Match
      `src/pages/ResetPassword.tsx:13-17` — 8+ characters, upper, lower, digit.
      Do not invent a different rule. Apply the same schema to
      `src/pages/AcceptInvitation.tsx:468-479`, which allows 6 characters today.
- [ ] **Step 2: Add the CAPTCHA widget to the signup and sign-in forms.** Pass
      the token as `options.captchaToken` to `supabase.auth.signUp` and
      `signInWithPassword`.
- [ ] **Step 3: Handle the unconfirmed-email state.** After Track B turns on
      Confirm email, `signUp` returns a session-less result. Show a
      "check your email" screen. Today `handleAuthStateChange`
      (`src/hooks/useAuth.tsx:51-62`) treats any session as fully logged in.
- [ ] **Step 4: Fix the E2E suite.** 154 of 280 production accounts use
      `test.com` and are unconfirmed. Once Confirm email is on, every signup
      test breaks. Change `generateTestUser()` and the sign-up helper to create
      users through the admin API with `email_confirm: true`, or to bypass the
      CAPTCHA with a test secret key.
- [ ] **Step 5: Run the full E2E suite** before you open the PR. Expect
      failures in step 4's absence, and fix them here, not in a follow-up.

---

### Task 9: Revoke and scope `get_users_by_ids`

Audit: Vuln 8.

**Files:**
- Create: `supabase/migrations/20260807000003_scope_get_users_by_ids.sql`
- Test: `supabase/tests/get_users_by_ids_scope.test.sql`
- Check caller: `src/hooks/useTipSplitAuditLog.ts:45`

- [ ] **Step 1: Write the pgTAP test.** `anon` EXECUTE must fail. A user must
      get rows for teammates in a shared restaurant. A user must get **no** row
      for a user outside every shared restaurant.
- [ ] **Step 2: Revoke the default grant.**
      `REVOKE EXECUTE ON FUNCTION public.get_users_by_ids(uuid[]) FROM PUBLIC, anon;`
      Follow the pattern at
      `supabase/migrations/20260802110000_assign_membership_role.sql:223`.
- [ ] **Step 3: Add the tenant scope inside the function.** Return only users
      who share at least one restaurant with `auth.uid()`. Return an empty set,
      not an error, for the rest.
- [ ] **Step 4: Verify the only client caller still works** —
      `src/hooks/useTipSplitAuditLog.ts:45`. Audit-log actors are always
      same-restaurant, so the scope must not break it.

---

### Task 10: Cap tenant and trial creation

Audit: Vuln 9.

**Files:**
- Create: `supabase/migrations/20260807000004_limit_restaurant_creation.sql`
- Test: `supabase/tests/limit_restaurant_creation.test.sql`

- [ ] **Step 1: Read the warning first.** Live users own 19 and 15 restaurants.
      `stripe-subscription-checkout/index.ts:168-176` has a volume-discount
      ladder at 3, 6, and 11+ locations. **Multi-unit ownership is a designed,
      paid use case. Do not cap it at a small number.**
- [ ] **Step 2: Cap only the unpaid case.** Recommended rule: an account with no
      active paid subscription may hold at most 3 restaurants in `trialing`
      status. An account with an active subscription has no cap.
- [ ] **Step 3: Require a confirmed email.** Once Track B step B1 is on, add
      `email_confirmed_at IS NOT NULL` to `create_restaurant_with_owner`.
      Keep this step behind that dependency.
- [ ] **Step 4: Add a cooldown.** The existing
      `pg_advisory_xact_lock(hashtext(auth.uid() || name))` dedups the same name
      for 5 seconds only. A counter in the name defeats it. Add a per-user
      time-window limit instead.
- [ ] **Step 5: Return a clear error the UI can show,** not a raw exception.
      Update `src/contexts/RestaurantContext.tsx` to render it.

---

### Task 11: Systemic — revoke `PUBLIC` and pin `search_path`

Audit: the systemic section. Mechanical and large. Do it last.

**Files:**
- Create: `supabase/migrations/20260807000005_revoke_public_execute_sweep.sql`
- Create: `supabase/migrations/20260807000006_pin_function_search_path.sql`

- [ ] **Step 1: List the targets from the live advisor feed,** not from a repo
      grep. 146 functions are `anon`-executable (lint 0028). 73 have a mutable
      `search_path` (lint 0011).
- [ ] **Step 2: Split into two migrations.** Do not mix the revoke sweep and the
      `search_path` pin. If one breaks production you must revert only that one.
- [ ] **Step 3: For the revoke sweep, classify each function first.** Some must
      stay `anon`-callable — anything the login page, the invitation page, or a
      public marketing route hits. Grep `src/` for every RPC name before you
      revoke it. Write the keep-list into the migration comment.
- [ ] **Step 4: For the `search_path` pin, use `SET search_path = public`** to
      match the correct existing pattern at
      `20250915204511_f5de15c1-57d2-4c60-bd82-0da16bca991a.sql:49-60`.
- [ ] **Step 5: Drop the vestigial `profiles.role` column** in a third, separate
      migration. It is self-updatable and nothing reads it. Grep to confirm zero
      readers before you drop it.
- [ ] **Step 6: Run `npm run test:db` and the full E2E suite** after each of the
      three migrations, not once at the end.

---

## Do not re-investigate

The audit refuted these. Read
`docs/SECURITY_AUDIT_ACCOUNT_CREATION_2026-08.md#refuted--do-not-re-investigate`
before you spend time on any of them.

- The card-testing oracle. This app has **no** card-tokenizing endpoint. All
  card entry is on Stripe-hosted Checkout.
- Stripe webhook forgery. All three verify the signature.
- `square-webhooks` fail-open. Handlers re-fetch from Square's API.
- `revel-bulk-sync` anonymous trigger.
- Invitation tenant escalation in `accept-invitation`.
- `handle_new_user()` metadata trust. This function is the correct template.
- A growth trial unlocking Pro AI features. It does not.
