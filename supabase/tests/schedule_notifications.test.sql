-- pgTAP tests for the schedule notification ledger.
-- Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md
-- TLA+:   specs/tla/publish-notifications/PublishNotifications.tla
--
-- Covers:
--   * the tables, the unique (change, employee) link, grants, and RLS;
--   * the change-log date columns, `tracked`, and nullable changed_by;
--   * log_shift_change: the `published` branch (flip and INSERT), the
--     column-compare rule for `updated`, `deleted`, and `unpublished`;
--   * get_schedule_pending_notifications and get_schedule_week_change_log;
--   * claim_schedule_notifications and mark_schedule_notification, with the
--     TLA+ invariants: a second publish with no change claims nothing, and
--     no (change, employee) pair is claimed twice.
--
-- No hardcoded dates: the week is the next Monday after CURRENT_DATE.
-- Instants are `<local timestamp> AT TIME ZONE 'America/Chicago'`.

BEGIN;

SELECT plan(62);

SET LOCAL role TO postgres;

CREATE TEMP TABLE cfg AS
SELECT (CURRENT_DATE + (8 - EXTRACT(ISODOW FROM CURRENT_DATE)::int)) AS ws;
GRANT SELECT ON cfg TO authenticated, service_role;

-- Users: a manager (owner of R1), a staff member of R1, and an owner of R2.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('5c000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sn-owner@example.com', crypt('pw', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('5c000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sn-staff@example.com', crypt('pw', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('5c000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sn-other@example.com', crypt('pw', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name, timezone) VALUES
  ('5c100000-0000-0000-0000-000000000001', 'SN Chicago', 'America/Chicago'),
  ('5c100000-0000-0000-0000-000000000002', 'SN Other',   'America/Chicago'),
  ('5c100000-0000-0000-0000-000000000003', 'SN Bad TZ',  'Not/AZone')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('5c000000-0000-0000-0000-000000000001', '5c100000-0000-0000-0000-000000000001', 'owner'),
  ('5c000000-0000-0000-0000-000000000002', '5c100000-0000-0000-0000-000000000001', 'staff'),
  ('5c000000-0000-0000-0000-000000000003', '5c100000-0000-0000-0000-000000000002', 'owner'),
  ('5c000000-0000-0000-0000-000000000001', '5c100000-0000-0000-0000-000000000003', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO employees (id, restaurant_id, name, position, status) VALUES
  ('5c200000-0000-0000-0000-00000000000a', '5c100000-0000-0000-0000-000000000001', 'Ana',  'Server', 'active'),
  ('5c200000-0000-0000-0000-00000000000b', '5c100000-0000-0000-0000-000000000001', 'Ben',  'Server', 'active'),
  ('5c200000-0000-0000-0000-00000000000c', '5c100000-0000-0000-0000-000000000002', 'Cara', 'Server', 'active'),
  ('5c200000-0000-0000-0000-00000000000d', '5c100000-0000-0000-0000-000000000003', 'Dan',  'Server', 'active')
ON CONFLICT (id) DO UPDATE SET restaurant_id = EXCLUDED.restaurant_id, name = EXCLUDED.name, status = EXCLUDED.status;

SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- ============================================================
-- 1. Tables, unique link, grants
-- ============================================================
SELECT has_table('public', 'schedule_notifications', 'schedule_notifications exists');
SELECT has_table('public', 'schedule_notification_changes', 'schedule_notification_changes exists');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'schedule_notification_changes'
          AND indexdef ILIKE '%UNIQUE%(change_log_id, employee_id)%'),
  'a UNIQUE index covers (change_log_id, employee_id)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.schedule_notifications', 'INSERT'),
  'authenticated cannot INSERT schedule_notifications');
SELECT ok(NOT has_table_privilege('authenticated', 'public.schedule_notification_changes', 'INSERT'),
  'authenticated cannot INSERT schedule_notification_changes');
SELECT ok(has_table_privilege('authenticated', 'public.schedule_notifications', 'SELECT'),
  'authenticated can SELECT schedule_notifications (RLS decides rows)');
SELECT ok(NOT has_table_privilege('anon', 'public.schedule_notifications', 'SELECT'),
  'anon cannot SELECT schedule_notifications');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.claim_schedule_notifications(uuid, date, date, text, uuid, uuid)', 'EXECUTE'),
  'authenticated cannot execute claim_schedule_notifications');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.mark_schedule_notification(uuid, text, text[], text)', 'EXECUTE'),
  'authenticated cannot execute mark_schedule_notification');
SELECT ok(has_function_privilege('service_role',
  'public.claim_schedule_notifications(uuid, date, date, text, uuid, uuid)', 'EXECUTE'),
  'service_role can execute claim_schedule_notifications');
SELECT ok(NOT has_function_privilege('anon',
  'public.get_schedule_pending_notifications(uuid, date, date)', 'EXECUTE'),
  'anon cannot execute get_schedule_pending_notifications');
SELECT ok(NOT has_function_privilege('anon',
  'public.get_schedule_week_change_log(uuid, date, date)', 'EXECUTE'),
  'anon cannot execute get_schedule_week_change_log');

-- ============================================================
-- 2. Change-log columns
-- ============================================================
SELECT has_column('schedule_change_logs', 'shift_date_before', 'shift_date_before exists');
SELECT has_column('schedule_change_logs', 'shift_date_after', 'shift_date_after exists');
SELECT col_not_null('schedule_change_logs', 'tracked', 'tracked is NOT NULL');
SELECT col_is_null('schedule_change_logs', 'changed_by', 'changed_by is nullable');

-- ============================================================
-- 3. Trigger branches
-- ============================================================
-- S1: Ana, Monday 10:00-18:00 local. S2: Ben, Sunday 22:00 local (next UTC day).
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT '5c300000-0000-0000-0000-000000000001', '5c100000-0000-0000-0000-000000000001',
       '5c200000-0000-0000-0000-00000000000a',
       (ws::timestamp + interval '10 hours') AT TIME ZONE 'America/Chicago',
       (ws::timestamp + interval '18 hours') AT TIME ZONE 'America/Chicago', 'Server'
FROM cfg;
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position)
SELECT '5c300000-0000-0000-0000-000000000002', '5c100000-0000-0000-0000-000000000001',
       '5c200000-0000-0000-0000-00000000000b',
       ((ws + 6)::timestamp + interval '22 hours') AT TIME ZONE 'America/Chicago',
       ((ws + 6)::timestamp + interval '26 hours') AT TIME ZONE 'America/Chicago', 'Server'
