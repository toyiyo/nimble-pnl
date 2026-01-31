-- Tests for subscription system functions introduced in 20260129000000_add_subscription_system.sql

-- 1) create_restaurant_with_owner sets up 14-day Growth trial
BEGIN;
SELECT plan(5);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-aaa000000001","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-aaa000000001', 'owner1@example.com') ON CONFLICT DO NOTHING;

WITH r AS (
  SELECT create_restaurant_with_owner('Trial Restaurant', 'addr', NULL, NULL, 'America/Chicago') AS id
)
SELECT ok((SELECT id IS NOT NULL FROM r), 'create_restaurant_with_owner returns an id');

SELECT is(
  (SELECT subscription_tier FROM restaurants WHERE name = 'Trial Restaurant'),
  'growth',
  'New restaurant starts on Growth tier'
);

SELECT is(
  (SELECT subscription_status FROM restaurants WHERE name = 'Trial Restaurant'),
  'trialing',
  'New restaurant marked as trialing'
);

SELECT ok(
  (SELECT trial_ends_at > now() + interval '13 days' AND trial_ends_at < now() + interval '15 days' FROM restaurants WHERE name = 'Trial Restaurant'),
  'Trial ends in approximately 14 days'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_id = '00000000-0000-0000-0000-aaa000000001'
      AND role = 'owner'
      AND restaurant_id = (SELECT id FROM restaurants WHERE name = 'Trial Restaurant')
  ),
  'Owner link created'
);

SELECT * FROM finish();
ROLLBACK;


-- 2) has_subscription_feature and get_effective_subscription_tier across statuses
BEGIN;
SELECT plan(12);

-- Active starter
INSERT INTO restaurants (id, name, subscription_tier, subscription_status) VALUES
  ('00000000-0000-0000-0000-bbb000000001', 'Active Starter', 'starter', 'active')
ON CONFLICT DO NOTHING;

SELECT is(
  get_effective_subscription_tier('00000000-0000-0000-0000-bbb000000001'),
  'starter',
  'Active starter returns starter'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-bbb000000001', 'financial_intelligence'),
  false,
  'Starter lacks financial_intelligence'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-bbb000000001', 'basic_pnl'),
  true,
  'Starter retains basic_pnl feature'
);

-- Trialing growth (not expired)
INSERT INTO restaurants (id, name, subscription_tier, subscription_status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-bbb000000002', 'Trial Growth', 'growth', 'trialing', now() + interval '7 days')
ON CONFLICT DO NOTHING;

SELECT is(
  get_effective_subscription_tier('00000000-0000-0000-0000-bbb000000002'),
  'growth',
  'Trialing growth reports growth effective tier'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-bbb000000002', 'financial_intelligence'),
  true,
  'Trialing growth grants financial_intelligence'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-bbb000000002', 'ai_assistant'),
  false,
  'Trialing growth does not grant ai_assistant'
);

-- Trial expired
INSERT INTO restaurants (id, name, subscription_tier, subscription_status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-bbb000000003', 'Trial Expired', 'growth', 'trialing', now() - interval '1 day')
ON CONFLICT DO NOTHING;

SELECT is(
  get_effective_subscription_tier('00000000-0000-0000-0000-bbb000000003'),
  NULL,
  'Expired trial returns null tier'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-bbb000000003', 'financial_intelligence'),
  false,
  'Expired trial blocks financial_intelligence'
);

-- Grandfathered valid
INSERT INTO restaurants (id, name, subscription_tier, subscription_status, grandfathered_until)
VALUES ('00000000-0000-0000-0000-bbb000000004', 'Grandfathered', 'starter', 'grandfathered', now() + interval '30 days')
ON CONFLICT DO NOTHING;

SELECT is(
  get_effective_subscription_tier('00000000-0000-0000-0000-bbb000000004'),
  'pro',
  'Grandfathered within window returns pro'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-bbb000000004', 'ai_assistant'),
  true,
  'Grandfathered restaurant can use ai_assistant'
);

-- Grandfathered expired
INSERT INTO restaurants (id, name, subscription_tier, subscription_status, grandfathered_until)
VALUES ('00000000-0000-0000-0000-bbb000000005', 'Grandfathered Expired', 'starter', 'grandfathered', now() - interval '1 day')
ON CONFLICT DO NOTHING;

SELECT is(
  get_effective_subscription_tier('00000000-0000-0000-0000-bbb000000005'),
  'starter',
  'Expired grandfathering falls back to starter'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-bbb000000005', 'financial_intelligence'),
  false,
  'Expired grandfathering loses financial_intelligence'
);

SELECT * FROM finish();
ROLLBACK;


-- 3) Volume discount and owner restaurant count
BEGIN;
SELECT plan(5);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-ccc000000001","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-ccc000000001', 'owner2@example.com') ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-ccc000000010', 'Loc1'),
  ('00000000-0000-0000-0000-ccc000000011', 'Loc2'),
  ('00000000-0000-0000-0000-ccc000000012', 'Loc3')
