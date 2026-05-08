# Plan — Trial-expiry email sequence

**Design:** [docs/superpowers/specs/2026-05-07-trial-expiry-emails-design.md](../specs/2026-05-07-trial-expiry-emails-design.md)
**Branch:** `feat/trial-expiry-emails`

Tasks are bite-sized and ordered by dependency. Each ends with a commit. TDD where applicable: test first, then implementation. `T-N` IDs are referenced in commit messages.

## Sequence

### T-1. Migration: `trial_emails_sent` table
**File:** `supabase/migrations/20260507120000_create_trial_emails_sent.sql`
- Table per design (id, restaurant_id, user_id, email_type, variant, sent_at, resend_message_id, trial_day_at_send).
- 3 indexes (user, restaurant, sent_at desc).
- Unique on `(restaurant_id, user_id, email_type)`.
- RLS enabled, no policies.
- Commit: `feat(db): add trial_emails_sent dedupe table (T-1)`.

### T-2. Migration: `email_unsubscribes` table
**File:** `supabase/migrations/20260507120100_create_email_unsubscribes.sql`
- Table per design (id, user_id, list, unsubscribed_at, source).
- Index on user_id.
- Unique on (user_id, list).
- CHECK constraint on `list IN ('trial_lifecycle', 'marketing', 'all')`.
- RLS enabled, no policies.
- Commit: `feat(db): add email_unsubscribes table (T-2)`.

### T-3. Migration: `users_in_trial_email_window` RPC
**File:** `supabase/migrations/20260507120200_users_in_trial_email_window_rpc.sql`
- `SECURITY DEFINER` plpgsql function returning `(restaurant_id, user_id, email, full_name, trial_day, activated, email_type)`.
- UTC-anchored day math.
- POS activation as OR-existence across the four connection tables.
- Internal-email LIKE filter.
- NOT EXISTS for trial_emails_sent + email_unsubscribes.
- `GRANT EXECUTE ... TO service_role`.
- Commit: `feat(db): users_in_trial_email_window RPC (T-3)`.

### T-4. pgTAP: RPC behavior matrix
**File:** `supabase/tests/17_users_in_trial_email_window.sql`
- BEGIN/ROLLBACK + RLS off pattern.
- Plan ~14 tests:
  - day 7/11/13/15 included (4 tests, 4 fixtures with relative dates)
  - day 0/3/8/12/14/16 excluded (1 test with multiple fixtures)
  - status not 'trialing' excluded (1 test: insert restaurants with each non-trialing status)
  - internal-email excluded (1 test, 2 fixtures)
  - POS-connected → activated true (1 test each per POS table = 4 tests)
  - existing trial_emails_sent row → row excluded from RPC (1 test)
  - existing email_unsubscribes row for trial_lifecycle → excluded (1 test)
  - email_unsubscribes for 'all' list → also excluded (1 test)
  - email_unsubscribes for unrelated 'marketing' list → NOT excluded (1 test)
- Test runner uses `npm run test:db`.
- Commit: `test(db): users_in_trial_email_window pgTAP coverage (T-4)`.

### T-5. `_shared/unsubscribeToken.ts` + tests
**Test file:** `tests/unit/unsubscribeToken.test.ts`
**Impl file:** `supabase/functions/_shared/unsubscribeToken.ts`
- Pure module, Web Crypto API.
- `unsubscribeTokenFor({ userId, secret })` returns hex HMAC-SHA256.
- `verifyUnsubscribeToken(token, { userId, secret })` returns boolean (timing-safe compare).
- Tests:
  - round-trip valid token verifies true
  - tampered token verifies false
  - wrong secret verifies false
  - empty/missing token verifies false
  - same input → same output (deterministic)
- Commit: `feat(shared): unsubscribe HMAC token helper (T-5)`.

### T-6. `_shared/trialEmailTemplates.ts` + tests
**Test file:** `tests/unit/trialEmailTemplates.test.ts`
**Impl file:** `supabase/functions/_shared/trialEmailTemplates.ts`
- Pure templates module per design.
- `renderTrialEmail(type, variant, ctx)` returning `{ subject, html, text }`.
- `htmlToText` helper (basic HTML stripping for plain-text fallback).
- All eight (4 types × 2 variants) templates.
- Tests cover each combination — assert subject content, presence of unsubscribe link in HTML AND text, presence of signature, presence of dashboard URL.
- One test asserts `text` is non-empty for every variant.
- Commit: `feat(shared): trial email templates (T-6)`.