FROM cfg;

SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE restaurant_id = '5c100000-0000-0000-0000-000000000001'), 0,
  'a draft INSERT writes no change-log row');

-- First publish: two flips -> two `published` rows.
SELECT lives_ok($$
  SELECT publish_schedule('5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), NULL)
$$, 'first publish runs');

SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE restaurant_id = '5c100000-0000-0000-0000-000000000001' AND change_type = 'published'), 2,
  'the publish flip writes one published row per shift');

SELECT is((SELECT shift_date_after FROM schedule_change_logs
           WHERE shift_id = '5c300000-0000-0000-0000-000000000002' AND change_type = 'published'),
          (SELECT ws + 6 FROM cfg),
  'shift_date_after is the restaurant local date (Sunday 22:00 Chicago stays Sunday)');

SELECT ok((SELECT bool_and(tracked) FROM schedule_change_logs
           WHERE restaurant_id = '5c100000-0000-0000-0000-000000000001'),
  'new rows are tracked');

SELECT is((SELECT changed_by FROM schedule_change_logs
           WHERE shift_id = '5c300000-0000-0000-0000-000000000001' AND change_type = 'published'),
          '5c000000-0000-0000-0000-000000000001'::uuid,
  'the published row records the actor');

-- No-op update (Sling-style upsert): no row.
UPDATE shifts SET updated_at = now(), locked = true WHERE id = '5c300000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE shift_id = '5c300000-0000-0000-0000-000000000001' AND change_type = 'updated'), 0,
  'an update with no visible change writes no row');

