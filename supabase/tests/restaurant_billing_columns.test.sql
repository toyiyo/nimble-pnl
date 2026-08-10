-- Tests for the restaurant billing column guard trigger.
-- Design: docs/superpowers/specs/2026-08-09-restaurant-billing-column-guard-design.md
--
-- The guard blocks direct writes to the ten billing/Stripe columns on
-- public.restaurants from PostgREST callers (authenticated, anon). Only
-- service_role, postgres, and supabase_admin may write these columns.
BEGIN;
SELECT plan(21);

-- ==========================================
-- Fixture: one restaurant, one owner, one manager, one staff member.
-- Runs as the harness role (postgres), before the first role switch.
-- ==========================================

ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO public.restaurants (id, name, address, timezone)
VALUES (
  '00000000-0000-0000-0000-b00000000001'::uuid,
  'pgTAP Billing Guard Restaurant',
  '1 Test Way',
  'America/Chicago'
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-b0000000a001'::uuid, 'billing-owner@test.com'),
  ('00000000-0000-0000-0000-b0000000a002'::uuid, 'billing-manager@test.com'),
  ('00000000-0000-0000-0000-b0000000a003'::uuid, 'billing-staff@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES
  ('00000000-0000-0000-0000-b0000000a001'::uuid,
   '00000000-0000-0000-0000-b00000000001'::uuid, 'owner'),
  ('00000000-0000-0000-0000-b0000000a002'::uuid,
   '00000000-0000-0000-0000-b00000000001'::uuid, 'manager'),
  ('00000000-0000-0000-0000-b0000000a003'::uuid,
   '00000000-0000-0000-0000-b00000000001'::uuid, 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- Case 1: the guard trigger exists on public.restaurants
-- ==========================================

RESET ROLE;
SELECT has_trigger(
  'public', 'restaurants', 'restaurant_billing_columns_guard',
  'restaurant_billing_columns_guard trigger exists on public.restaurants'
);

-- ==========================================
-- Cases 2-11: an owner cannot change any of the ten billing columns
-- ==========================================

RESET ROLE;
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-b0000000a001","role":"authenticated"}', true);

SELECT throws_ok(
  $$UPDATE public.restaurants SET subscription_tier = 'pro'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change subscription_tier'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET subscription_status = 'active'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change subscription_status'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET subscription_period = 'annual'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change subscription_period'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET stripe_subscription_customer_id = 'cus_fake'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change stripe_subscription_customer_id'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET stripe_subscription_id = 'sub_fake'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change stripe_subscription_id'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET trial_ends_at = now() + interval '30 days'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change trial_ends_at'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET subscription_ends_at = now() + interval '1 year'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change subscription_ends_at'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET grandfathered_until = now() + interval '1 year'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change grandfathered_until'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET subscription_cancel_at = now() + interval '1 day'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change subscription_cancel_at'
);

SELECT throws_ok(
  $$UPDATE public.restaurants SET stripe_customer_id = 'cus_fake2'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'owner cannot change stripe_customer_id'
);

-- ==========================================
-- Case 12: a manager cannot change subscription_tier either
-- ==========================================

RESET ROLE;
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-b0000000a002","role":"authenticated"}', true);

SELECT throws_ok(
  $$UPDATE public.restaurants SET subscription_tier = 'pro'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  '42501',
  'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe',
  'manager cannot change subscription_tier'
);

-- ==========================================
-- Case 13-14: the non-vacuity control. An owner can still change a
-- non-billing column, so cases 2-12 fail on the trigger, not on RLS.
-- ==========================================

RESET ROLE;
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-b0000000a001","role":"authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.restaurants SET name = 'pgTAP Billing Guard Restaurant (renamed)'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  'owner can still change name (non-billing column)'
);

RESET ROLE;
SELECT is(
  (SELECT name FROM public.restaurants
     WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid),
  'pgTAP Billing Guard Restaurant (renamed)',
  'the name control write landed'
);

-- ==========================================
-- Case 15: an owner can change address and timezone together
-- ==========================================

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-b0000000a001","role":"authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.restaurants SET address = '2 Test Way', timezone = 'America/New_York'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  'owner can change address and timezone together'
);

-- ==========================================
-- Case 16: writing subscription_tier with its current value is a no-op
-- under IS DISTINCT FROM, so it does not trip the guard
-- ==========================================

RESET ROLE;
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-b0000000a001","role":"authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.restaurants SET subscription_tier = subscription_tier
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  'owner writing subscription_tier with its current value does not trip the guard'
);

-- ==========================================
-- Case 17: a staff member's UPDATE matches zero rows under RLS, so no
-- exception is raised, and subscription_tier is unchanged. The pre-value
-- is captured (not hard-coded) so this case checks "unchanged", not a
-- specific value that an earlier case might have already set.
-- ==========================================

RESET ROLE;
SELECT set_config('pgtap.pre_staff_subscription_tier',
  (SELECT subscription_tier FROM public.restaurants
     WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid),
  true);

SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-b0000000a003","role":"authenticated"}', true);

SELECT lives_ok(
  $$UPDATE public.restaurants SET subscription_tier = 'pro'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  'staff UPDATE does not raise (RLS matches zero rows)'
);

RESET ROLE;
SELECT is(
  (SELECT subscription_tier FROM public.restaurants
     WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid),
  current_setting('pgtap.pre_staff_subscription_tier'),
  'subscription_tier is unchanged after the staff UPDATE'
);

-- ==========================================
-- Case 18-19: service_role can change subscription_tier, and the write
-- lands
-- ==========================================

-- Clear the stale JWT claim from case 17. Each real PostgREST request sets
-- its own request.jwt.claims fresh, so a service_role or postgres writer
-- never carries a leftover "authenticated" claim. Only this test's shared
-- transaction can leak one role's claim into the next role's case.
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL role TO service_role;

SELECT lives_ok(
  $$UPDATE public.restaurants SET subscription_tier = 'growth'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  'service_role can change subscription_tier'
);

RESET ROLE;
SELECT is(
  (SELECT subscription_tier FROM public.restaurants
     WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid),
  'growth',
  'the service_role write landed'
);

-- ==========================================
-- Case 20: postgres (the migration role) can still change
-- subscription_tier, so future migrations keep working
-- ==========================================

RESET ROLE;
SELECT lives_ok(
  $$UPDATE public.restaurants SET subscription_tier = 'pro'
    WHERE id = '00000000-0000-0000-0000-b00000000001'::uuid$$,
  'postgres can change subscription_tier'
);

SELECT * FROM finish();
ROLLBACK;
