# Design: block owner writes to the restaurant billing columns

- **Date:** 2026-08-09
- **Branch:** `fix/restaurant-billing-column-guard`
- **Plan task:** Task 2 of `docs/plans/2026-08-07-account-creation-security-plan.md:126-156`
- **Audit item:** Vuln 2 of `docs/SECURITY_AUDIT_ACCOUNT_CREATION_2026-08.md`

## 1. The problem

The policy `"Owners and managers can update their restaurants"`
(`supabase/migrations/20250916223011_7793a7c0-1807-4a7e-b125-c458b98bd032.sql:56-65`)
is `FOR UPDATE` with no `WITH CHECK` clause. Postgres then reuses `USING`
for the new row. `USING` tests only membership and role, keyed on
`restaurants.id`, which an UPDATE never changes. The policy validates
*who* writes. It never validates *which columns*.

Live catalog state on production confirms this. `pg_policies` returns one
UPDATE policy on `public.restaurants`, `permissive`, `{authenticated}`,
`with_check = null`. `pg_trigger` returns one non-internal trigger,
`update_restaurants_updated_at`
(`supabase/migrations/20250915210020_774bc2c1-abb6-4f03-b10f-5cfc85e9b772.sql:79`),
a timestamp stamper.

Every self-serve signup becomes owner of its own restaurant. That owner
can run:

```js
supabase.from('restaurants')
  .update({ subscription_tier: 'pro', subscription_status: 'active' })
  .eq('id', restaurantId)
```

`has_subscription_feature()`
(`supabase/migrations/20260129000000_add_subscription_system.sql:60-152`)
reads these columns directly. The write unlocks `ai_assistant`,
`financial_intelligence`, `inventory_automation`, `scheduling`,
`ai_alerts`, `multi_location_dashboard`, and `recipe_profitability`.

A **manager** can do the same. The policy names both roles
(`…20250916223011….sql:60-65`).

## 2. Column scope — ten columns, not nine

`information_schema.columns` on production lists 33 columns on
`public.restaurants`. Ten of them decide billing or Stripe identity:

| Column | Added by |
|---|---|
| `subscription_tier` | `supabase/migrations/20260129000000_add_subscription_system.sql:19` |
| `subscription_status` | `…20260129000000….sql:21` |
| `subscription_period` | `…20260129000000….sql:23` |
| `stripe_subscription_customer_id` | `…20260129000000….sql:25` |
| `stripe_subscription_id` | `…20260129000000….sql:26` |
| `trial_ends_at` | `…20260129000000….sql:27` |
| `subscription_ends_at` | `…20260129000000….sql:28` |
| `grandfathered_until` | `…20260129000000….sql:29` |
| `subscription_cancel_at` | `supabase/migrations/20260130000001_add_subscription_cancel_at.sql:5` |
| `stripe_customer_id` | `supabase/migrations/20251018202456_11ccc200-79ec-4475-9ebe-92bd8c42f77a.sql:3` |

**`grandfathered_until` is a second bypass the audit missed.**
`has_subscription_feature()` gives the Pro tier when
`subscription_status = 'grandfathered'` and `NOW() <= grandfathered_until`
(`…20260129000000….sql:95-99`). An owner who writes both columns holds Pro
for as long as they choose. The guard covers all ten.

## 3. Why a trigger and not a policy

A policy cannot compare `OLD` to `NEW`. Postgres gives a `WITH CHECK`
expression the new row only.

A column-level `REVOKE` also fails here. Postgres gives a table-level
`GRANT` precedence over a column-level `REVOKE`, and `authenticated` holds
table-level UPDATE through PostgREST. The repository already recorded this
in the header of
`supabase/migrations/20260426120000_lock_check_bank_account_secrets.sql:20-25`.

That file is the precedent. It locks three secret columns on
`public.check_bank_accounts` with a `BEFORE UPDATE` trigger
(`…20260426120000….sql:27-53`). This design copies the shape.

## 4. The writer test

The trigger must allow every legitimate writer. A grep of
`supabase/functions/`, `supabase/migrations/`, and `src/` gives the
complete list.

### Edge functions — three, all service role

