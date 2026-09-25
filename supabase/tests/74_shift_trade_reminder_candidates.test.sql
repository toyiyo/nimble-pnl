-- ============================================================================
-- Test: get_shift_trade_reminder_candidates.
--
-- The test fixes p_now at P = 2026-10-07 15:00 UTC (10:00 in Chicago).
-- Each trade gets its own shift that starts h after P. The stage set for a
-- trade is sorted as text: '24h' < '6h' < '72h' < 'unclaimed'.
--
-- Fixture namespace: UUIDs that start with 74000000-...
--   Restaurants (…-0000-00000000000N):
--     R1 America/Chicago, no settings rows (main set).
--     R2 'Not/AZone' (falls back to Chicago).
--     R3 Asia/Tokyo (P is 00:00 there, so quiet hours apply).
--     R4 block mode, trade_deadline_hours 24 (E = 36).
--     R5 both channel types off.
--     R6 reminder push off (email on); unclaimed email on (push off).
--     R7 NULL time zone.
--     R8 block mode, trade_deadline_hours 6 (E = 24).
--   Poster of restaurant N: employee …-0001-00000000000N.
--   Shift of trade T: …-0003-0000000000TT. Trade T: …-0004-0000000000TT.
-- ============================================================================

BEGIN;
SELECT plan(49);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------------------
-- Setup
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('74000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rem-poster-74@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('74000000-0000-0000-0000-000000000001', 'Candidates R1', 'America/Chicago'),
  ('74000000-0000-0000-0000-000000000002', 'Candidates R2', 'Not/AZone'),
  ('74000000-0000-0000-0000-000000000003', 'Candidates R3', 'Asia/Tokyo'),
  ('74000000-0000-0000-0000-000000000004', 'Candidates R4', 'America/Chicago'),
  ('74000000-0000-0000-0000-000000000005', 'Candidates R5', 'America/Chicago'),
  ('74000000-0000-0000-0000-000000000006', 'Candidates R6', 'America/Chicago'),
  ('74000000-0000-0000-0000-000000000007', 'Candidates R7', NULL),
  ('74000000-0000-0000-0000-000000000008', 'Candidates R8', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active, status)
SELECT ('74000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid,
       ('74000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       CASE WHEN n = 1 THEN '74000000-0000-0000-0002-000000000001'::uuid END,
       'Poster Number ' || n, 'rem-poster-' || n || '-74@test.com', 'Server', true, 'active'
FROM generate_series(1, 8) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active, status) VALUES
  ('74000000-0000-0000-0001-000000000099', '74000000-0000-0000-0000-000000000001', NULL, 'Target B', 'rem-target-74@test.com', 'Server', true, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO staffing_settings (restaurant_id, trade_deadline_mode, trade_deadline_hours) VALUES
  ('74000000-0000-0000-0000-000000000004', 'block', 24),
  ('74000000-0000-0000-0000-000000000008', 'block', 6)
ON CONFLICT (restaurant_id) DO UPDATE SET trade_deadline_mode = EXCLUDED.trade_deadline_mode, trade_deadline_hours = EXCLUDED.trade_deadline_hours;

INSERT INTO notification_channel_settings (restaurant_id, notification_type, email_enabled, push_enabled) VALUES
  ('74000000-0000-0000-0000-000000000005', 'shift_trade_reminder', false, false),
  ('74000000-0000-0000-0000-000000000005', 'shift_trade_unclaimed', false, false),
  ('74000000-0000-0000-0000-000000000006', 'shift_trade_reminder', true, false),
  ('74000000-0000-0000-0000-000000000006', 'shift_trade_unclaimed', true, false)
ON CONFLICT (restaurant_id, notification_type) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, push_enabled = EXCLUDED.push_enabled;

-- The block-mode insert guard compares with the real clock. The fixtures use
-- a fixed P, so turn the guard off for this transaction only.
ALTER TABLE shift_trades DISABLE TRIGGER trg_shift_protection_trade_insert;

CREATE FUNCTION pg_temp.tid(n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('74000000-0000-0000-0004-' || lpad(n::text, 12, '0'))::uuid
$$;

-- mk(trade number, restaurant number, hours to start, created_at, trade
-- status, shift status, target employee)
CREATE FUNCTION pg_temp.mk(
  n int, r int, h interval,
  created timestamptz DEFAULT '2026-09-27 15:00:00+00',
  t_status text DEFAULT 'open',
  s_status text DEFAULT 'scheduled',
  target uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  p timestamptz := '2026-10-07 15:00:00+00';
  sid uuid := ('74000000-0000-0000-0003-' || lpad(n::text, 12, '0'))::uuid;
BEGIN
  INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status, is_published)
  VALUES (sid,
          ('74000000-0000-0000-0000-' || lpad(r::text, 12, '0'))::uuid,
          ('74000000-0000-0000-0001-' || lpad(r::text, 12, '0'))::uuid,
          p + h, p + h + interval '6 hours', 'Server', 0, s_status, true);
  INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, target_employee_id, status, created_at)
  VALUES (pg_temp.tid(n),
          ('74000000-0000-0000-0000-' || lpad(r::text, 12, '0'))::uuid,
          sid,
          ('74000000-0000-0000-0001-' || lpad(r::text, 12, '0'))::uuid,
          target, t_status, created);
END;
$$;

-- R1: stage windows and bounds.
SELECT pg_temp.mk(1, 1, interval '72 hours');
SELECT pg_temp.mk(2, 1, interval '72 hours 1 minute');
SELECT pg_temp.mk(3, 1, interval '24 hours 1 minute');
SELECT pg_temp.mk(4, 1, interval '24 hours');
SELECT pg_temp.mk(5, 1, interval '6 hours 1 minute');
SELECT pg_temp.mk(6, 1, interval '6 hours');
SELECT pg_temp.mk(7, 1, interval '1 minute');
SELECT pg_temp.mk(8, 1, interval '0 hours');
-- R1: created-at skip rule (h = 20 h, so start - 24h = P - 4h).
SELECT pg_temp.mk(9, 1, interval '20 hours', '2026-10-07 12:00:00+00');   -- created = start - 23h
SELECT pg_temp.mk(10, 1, interval '20 hours', '2026-10-07 11:00:00+00');  -- created = start - 24h
SELECT pg_temp.mk(11, 1, interval '20 hours', NULL);                      -- created IS NULL
-- R1: unclaimed needs now - created >= 1h (h = 5 h, so start - 6h = P - 1h).
SELECT pg_temp.mk(12, 1, interval '5 hours', '2026-10-07 14:01:00+00');   -- 59 min old
SELECT pg_temp.mk(13, 1, interval '5 hours', '2026-10-07 14:00:00+00');   -- 60 min old
-- R1: trade and shift status.
SELECT pg_temp.mk(14, 1, interval '10 hours', t_status => 'pending_approval');
SELECT pg_temp.mk(15, 1, interval '10 hours', s_status => 'cancelled');
SELECT pg_temp.mk(16, 1, interval '10 hours', s_status => 'confirmed');
SELECT pg_temp.mk(19, 1, interval '10 hours', s_status => 'completed');
-- R1: an existing reminder row hides that stage only.
SELECT pg_temp.mk(17, 1, interval '10 hours');
INSERT INTO shift_trade_reminders (restaurant_id, shift_trade_id, stage)
VALUES ('74000000-0000-0000-0000-000000000001', pg_temp.tid(17), '24h');
-- R1: directed trade.
SELECT pg_temp.mk(18, 1, interval '10 hours', target => '74000000-0000-0000-0001-000000000099');
-- R1: gap between two employee stages (h = 5 h, so 6h is due).
SELECT pg_temp.mk(90, 1, interval '5 hours');   -- 24h sent 15 min before P
SELECT pg_temp.mk(91, 1, interval '5 hours');   -- 24h sent 7 h before P
SELECT pg_temp.mk(92, 1, interval '5 hours');   -- unclaimed sent 15 min before P
INSERT INTO shift_trade_reminders (restaurant_id, shift_trade_id, stage, sent_at) VALUES
  ('74000000-0000-0000-0000-000000000001', pg_temp.tid(90), '24h', '2026-10-07 14:45:00+00'),
  ('74000000-0000-0000-0000-000000000001', pg_temp.tid(91), '24h', '2026-10-07 08:00:00+00'),
  ('74000000-0000-0000-0000-000000000001', pg_temp.tid(92), 'unclaimed', '2026-10-07 14:45:00+00');
-- R2, R3, R7: time zones.
SELECT pg_temp.mk(20, 2, interval '10 hours');
SELECT pg_temp.mk(30, 3, interval '10 hours');
SELECT pg_temp.mk(70, 7, interval '10 hours');
-- R4: block mode, 24 h deadline, E = 36 h.
SELECT pg_temp.mk(40, 4, interval '30 hours');
SELECT pg_temp.mk(41, 4, interval '36 hours');
SELECT pg_temp.mk(42, 4, interval '36 hours 1 minute');
SELECT pg_temp.mk(43, 4, interval '20 hours');
SELECT pg_temp.mk(44, 4, interval '24 hours');
-- R8: block mode, 6 h deadline, E = GREATEST(24, 18) = 24 h.
SELECT pg_temp.mk(80, 8, interval '5 hours');
SELECT pg_temp.mk(81, 8, interval '24 hours');
SELECT pg_temp.mk(82, 8, interval '24 hours 1 minute');
-- R5 and R6: channel settings.
SELECT pg_temp.mk(50, 5, interval '10 hours');
SELECT pg_temp.mk(60, 6, interval '10 hours');

ALTER TABLE shift_trades ENABLE TRIGGER trg_shift_protection_trade_insert;

CREATE TEMP TABLE c AS
SELECT * FROM public.get_shift_trade_reminder_candidates('2026-10-07 15:00:00+00', 1000)
WHERE restaurant_id::text LIKE '74000000-%';

CREATE FUNCTION pg_temp.stages(n int) RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(stage ORDER BY stage), '{}') FROM c WHERE shift_trade_id = pg_temp.tid(n)
$$;

-- ---------------------------------------------------------------------------
-- Stage windows (1-8)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(1), ARRAY['72h'], 'h = 72: 72h is due (upper bound is inclusive)');
SELECT is(pg_temp.stages(2), '{}'::text[], 'h = 72 h 1 min: nothing is due');
SELECT is(pg_temp.stages(3), ARRAY['72h'], 'h = 24 h 1 min: 72h is due (lower bound is exclusive)');
SELECT is(pg_temp.stages(4), ARRAY['24h', 'unclaimed'], 'h = 24: 24h and unclaimed are due');
SELECT is(pg_temp.stages(5), ARRAY['24h', 'unclaimed'], 'h = 6 h 1 min: 24h and unclaimed are due');
SELECT is(pg_temp.stages(6), ARRAY['6h', 'unclaimed'], 'h = 6: 6h and unclaimed are due');
SELECT is(pg_temp.stages(7), ARRAY['6h', 'unclaimed'], 'h = 1 min: 6h and unclaimed are due');
SELECT is(pg_temp.stages(8), '{}'::text[], 'h = 0: a started shift gets nothing');

-- ---------------------------------------------------------------------------
-- Created-at skip rule and the 1 h unclaimed rule (9-13)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(9), ARRAY['unclaimed'], 'created after start - 24h: the 24h stage is skipped');
SELECT is(pg_temp.stages(10), ARRAY['24h', 'unclaimed'], 'created at start - 24h exactly: 24h is due');
SELECT is(pg_temp.stages(11), ARRAY['24h', 'unclaimed'], 'NULL created_at counts as -infinity');
SELECT is(pg_temp.stages(12), '{}'::text[], 'created 59 min ago: 6h is skipped and unclaimed is not due');
SELECT is(pg_temp.stages(13), ARRAY['6h', 'unclaimed'], 'created 60 min ago: 6h and unclaimed are due');

