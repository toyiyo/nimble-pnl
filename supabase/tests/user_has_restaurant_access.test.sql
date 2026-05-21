-- pgTAP tests for public.user_has_restaurant_access(uuid, boolean)
--
-- Regression coverage for the 2026-05-21 production hotfix: ensures the helper
-- exists with the two-arg signature expected by callers
-- (bulk_set_employee_availability, RLS policies, future code).

BEGIN;
SELECT plan(6);

-- 1. Function exists with the expected (uuid, boolean) signature in public.
SELECT has_function(
  'public',
  'user_has_restaurant_access',
  ARRAY['uuid', 'boolean'],
  'user_has_restaurant_access(uuid, boolean) exists in public schema'
);

-- 2. Returns BOOLEAN.
SELECT function_returns(
  'public',
  'user_has_restaurant_access',
  ARRAY['uuid', 'boolean'],
  'boolean',
  'user_has_restaurant_access returns boolean'
);

-- 3. Defined SECURITY DEFINER (callable from RLS-protected contexts).
SELECT ok(
  (
    SELECT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'user_has_restaurant_access'
      AND pg_get_function_identity_arguments(p.oid) = 'p_restaurant_id uuid, p_require_manager_role boolean'
  ),
  'user_has_restaurant_access is SECURITY DEFINER'
);

-- 4. Second arg has a DEFAULT (so single-arg callers still resolve).
SELECT ok(
  (
    SELECT p.pronargdefaults = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'user_has_restaurant_access'
      AND pg_get_function_identity_arguments(p.oid) = 'p_restaurant_id uuid, p_require_manager_role boolean'
  ),
  'p_require_manager_role has a default value'
);

-- 5. Returns FALSE when there is no matching user_restaurants row (auth.uid()
--    is NULL during pgTAP runs, so no row will match for any restaurant_id).
SELECT is(
  public.user_has_restaurant_access('00000000-0000-0000-0000-000000000000'::uuid),
  false,
  'returns false when caller has no matching user_restaurants row'
);

-- 6. Same with explicit manager-required flag.
SELECT is(
  public.user_has_restaurant_access('00000000-0000-0000-0000-000000000000'::uuid, true),
  false,
  'returns false when caller has no matching user_restaurants row (manager-required)'
);

SELECT * FROM finish();
ROLLBACK;