ON CONFLICT DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-ccc000000001', '00000000-0000-0000-0000-ccc000000010', 'owner'),
  ('00000000-0000-0000-0000-ccc000000001', '00000000-0000-0000-0000-ccc000000011', 'owner'),
  ('00000000-0000-0000-0000-ccc000000001', '00000000-0000-0000-0000-ccc000000012', 'owner')
ON CONFLICT DO NOTHING;

SELECT is(
  get_owner_restaurant_count('00000000-0000-0000-0000-ccc000000001'),
  3,
  'Counts owned restaurants'
);

SELECT is(get_volume_discount_percent(1), 0::numeric, 'No discount for 1 location');
SELECT is(get_volume_discount_percent(3), 0.05::numeric, '5% discount for 3-5 locations');
SELECT is(get_volume_discount_percent(6), 0.10::numeric, '10% discount for 6-10 locations');
SELECT is(get_volume_discount_percent(11), 0.15::numeric, '15% discount for 11+ locations');

SELECT * FROM finish();
ROLLBACK;


-- 4) user_has_capability subscription gating
BEGIN;
SELECT plan(6);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-ddd000000001","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-ddd000000001', 'owner3@example.com') ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name, subscription_tier, subscription_status) VALUES
  ('00000000-0000-0000-0000-ddd000000010', 'Capable R', 'pro', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-ddd000000001', '00000000-0000-0000-0000-ddd000000010', 'owner')
ON CONFLICT DO NOTHING;

SELECT ok(
  user_has_capability('00000000-0000-0000-0000-ddd000000010', 'view:ai_assistant'),
  'Active Pro owner can view AI assistant'
);
SELECT ok(
  user_has_capability('00000000-0000-0000-0000-ddd000000010', 'view:financial_intelligence'),
  'Active Pro owner can view financial intelligence'
);

-- Downgrade to trialing growth
UPDATE restaurants
SET subscription_tier = 'growth', subscription_status = 'trialing', trial_ends_at = now() + interval '7 days'
WHERE id = '00000000-0000-0000-0000-ddd000000010';

SELECT ok(
  NOT user_has_capability('00000000-0000-0000-0000-ddd000000010', 'view:ai_assistant'),
  'Growth trial cannot access AI assistant'
);
SELECT ok(
  user_has_capability('00000000-0000-0000-0000-ddd000000010', 'view:financial_intelligence'),
  'Growth trial can access financial intelligence'
);

-- Canceled removes subscription features
UPDATE restaurants
SET subscription_status = 'canceled'
WHERE id = '00000000-0000-0000-0000-ddd000000010';

SELECT ok(
  NOT user_has_capability('00000000-0000-0000-0000-ddd000000010', 'view:financial_intelligence'),
  'Canceled subscription loses financial intelligence'
);

SELECT ok(
  user_has_capability('00000000-0000-0000-0000-ddd000000010', 'manage:subscription'),
  'Owner retains manage:subscription even when canceled'
);

SELECT * FROM finish();
ROLLBACK;