-- ---------------------------------------------------------------------------
-- Status filters (14-17)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(14), '{}'::text[], 'a pending_approval trade gets nothing');
SELECT is(pg_temp.stages(15), '{}'::text[], 'an open trade on a cancelled shift gets nothing');
SELECT is(pg_temp.stages(16), ARRAY['24h', 'unclaimed'], 'an open trade on a confirmed shift is due');
SELECT is(pg_temp.stages(19), '{}'::text[], 'an open trade on a completed shift gets nothing');

-- ---------------------------------------------------------------------------
-- Existing reminder row (18)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(17), ARRAY['unclaimed'], 'an existing 24h row hides the 24h stage only');

-- ---------------------------------------------------------------------------
-- Gap between two employee stages (19-21)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(90), ARRAY['unclaimed'], 'a 24h push 15 min ago hides the 6h stage');
SELECT is(pg_temp.stages(91), ARRAY['6h', 'unclaimed'], 'a 24h push 7 h ago does not hide the 6h stage');
SELECT is(pg_temp.stages(92), ARRAY['6h'], 'an unclaimed push 15 min ago does not hide the 6h stage');

-- ---------------------------------------------------------------------------
-- Output columns (22-27)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(18), ARRAY['24h', 'unclaimed'], 'a directed trade is due');
SELECT is(
  (SELECT DISTINCT offered_by_name FROM c WHERE shift_trade_id = pg_temp.tid(18)),
  'Poster Number 1',
  'offered_by_name is the poster name'
);
SELECT is(
  (SELECT DISTINCT restaurant_name || '|' || "position" || '|' || is_published::text FROM c WHERE shift_trade_id = pg_temp.tid(18)),
  'Candidates R1|Server|true',
  'restaurant_name, position and is_published come back'
);
SELECT is(
  (SELECT DISTINCT end_time - start_time FROM c WHERE shift_trade_id = pg_temp.tid(18)),
  interval '6 hours',
  'start_time and end_time come from the offered shift'
);
SELECT is(
  (SELECT DISTINCT start_time FROM c WHERE shift_trade_id = pg_temp.tid(18)),
  '2026-10-08 01:00:00+00'::timestamptz,
  'start_time is the offered shift start'
);
SELECT is(
  (SELECT DISTINCT restaurant_timezone FROM c WHERE shift_trade_id = pg_temp.tid(18)),
  'America/Chicago',
  'restaurant_timezone keeps a valid zone'
);

