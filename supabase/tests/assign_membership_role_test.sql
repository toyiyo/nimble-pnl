BEGIN;
SELECT plan(25);

SELECT is(
  public.invitable_roles('owner'),
  ARRAY['owner','manager','operations_manager','chef','staff',
        'collaborator_accountant','collaborator_inventory','collaborator_chef',
        'collaborator_operations_manager'],
  'the owner row matches src/lib/permissions/invitations.ts:14-18'
);

SELECT is(
  public.invitable_roles('manager'),
  ARRAY['manager','operations_manager','chef','staff',
        'collaborator_accountant','collaborator_inventory','collaborator_chef',
        'collaborator_operations_manager'],
  'a manager may not assign owner'
);

SELECT is(public.invitable_roles('operations_manager'), ARRAY['staff'],
  'operations_manager reaches staff only');

SELECT ok(public.invitable_roles('staff') IS NULL,
  'a role with no matrix row gets NULL, not an empty array that reads as "checked and allowed nothing"');

-- kiosk is absent from every row by design: a kiosk is a shared device
-- credential, not a person (src/lib/permissions/invitations.ts:12-13).
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM (VALUES ('owner'),('manager'),('operations_manager')) AS i(r)
    WHERE 'kiosk' = ANY (public.invitable_roles(i.r))
  ),
  'nobody can assign kiosk'
);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner1@test.local'),
  ('a0000000-0000-0000-0000-000000000002', 'owner2@test.local'),
  ('a0000000-0000-0000-0000-000000000003', 'manager@test.local'),
  ('a0000000-0000-0000-0000-000000000004', 'staff@test.local'),
  ('a0000000-0000-0000-0000-000000000005', 'kiosk@test.local'),
  ('a0000000-0000-0000-0000-000000000006', 'outsider@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Test Kitchen'),
  ('c0000000-0000-0000-0000-000000000002', 'Other Kitchen');

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'owner',   public.builtin_role_id_for('owner')),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000001', 'owner',   public.builtin_role_id_for('owner')),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000001', 'manager', public.builtin_role_id_for('manager')),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000001', 'staff',   public.builtin_role_id_for('staff')),
  ('d0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005',
   'c0000000-0000-0000-0000-000000000001', 'kiosk',   public.builtin_role_id_for('kiosk'));

-- A custom role in restaurant 1, and one in restaurant 2 for the cross-tenant case.
INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'Operations Lead', 'collaborator', false),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'Other Tenant Role', 'collaborator', false);

-- ---------------------------------------------------------------- helper
-- Same shape as pg_temp.as_user_copy in copy_role_to_restaurants_test.sql:
-- switch role + jwt claims, run, switch back, never let the exception escape
-- (an escaping exception aborts the transaction and ROLLBACK fires before
-- finish() reports).
--
-- Returns the SQLSTATE rather than a bare 'raised' sentinel, because every
-- assertion below cares specifically that the denial is 42501 -- a typo
-- raising 42883 (undefined function) would satisfy "it raised" while proving
-- nothing about the privilege check.
CREATE OR REPLACE FUNCTION pg_temp.as_user_assign(
  p_user_id       UUID,
  p_membership_id UUID,
  p_role          TEXT,
  p_role_id       UUID DEFAULT NULL
) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  BEGIN
    PERFORM public.assign_membership_role(p_membership_id, p_role, p_role_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', 'postgres', true);
    RETURN SQLSTATE;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN 'ok';
END;
$$;

-- ---- The bug this whole function exists to kill -------------------------
-- Asserted as a state change, not merely "no exception": the old path also
-- raised nothing, and that was the problem.
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'chef'),
  'ok', 'a manager may move a staff member to chef');
SELECT is(
  (SELECT role FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  'chef', 'the role column actually changed');
SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  public.builtin_role_id_for('chef'),
  'role_id was written explicitly, not left to the sync trigger');

-- ---- Rule 2: never self-target -----------------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000003'::uuid, 'staff'),
  '42501', 'a caller cannot change their own role');

-- ---- Rule 3: caller with no membership row -----------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000006'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'staff'),
  '42501', 'a caller with no membership in the restaurant is denied');

-- ---- Rule 4: the matrix, both directions -------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'owner'),
  '42501', 'a manager cannot assign owner — not in the manager row');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'kiosk'),
  '42501', 'nobody can be moved INTO kiosk');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000005'::uuid, 'staff'),
  '42501', 'a kiosk credential cannot be converted into a person');

-- ---- Rule 5: owners ----------------------------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000001'::uuid, 'staff'),
  '42501', 'a manager cannot demote an owner');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'd0000000-0000-0000-0000-000000000002'::uuid, 'manager'),
  'ok', 'an owner may demote a second owner while two remain');

-- owner2 is now a manager, so owner1 is the sole owner. Nobody can demote
-- them: a manager is stopped by rule 5a, and owner1 is stopped by rule 2.
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000002'::uuid,
    'd0000000-0000-0000-0000-000000000001'::uuid, 'manager'),
  '42501', 'the sole owner cannot be demoted by the manager they just created');

-- Promoting back TO owner is its own path — only the owner matrix row
-- contains 'owner', so this also re-asserts rule 4 in the allowed direction.
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'd0000000-0000-0000-0000-000000000002'::uuid, 'owner'),
  'ok', 'an owner may promote someone back to owner');

-- ---- Rule 6: custom roles ----------------------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom'),
  '42501', 'collaborator_custom without a role_id is refused');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'staff',
    'e0000000-0000-0000-0000-000000000001'::uuid),
  '42501', 'a builtin role WITH a role_id is a caller error, not a silent preference');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom',
    'e0000000-0000-0000-0000-000000000002'::uuid),
  '42501', 'another tenant''s role_id is refused');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom',
    public.builtin_role_id_for('staff')),
  '42501', 'a global builtin role_id is refused as a custom role');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom',
    'e0000000-0000-0000-0000-000000000001'::uuid),
  'ok', 'a manager may assign this restaurant''s own custom role');

SELECT is(
  (SELECT role || '/' || role_id::text FROM public.user_restaurants
    WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  'collaborator_custom/e0000000-0000-0000-0000-000000000001',
  'both columns were written together — never collaborator_custom with a NULL role_id');

-- ---- Grants ------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.assign_membership_role(uuid,text,uuid)', 'EXECUTE'),
  'anon cannot execute the RPC');
SELECT ok(
  has_function_privilege('authenticated',
    'public.assign_membership_role(uuid,text,uuid)', 'EXECUTE'),
  'authenticated can execute the RPC');

SELECT * FROM finish();
ROLLBACK;