| Writer | Columns | Client |
|---|---|---|
| `supabase/functions/stripe-subscription-webhook/subscription-handler.ts:208-215, 364, 405-410, 458, 485` | eight of the ten | `supabaseAdmin`, built from `SUPABASE_SERVICE_ROLE_KEY` at `supabase/functions/stripe-subscription-webhook/index.ts:61-64` |
| `supabase/functions/stripe-financial-connections-session/index.ts:128, 165, 185, 207` | `stripe_customer_id` | `supabaseAdmin`, `…/index.ts:58-61` |
| `supabase/functions/stripe-subscription-checkout/index.ts:198` | `stripe_subscription_customer_id` | `supabaseAdmin`, `…/index.ts:91-94` |

### SQL — one migration, zero functions

`supabase/migrations/20260129000000_add_subscription_system.sql:49-56`
grandfathers existing restaurants. It runs as the migration role.

A production catalog query for functions whose body matches
`update\s+(public\.)?restaurants` in schemas `public` and `private`
returned **zero rows**. No `SECURITY DEFINER` function writes this table.

### Browser — zero billing writers in `src/`

`src/hooks/useRestaurants.tsx:198-203` exposes a generic
`updateRestaurant(restaurantId, updates)`. `src/pages/RestaurantSettings.tsx:397-400`
writes the geofence columns. Neither names a billing column.
`src/hooks/useSubscription.ts` contains no `.update(`, `.insert(`, or
`.upsert(` call at all — it reads only.

### The test itself

PostgREST runs `SET LOCAL ROLE` to `authenticated` or `anon` for every
browser request. Every legitimate billing writer runs as `service_role`,
`postgres`, or `supabase_admin`. The trigger therefore checks the columns
only when the effective role is an end-user role:

```sql
IF current_user IN ('authenticated', 'anon')
   OR coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        ''
      ) IN ('authenticated', 'anon')
THEN
  -- compare the ten columns
END IF;
```

Three notes on that expression.

- **`nullif` before the cast.** An empty `request.jwt.claims` string makes
  `''::jsonb` raise. `supabase/migrations/20251221000001_create_invoicing_tables.sql:342-345`
  casts without the guard. This design does not copy that.
- **The second arm is defense in depth.** A future `SECURITY DEFINER`
  function owned by `postgres` would set `current_user = postgres` and
  slip past the first arm. The JWT claim still says `authenticated`, so
  the second arm holds. A function that must change billing can add a
  session flag later, the way `set_check_bank_account_secrets` does
  (`…20260426120000….sql:95`).
- **The list is a deny-list, not an allow-list.** An allow-list of
  `service_role, postgres, supabase_admin` fails closed. Migrations run as
  `postgres` locally and as `supabase_admin` in CI, and a future CLI
  version could pick a third role and break every deploy. A deny-list of
  the two PostgREST roles cannot break a deploy, and PostgREST has no
  third end-user role in this project.

The trigger function is `SECURITY INVOKER` (the default). A
`SECURITY DEFINER` trigger would read `current_user = postgres` for every
caller and never fire.

## 5. Blast radius: the E2E helper is the exploit

`tests/helpers/e2e-supabase.ts:673-690` defines `__setSubscriptionTier`.
It runs **in the browser page**, on the app's own authenticated Supabase
client, and writes `subscription_tier` and `subscription_status`. That is
the exact statement in section 1.

`signUpAndCreateRestaurant` calls it at
`tests/helpers/e2e-supabase.ts:1226-1234` to put every test restaurant on
`pro`/`active`. 69 spec files call `signUpAndCreateRestaurant`.

The call sits in a `try`/`catch` that only logs
(`tests/helpers/e2e-supabase.ts:1233`), so the trigger would not fail the
tests. It would silently leave each restaurant on the `starter`/`trialing`
default. `has_subscription_feature()` maps `trialing` with a null
`trial_ends_at` to the `growth` tier (`…20260129000000….sql:106-110`), so
Growth features keep working by accident and only `ai_assistant` loses
access. Depending on an accident is not acceptable.

