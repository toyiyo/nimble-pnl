-- ============================================================================
-- Test: expire_stale_shift_trades
--
-- Expires only: status 'open' + shift started + restaurant opted in.
-- Sets the visible marker (cancelled + reviewed_at + manager_note
-- 'auto_expired'). pending_approval trades, future shifts, and opted-out
-- restaurants stay untouched. The cron job is registered. Clients cannot
-- execute the function.
--
-- Migration under test: 20260903035000_shift_protection_auto_expire.sql
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md
--
-- Fixture namespace: UUIDs starting with 76000000-...
-- ============================================================================

BEGIN;
SELECT plan(7);

SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trades DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('76000000-0000-0000-0000-000000000001', 'Auto Expire Restaurant A', 'America/Chicago'),
  ('76000000-0000-0000-0000-000000000002', 'Auto Expire Restaurant B', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('76000000-0000-0000-0000-000000000021', '76000000-0000-0000-0000-000000000001', NULL, 'AE Server A', 'ae-a-76@test.com', 'Server', true),
  ('76000000-0000-0000-0000-000000000022', '76000000-0000-0000-0000-000000000002', NULL, 'AE Server B', 'ae-b-76@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- A opts in; B does not.
DELETE FROM staffing_settings WHERE restaurant_id IN
  ('76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000002');
INSERT INTO staffing_settings (restaurant_id, trade_auto_expire) VALUES
  ('76000000-0000-0000-0000-000000000001', true),
  ('76000000-0000-0000-0000-000000000002', false);

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status) VALUES
  ('76000000-0000-0000-0000-000000000041', '76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000021', now() - interval '2 hours', now() + interval '4 hours', 'Server', 30, 'scheduled'),
  ('76000000-0000-0000-0000-000000000042', '76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000021', now() + interval '5 days', now() + interval '5 days 6 hours', 'Server', 30, 'scheduled'),
  ('76000000-0000-0000-0000-000000000043', '76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000021', now() - interval '2 hours', now() + interval '4 hours', 'Server', 30, 'scheduled'),
  ('76000000-0000-0000-0000-000000000044', '76000000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000022', now() - interval '2 hours', now() + interval '4 hours', 'Server', 30, 'scheduled')
ON CONFLICT (id) DO NOTHING;

DELETE FROM shift_trades WHERE restaurant_id IN
  ('76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000002');
INSERT INTO shift_trades (id, restaurant_id, offered_shift_id, offered_by_employee_id, accepted_by_employee_id, status) VALUES
  ('76000000-0000-0000-0000-000000000061', '76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000041', '76000000-0000-0000-0000-000000000021', NULL, 'open'),
  ('76000000-0000-0000-0000-000000000062', '76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000042', '76000000-0000-0000-0000-000000000021', NULL, 'open'),
  ('76000000-0000-0000-0000-000000000063', '76000000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000043', '76000000-0000-0000-0000-000000000021', '76000000-0000-0000-0000-000000000021', 'pending_approval'),
  ('76000000-0000-0000-0000-000000000064', '76000000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000044', '76000000-0000-0000-0000-000000000022', NULL, 'open');

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;

-- 1. Exactly one trade expires.
SELECT is(
  (SELECT expire_stale_shift_trades()),
  1,
  'exactly one trade expires'
);

-- 2. The expired trade carries the visible marker.
SELECT is(
  (SELECT status || '/' || manager_note || '/' || (reviewed_at IS NOT NULL)::text
   FROM shift_trades WHERE id = '76000000-0000-0000-0000-000000000061'),
  'cancelled/auto_expired/true',
  'the expired trade is cancelled with the auto_expired marker and reviewed_at'
);

-- 3. The future open trade stays open.
SELECT is(
  (SELECT status FROM shift_trades WHERE id = '76000000-0000-0000-0000-000000000062'),
  'open',
  'a future open trade stays open'
);

-- 4. A pending_approval trade on a started shift stays.
SELECT is(
  (SELECT status FROM shift_trades WHERE id = '76000000-0000-0000-0000-000000000063'),
  'pending_approval',
  'a pending_approval trade is not expired'
);

-- 5. The opted-out restaurant keeps its stale open trade.
SELECT is(
  (SELECT status FROM shift_trades WHERE id = '76000000-0000-0000-0000-000000000064'),
  'open',
  'an opted-out restaurant is untouched'
);

-- 6. The cron job is registered every 30 minutes.
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'shift-protection-trade-expiry'),
  '*/30 * * * *',
  'the expiry cron job is registered'
);

-- 7. Clients cannot execute the function.
SELECT ok(
  NOT has_function_privilege('authenticated', 'expire_stale_shift_trades()', 'EXECUTE'),
  'authenticated cannot execute expire_stale_shift_trades'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
