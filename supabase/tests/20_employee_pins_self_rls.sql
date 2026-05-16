-- Test: employee_pins self-manage RLS policies
-- Verifies that an active employee may upsert ONLY their own row.

BEGIN;
SELECT plan(5);

-- Setup
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'mgr-pinrls@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'alice-pinrls@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'bob-pinrls@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'PinRLS Test Cafe')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (restaurant_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'manager'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'staff'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'staff')
ON CONFLICT DO NOTHING;

INSERT INTO employees (id, restaurant_id, user_id, name, position, is_active, status, compensation_type) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'Alice PinRLS', 'server', true, 'active', 'hourly'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'Bob PinRLS',   'server', true, 'active', 'hourly')
ON CONFLICT (id) DO NOTHING;

-- Switch to Alice's JWT context
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

-- Test 1: Alice can insert her OWN pin row
SELECT lives_ok(
  $$ INSERT INTO employee_pins (restaurant_id, employee_id, pin_hash, min_length)
     VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'aaa', 4) $$,
  'Alice can insert her own employee_pins row'
);

-- Test 2: Alice can update her own pin row
SELECT lives_ok(
  $$ UPDATE employee_pins SET pin_hash = 'bbb'
     WHERE employee_id = '00000000-0000-0000-0000-0000000000c1' $$,
  'Alice can update her own employee_pins row'
);

-- Test 3: Alice CANNOT insert Bob's pin row -- RLS rejects with insufficient privileges
SELECT throws_ok(
  $$ INSERT INTO employee_pins (restaurant_id, employee_id, pin_hash, min_length)
     VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2', 'ccc', 4) $$,
  '42501',
  NULL,
  'Alice cannot insert a pin row for Bob'
);

-- Test 4: Alice's DELETE silently affects zero rows (no self-delete policy)
DELETE FROM employee_pins WHERE employee_id = '00000000-0000-0000-0000-0000000000c1';
SELECT is(
  (SELECT count(*)::int FROM employee_pins WHERE employee_id = '00000000-0000-0000-0000-0000000000c1'),
  1,
  'Alice cannot delete her own employee_pins row (no self-delete policy)'
);

-- Test 5: Deactivated employee cannot update
-- Reset to superuser to flip is_active, then switch back to Alice
RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);
UPDATE employees SET is_active = false WHERE id = '00000000-0000-0000-0000-0000000000c1';

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

-- The deactivated Alice's UPDATE should affect zero rows (RLS USING clause excludes her row).
-- Use a similar count-based assertion since RLS denials on UPDATE are silent, not error.
UPDATE employee_pins SET pin_hash = 'zzz' WHERE employee_id = '00000000-0000-0000-0000-0000000000c1';
SELECT is(
  (SELECT pin_hash FROM employee_pins WHERE employee_id = '00000000-0000-0000-0000-0000000000c1'),
  'bbb',
  'Deactivated Alice cannot update her pin row (pin_hash unchanged)'
);

SELECT * FROM finish();
ROLLBACK;
