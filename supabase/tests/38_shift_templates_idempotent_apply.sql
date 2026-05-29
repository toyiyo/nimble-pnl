-- pgTAP tests for shift_templates idempotent "Apply suggested shifts"
-- Asserts: duplicate apply is a no-op via ON CONFLICT DO NOTHING,
--          distinct slots (different position) still insert,
--          and the days/capacity/name columns accept the produced insert shape.
--
-- Depends on migration: 20260528120000_shift_templates_idempotent_apply.sql
-- which creates:
--   CREATE UNIQUE INDEX uq_shift_templates_active_slot
--     ON public.shift_templates (restaurant_id, position, start_time, end_time)
--     WHERE is_active = true;

BEGIN;

SELECT plan(3);

-- ============================================================
-- Setup: disable RLS so the test can insert without auth context
-- ============================================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates DISABLE ROW LEVEL SECURITY;

-- Seed a restaurant and one active template that will serve as the collision target
INSERT INTO restaurants (id, name)
VALUES ('00000000-0000-0000-0000-0000000000aa', 'Idempotency Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
VALUES (
  '00000000-0000-0000-0000-0000000000aa',
  'Suggested · Server 17:00-22:00',
  '{5}',
  '17:00:00',
  '22:00:00',
  0,
  'Server',
  2,
  true
);

-- ============================================================
-- Test 1: A duplicate active slot violates the unique index
-- ============================================================

SELECT throws_ok(
  $$
    INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
    VALUES (
      '00000000-0000-0000-0000-0000000000aa',
      'dup',
      '{5}',
      '17:00:00',
      '22:00:00',
      0,
      'Server',
      2,
      true
    )
  $$,
  '23505',
  NULL,
  'duplicate active slot violates unique index'
);

-- ============================================================
-- Test 2: ON CONFLICT DO NOTHING makes re-apply a silent no-op
-- ============================================================

SELECT lives_ok(
  $$
    INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
    VALUES (
      '00000000-0000-0000-0000-0000000000aa',
      'dup',
      '{5}',
      '17:00:00',
      '22:00:00',
      0,
      'Server',
      2,
      true
    )
    ON CONFLICT (restaurant_id, position, start_time, end_time) WHERE is_active = true DO NOTHING
  $$,
  'ON CONFLICT DO NOTHING re-apply is a no-op'
);

-- ============================================================
-- Test 3: A distinct slot (different position) still inserts
-- ============================================================

SELECT lives_ok(
  $$
    INSERT INTO shift_templates (restaurant_id, name, days, start_time, end_time, break_duration, position, capacity, is_active)
    VALUES (
      '00000000-0000-0000-0000-0000000000aa',
      'Suggested · Cook 17:00-22:00',
      '{5}',
      '17:00:00',
      '22:00:00',
      0,
      'Cook',
      1,
      true
    )
  $$,
  'distinct position inserts without conflict'
);

SELECT * FROM finish();
ROLLBACK;
