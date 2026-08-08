-- ============================================================================
-- employee_column_gating_test.sql
--
-- Coverage for 20260806110000: the eight sensitive columns of public.employees
-- are revoked from `authenticated`, and public.employees_secure is the only
-- path to them.
--
-- Warning: a normal test role cannot read another role's column grants.
-- has_column_privilege raises "permission denied" unless the session is a
-- superuser. `SET LOCAL role TO postgres` is required, not decorative. The
-- same idiom is at supabase/tests/review_responses_rls_test.sql:98-110.
--
-- Warning: a grant-posture assertion that passes on a bare local Postgres has
-- proven nothing. Production creates every public table under `ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ON TABLES TO service_role`, and a local instance
-- has no such default to revoke. Read pg_default_acl before you trust a green.
-- ============================================================================
BEGIN;

SELECT plan(14);

SET LOCAL role TO postgres;

-- ----------------------------------------------------------------------------
-- 1. The eight sensitive columns are closed to `authenticated`.
-- ----------------------------------------------------------------------------
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'hourly_rate', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.hourly_rate'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'salary_amount', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.salary_amount'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'contractor_payment_amount', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.contractor_payment_amount'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'daily_rate_amount', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.daily_rate_amount'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'daily_rate_reference_weekly', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.daily_rate_reference_weekly'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'email', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.email'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'phone', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.phone'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'date_of_birth', 'SELECT'),
  FALSE, 'authenticated cannot SELECT employees.date_of_birth'
);

-- ----------------------------------------------------------------------------
-- 2. The 30 plain columns stay open, and anon stays shut.
-- ----------------------------------------------------------------------------
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'name', 'SELECT'),
  TRUE, 'authenticated can still SELECT employees.name'
);
SELECT is(
  has_column_privilege('authenticated', 'public.employees', 'restaurant_id', 'SELECT'),
  TRUE, 'authenticated can still SELECT employees.restaurant_id'
);
SELECT is(
  has_table_privilege('anon', 'public.employees_secure', 'SELECT'),
  FALSE, 'anon cannot SELECT the masking view'
);
SELECT is(
  has_table_privilege('authenticated', 'public.employees_secure', 'SELECT'),
  TRUE, 'authenticated can SELECT the masking view'
);

-- ----------------------------------------------------------------------------
-- 3. The view runs with owner rights and carries its own row predicate.
--    security_invoker must stay off: the caller no longer holds the column
--    privilege, so an invoker-rights view fails for everyone.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT COALESCE(
     (SELECT option FROM unnest(c.reloptions) AS option
      WHERE option LIKE 'security_invoker=%'), 'unset')
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'employees_secure'),
  'unset',
  'employees_secure does not set security_invoker'
);

SELECT ok(
  (SELECT pg_get_viewdef('public.employees_secure'::regclass) LIKE '%user_restaurants%'),
  'employees_secure carries its own row predicate against user_restaurants'
);

SELECT * FROM finish();
ROLLBACK;