-- ---------------------------------------------------------------------------
-- Time zones and quiet hours (28-36)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(20), ARRAY['24h', 'unclaimed'], 'a garbage zone does not raise and falls back');
SELECT is(
  (SELECT DISTINCT restaurant_timezone FROM c WHERE shift_trade_id = pg_temp.tid(20)),
  'America/Chicago',
  'a garbage zone returns the fallback zone'
);
SELECT is(pg_temp.stages(70), ARRAY['24h', 'unclaimed'], 'a NULL zone falls back');
SELECT is(
  (SELECT DISTINCT restaurant_timezone FROM c WHERE shift_trade_id = pg_temp.tid(70)),
  'America/Chicago',
  'a NULL zone returns the fallback zone'
);
SELECT is(pg_temp.stages(30), '{}'::text[], 'quiet hours: 00:00 in Tokyo sends nothing');

SELECT is(
  (SELECT count(*)::int FROM public.get_shift_trade_reminder_candidates('2026-10-07 12:59:00+00', 1000)
   WHERE restaurant_id = '74000000-0000-0000-0000-000000000001'),
  0,
  'quiet hours: 07:59 in Chicago sends nothing'
);
SELECT ok(
  (SELECT count(*)::int FROM public.get_shift_trade_reminder_candidates('2026-10-07 13:00:00+00', 1000)
   WHERE restaurant_id = '74000000-0000-0000-0000-000000000001') > 0,
  'quiet hours end at 08:00 in Chicago'
);
SELECT ok(
  (SELECT count(*)::int FROM public.get_shift_trade_reminder_candidates('2026-10-08 02:59:00+00', 1000)
   WHERE restaurant_id = '74000000-0000-0000-0000-000000000001') > 0,
  'quiet hours do not apply at 21:59 in Chicago'
);
SELECT is(
  (SELECT count(*)::int FROM public.get_shift_trade_reminder_candidates('2026-10-08 03:00:00+00', 1000)
   WHERE restaurant_id = '74000000-0000-0000-0000-000000000001'),
  0,
  'quiet hours start at 22:00 in Chicago'
);

