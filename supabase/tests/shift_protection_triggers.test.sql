-- ============================================================================
-- Test: Shift Protection block-mode triggers
--
-- trg_shift_protection_trade_insert  — employee trade post inside the
--   window raises; far-future post passes; capability holder is exempt.
-- trg_shift_protection_trade_accept  — the direct open -> pending_approval
--   UPDATE raises inside the window; open -> cancelled passes.
-- trg_shift_protection_timeoff      — short-notice INSERT raises; same-day
--   limit raises; clean INSERT passes; a date-edit UPDATE into the window
--   raises; capability holder is exempt; warn mode never raises.
--
-- Migration under test: 20260903034900_shift_protection_triggers.sql
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md
--
-- Fixture namespace: UUIDs starting with 75000000-...
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
  ('75000000-0000-0000-0000-000000000001', 'Trigger Guard Restaurant', 'America/Chicago'),
  ('75000000-0000-0000-0000-000000000002', 'Trigger Guard Restaurant B', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('75000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tg-m-75@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('75000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tg-e1-75@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('75000000-0000-0000-0000-000000000031', '75000000-0000-0000-0000-000000000011', '75000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('75000000-0000-0000-0000-000000000021', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000012', 'Server E1', 'tg-e1-75@test.com', 'Server', true),
  ('75000000-0000-0000-0000-000000000022', '75000000-0000-0000-0000-000000000001', NULL, 'Server E2', 'tg-e2-75@test.com', 'Server', true),
  ('75000000-0000-0000-0000-000000000023', '75000000-0000-0000-0000-000000000002', NULL, 'Server B1', 'tg-b1-75@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- E1's shifts: near (12h out) and far (local day +20).
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('75000000-0000-0000-0000-000000000041', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000021', now() + interval '12 hours', now() + interval '18 hours', 'Server', 30, 'scheduled'),
  ('75000000-0000-0000-0000-000000000042', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000021', (((now() AT TIME ZONE 'America/Chicago')::date + 20) + TIME '12:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 20) + TIME '18:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled'),
  ('75000000-0000-0000-0000-000000000043', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000021', now() + interval '20 hours', now() + interval '23 hours', 'Server', 30, 'scheduled'),
  ('75000000-0000-0000-0000-000000000044', '75000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000023', (((now() AT TIME ZONE 'America/Chicago')::date + 20) + TIME '12:00') AT TIME ZONE 'America/Chicago', (((now() AT TIME ZONE 'America/Chicago')::date + 20) + TIME '18:00') AT TIME ZONE 'America/Chicago', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO NOTHING;

-- Fixture rows that must not hit the block triggers: insert them under
-- the owner's identity (capability exempt).
SELECT set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

-- Rules: everything block. Deadline 24h, notice 7 days, same-day limit 1.
DELETE FROM staffing_settings WHERE restaurant_id = '75000000-0000-0000-0000-000000000001';
INSERT INTO staffing_settings (restaurant_id, trade_deadline_mode, trade_deadline_hours,
                               timeoff_notice_mode, timeoff_notice_days,
                               timeoff_sameday_mode, timeoff_sameday_limit)
VALUES ('75000000-0000-0000-0000-000000000001', 'block', 24, 'block', 7, 'block', 1);

-- E2 approved time off on local day +30 (the same-day fixture).
DELETE FROM time_off_requests WHERE restaurant_id = '75000000-0000-0000-0000-000000000001';
INSERT INTO time_off_requests (id, restaurant_id, employee_id, start_date, end_date, status)
VALUES ('75000000-0000-0000-0000-000000000051', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000022',
        (now() AT TIME ZONE 'America/Chicago')::date + 30, (now() AT TIME ZONE 'America/Chicago')::date + 30, 'approved');

-- An open trade on the near shift (posted by the exempt owner) for the
-- direct-accept assertions.
DELETE FROM shift_trades WHERE restaurant_id = '75000000-0000-0000-0000-000000000001';
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
VALUES ('75000000-0000-0000-0000-000000000061', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000043', '75000000-0000-0000-0000-000000000021', 'open');

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Trade INSERT guard (as employee E1)
-- ============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000012","role":"authenticated"}', true);

-- 1. Post inside the window raises.
SELECT throws_ok(
  $$INSERT INTO shift_trades (restaurant_id, offered_shift_id, offered_by_employee_id, status)
    VALUES ('75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000041',
            '75000000-0000-0000-0000-000000000021', 'open')$$,
  'P0001',
  'shift_protection:trade_deadline Trades close 24 hours before a shift starts.',
  'block mode: an employee cannot post a trade inside the window'
);

-- 2. Far-future post passes.
SELECT lives_ok(
  $$INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
    VALUES ('75000000-0000-0000-0000-000000000062', '75000000-0000-0000-0000-000000000001',
            '75000000-0000-0000-0000-000000000042', '75000000-0000-0000-0000-000000000021', 'open')$$,
  'block mode: a far-future trade post passes'
);

-- 3. The direct open -> pending_approval UPDATE raises inside the window.
SELECT throws_ok(
  $$UPDATE shift_trades
    SET status = 'pending_approval', accepted_by_employee_id = '75000000-0000-0000-0000-000000000021'
    WHERE id = '75000000-0000-0000-0000-000000000061'$$,
  'P0001',
  'shift_protection:trade_deadline Trades close 24 hours before a shift starts.',
  'block mode: the direct-accept UPDATE bypass is closed'
);

-- 4. open -> cancelled stays allowed (self-cancel path).
SELECT lives_ok(
  $$UPDATE shift_trades SET status = 'cancelled'
    WHERE id = '75000000-0000-0000-0000-000000000061'$$,
  'the cancel transition does not hit the guard'
);

-- ============================================================================
-- Time-off guard (as employee E1)
-- ============================================================================

-- 5. Short-notice INSERT raises.
SELECT throws_ok(
  $$INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
    VALUES ('75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000021',
            (now() AT TIME ZONE 'America/Chicago')::date + 1,
            (now() AT TIME ZONE 'America/Chicago')::date + 1, 'pending')$$,
  'P0001',
  'shift_protection:timeoff_notice This restaurant asks for 7 days of notice for time off.',
  'block mode: a short-notice request is refused'
);

-- 6. Same-day limit raises (E2 already approved on day +30, limit 1).
SELECT throws_ok(
  $$INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
    VALUES ('75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000021',
            (now() AT TIME ZONE 'America/Chicago')::date + 30,
            (now() AT TIME ZONE 'America/Chicago')::date + 30, 'pending')$$,
  'P0001',
  'shift_protection:timeoff_sameday 1 coworker(s) already have approved time off on a requested day (limit 1).',
  'block mode: the same-day limit is refused'
);

-- 7. A clean far-future request passes.
SELECT lives_ok(
  $$INSERT INTO time_off_requests (id, restaurant_id, employee_id, start_date, end_date, status)
    VALUES ('75000000-0000-0000-0000-000000000052', '75000000-0000-0000-0000-000000000001',
            '75000000-0000-0000-0000-000000000021',
            (now() AT TIME ZONE 'America/Chicago')::date + 40,
            (now() AT TIME ZONE 'America/Chicago')::date + 40, 'pending')$$,
  'block mode: a clean far-future request passes'
);

-- 8. The date-edit bypass is closed: an UPDATE into the window raises.
SELECT throws_ok(
  $$UPDATE time_off_requests
    SET start_date = (now() AT TIME ZONE 'America/Chicago')::date + 1,
        end_date = (now() AT TIME ZONE 'America/Chicago')::date + 1
    WHERE id = '75000000-0000-0000-0000-000000000052'$$,
  'P0001',
  'shift_protection:timeoff_notice This restaurant asks for 7 days of notice for time off.',
  'block mode: a date edit into the window is refused'
);

-- ============================================================================
-- Exemption and warn mode
-- ============================================================================

-- 9. The owner (edit:scheduling) posts a short-notice request for E2.
SELECT set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO time_off_requests (id, restaurant_id, employee_id, start_date, end_date, status)
    VALUES ('75000000-0000-0000-0000-000000000053', '75000000-0000-0000-0000-000000000001',
            '75000000-0000-0000-0000-000000000022',
            (now() AT TIME ZONE 'America/Chicago')::date + 1,
            (now() AT TIME ZONE 'America/Chicago')::date + 1, 'pending')$$,
  'a capability holder is exempt from block mode'
);

-- 10. Warn mode never raises: flip the modes, retry the short-notice insert.
UPDATE staffing_settings
SET trade_deadline_mode = 'warn', timeoff_notice_mode = 'warn', timeoff_sameday_mode = 'warn'
WHERE restaurant_id = '75000000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO time_off_requests (id, restaurant_id, employee_id, start_date, end_date, status)
    VALUES ('75000000-0000-0000-0000-000000000054', '75000000-0000-0000-0000-000000000001',
            '75000000-0000-0000-0000-000000000021',
            (now() AT TIME ZONE 'America/Chicago')::date + 1,
            (now() AT TIME ZONE 'America/Chicago')::date + 1, 'pending')$$,
  'warn mode does not raise on a short-notice request'
);

-- 11. Warn mode: a trade post inside the window passes too.
SELECT lives_ok(
  $$INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, status)
    VALUES ('75000000-0000-0000-0000-000000000063', '75000000-0000-0000-0000-000000000001',
            '75000000-0000-0000-0000-000000000041', '75000000-0000-0000-0000-000000000021', 'open')$$,
  'warn mode does not raise on a trade post inside the window'
);

-- ============================================================================
-- Tenant binds and the date-preserving edit
-- ============================================================================

-- 12. A trade cannot reference a shift of another restaurant — even for a
-- capability holder (the bind runs before the exemption).
SELECT set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO shift_trades (restaurant_id, offered_shift_id, offered_by_employee_id, status)
    VALUES ('75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000044',
            '75000000-0000-0000-0000-000000000021', 'open')$$,
  'P0001',
  'shift_protection:invalid_trade The offered shift is not in this restaurant.',
  'a trade with a cross-restaurant shift is refused'
);

-- 13. A time-off row cannot carry a foreign restaurant_id.
SELECT throws_ok(
  $$INSERT INTO time_off_requests (restaurant_id, employee_id, start_date, end_date, status)
    VALUES ('75000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000021',
            (now() AT TIME ZONE 'America/Chicago')::date + 40,
            (now() AT TIME ZONE 'America/Chicago')::date + 40, 'pending')$$,
  'P0001',
  'shift_protection:invalid_request The employee is not in this restaurant.',
  'a time-off row with a foreign restaurant_id is refused'
);

-- 14. A date-preserving edit passes even in block mode. Re-enable block,
-- then edit the reason of E1's short-notice warn-mode request (…54) with
-- both dates in the SET list but unchanged.
UPDATE staffing_settings
SET trade_deadline_mode = 'block', timeoff_notice_mode = 'block', timeoff_sameday_mode = 'block'
WHERE restaurant_id = '75000000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
SELECT lives_ok(
  $$UPDATE time_off_requests
    SET start_date = start_date, end_date = end_date, reason = 'typo fix'
    WHERE id = '75000000-0000-0000-0000-000000000054'$$,
  'a date-preserving edit does not re-run the block rules'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
