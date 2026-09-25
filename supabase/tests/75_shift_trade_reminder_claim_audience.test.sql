-- ============================================================================
-- Test: claim_shift_trade_reminder, get_shift_trade_reminder_audience and
-- get_shift_trade_unclaimed_recipients (design B2 and B4 items 4, 5, 6).
--
-- The claim compares with the real clock, so the shifts here are relative
-- to now().
--
-- Fixture namespace: UUIDs that start with 75000000-...
--   R1 …-0000-000000000001, R2 …-0000-000000000002.
--   User N: …-0002-0000000000NN. Employee N: …-0001-0000000000NN.
--   Users and employees on R1:
--     01 poster P (active). P is also a manager of R1.
--     02 B, active, free (eligible).
--     03 C, inactive.
--     04 D, active, no user_id (employee row only).
--     05 E, active, overlap with a scheduled shift.
--     06 F, active, overlap with a cancelled shift (eligible).
--     07 G, active, overlap with a confirmed shift.
--     08 H, active, shift on another day (eligible).
--   Memberships on R1 (users only):
--     11 owner, 12 manager, 13 operations_manager,
--     14 collaborator_operations_manager, 15 staff, 16 manager (deleted user).
--     17 owner of R2 only.
--   Trades: TR1 open marketplace, TR2 open directed to B,
--     TR3 pending_approval, TR4 open on a started shift.
-- ============================================================================

BEGIN;
SELECT plan(26);

SET LOCAL role TO postgres;

