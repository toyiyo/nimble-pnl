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

SELECT plan(19);

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

-- ----------------------------------------------------------------------------
-- 4. The self-row exception: a caller always reads their own pay and contact
--    data, flag or no flag. A coworker's row stays masked. A row with no
--    linked account (user_id IS NULL) stays masked for a caller with no
--    flags, never unmasked by a NULL-equals-NULL accident.
-- ----------------------------------------------------------------------------
SET LOCAL role TO postgres;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO public.restaurants (id, name) VALUES
  ('b1111111-0000-0000-0000-000000000001', 'Self-Row Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES
  ('b1111111-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'self_staff@test.com',
   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('b1111111-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'coworker_staff@test.com',
   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Both are plain 'staff': the legacy CASE denies view:pay_rates and
-- view:employee_pii to that role string, so any unmasking below can only
-- come from the self-row exception, not from a flag.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('b1111111-0000-0000-0000-000000000010', 'b1111111-0000-0000-0000-000000000001', 'staff'),
  ('b1111111-0000-0000-0000-000000000020', 'b1111111-0000-0000-0000-000000000001', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.employees (id, restaurant_id, user_id, name, email, hourly_rate, compensation_type, position, is_active)
VALUES
  ('b1111111-0000-0000-0000-000000000011', 'b1111111-0000-0000-0000-000000000001',
   'b1111111-0000-0000-0000-000000000010', 'Self Staff', 'self_staff@test.com', 1500, 'hourly', 'Server', true),
  ('b1111111-0000-0000-0000-000000000021', 'b1111111-0000-0000-0000-000000000001',
   'b1111111-0000-0000-0000-000000000020', 'Coworker Staff', 'coworker_staff@test.com', 2000, 'hourly', 'Server', true),
  ('b1111111-0000-0000-0000-000000000031', 'b1111111-0000-0000-0000-000000000001',
   NULL, 'Unlinked Row', 'unlinked@test.com', 999, 'hourly', 'Server', true)
ON CONFLICT (id) DO UPDATE SET
  hourly_rate = EXCLUDED.hourly_rate, email = EXCLUDED.email, user_id = EXCLUDED.user_id;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants ENABLE ROW LEVEL SECURITY;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claim.sub TO 'b1111111-0000-0000-0000-000000000010'; -- Self Staff

SELECT is(
  (SELECT hourly_rate FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000011'),
  1500,
  'a staff member reads their own hourly_rate, unmasked, flag or no flag'
);
SELECT is(
  (SELECT email FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000011'),
  'self_staff@test.com'::text,
  'a staff member reads their own email, unmasked, flag or no flag'
);
SELECT is(
  (SELECT hourly_rate FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  NULL::integer,
  'the same staff member reads NULL for a coworker''s hourly_rate'
);
SELECT is(
  (SELECT email FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  NULL::text,
  'the same staff member reads NULL for a coworker''s email'
);
SELECT is(
  (SELECT hourly_rate FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000031'),
  NULL::integer,
  'a row with no linked account (user_id IS NULL) stays masked for a caller without the flags'
);

SELECT * FROM finish();
ROLLBACK;
