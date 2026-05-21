BEGIN;
SELECT plan(16);

-- ---------- Fixture setup ----------
-- Two restaurants; one owner per restaurant; one staff at restaurant A.
-- DO UPDATE keeps fixtures deterministic across re-runs (stale fields would
-- otherwise persist from earlier runs and break assertions).
INSERT INTO auth.users (id, email, encrypted_password, aud, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ownerA@test.com', '', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'ownerB@test.com', '', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'staffA@test.com', '', 'authenticated', 'authenticated')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role;

INSERT INTO restaurants (id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RestaurantA'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'RestaurantB')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'owner'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO employees (id, restaurant_id, name, position, status) VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice A',   'Server', 'active'),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bob A',     'Cook',   'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Mallory B', 'Host',   'active')
ON CONFLICT (id) DO UPDATE SET
  restaurant_id = EXCLUDED.restaurant_id,
  name = EXCLUDED.name,
  position = EXCLUDED.position,
  status = EXCLUDED.status;

-- Helper to impersonate a user via auth.uid()
CREATE OR REPLACE FUNCTION test_set_user(uid UUID) RETURNS VOID
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, true);
$$;

-- ---------- 1. Happy path: owner writes 2 employees x 7 days = 14 rows ----------
SELECT test_set_user('11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid,
          'cccccccc-cccc-cccc-cccc-ccccccccccc2'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 0, 'start_time', '09:00:00', 'end_time', '17:00:00', 'is_available', false),
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 2, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 3, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 4, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 5, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 6, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true)
    )
  ) $sql$,
  'owner can bulk-set availability'
);

SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  14,
  '2 employees x 7 days = 14 rows inserted'
);

-- ---------- 2. Idempotent re-run preserves count ----------
SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid,
          'cccccccc-cccc-cccc-cccc-ccccccccccc2'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 0, 'start_time', '09:00:00', 'end_time', '17:00:00', 'is_available', false),
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 2, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 3, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 4, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 5, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 6, 'start_time', '10:00:00', 'end_time', '23:00:00', 'is_available', true)
    )
  ) $sql$,
  'idempotent re-run succeeds'
);
SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  14,
  'row count still 14 after re-run'
);

-- ---------- 3. Days NOT in payload are untouched ----------
SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '06:00:00', 'end_time', '14:00:00', 'is_available', true)
    )
  ) $sql$,
  'partial update succeeds'
);
SELECT is(
  (SELECT start_time::text FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
     AND day_of_week = 1),
  '06:00:00',
  'Monday replaced; other days untouched'
);
SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'),
  7,
  'still 7 rows for employee 1 (no orphans)'
);

-- ---------- 4. Staff role is denied (42501) ----------
SELECT test_set_user('33333333-3333-3333-3333-333333333333');
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  '42501',
  'forbidden',
  'staff role gets 42501'
);

-- ---------- 5. Cross-tenant employee_id rejected (23503) ----------
SELECT test_set_user('11111111-1111-1111-1111-111111111111');
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid],  -- belongs to B
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  '23503',
  'employee_not_in_restaurant',
  'cross-tenant employee rejected'
);

-- ---------- 6. Empty array returns (0, 0) ----------
SELECT results_eq(
  $sql$ SELECT employees_updated, rows_inserted FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY[]::uuid[],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  $sql$ VALUES (0, 0) $sql$,
  'empty employee array returns (0, 0)'
);

-- ---------- 7. Out-of-range day_of_week (22003) ----------
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 9, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  '22003',
  'invalid_day_of_week',
  'day_of_week 9 rejected'
);

-- ---------- 8. Missing is_available (22004) ----------
SELECT throws_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00')
    )
  ) $sql$,
  '22004',
  'is_available_required',
  'missing is_available rejected'
);

-- ---------- 9. Multi-window same day inserts both ----------
DELETE FROM employee_availability
WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  AND employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
SELECT lives_ok(
  $sql$ SELECT * FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '09:00:00', 'end_time', '13:00:00', 'is_available', true),
      jsonb_build_object('day_of_week', 1, 'start_time', '17:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  'split-shift insert succeeds'
);
SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
     AND day_of_week = 1),
  2,
  'two windows on Monday'
);

-- ---------- 10. Duplicate employee IDs are deduped (no row inflation) ----------
DELETE FROM employee_availability
WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  AND employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
SELECT results_eq(
  $sql$ SELECT employees_updated, rows_inserted FROM bulk_set_employee_availability(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ARRAY['cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid,
          'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid,
          'cccccccc-cccc-cccc-cccc-ccccccccccc1'::uuid],
    jsonb_build_array(
      jsonb_build_object('day_of_week', 1, 'start_time', '10:00:00', 'end_time', '22:00:00', 'is_available', true)
    )
  ) $sql$,
  $sql$ VALUES (1, 1) $sql$,
  'duplicate IDs deduped: 1 employee, 1 row'
);
SELECT is(
  (SELECT COUNT(*)::int FROM employee_availability
   WHERE restaurant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND employee_id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
     AND day_of_week = 1),
  1,
  'only one row written despite 3 duplicate IDs'
);

SELECT * FROM finish();
ROLLBACK;
