-- Test: Time-Off Notification Approver Resolution
-- Verifies the join pattern used by the send-time-off-notification edge function
-- returns owner/manager profiles and excludes other roles.

BEGIN;

SELECT plan(6);

-- Setup: create an isolated restaurant and three users with different roles.
INSERT INTO restaurants (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-000000000801'::uuid,
  'Approver Test Restaurant',
  '1 Test St',
  '555-0801'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000802'::uuid, 'owner-approver@test.com'),
  ('00000000-0000-0000-0000-000000000803'::uuid, 'manager-approver@test.com'),
  ('00000000-0000-0000-0000-000000000804'::uuid, 'chef-approver@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (user_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000802'::uuid, 'owner-approver@test.com'),
  ('00000000-0000-0000-0000-000000000803'::uuid, 'manager-approver@test.com'),
  ('00000000-0000-0000-0000-000000000804'::uuid, 'chef-approver@test.com')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES
  ('00000000-0000-0000-0000-000000000802'::uuid, '00000000-0000-0000-0000-000000000801'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000803'::uuid, '00000000-0000-0000-0000-000000000801'::uuid, 'manager'),
  ('00000000-0000-0000-0000-000000000804'::uuid, '00000000-0000-0000-0000-000000000801'::uuid, 'chef')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- Test 1: owner is resolved through the profiles join
SELECT ok(
  EXISTS(
    SELECT 1 FROM user_restaurants ur
    JOIN profiles p ON p.user_id = ur.user_id
    WHERE ur.restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
      AND ur.role = 'owner'
      AND p.email = 'owner-approver@test.com'
  ),
  'owner profile is resolvable via user_restaurants -> profiles join'
);

-- Test 2: manager is resolved
SELECT ok(
  EXISTS(
    SELECT 1 FROM user_restaurants ur
    JOIN profiles p ON p.user_id = ur.user_id
    WHERE ur.restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
      AND ur.role = 'manager'
      AND p.email = 'manager-approver@test.com'
  ),
  'manager profile is resolvable via user_restaurants -> profiles join'
);

-- Test 3: approver list contains exactly owner + manager, not chef
SELECT is(
  (SELECT count(*)::int FROM user_restaurants
   WHERE restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
     AND role IN ('owner', 'manager')),
  2,
  'Only owner and manager roles count as approvers'
);

-- Test 4: chef's email is NOT returned by the approver-filtered join
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM user_restaurants ur
    JOIN profiles p ON p.user_id = ur.user_id
    WHERE ur.restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
      AND ur.role IN ('owner', 'manager')
      AND p.email = 'chef-approver@test.com'
  ),
  'chef email is excluded when filtering to owner/manager roles'
);

-- Test 5: join returns email for every approver (no null-profile rows)
SELECT is(
  (SELECT count(*)::int FROM user_restaurants ur
   JOIN profiles p ON p.user_id = ur.user_id
   WHERE ur.restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
     AND ur.role IN ('owner', 'manager')
     AND p.email IS NOT NULL),
  2,
  'Both approvers have non-null emails via the join'
);

-- Test 6: empty-approver case — a new restaurant with no owners/managers returns 0
INSERT INTO restaurants (id, name, address, phone)
VALUES (
  '00000000-0000-0000-0000-000000000805'::uuid,
  'Empty Approver Restaurant',
  '2 Test St',
  '555-0805'
)
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (SELECT count(*)::int FROM user_restaurants
   WHERE restaurant_id = '00000000-0000-0000-0000-000000000805'::uuid
     AND role IN ('owner', 'manager')),
  0,
  'Restaurant with no team returns 0 approvers'
);

SELECT * FROM finish();
ROLLBACK;