-- Status change (clock-in): no row.
UPDATE shifts SET status = 'confirmed' WHERE id = '5c300000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE shift_id = '5c300000-0000-0000-0000-000000000001' AND change_type = 'updated'), 0,
  'a status change writes no row');

-- ============================================================
-- 4. Claim after the first publish
-- ============================================================
SET LOCAL role TO service_role;

CREATE TEMP TABLE claim1 AS
SELECT * FROM claim_schedule_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), 'publish', NULL, NULL);

SELECT is((SELECT count(*)::int FROM claim1), 2, 'first claim makes one row per employee');
SELECT is((SELECT array_length(change_log_ids, 1) FROM claim1
           WHERE employee_id = '5c200000-0000-0000-0000-00000000000a'), 1,
  'Ana''s row holds her one change');

-- A concurrent second claim finds nothing free (rows are claimed, not sent).
SELECT is((SELECT count(*)::int FROM claim_schedule_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), 'publish', NULL, NULL)), 0,
  'a second claim while the first is in flight claims nothing (no double send)');

-- Mark Ana sent, Ben failed.
SELECT ok(mark_schedule_notification(
  (SELECT notification_id FROM claim1 WHERE employee_id = '5c200000-0000-0000-0000-00000000000a'),
  'sent', ARRAY['email'], NULL), 'mark sent returns true');
SELECT ok(mark_schedule_notification(
  (SELECT notification_id FROM claim1 WHERE employee_id = '5c200000-0000-0000-0000-00000000000b'),
  'failed', ARRAY[]::text[], 'provider 500'), 'mark failed returns true');
SELECT ok(NOT mark_schedule_notification(
  (SELECT notification_id FROM claim1 WHERE employee_id = '5c200000-0000-0000-0000-00000000000a'),
  'failed', ARRAY[]::text[], NULL), 'a sent row cannot be marked again');
SELECT isnt((SELECT sent_at FROM schedule_notifications
             WHERE id = (SELECT notification_id FROM claim1 WHERE employee_id = '5c200000-0000-0000-0000-00000000000a')),
            NULL, 'mark sent stamps sent_at');

-- ============================================================
-- 5. Pending, as the owner
-- ============================================================
SET LOCAL role TO authenticated;

SELECT is((SELECT count(*)::int FROM get_schedule_pending_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))), 1,
  'only Ben''s failed change is pending');
SELECT is((SELECT state FROM get_schedule_pending_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))), 'failed',
  'the pending state is failed');

-- ============================================================
-- 6. Second publish with no change: nothing new; the failed row comes back
-- ============================================================
SELECT lives_ok($$
  SELECT publish_schedule('5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), NULL)
$$, 'second publish runs');
SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE restaurant_id = '5c100000-0000-0000-0000-000000000001' AND change_type = 'published'), 2,
  'a second publish with no draft writes no row');

SET LOCAL role TO service_role;
CREATE TEMP TABLE claim2 AS
SELECT * FROM claim_schedule_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), 'publish', NULL, NULL);
SELECT is((SELECT count(*)::int FROM claim2), 1, 'the retry claims only the failed row');
SELECT is((SELECT notification_id FROM claim2),
          (SELECT notification_id FROM claim1 WHERE employee_id = '5c200000-0000-0000-0000-00000000000b'),
  'the failed row keeps its id (same idempotency key)');
SELECT ok((SELECT reclaimed FROM claim2), 'the retry row is flagged reclaimed');
SELECT ok(mark_schedule_notification((SELECT notification_id FROM claim2), 'sent', ARRAY['push'], NULL),
  'the retry is marked sent');