CREATE FUNCTION pg_temp.u(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('75000000-0000-0000-0002-' || lpad(n::text, 12, '0'))::uuid
$$;
CREATE FUNCTION pg_temp.e(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('75000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid
$$;
CREATE FUNCTION pg_temp.sorted(ids uuid[]) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM unnest(ids) AS x
$$;

INSERT INTO restaurants (id, name) VALUES
  ('75000000-0000-0000-0000-000000000001', 'Claim Audience R1'),
  ('75000000-0000-0000-0000-000000000002', 'Claim Audience R2')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, deleted_at)
SELECT pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'rem-user-' || n || '-75@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '',
       CASE WHEN n = 16 THEN now() END
FROM unnest(ARRAY[1, 2, 3, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17]) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active, status) VALUES
  (pg_temp.e(1), '75000000-0000-0000-0000-000000000001', pg_temp.u(1), 'Pat Poster', 'rem-p-75@test.com', 'Server', true, 'active'),
  (pg_temp.e(2), '75000000-0000-0000-0000-000000000001', pg_temp.u(2), 'Bea Free', 'rem-b-75@test.com', 'Server', true, 'active'),
  (pg_temp.e(3), '75000000-0000-0000-0000-000000000001', pg_temp.u(3), 'Cal Inactive', 'rem-c-75@test.com', 'Server', false, 'inactive'),
  (pg_temp.e(4), '75000000-0000-0000-0000-000000000001', NULL, 'Dee NoUser', 'rem-d-75@test.com', 'Server', true, 'active'),
  (pg_temp.e(5), '75000000-0000-0000-0000-000000000001', pg_temp.u(5), 'Eve Scheduled', 'rem-e-75@test.com', 'Server', true, 'active'),
  (pg_temp.e(6), '75000000-0000-0000-0000-000000000001', pg_temp.u(6), 'Fay Cancelled', 'rem-f-75@test.com', 'Server', true, 'active'),
  (pg_temp.e(7), '75000000-0000-0000-0000-000000000001', pg_temp.u(7), 'Gus Confirmed', 'rem-g-75@test.com', 'Server', true, 'active'),
  (pg_temp.e(8), '75000000-0000-0000-0000-000000000001', pg_temp.u(8), 'Hal OtherDay', 'rem-h-75@test.com', 'Server', true, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  (pg_temp.u(1),  '75000000-0000-0000-0000-000000000001', 'manager'),
  (pg_temp.u(11), '75000000-0000-0000-0000-000000000001', 'owner'),
  (pg_temp.u(12), '75000000-0000-0000-0000-000000000001', 'manager'),
  (pg_temp.u(13), '75000000-0000-0000-0000-000000000001', 'operations_manager'),
  (pg_temp.u(14), '75000000-0000-0000-0000-000000000001', 'collaborator_operations_manager'),
  (pg_temp.u(15), '75000000-0000-0000-0000-000000000001', 'staff'),
  (pg_temp.u(16), '75000000-0000-0000-0000-000000000001', 'manager'),
  (pg_temp.u(17), '75000000-0000-0000-0000-000000000002', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Offered shifts (all by the poster) and the other employees' shifts.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status, is_published) VALUES
  ('75000000-0000-0000-0003-000000000001', '75000000-0000-0000-0000-000000000001', pg_temp.e(1), now() + interval '2 days', now() + interval '2 days 6 hours', 'Server', 0, 'scheduled', true),
  ('75000000-0000-0000-0003-000000000002', '75000000-0000-0000-0000-000000000001', pg_temp.e(1), now() + interval '3 days', now() + interval '3 days 6 hours', 'Server', 0, 'scheduled', true),
  ('75000000-0000-0000-0003-000000000003', '75000000-0000-0000-0000-000000000001', pg_temp.e(1), now() + interval '4 days', now() + interval '4 days 6 hours', 'Server', 0, 'scheduled', true),
  ('75000000-0000-0000-0003-000000000004', '75000000-0000-0000-0000-000000000001', pg_temp.e(1), now() - interval '1 hour', now() + interval '5 hours', 'Server', 0, 'scheduled', true),
  ('75000000-0000-0000-0003-000000000005', '75000000-0000-0000-0000-000000000001', pg_temp.e(5), now() + interval '2 days 2 hours', now() + interval '2 days 8 hours', 'Server', 0, 'scheduled', true),
  ('75000000-0000-0000-0003-000000000006', '75000000-0000-0000-0000-000000000001', pg_temp.e(6), now() + interval '2 days 2 hours', now() + interval '2 days 8 hours', 'Server', 0, 'cancelled', true),
  ('75000000-0000-0000-0003-000000000007', '75000000-0000-0000-0000-000000000001', pg_temp.e(7), now() + interval '2 days 2 hours', now() + interval '2 days 8 hours', 'Server', 0, 'confirmed', true),
  ('75000000-0000-0000-0003-000000000008', '75000000-0000-0000-0000-000000000001', pg_temp.e(8), now() + interval '5 days', now() + interval '5 days 6 hours', 'Server', 0, 'scheduled', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status) VALUES
  ('75000000-0000-0000-0004-000000000001', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0003-000000000001', pg_temp.e(1), NULL, 'open'),
  ('75000000-0000-0000-0004-000000000002', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0003-000000000002', pg_temp.e(1), pg_temp.e(2), 'open'),
  ('75000000-0000-0000-0004-000000000003', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0003-000000000003', pg_temp.e(1), NULL, 'pending_approval'),
  ('75000000-0000-0000-0004-000000000004', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0003-000000000004', pg_temp.e(1), NULL, 'open')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Claim (1-6)
-- ---------------------------------------------------------------------------
SELECT is(public.claim_shift_trade_reminder('75000000-0000-0000-0004-000000000001', '72h'), true,
  'claim: the first claim of a stage returns true');
SELECT is(public.claim_shift_trade_reminder('75000000-0000-0000-0004-000000000001', '72h'), false,
  'claim: a second claim of the same stage returns false');
SELECT is(public.claim_shift_trade_reminder('75000000-0000-0000-0004-000000000001', '24h'), true,
  'claim: a different stage of the same trade returns true');
SELECT is(public.claim_shift_trade_reminder('75000000-0000-0000-0004-000000000003', '24h'), false,
  'claim: a trade that is not open returns false');
SELECT is(public.claim_shift_trade_reminder('75000000-0000-0000-0004-000000000004', '6h'), false,
  'claim: a trade on a started shift returns false');
SELECT is(
  (SELECT count(*)::int FROM public.shift_trade_reminders
   WHERE shift_trade_id = '75000000-0000-0000-0004-000000000001'
     AND restaurant_id = '75000000-0000-0000-0000-000000000001'),
  2,
  'claim: two ledger rows exist, with the trade restaurant_id'
);

-- ---------------------------------------------------------------------------
-- Audience (7-13)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE aud1 AS
SELECT user_id FROM public.get_shift_trade_reminder_audience('75000000-0000-0000-0004-000000000001');

SELECT is(
  pg_temp.sorted(ARRAY(SELECT user_id FROM aud1)),
  pg_temp.sorted(ARRAY[pg_temp.u(2), pg_temp.u(6), pg_temp.u(8)]),
  'audience: only B, F and H are eligible'
);
SELECT ok(NOT EXISTS (SELECT 1 FROM aud1 WHERE user_id = pg_temp.u(1)), 'audience: excludes the poster');
SELECT ok(NOT EXISTS (SELECT 1 FROM aud1 WHERE user_id = pg_temp.u(3)), 'audience: excludes an inactive employee');
SELECT ok(NOT EXISTS (SELECT 1 FROM aud1 WHERE user_id = pg_temp.u(5)), 'audience: excludes an overlap with a scheduled shift');
SELECT ok(NOT EXISTS (SELECT 1 FROM aud1 WHERE user_id = pg_temp.u(7)), 'audience: excludes an overlap with a confirmed shift');
SELECT ok(EXISTS (SELECT 1 FROM aud1 WHERE user_id = pg_temp.u(6)), 'audience: includes an overlap with a cancelled shift');

SELECT is(
  ARRAY(SELECT user_id FROM public.get_shift_trade_reminder_audience('75000000-0000-0000-0004-000000000002')),
  ARRAY[pg_temp.u(2)],
  'audience: a directed trade returns only its target'
);

-- ---------------------------------------------------------------------------
-- Unclaimed recipients (14-21)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rec1 AS
SELECT * FROM public.get_shift_trade_unclaimed_recipients('75000000-0000-0000-0004-000000000001');

SELECT is(
  pg_temp.sorted(ARRAY(SELECT user_id FROM rec1 WHERE kind = 'scheduler')),
  pg_temp.sorted(ARRAY[pg_temp.u(11), pg_temp.u(12), pg_temp.u(13), pg_temp.u(14)]),
  'recipients: owner, manager, operations_manager and collaborator_operations_manager are schedulers'
);
SELECT ok(NOT EXISTS (SELECT 1 FROM rec1 WHERE user_id = pg_temp.u(15)), 'recipients: staff is not a recipient');
SELECT ok(NOT EXISTS (SELECT 1 FROM rec1 WHERE user_id = pg_temp.u(16)), 'recipients: a deleted user is not a recipient');
SELECT ok(NOT EXISTS (SELECT 1 FROM rec1 WHERE user_id = pg_temp.u(17)), 'recipients: an owner of another restaurant is not a recipient');
SELECT is(
  (SELECT count(*)::int FROM rec1 WHERE user_id = pg_temp.u(1)),
  1,
  'recipients: the poster returns one time'
);
SELECT is(
  (SELECT kind || '|' || COALESCE(email, '<null>') FROM rec1 WHERE user_id = pg_temp.u(1)),
  'poster|<null>',
  'recipients: the poster row has kind poster and no email'
);
SELECT is(
  (SELECT email FROM rec1 WHERE user_id = pg_temp.u(11)),
  'rem-user-11-75@test.com',
  'recipients: a scheduler email comes from auth.users'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_shift_trade_unclaimed_recipients(uuid)'::regprocedure)
  AND (SELECT proconfig FROM pg_proc WHERE oid = 'public.get_shift_trade_unclaimed_recipients(uuid)'::regprocedure)
      @> ARRAY['search_path=public, pg_temp'],
  'recipients: SECURITY DEFINER with a fixed search_path'
);

-- ---------------------------------------------------------------------------
-- Grants (22-26)
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.claim_shift_trade_reminder(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_shift_trade_reminder(uuid, text)', 'EXECUTE'),
  'anon and authenticated cannot execute claim_shift_trade_reminder'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_shift_trade_reminder_audience(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_shift_trade_reminder_audience(uuid)', 'EXECUTE'),
  'anon and authenticated cannot execute get_shift_trade_reminder_audience'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_shift_trade_unclaimed_recipients(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_shift_trade_unclaimed_recipients(uuid)', 'EXECUTE'),
  'anon and authenticated cannot execute get_shift_trade_unclaimed_recipients'
);
SELECT ok(
  has_function_privilege('service_role', 'public.claim_shift_trade_reminder(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_shift_trade_reminder_audience(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_shift_trade_unclaimed_recipients(uuid)', 'EXECUTE'),
  'service_role can execute the claim, audience and recipients functions'
);

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0002-000000000011","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.get_shift_trade_unclaimed_recipients('75000000-0000-0000-0004-000000000001') $$,
  '42501', NULL,
  'an owner with the authenticated role cannot read recipient emails'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
