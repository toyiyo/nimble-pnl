-- Tests for public.effective_subscription_status(text, timestamptz)
BEGIN;
SELECT plan(15);

-- Helper cases
SELECT is(
  effective_subscription_status('trialing', now() - interval '1 day'),
  'trial_expired',
  'Expired trial returns trial_expired'
);
SELECT is(
  effective_subscription_status('trialing', now() + interval '1 day'),
  'trialing',
  'Running trial returns trialing'
);
SELECT is(
  effective_subscription_status('trialing', NULL),
  'trialing',
  'NULL end date stays trialing'
);
SELECT is(
  effective_subscription_status('trialing', now()),
  'trialing',
  'Boundary trial_ends_at = now() is still trialing'
);

-- Pass-through
SELECT is(effective_subscription_status('active', now() - interval '1 day'), 'active', 'active passes through');
SELECT is(effective_subscription_status('past_due', now() - interval '1 day'), 'past_due', 'past_due passes through');
SELECT is(effective_subscription_status('canceled', now() - interval '1 day'), 'canceled', 'canceled passes through');
SELECT is(effective_subscription_status('grandfathered', now() - interval '1 day'), 'grandfathered', 'grandfathered passes through');

-- Grants
SELECT ok(
  has_function_privilege('authenticated', 'public.effective_subscription_status(text, timestamptz)', 'EXECUTE'),
  'authenticated can execute'
);
SELECT ok(
  has_function_privilege('service_role', 'public.effective_subscription_status(text, timestamptz)', 'EXECUTE'),
  'service_role can execute'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.effective_subscription_status(text, timestamptz)', 'EXECUTE'),
  'anon cannot execute'
);

-- Parity with the gates
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-ccc000000001","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-ccc000000001', 'parity-owner@example.com') ON CONFLICT DO NOTHING;

SELECT create_restaurant_with_owner('Parity Expired', 'addr', NULL, NULL, 'America/Chicago');
SELECT create_restaurant_with_owner('Parity Running', 'addr', NULL, NULL, 'America/Chicago');

-- Clear the JWT claims so the billing guard allows the fixture writes.
SELECT set_config('request.jwt.claims', '', true);

UPDATE restaurants SET trial_ends_at = now() - interval '2 days' WHERE name = 'Parity Expired';
UPDATE restaurants SET trial_ends_at = now() + interval '5 days' WHERE name = 'Parity Running';

SELECT is(
  (SELECT effective_subscription_status(subscription_status, trial_ends_at) FROM restaurants WHERE name = 'Parity Expired'),
  'trial_expired',
  'Expired fixture is trial_expired'
);
SELECT ok(
  (SELECT get_effective_subscription_tier(id) IS NULL FROM restaurants WHERE name = 'Parity Expired'),
  'Expired fixture: effective tier is NULL'
);
SELECT ok(
  (SELECT NOT has_subscription_feature(id, 'basic_pnl') AND NOT has_subscription_feature(id, 'scheduling') FROM restaurants WHERE name = 'Parity Expired'),
  'Expired fixture: basic_pnl and scheduling are FALSE'
);

SELECT ok(
  (SELECT effective_subscription_status(subscription_status, trial_ends_at) = 'trialing'
      AND get_effective_subscription_tier(id) IS NOT NULL
      AND has_subscription_feature(id, 'basic_pnl')
      AND has_subscription_feature(id, 'scheduling')
   FROM restaurants WHERE name = 'Parity Running'),
  'Running fixture: trialing, tier set, basic_pnl and scheduling TRUE'
);

SELECT * FROM finish();
ROLLBACK;
