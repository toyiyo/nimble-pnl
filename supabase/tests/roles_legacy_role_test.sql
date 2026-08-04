-- roles.legacy_role — the builtin-role-string <-> roles-row mapping the client
-- reads so it never hardcodes a builtin UUID.
BEGIN;
SELECT plan(6);

-- A. The column exists and is nullable.
SELECT has_column('public', 'roles', 'legacy_role', 'roles.legacy_role exists');
SELECT col_is_null('public', 'roles', 'legacy_role', 'legacy_role is nullable (custom roles have none)');

-- B. All ten builtins agree with builtin_role_id_for. This is the whole point
--    of the column: if it drifts, the client resolves the wrong role.
SELECT is(
  (SELECT count(*)::int FROM public.roles r
    WHERE r.legacy_role IS NOT NULL
      AND public.builtin_role_id_for(r.legacy_role) = r.id),
  10,
  'all ten builtin rows round-trip through builtin_role_id_for'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE legacy_role IS NOT NULL),
  10,
  'exactly ten rows carry a legacy_role — no more, no fewer'
);

-- C. The invariants are enforced by the database, not by this test alone.
--    An UPDATE of an existing builtin row is not a usable probe here: the
--    pre-existing roles_block_builtin_mutation trigger (BEFORE UPDATE OR
--    DELETE, 20260730100000_roles_and_areas_tables.sql) rejects ANY update to
--    a builtin row with 42501 before the unique index is ever reached. An
--    INSERT of a second builtin-flavored row carrying an already-taken
--    legacy_role exercises the same index without tripping that trigger.
SELECT throws_ok(
  $$ INSERT INTO public.roles (restaurant_id, name, flavor, builtin, legacy_role)
     VALUES (NULL, 'Bogus Manager', 'platform', true, 'manager') $$,
  '23505',
  NULL,
  'a duplicated legacy_role is rejected by the partial unique index'
);

SELECT throws_ok(
  $$ INSERT INTO public.roles (restaurant_id, name, flavor, builtin, legacy_role)
     VALUES (NULL, 'Bogus', 'collaborator', false, 'staff') $$,
  '23514',
  NULL,
  'a non-builtin row cannot carry a legacy_role'
);

SELECT * FROM finish();
ROLLBACK;