**Fix:** move the tier write out of the browser and into the Node test
process, behind the service role. The development workflow already names
this pattern for exactly this case: "a service-role client confined to the
Node test process (never the browser page) when RLS blocks the setup"
(`.claude/skills/development-workflow.md:633-634`).

- Add `tests/helpers/e2e-service-role.ts`. It builds one
  `@supabase/supabase-js` client from `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`, and exports
  `setSubscriptionTier(restaurantId, tier, status)`.
- Change `signUpAndCreateRestaurant` to call it.
- Delete `__setSubscriptionTier` from the browser helpers. Leaving a
  helper that can only fail is worse than no helper.
- Add `SUPABASE_SERVICE_ROLE_KEY` to the E2E job env in
  `.github/workflows/unit-tests.yml:251-256`. The job already hardcodes
  the local Supabase demo anon key on line 255. The service-role demo key
  is the same class of value: it belongs to the throwaway local stack that
  `supabase start` creates on line 236, and it is published in the
  Supabase CLI documentation. It is not a production secret.

`sonar-project.properties:8` sets `sonar.sources=src`, so the new helper
file is outside the coverage gate.

## 6. Tests

### pgTAP — `supabase/tests/restaurant_billing_columns.test.sql`

Fixture: one restaurant, one owner, one manager, membership rows for both.

**A deny case must pin the message, not only the SQLSTATE.** RLS denial
and this trigger both raise `42501`. A test pinned to the code alone would
stay green if the actor lost RLS access and never reached the trigger.
This repeats the trap recorded in `memory/lessons.md:2539-2545` through a
new mechanism, so every deny case passes both arguments to `throws_ok`:

```sql
SELECT throws_ok(
  $$UPDATE public.restaurants SET subscription_tier = 'pro' WHERE id = '<R>'$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe'
);
```

| # | Case | Expect |
|---|---|---|
| 1 | Trigger exists on `public.restaurants` | `has_trigger` |
| 2-11 | Owner changes each of the ten billing columns | `throws_ok` 42501 + message |
| 12 | Manager changes `subscription_tier` | `throws_ok` 42501 + message |
| 13 | Owner changes `name` | `lives_ok` — the non-vacuity control. It proves RLS lets this actor write, so cases 2-12 fail on the trigger. |
| 14 | Owner changes `address` and `timezone` | `lives_ok` |
| 15 | Owner writes `subscription_tier` with its current value | `lives_ok` — `IS DISTINCT FROM` sees no change |
| 16 | `service_role` changes `subscription_tier` | `lives_ok` |
| 17 | Value after case 16 | `is(...)` — the write landed |
| 18 | `postgres` changes `subscription_tier` | `lives_ok` — later migrations keep working |

### E2E — `tests/e2e/subscription-tier-guard.spec.ts`

The Phase 8 gate calls this an authorization change, so it needs a
Playwright spec. The spec signs up a new owner, then runs the exploit from
the page:

1. `signUpAndCreateRestaurant`.
2. From the page, `supabase.from('restaurants').update({subscription_tier:'pro'})`.
3. Assert the call returns an error.
4. Re-read the row and assert `subscription_tier` is unchanged.

Step 4 matters on its own. PostgREST returns no error for an UPDATE that
matches zero rows, so an assertion on the error alone could pass for the
wrong reason.

## 7. Out of scope

- The permissive INSERT policy on `restaurants`
  (`…20250916223011….sql:50-54`) has `WITH CHECK (true)`. A new restaurant
  can therefore be inserted with any tier. The defaults come from the
  column definitions, and the INSERT path is
  `create_restaurant_with_owner`, so this is a separate finding. It goes
  in the Task 3 audit note, not in this PR.
- Task 6 and Task 10 read these columns. Both depend on this PR landing.

## 8. Decided trade-offs

- **The trigger runs on every `restaurants` UPDATE.** Cost is one role
  comparison and ten `IS DISTINCT FROM` tests per row. The table is small
  and its update rate is low. Accepted.
- **The deny-list can fail open for an unknown PostgREST role.** Accepted,
  with the reasoning in section 4. The alternative fails deploys.
- **No bypass flag ships in this migration.** No caller needs one today.
  Adding an unused bypass would widen the attack surface for no gain.
