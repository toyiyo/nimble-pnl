-- ============================================================================
-- Test: review_time_off_request
--
-- Authz follows the trade pattern (capability check before the fetch, no
-- existence oracle). Findings: notice, same-day, coverage. p_override
-- approves through findings. Reject skips the findings. Only pending
-- requests are reviewable.
--
-- Migration under test: 20260903034700_shift_protection_review_timeoff.sql
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md
--
-- Fixture namespace: UUIDs starting with 73000000-...
-- Dates are relative to now() (lesson: hardcoded dates rot).
-- ============================================================================

BEGIN;
SELECT plan(11);

SET LOCAL role TO postgres;

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('73000000-0000-0000-0000-000000000001', 'Review Timeoff Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('73000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rt-m-73@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('73000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rt-s-73@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- M is an owner (holds edit:scheduling). S is plain staff (no capability).
INSERT INTO user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('73000000-0000-0000-0000-000000000031', '73000000-0000-0000-0000-000000000011', '73000000-0000-0000-0000-000000000001', 'owner'),
  ('73000000-0000-0000-0000-000000000032', '73000000-0000-0000-0000-000000000012', '73000000-0000-0000-0000-000000000001', 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO employees (id, restaurant_id, user_id, name, email, position, is_active) VALUES
  ('73000000-0000-0000-0000-000000000021', '73000000-0000-0000-0000-000000000001', NULL, 'Server E1', 'rt-e1-73@test.com', 'Server', true),
  ('73000000-0000-0000-0000-000000000022', '73000000-0000-0000-0000-000000000001', NULL, 'Server E2', 'rt-e2-73@test.com', 'Server', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Rules: notice warn 7 days, same-day warn limit 1, coverage warn.
DELETE FROM staffing_settings WHERE restaurant_id = '73000000-0000-0000-0000-000000000001';
INSERT INTO staffing_settings (restaurant_id, timeoff_notice_mode, timeoff_notice_days,
                               timeoff_sameday_mode, timeoff_sameday_limit, coverage_floor_mode)
VALUES ('73000000-0000-0000-0000-000000000001', 'warn', 7, 'warn', 1, 'warn');

-- Requests, dated relative to the restaurant-local today:
--   req1 (…41): starts tomorrow — notice finding only.
--   req2 (…42): 60 days out, clean — approves without findings.
--   req3 (…43): 65 days out, E2 has approved time off that day — same-day.
--   req4 (…44): 70 days out, E1 has an uncovered shift that day — coverage.
--   req5 (…45): starts tomorrow, used for the reject-skips-findings case.
--   req6 (…46): E2's approved fixture on day 65.
DELETE FROM time_off_requests WHERE restaurant_id = '73000000-0000-0000-0000-000000000001';
INSERT INTO time_off_requests (id, restaurant_id, employee_id, start_date, end_date, status)
SELECT x.id::uuid, '73000000-0000-0000-0000-000000000001', x.emp::uuid,
       (now() AT TIME ZONE 'America/Chicago')::date + x.off1,
       (now() AT TIME ZONE 'America/Chicago')::date + x.off2,
       x.status
FROM (VALUES
  ('73000000-0000-0000-0000-000000000041', '73000000-0000-0000-0000-000000000021', 1, 2, 'pending'),
  ('73000000-0000-0000-0000-000000000042', '73000000-0000-0000-0000-000000000021', 60, 61, 'pending'),
  ('73000000-0000-0000-0000-000000000043', '73000000-0000-0000-0000-000000000021', 65, 65, 'pending'),
  ('73000000-0000-0000-0000-000000000044', '73000000-0000-0000-0000-000000000021', 70, 70, 'pending'),
  ('73000000-0000-0000-0000-000000000045', '73000000-0000-0000-0000-000000000021', 1, 1, 'pending'),
  ('73000000-0000-0000-0000-000000000046', '73000000-0000-0000-0000-000000000022', 65, 65, 'approved')
) AS x(id, emp, off1, off2, status);

-- E1's uncovered Server shift on day 70 (noon-6pm local, no template, no
-- other Server overlaps): after-count 0 < required 1.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, break_duration, status)
VALUES (
  '73000000-0000-0000-0000-000000000061',
  '73000000-0000-0000-0000-000000000001',
  '73000000-0000-0000-0000-000000000021',
  (((now() AT TIME ZONE 'America/Chicago')::date + 70) + TIME '12:00') AT TIME ZONE 'America/Chicago',
  (((now() AT TIME ZONE 'America/Chicago')::date + 70) + TIME '18:00') AT TIME ZONE 'America/Chicago',
  'Server', 30, 'scheduled'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Authz
-- ============================================================================

-- 1-2. Plain staff is denied, with the same error for a random id.
SELECT set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
SELECT is(
  (SELECT review_time_off_request('73000000-0000-0000-0000-000000000042', 'approved')->>'error'),
  'Unauthorized: schedule manage access required',
  'plain staff cannot review a request'
);
SELECT is(
  (SELECT review_time_off_request('73000000-0000-0000-0000-000000000099', 'approved')->>'error'),
  'Unauthorized: schedule manage access required',
  'a random request id fails with the same error (no oracle)'
);

-- 3. Invalid action.
SELECT set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
SELECT is(
  (SELECT review_time_off_request('73000000-0000-0000-0000-000000000042', 'maybe')->>'error'),
  'Invalid action',
  'p_action outside approved/rejected is refused'
);

-- ============================================================================
-- Findings and override
-- ============================================================================

-- 4-5. Clean request approves; reviewer fields land.
SELECT is(
  (SELECT (review_time_off_request('73000000-0000-0000-0000-000000000042', 'approved')->>'success')::boolean),
  true,
  'a clean far-future request approves without findings'
);
SELECT is(
  (SELECT status || '/' || reviewed_by::text
   FROM time_off_requests WHERE id = '73000000-0000-0000-0000-000000000042'),
  'approved/73000000-0000-0000-0000-000000000011',
  'status, reviewed_by written on approval'
);

-- 6-7. Short-notice request returns a notice finding; override approves.
SELECT is(
  (SELECT r->'warnings'->0->>'rule'
   FROM review_time_off_request('73000000-0000-0000-0000-000000000041', 'approved') AS r
   WHERE r->>'code' = 'policy_warning'),
  'timeoff_notice',
  'a short-notice approval returns the notice finding'
);
SELECT is(
  (SELECT (review_time_off_request('73000000-0000-0000-0000-000000000041', 'approved', true)->>'success')::boolean),
  true,
  'p_override approves through the finding'
);

-- 8. Same-day limit finding (E2 already approved that day, limit 1).
SELECT is(
  (SELECT r->'warnings'->0->>'rule'
   FROM review_time_off_request('73000000-0000-0000-0000-000000000043', 'approved') AS r),
  'timeoff_sameday',
  'the same-day limit returns a finding'
);

-- 9. Coverage floor finding (uncovered shift on day 70).
SELECT is(
  (SELECT r->'warnings'->0->>'rule'
   FROM review_time_off_request('73000000-0000-0000-0000-000000000044', 'approved') AS r),
  'coverage_floor',
  'an uncovered shift returns the coverage finding'
);

-- 10. Reject skips the findings entirely.
SELECT is(
  (SELECT (review_time_off_request('73000000-0000-0000-0000-000000000045', 'rejected')->>'success')::boolean),
  true,
  'reject succeeds without findings on a short-notice request'
);

-- 11. A decided request is not reviewable again.
SELECT is(
  (SELECT review_time_off_request('73000000-0000-0000-0000-000000000042', 'approved')->>'error'),
  'Request is not pending',
  'an approved request cannot be reviewed again'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
