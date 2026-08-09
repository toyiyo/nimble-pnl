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

SELECT plan(27);

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

-- ----------------------------------------------------------------------------
-- 5. Each flag alone, and both flags together, on a COWORKER row (not self).
--    The self-row exception cannot explain any result here, so every read
--    below comes only from role_flags. Three role_id-based custom roles,
--    each on the same restaurant as the self-row fixtures above, holding
--    respectively: view:pay_rates only, view:employee_pii only, both.
-- ----------------------------------------------------------------------------
SET LOCAL role TO postgres;
ALTER TABLE public.roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_flags DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin) VALUES
  ('b1111111-0000-0000-0000-0000000000c1', 'b1111111-0000-0000-0000-000000000001', 'Pay Only', 'collaborator', false),
  ('b1111111-0000-0000-0000-0000000000c2', 'b1111111-0000-0000-0000-000000000001', 'PII Only', 'collaborator', false),
  ('b1111111-0000-0000-0000-0000000000c3', 'b1111111-0000-0000-0000-000000000001', 'Both Flags', 'collaborator', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_flags (role_id, flag) VALUES
  ('b1111111-0000-0000-0000-0000000000c1', 'view:pay_rates'),
  ('b1111111-0000-0000-0000-0000000000c2', 'view:employee_pii'),
  ('b1111111-0000-0000-0000-0000000000c3', 'view:pay_rates'),
  ('b1111111-0000-0000-0000-0000000000c3', 'view:employee_pii')
ON CONFLICT (role_id, flag) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES
  ('b1111111-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pay_only@test.com',
   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('b1111111-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pii_only@test.com',
   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('b1111111-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'both_flags@test.com',
   crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- role_id is set, role stays NULL: user_has_capability resolves the two
-- flags from role_flags, never touching the legacy CASE.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role_id) VALUES
  ('b1111111-0000-0000-0000-000000000040', 'b1111111-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-0000000000c1'),
  ('b1111111-0000-0000-0000-000000000050', 'b1111111-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-0000000000c2'),
  ('b1111111-0000-0000-0000-000000000060', 'b1111111-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-0000000000c3')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role_id = EXCLUDED.role_id;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants ENABLE ROW LEVEL SECURITY;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claim.sub TO 'b1111111-0000-0000-0000-000000000040'; -- Pay Only

SELECT is(
  (SELECT hourly_rate FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  2000,
  'view:pay_rates alone unmasks a coworker''s hourly_rate'
);
SELECT is(
  (SELECT email FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  NULL::text,
  'view:pay_rates alone still masks a coworker''s email'
);

SET LOCAL request.jwt.claim.sub TO 'b1111111-0000-0000-0000-000000000050'; -- PII Only

SELECT is(
  (SELECT hourly_rate FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  NULL::integer,
  'view:employee_pii alone still masks a coworker''s hourly_rate'
);
SELECT is(
  (SELECT email FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  'coworker_staff@test.com'::text,
  'view:employee_pii alone unmasks a coworker''s email'
);

SET LOCAL request.jwt.claim.sub TO 'b1111111-0000-0000-0000-000000000060'; -- Both Flags

SELECT is(
  (SELECT hourly_rate FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  2000,
  'both flags together unmask a coworker''s hourly_rate'
);
SELECT is(
  (SELECT email FROM public.employees_secure WHERE id = 'b1111111-0000-0000-0000-000000000021'),
  'coworker_staff@test.com'::text,
  'both flags together unmask a coworker''s email'
);

-- ----------------------------------------------------------------------------
-- 6. employee_compensation_history (Step 3 of 20260806110000): the SELECT
--    policy now requires view:pay_rates, not bare membership. A caller who
--    holds view:employee_pii but not view:pay_rates reads zero rows, not an
--    error — RLS drops the rows silently.
-- ----------------------------------------------------------------------------
SET LOCAL role TO postgres;

INSERT INTO public.employee_compensation_history
  (employee_id, restaurant_id, compensation_type, amount_cents, effective_date)
VALUES
  ('b1111111-0000-0000-0000-000000000021', 'b1111111-0000-0000-0000-000000000001',
   'hourly', 2000, CURRENT_DATE)
ON CONFLICT (employee_id, effective_date) DO NOTHING;

SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claim.sub TO 'b1111111-0000-0000-0000-000000000060'; -- Both Flags: holds view:pay_rates

SELECT ok(
  (SELECT count(*) FROM public.employee_compensation_history
   WHERE restaurant_id = 'b1111111-0000-0000-0000-000000000001') >= 1,
  'a caller with view:pay_rates reads the restaurant''s compensation history'
);

SET LOCAL request.jwt.claim.sub TO 'b1111111-0000-0000-0000-000000000050'; -- PII Only: lacks view:pay_rates

SELECT is(
  (SELECT count(*) FROM public.employee_compensation_history
   WHERE restaurant_id = 'b1111111-0000-0000-0000-000000000001'),
  0::bigint,
  'a caller without view:pay_rates reads zero compensation history rows'
);

SELECT * FROM finish();
ROLLBACK;