### T-7. Edge function: `unsubscribe-email`
**Test file:** `tests/unit/unsubscribeEmail.test.ts` (testing the handler logic via export)
**Impl file:** `supabase/functions/unsubscribe-email/index.ts`
- POST-only (with OPTIONS preflight).
- Reads `token`, `user_id`, `list` from query params (so RFC 8058 List-Unsubscribe-Post One-Click works).
- Validates token via `verifyUnsubscribeToken`.
- Validates list against allow-list.
- Inserts into `email_unsubscribes` with `ON CONFLICT (user_id, list) DO NOTHING`.
- Returns proper HTTP codes (200 success, 400 bad token/list, 500 unhandled).
- Tests use a small handler-export pattern: extract the request handler so we can call it with synthetic `Request` objects + a mocked Supabase client.
- Commit: `feat(api): unsubscribe-email edge function (T-7)`.

### T-8. Edge function: `trial-expiry-emails`
**Test file:** `tests/unit/trialExpiryEmails.test.ts`
**Impl file:** `supabase/functions/trial-expiry-emails/index.ts`
- Per-design loop: rpc → render → send → insert → posthog capture.
- Deps wired: corsHeaders, captureServerEvent, unsubscribeTokenFor, renderTrialEmail.
- Per-row error handling — partial failure does not abort the batch.
- Returns 200 with results array; 500 only for top-level errors with a generic message (lessons.md [2026-04-22]).
- Tests:
  - happy path: RPC returns 2 rows → 2 sends, 2 inserts, 2 posthog events (asserted via mocks)
  - rpc returns 0 rows → returns `{ ok: true, count: 0, results: [] }`
  - resend send fails for 1 row → other row succeeds, status `send_failed` reported, no insert for failed row
  - rpc fails → 500 with generic error body, real error logged
- Commit: `feat(api): trial-expiry-emails edge function (T-8)`.

### T-9. Migration: cron schedule
**File:** `supabase/migrations/20260507120300_schedule_trial_expiry_emails.sql`
- `SELECT cron.schedule('trial-expiry-emails', '0 9 * * *', $$...net.http_post...$$)`.
- Idempotent: precede with `cron.unschedule('trial-expiry-emails')` wrapped in `BEGIN;... EXCEPTION ... END` if needed (look at existing cron migrations for pattern).
- Commit: `feat(db): cron schedule for trial-expiry-emails (T-9)`.

### T-10. config.toml entries
**File:** `supabase/config.toml`
- Add `[functions.trial-expiry-emails] verify_jwt = false`.
- Add `[functions.unsubscribe-email] verify_jwt = false`.
- Commit: `chore(config): verify_jwt=false for trial+unsubscribe functions (T-10)`.

### T-11. Frontend: `/unsubscribe` page + route
**Test file:** `tests/unit/Unsubscribe.test.tsx`
**Impl file:** `src/pages/Unsubscribe.tsx`
**Route wiring:** `src/App.tsx`
- Public route, no `<ProtectedRoute>` wrapper.
- States: idle (confirm), submitting, success, error.
- Apple/Notion styling (semantic tokens, typography scale per CLAUDE.md).
- Click handler POSTs to `${VITE_PUBLIC_SUPABASE_URL}/functions/v1/unsubscribe-email?token=...&user_id=...&list=...`.
- Tests:
  - initial render shows confirm UI with the user's list-display-name
  - clicking the button transitions through submitting → success
  - bad token (mocked POST returns 400) → error state with retry link
  - missing required params → render error state directly
- Commit: `feat(ui): public /unsubscribe confirmation page (T-11)`.

### T-12. Update lessons.md (during retrospective only)
- Skipped during build; only Phase 10.

### T-13. Verification sweep
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:db`
- `npm run build`
- All must be green; fix-and-retry up to 5 iterations locally.
- Commit any fixes as `fix(verify): <what>`.

## Test commands per layer

| Layer | Command |
|---|---|
| All unit tests | `npm run test` |
| Single unit file | `npx vitest run tests/unit/trialEmailTemplates.test.ts` |
| pgTAP | `npm run test:db` |
| pgTAP single | `psql ... -f supabase/tests/17_users_in_trial_email_window.sql` (handled by db-test runner) |
| Type-check | `npm run typecheck` |
| Lint | `npm run lint` |
| Build | `npm run build` |

## Risks captured for build phase

- pgTAP fixture must DELETE-before-INSERT and disable RLS inside the txn — copy from an existing test (e.g. `09_employee_activation.sql` or similar) for the pattern.
- For the cron-schedule migration: check if `cron.unschedule(...)` raises on non-existent jobs — wrap in DO block with `EXCEPTION WHEN OTHERS` to make idempotent.
- `coderabbit review --plain --type committed` is run AFTER all build tasks complete (Phase 7), not per-task.