SELECT is((SELECT count(*)::int FROM claim_schedule_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), 'publish', NULL, NULL)), 0,
  'TLA+ NoEmptyNotification: a publish with no change claims nothing');

-- ============================================================
-- 7. Edit after publish: reassignment Ana -> Ben, and a time change
-- ============================================================
SET LOCAL role TO authenticated;
UPDATE shifts SET employee_id = '5c200000-0000-0000-0000-00000000000b'
WHERE id = '5c300000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE shift_id = '5c300000-0000-0000-0000-000000000001' AND change_type = 'updated'), 1,
  'a reassignment writes exactly one updated row (TLA+ LogExactlyOnce)');

SELECT is((SELECT count(*)::int FROM get_schedule_pending_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))), 2,
  'the reassignment is pending for both the old and the new employee');

SET LOCAL role TO service_role;
CREATE TEMP TABLE claim3 AS
SELECT * FROM claim_schedule_notifications(
  '5c100000-0000-0000-0000-000000000001', NULL, NULL, 'shift_change', NULL,
  (SELECT id FROM schedule_change_logs WHERE shift_id = '5c300000-0000-0000-0000-000000000001' AND change_type = 'updated'));
SELECT is((SELECT count(*)::int FROM claim3), 2, 'a shift-change claim makes a row for each recipient');
SELECT ok(NOT EXISTS (SELECT 1 FROM claim3 WHERE notification_id IN (SELECT notification_id FROM claim1)),
  'new pairs go to new rows, never into an old row');

-- The publish notifier now runs too: it must not take the same pairs.
SELECT is((SELECT count(*)::int FROM claim_schedule_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), 'publish', NULL, NULL)), 0,
  'TLA+ NoDuplicateDelivery: the publish claim skips pairs held by the shift-change claim');

-- Stale claim inside the window comes back; outside the window it does not.
UPDATE schedule_notifications SET claimed_at = now() - interval '15 minutes', created_at = now() - interval '15 minutes'
WHERE id = (SELECT notification_id FROM claim3 WHERE employee_id = '5c200000-0000-0000-0000-00000000000a');
UPDATE schedule_notifications SET claimed_at = now() - interval '2 hours', created_at = now() - interval '2 hours'
WHERE id = (SELECT notification_id FROM claim3 WHERE employee_id = '5c200000-0000-0000-0000-00000000000b');

CREATE TEMP TABLE claim4 AS
SELECT * FROM claim_schedule_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), 'publish', NULL, NULL);
SELECT is((SELECT count(*)::int FROM claim4), 1, 'only the 15-minute-old claim is taken back');
SELECT is((SELECT employee_id FROM claim4), '5c200000-0000-0000-0000-00000000000a'::uuid,
  'the taken-back claim is Ana''s');

SET LOCAL role TO authenticated;
SELECT is((SELECT state FROM get_schedule_pending_notifications(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))
  WHERE employee_id = '5c200000-0000-0000-0000-00000000000b'), 'in_doubt',
  'a claim older than the window shows as in_doubt');

-- ============================================================
-- 8. Change log
-- ============================================================
SELECT is((SELECT count(*)::int FROM get_schedule_week_change_log(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))), 3,
  'the week change log has two published rows and one updated row');
SELECT is((SELECT jsonb_array_length(notifications) FROM get_schedule_week_change_log(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))
  WHERE shift_id = '5c300000-0000-0000-0000-000000000002'), 1,
  'Ben''s published row shows one notification');
SELECT is((SELECT notifications->0->>'status' FROM get_schedule_week_change_log(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))
  WHERE shift_id = '5c300000-0000-0000-0000-000000000002'), 'sent',
  'that notification is sent');
