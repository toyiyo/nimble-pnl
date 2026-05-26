BEGIN;
SELECT plan(19);

-- Column exists, correct type, nullable
SELECT has_column('public', 'receipt_imports', 'file_hash', 'file_hash column should exist');
SELECT col_type_is('public', 'receipt_imports', 'file_hash', 'text', 'file_hash should be text type');
SELECT col_is_null('public', 'receipt_imports', 'file_hash', 'file_hash should be nullable');

-- Hash-lookup index exists and is partial on file_hash IS NOT NULL
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname = 'receipt_imports_restaurant_hash_idx'
      AND indexdef ILIKE '%(restaurant_id, file_hash)%'
      AND indexdef ILIKE '%WHERE (file_hash IS NOT NULL)%'
  ),
  'receipt_imports_restaurant_hash_idx exists as partial composite (restaurant_id, file_hash)'
);

-- Semantic-lookup index exists and is partial on purchase_date IS NOT NULL
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname = 'receipt_imports_restaurant_purchase_date_idx'
      AND indexdef ILIKE '%(restaurant_id, purchase_date)%'
      AND indexdef ILIKE '%WHERE (purchase_date IS NOT NULL)%'
  ),
  'receipt_imports_restaurant_purchase_date_idx exists as partial composite (restaurant_id, purchase_date)'
);

-- Neither index covers NULL rows (verify partial predicate exists by counting)
SELECT is(
  (SELECT count(*)::int FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname IN ('receipt_imports_restaurant_hash_idx', 'receipt_imports_restaurant_purchase_date_idx')
      AND indexdef ILIKE '%WHERE%'),
  2,
  'Both new indexes use a WHERE predicate (partial indexes)'
);

-- Indexes use btree (default), not some unrelated AM
SELECT is(
  (SELECT count(*)::int FROM pg_indexes pi
     JOIN pg_class c ON c.relname = pi.indexname
     JOIN pg_am am ON am.oid = c.relam
    WHERE pi.schemaname = 'public'
      AND pi.tablename = 'receipt_imports'
      AND pi.indexname IN ('receipt_imports_restaurant_hash_idx', 'receipt_imports_restaurant_purchase_date_idx')
      AND am.amname = 'btree'),
  2,
  'Both indexes use btree access method'
);

-- ---------- RLS coverage ----------
-- Setup: two restaurants, four users (one per role) in restaurant A only.
-- Each role should SELECT only restaurant A's row, never restaurant B's.

INSERT INTO public.restaurants (id, name)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Restaurant A'),
  ('22222222-2222-2222-2222-222222222222', 'Restaurant B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, instance_id, aud, role)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local',           '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager-a@test.local',         '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'chef-a@test.local',            '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'collab-inv-a@test.local',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'staff-a@test.local',           '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'kiosk-a@test.local',           '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'manager'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'chef'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'collaborator_inventory'),
  ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'staff'),
  ('aaaaaaaa-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'kiosk')
ON CONFLICT DO NOTHING;

INSERT INTO public.receipt_imports (id, restaurant_id, status, file_hash, file_name)
VALUES
  ('cccccccc-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'uploaded', 'aaaa', 'a.pdf'),
  ('cccccccc-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'uploaded', 'bbbb', 'b.pdf')
ON CONFLICT (id) DO NOTHING;

-- Helper to evaluate a SELECT under a given user
CREATE OR REPLACE FUNCTION pg_temp.visible_count(p_user_id uuid, p_restaurant_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  SELECT count(*) INTO v_count
    FROM public.receipt_imports
    WHERE restaurant_id = p_restaurant_id;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_count;
END
$$;

-- owner: SELECT permitted on own restaurant only
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid), 1, 'owner SELECTs own restaurant');
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000001'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'owner cannot SELECT other restaurant');

-- manager: SELECT permitted on own restaurant only
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid), 1, 'manager SELECTs own restaurant');
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000002'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'manager cannot SELECT other restaurant');

-- chef: SELECT denied entirely (policy restricts to owner/manager)
-- The chef-own=0 assertion also proves role switching works: without RLS it would return 1.
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000003'::uuid, '11111111-1111-1111-1111-111111111111'::uuid), 0, 'chef cannot SELECT own restaurant');
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000003'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'chef cannot SELECT other restaurant');

-- collaborator_inventory: SELECT denied entirely
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000004'::uuid, '11111111-1111-1111-1111-111111111111'::uuid), 0, 'collaborator_inventory cannot SELECT own restaurant');
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000004'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'collaborator_inventory cannot SELECT other restaurant');

-- staff: SELECT denied entirely
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000005'::uuid, '11111111-1111-1111-1111-111111111111'::uuid), 0, 'staff cannot SELECT own restaurant');
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000005'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'staff cannot SELECT other restaurant');

-- kiosk: SELECT denied entirely
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000006'::uuid, '11111111-1111-1111-1111-111111111111'::uuid), 0, 'kiosk cannot SELECT own restaurant');
SELECT is(pg_temp.visible_count('aaaaaaaa-0000-0000-0000-000000000006'::uuid, '22222222-2222-2222-2222-222222222222'::uuid), 0, 'kiosk cannot SELECT other restaurant');

SELECT * FROM finish();
ROLLBACK;
