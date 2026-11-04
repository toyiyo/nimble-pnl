-- ============================================================================
-- Test: approve_shift_trade re-checks + accept_shift_trade deadline block
--
-- approve_shift_trade(4-arg): happy path unchanged; findings for
-- trade_deadline, overlap, timeoff_conflict, shift_started; p_override
-- approves through findings; the 3-arg overload is gone; EXECUTE is
-- granted on the new signature.
-- accept_shift_trade: warn mode accepts; block mode refuses inside the
-- window, accepts outside it, and exempts a capability holder.
--
-- Migration under test: 20260903034800_shift_protection_trade_functions.sql
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md
--
-- Fixture namespace: UUIDs starting with 74000000-...
-- Dates are relative to now() (lesson: hardcoded dates rot).
-- ============================================================================

BEGIN;
SELECT plan(14);

SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trades DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('74000000-0000-0000-0000-000000000001', 'Trade Recheck Restaurant', 'America/Chicago'),
  ('74000000-0000-0000-0000-000000000002', 'Trade Recheck Restaurant B', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('74000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tr-m-74@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('74000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tr-oe-74@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('74000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tr-ae-74@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('74000000-0000-0000-0000-000000000031', '74000000-0000-0000-0000-000000000011', '74000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('74000000-0000-0000-0000-000000000021', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000015', 'Offerer OE', 'tr-oe-74@test.com', 'Server', true),
  ('74000000-0000-0000-0000-000000000022', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000016', 'Accepter AE', 'tr-ae-74@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Rules: warn deadline, 24 hours.
DELETE FROM staffing_settings WHERE restaurant_id = '74000000-0000-0000-0000-000000000001';
INSERT INTO staffing_settings (restaurant_id, trade_deadline_mode, trade_deadline_hours)
VALUES ('74000000-0000-0000-0000-000000000001', 'warn', 24);

-- Shifts (owner OE unless noted):
--   s1 (…41): starts in 12 hours — inside the 24h window
--   s2 (…42): local day +8, noon-6pm — clean
--   s3 (…43): local day +9, noon-6pm — AE holds an overlapping shift s3b
--   s4 (…44): local day +10, noon-6pm — AE has approved time off that day
--   s5 (…45): started 1 hour ago
--   s6 (…46): starts in 12 hours (accept, warn mode)
--   s7 (…47): starts in 12 hours (accept, block mode)
--   s8 (…48): local day +12, noon-6pm (accept, block mode, outside window)
--   s3b (…49): AE's own shift, same window as s3 — never traded
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('74000000-0000-0000-0000-000000000041', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', now() + interval '12 hours', now() + interval '18 hours', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000042', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', (((now() AT TIME ZONE 'America/Chicago')::date + 8) + TIME '12:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 8) + TIME '18:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000043', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', (((now() AT TIME ZONE 'America/Chicago')::date + 9) + TIME '12:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 9) + TIME '18:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000044', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', (((now() AT TIME ZONE 'America/Chicago')::date + 10) + TIME '12:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 10) + TIME '18:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000045', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', now() - interval '1 hour', now() + interval '5 hours', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000046', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', now() + interval '20 hours', now() + interval '23 hours', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000047', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', now() + interval '20 hours', now() + interval '23 hours', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000048', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', (((now() AT TIME ZONE 'America/Chicago')::date + 12) + TIME '12:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 12) + TIME '18:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled'),
  ('74000000-0000-0000-0000-000000000049', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000022', (((now() AT TIME ZONE 'America/Chicago')::date + 9) + TIME '13:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 9) + TIME '17:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO NOTHING;

-- The owner M also holds an employee row (ME), for the capability-exempt
-- accept assertion. s10 starts in 12 hours; t10 (seeded below, after the
-- DELETE) offers it.
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('74000000-0000-0000-0000-000000000024', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000011', 'Manager ME', 'tr-m-74@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('74000000-0000-0000-0000-000000000051', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000021', now() + interval '12 hours', now() + interval '15 hours', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO NOTHING;

-- AE approved time off exactly on the local day of s4.
DELETE FROM time_off_requests WHERE restaurant_id = '74000000-0000-0000-0000-000000000001';
INSERT INTO time_off_requests (id, restaurant_id, employee_id, start_date, end_date, status)
VALUES ('74000000-0000-0000-0000-000000000051', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000022',
        (now() AT TIME ZONE 'America/Chicago')::date + 10, (now() AT TIME ZONE 'America/Chicago')::date + 10, 'approved');

-- Trades: t1..t5 pending_approval (AE accepted), t6..t8 open.
DELETE FROM shift_trades WHERE restaurant_id = '74000000-0000-0000-0000-000000000001';
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, accepted_by_employee_id, status) VALUES
  ('74000000-0000-0000-0000-000000000061', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000041', '74000000-0000-0000-0000-000000000021', '74000000-0000-0000-0000-000000000022', 'pending_approval'),
  ('74000000-0000-0000-0000-000000000062', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000042', '74000000-0000-0000-0000-000000000021', '74000000-0000-0000-0000-000000000022', 'pending_approval'),
  ('74000000-0000-0000-0000-000000000063', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000043', '74000000-0000-0000-0000-000000000021', '74000000-0000-0000-0000-000000000022', 'pending_approval'),
  ('74000000-0000-0000-0000-000000000064', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000044', '74000000-0000-0000-0000-000000000021', '74000000-0000-0000-0000-000000000022', 'pending_approval'),
  ('74000000-0000-0000-0000-000000000065', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000045', '74000000-0000-0000-0000-000000000021', '74000000-0000-0000-0000-000000000022', 'pending_approval'),
  ('74000000-0000-0000-0000-000000000066', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000046', '74000000-0000-0000-0000-000000000021', NULL, 'open'),
  ('74000000-0000-0000-0000-000000000067', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000047', '74000000-0000-0000-0000-000000000021', NULL, 'open'),
  ('74000000-0000-0000-0000-000000000068', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000048', '74000000-0000-0000-0000-000000000021', NULL, 'open'),
  ('74000000-0000-0000-0000-000000000070', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000051', '74000000-0000-0000-0000-000000000021', NULL, 'open');

-- Cross-restaurant fixture: a shift in restaurant B, referenced by a
-- trade in restaurant A. Seeded AFTER the DELETE above so the cleanup
-- cannot erase it (7d finding). The insert trigger's tenant bind refuses
-- such a row, so disable that trigger for this one seed insert — the
-- point is to prove approve_shift_trade ALSO refuses it.
INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('74000000-0000-0000-0000-000000000023', '74000000-0000-0000-0000-000000000002', NULL, 'Server B1', 'tr-b1-74@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('74000000-0000-0000-0000-000000000050', '74000000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000023', (((now() AT TIME ZONE 'America/Chicago')::date + 15) + TIME '12:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 15) + TIME '18:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE shift_trades DISABLE TRIGGER trg_shift_protection_trade_insert;
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, accepted_by_employee_id, status) VALUES
  ('74000000-0000-0000-0000-000000000069', '74000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000050', '74000000-0000-0000-0000-000000000021', '74000000-0000-0000-0000-000000000022', 'pending_approval');
ALTER TABLE shift_trades ENABLE TRIGGER trg_shift_protection_trade_insert;


ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- approve_shift_trade
-- ============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

-- 1. Happy path unchanged: clean trade approves with 3 call args.
SELECT is(
  (SELECT (approve_shift_trade('74000000-0000-0000-0000-000000000062', '74000000-0000-0000-0000-000000000011', NULL)->>'success')::boolean),
  true,
  'a clean trade approves without an override'
);

-- 2-4. Inside the deadline window: policy_warning, rule, then override.
SELECT is(
  (SELECT approve_shift_trade('74000000-0000-0000-0000-000000000061', '74000000-0000-0000-0000-000000000011')->>'code'),
  'policy_warning',
  'a trade inside the deadline window returns policy_warning'
);
SELECT is(
  (SELECT approve_shift_trade('74000000-0000-0000-0000-000000000061', '74000000-0000-0000-0000-000000000011')->'warnings'->0->>'rule'),
  'trade_deadline',
  'the finding names the trade_deadline rule'
);
SELECT is(
  (SELECT (approve_shift_trade('74000000-0000-0000-0000-000000000061', '74000000-0000-0000-0000-000000000011', NULL, true)->>'success')::boolean),
  true,
  'p_override approves through the deadline finding'
);

-- 5. Accepter overlap re-check fires at approval time.
SELECT is(
  (SELECT approve_shift_trade('74000000-0000-0000-0000-000000000063', '74000000-0000-0000-0000-000000000011')->'warnings'->0->>'rule'),
  'overlap',
  'an accepter shift overlap returns the overlap finding'
);

-- 6. Accepter time-off conflict fires at approval time.
SELECT is(
  (SELECT approve_shift_trade('74000000-0000-0000-0000-000000000064', '74000000-0000-0000-0000-000000000011')->'warnings'->0->>'rule'),
  'timeoff_conflict',
  'accepter time off returns the timeoff_conflict finding'
);

-- 7. A started shift returns the shift_started finding.
SELECT is(
  (SELECT approve_shift_trade('74000000-0000-0000-0000-000000000065', '74000000-0000-0000-0000-000000000011')->'warnings'->0->>'rule'),
  'shift_started',
  'a started shift returns the shift_started finding'
);

-- 7b. Cross-restaurant shift: approve refuses before any transfer.
SELECT is(
  (SELECT approve_shift_trade('74000000-0000-0000-0000-000000000069', '74000000-0000-0000-0000-000000000011', NULL, true)->>'error'),
  'Shift does not belong to this restaurant',
  'approve refuses a trade whose shift lives in another restaurant, even with the override'
);

-- ============================================================================
-- accept_shift_trade
-- ============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000016","role":"authenticated"}', true);

-- 8. warn mode: accept succeeds inside the window.
SELECT is(
  (SELECT (accept_shift_trade('74000000-0000-0000-0000-000000000066', '74000000-0000-0000-0000-000000000022')->>'success')::boolean),
  true,
  'warn mode does not change the accept'
);

-- 9-10. block mode: refused inside the window, accepted outside it.
SET LOCAL role TO postgres;
UPDATE staffing_settings SET trade_deadline_mode = 'block'
WHERE restaurant_id = '74000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT accept_shift_trade('74000000-0000-0000-0000-000000000067', '74000000-0000-0000-0000-000000000022')->>'error'),
  'This trade closed: the shift starts inside the 24-hour trade window.',
  'block mode refuses an accept inside the window'
);
SELECT is(
  (SELECT (accept_shift_trade('74000000-0000-0000-0000-000000000068', '74000000-0000-0000-0000-000000000022')->>'success')::boolean),
  true,
  'block mode accepts a shift outside the window'
);

-- 10b. A capability holder is exempt from the block-mode deadline.
SELECT set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
SELECT is(
  (SELECT (accept_shift_trade('74000000-0000-0000-0000-000000000070', '74000000-0000-0000-0000-000000000024')->>'success')::boolean),
  true,
  'a capability holder accepts inside the window in block mode'
);

-- ============================================================================
-- Signature hygiene
-- ============================================================================

-- 11. The 3-argument overload is gone.
SELECT hasnt_function('public', 'approve_shift_trade', ARRAY['uuid', 'uuid', 'text'],
  'the 3-argument approve_shift_trade overload is dropped');

-- 12. EXECUTE is granted on the new signature.
SELECT ok(
  has_function_privilege('authenticated', 'approve_shift_trade(uuid, uuid, text, boolean)', 'EXECUTE'),
  'authenticated can execute the 4-argument approve_shift_trade'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
