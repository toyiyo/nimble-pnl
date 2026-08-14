# Plan: block owner writes to the restaurant billing columns

- **Design:** `docs/superpowers/specs/2026-08-09-restaurant-billing-column-guard-design.md`
- **Branch:** `fix/restaurant-billing-column-guard`
- **Worktree:** `.claude/worktrees/restaurant-billing-guard`
- **Task:** Task 2 of `docs/plans/2026-08-07-account-creation-security-plan.md`

## Goal

Stop an owner or a manager from writing their own subscription tier.
Keep every legitimate writer working: the three Stripe edge functions,
the migrations, and the non-billing restaurant settings.

## Step 1 — pgTAP test first (red)

**New file:** `supabase/tests/restaurant_billing_columns.test.sql`

20 cases, per section 6 of the design. Fixture: one restaurant, one
owner, one manager, one staff member, membership rows for all three.

Each block sets the Postgres role, not only the JWT claims:

```sql
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"<OWNER_UUID>","role":"authenticated"}', true);
```

`RESET ROLE` runs before every fixture read and before each role change.

Every deny case pins both the SQLSTATE `42501` and the exact message.

Run `npm run test:db`. Expect the 12 deny cases to fail. That failure is
the proof the test can detect the bug.

## Step 2 — the migration (green)

**New file:** `supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql`

- `public._guard_restaurant_billing_columns()`, `plpgsql`,
  `SECURITY INVOKER`, `SET search_path = pg_catalog, pg_temp`.
- Role test: `current_user IN ('authenticated','anon')` OR the JWT `role`
  claim in the same set, with `nullif` before the `::jsonb` cast.
- Inside the test, compare the ten billing columns with
  `IS DISTINCT FROM`. Raise `42501` with this message:
  `Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe`
- Trigger `restaurant_billing_columns_guard`, `BEFORE UPDATE`,
  `FOR EACH ROW`, with `DROP TRIGGER IF EXISTS` in front.
- A header comment records the `file:line` of every legitimate writer,
  per the Task 1 lesson.

Run `npm run db:reset && npm run test:db`. Expect 20 of 20 green.

## Step 3 — fix the E2E helper

The current helper performs the exact exploit from the browser page. The
migration would break it silently, because its call site only logs.

**New file:** `tests/helpers/e2e-service-role.ts`
- One `@supabase/supabase-js` client from `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`, created lazily, `persistSession: false`.
- Throw a clear error when either variable is absent.
- Export `setSubscriptionTier(restaurantId, tier, status)`.

**Edit:** `tests/helpers/e2e-supabase.ts`
- Delete `__setSubscriptionTier` at lines 673-690.
- Change the call site at lines 1226-1234 to call the Node helper.
- Replace the log-only `catch` with a `throw`. A silent tier failure put
  69 spec files on the wrong plan.

**Edit:** `.github/workflows/unit-tests.yml`
- Add `SUPABASE_SERVICE_ROLE_KEY` to the E2E job env near line 255. The
  value is the local Supabase demo key that `supabase start` creates. It
  is not a production secret. The job already hardcodes the matching demo
  anon key.

## Step 4 — the E2E guard spec

**New file:** `tests/e2e/subscription-tier-guard.spec.ts`

1. `signUpAndCreateRestaurant` — the new user is owner.
2. From the page, run the self-upgrade against `restaurants`.
3. Assert the call returns an error.
4. Re-read the row and assert `subscription_tier` did not change.

Step 4 is not optional. PostgREST returns no error for a zero-row UPDATE,
so an error assertion alone can pass for the wrong reason.

## Step 5 — verify

- `npm run test:db` — 20 of 20 green.
- `npm run typecheck` and `npm run lint`.
- `npm run test` — the unit suite must stay green.
- `npx playwright test tests/e2e/subscription-tier-guard.spec.ts` plus a
  sample of 3 specs that call `signUpAndCreateRestaurant`, to prove the
  new tier helper works.

## Out of scope

- The permissive INSERT policy on `restaurants`. It goes in the Task 3
  audit note.
- Task 6 and Task 10. Both wait for this PR.

## Risk

**The largest risk is the E2E blast radius.** 69 spec files call
`signUpAndCreateRestaurant`. Step 3 changes the tier write for all of
them. Step 5 samples three of those specs before the PR opens, and the
full E2E job in CI is the hard gate.

## Files

| Action | Path |
|---|---|
| new | `supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql` |
| new | `supabase/tests/restaurant_billing_columns.test.sql` |
| new | `tests/helpers/e2e-service-role.ts` |
| new | `tests/e2e/subscription-tier-guard.spec.ts` |
| edit | `tests/helpers/e2e-supabase.ts` |
| edit | `.github/workflows/unit-tests.yml` |