-- ---------------------------------------------------------------------------
-- Block mode (37-44)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(40), ARRAY['72h', 'unclaimed'], 'block 24: h = 30 gets 72h and unclaimed (E = 36)');
SELECT is(pg_temp.stages(41), ARRAY['72h', 'unclaimed'], 'block 24: h = 36 gets unclaimed (E bound is inclusive)');
SELECT is(pg_temp.stages(42), ARRAY['72h'], 'block 24: h = 36 h 1 min gets no unclaimed');
SELECT is(pg_temp.stages(43), ARRAY['unclaimed'], 'block 24: h = 20 skips the employee stage');
SELECT is(pg_temp.stages(44), ARRAY['unclaimed'], 'block 24: h = 24 skips the employee stage');
SELECT is(pg_temp.stages(80), ARRAY['unclaimed'], 'block 6: h = 5 skips the employee stage');
SELECT is(pg_temp.stages(81), ARRAY['24h', 'unclaimed'], 'block 6: h = 24 gets 24h and unclaimed (E = 24)');
SELECT is(pg_temp.stages(82), ARRAY['72h'], 'block 6: h = 24 h 1 min gets no unclaimed');

-- ---------------------------------------------------------------------------
-- Channel settings (45-46)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.stages(50), '{}'::text[], 'channels off: no candidate');
SELECT is(pg_temp.stages(60), ARRAY['unclaimed'], 'reminder push off: no employee stage; unclaimed email on: unclaimed stays');

-- ---------------------------------------------------------------------------
-- LIMIT and order (47-48)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.get_shift_trade_reminder_candidates('2026-10-07 15:00:00+00', 3)),
  3,
  'p_limit caps the rows'
);
SELECT is(
  (SELECT array_agg(start_time) FROM public.get_shift_trade_reminder_candidates('2026-10-07 15:00:00+00', 3)),
  (SELECT array_agg(start_time) FROM (
     SELECT start_time FROM public.get_shift_trade_reminder_candidates('2026-10-07 15:00:00+00', 1000)
     ORDER BY start_time LIMIT 3) s),
  'rows come back soonest start_time first'
);

-- ---------------------------------------------------------------------------
-- Grants (49)
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_shift_trade_reminder_candidates(timestamptz, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_shift_trade_reminder_candidates(timestamptz, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_shift_trade_reminder_candidates(timestamptz, integer)', 'EXECUTE'),
  'only service_role can execute get_shift_trade_reminder_candidates'
);

SELECT * FROM finish();
ROLLBACK;