SELECT is((SELECT changed_by_email FROM get_schedule_week_change_log(
  '5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg))
  WHERE change_type = 'updated'), 'sn-owner@example.com',
  'the change log names the actor');

-- ============================================================
-- 9. Access checks
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT throws_ok($$
  SELECT * FROM get_schedule_pending_notifications('5c100000-0000-0000-0000-000000000001', NULL, NULL)
$$, '42501', NULL, 'a staff member cannot read pending notifications');
SELECT is((SELECT count(*)::int FROM schedule_notifications
           WHERE restaurant_id = '5c100000-0000-0000-0000-000000000001'), 0,
  'RLS hides notification rows from a staff member');

SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT throws_ok($$
  SELECT * FROM get_schedule_week_change_log('5c100000-0000-0000-0000-000000000001', NULL, NULL)
$$, '42501', NULL, 'an owner of another restaurant cannot read the change log');
SELECT is((SELECT count(*)::int FROM schedule_notifications
           WHERE restaurant_id = '5c100000-0000-0000-0000-000000000001'), 0,
  'RLS hides notification rows across tenants');

-- ============================================================
-- 10. Delete, unpublish, INSERT published, bad time zone, untracked rows
-- ============================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"5c000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL role TO postgres;

DELETE FROM shifts WHERE id = '5c300000-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE shift_id = '5c300000-0000-0000-0000-000000000002' AND change_type = 'deleted'), 1,
  'deleting a published shift writes one deleted row');

-- Open-shift claim path: an INSERT with is_published = true.
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, is_published, locked)
SELECT '5c300000-0000-0000-0000-000000000003', '5c100000-0000-0000-0000-000000000001',
       '5c200000-0000-0000-0000-00000000000a',
       ((ws + 2)::timestamp + interval '9 hours') AT TIME ZONE 'America/Chicago',
       ((ws + 2)::timestamp + interval '15 hours') AT TIME ZONE 'America/Chicago', 'Server', true, true
FROM cfg;
SELECT is((SELECT count(*)::int FROM schedule_change_logs
           WHERE shift_id = '5c300000-0000-0000-0000-000000000003' AND change_type = 'published'), 1,
  'an INSERT of a published shift writes one published row');

SELECT lives_ok($$
  SELECT unpublish_schedule('5c100000-0000-0000-0000-000000000001', (SELECT ws FROM cfg), (SELECT ws + 6 FROM cfg), 'test')
$$, 'unpublish runs');
SET LOCAL role TO authenticated;
SELECT ok(NOT EXISTS (SELECT 1 FROM get_schedule_pending_notifications(
  '5c100000-0000-0000-0000-000000000001', NULL, NULL) WHERE change_type = 'unpublished'),
  'unpublished rows are never pending');
SET LOCAL role TO postgres;

-- Bad time zone falls back to UTC (publish_schedule's rule).
INSERT INTO schedule_change_logs (restaurant_id, shift_id, employee_id, change_type, changed_by, after_data)
VALUES ('5c100000-0000-0000-0000-000000000003', gen_random_uuid(), '5c200000-0000-0000-0000-00000000000d',
        'updated', NULL, jsonb_build_object('start_time', '2030-01-07T03:00:00+00:00', 'employee_id', '5c200000-0000-0000-0000-00000000000d'));
SELECT is((SELECT shift_date_after FROM schedule_change_logs WHERE restaurant_id = '5c100000-0000-0000-0000-000000000003'),
          DATE '2030-01-07', 'an invalid time zone falls back to UTC; a null changed_by is accepted');

-- Untracked (pre-deploy) rows are never pending.
UPDATE schedule_change_logs SET tracked = false WHERE restaurant_id = '5c100000-0000-0000-0000-000000000003';
UPDATE schedule_change_logs SET after_data = after_data || '{"is_published": true}'::jsonb
WHERE restaurant_id = '5c100000-0000-0000-0000-000000000003';
SET LOCAL role TO authenticated;
SELECT is((SELECT count(*)::int FROM get_schedule_pending_notifications(
  '5c100000-0000-0000-0000-000000000003', NULL, NULL)), 0,
  'an untracked row is never pending');

SELECT * FROM finish();
ROLLBACK;
