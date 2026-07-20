-- ============================================================================
-- Tests for notification_channel_settings table
--
-- Verifies table structure, defaults, UNIQUE/CHECK constraints, the updated_at
-- trigger, RLS (member SELECT / owner+manager-only write), cross-restaurant
-- isolation, and the data-migration backfill from the legacy
-- notification_settings single-boolean-per-type columns.
--
-- Migration: 20260719120000_notification_channel_settings.sql
-- ============================================================================

BEGIN;
SELECT plan(20);

-- ============================================================================
-- TEST CATEGORY 1: Table and column structure (Tests 1-4)
-- ============================================================================

SELECT has_table('public', 'notification_channel_settings', 'notification_channel_settings table should exist');
SELECT has_column('public', 'notification_channel_settings', 'notification_type', 'should have notification_type column');
SELECT has_column('public', 'notification_channel_settings', 'email_enabled', 'should have email_enabled column');
SELECT has_column('public', 'notification_channel_settings', 'push_enabled', 'should have push_enabled column');

-- ============================================================================
-- TEST CATEGORY 2: Defaults, UNIQUE, CHECK, trigger (Tests 5-9)
-- ============================================================================

SET LOCAL role TO postgres;
ALTER TABLE notification_channel_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name) VALUES
  ('c9000000-0000-0000-0000-000000000001', 'Notif Channel Test Restaurant 1'),
  ('c9000000-0000-0000-0000-000000000002', 'Notif Channel Test Restaurant 2'),
  ('c9000000-0000-0000-0000-000000000003', 'Notif Channel Test Restaurant 3 (non-member)')
ON CONFLICT (id) DO NOTHING;

-- Test 5-6: Defaults are true/true
INSERT INTO notification_channel_settings (id, restaurant_id, notification_type)
VALUES ('c9000000-0000-0000-0000-100000000001', 'c9000000-0000-0000-0000-000000000001', 'pin_reset');

SELECT is(
  (SELECT email_enabled FROM notification_channel_settings WHERE id = 'c9000000-0000-0000-0000-100000000001'),
  true,
  'Default email_enabled should be true'
);

SELECT is(
  (SELECT push_enabled FROM notification_channel_settings WHERE id = 'c9000000-0000-0000-0000-100000000001'),
  true,
  'Default push_enabled should be true'
);

-- Test 7: UNIQUE(restaurant_id, notification_type) rejects a duplicate
SELECT throws_ok(
  $$INSERT INTO notification_channel_settings (restaurant_id, notification_type)
    VALUES ('c9000000-0000-0000-0000-000000000001', 'pin_reset')$$,
  '23505',
  NULL,
  'UNIQUE constraint should prevent duplicate (restaurant_id, notification_type)'
);

-- Test 8: CHECK constraint rejects a notification_type not in the catalog
SELECT throws_ok(
  $$INSERT INTO notification_channel_settings (restaurant_id, notification_type)
    VALUES ('c9000000-0000-0000-0000-000000000001', 'not_a_real_type')$$,
  '23514',
  NULL,
  'CHECK constraint should reject an unknown notification_type'
);

-- Test 9: updated_at trigger advances on UPDATE. NOW() is transaction-scoped in
-- Postgres (constant for the whole test transaction), so comparing updated_at to
-- created_at (both defaulted via NOW() at insert time) would never show a
-- difference. Instead, force updated_at to a sentinel past value at INSERT
-- (bypassing the BEFORE UPDATE trigger), then verify the trigger overwrites it
-- on UPDATE.
INSERT INTO notification_channel_settings (id, restaurant_id, notification_type, updated_at)
VALUES ('c9000000-0000-0000-0000-100000000009', 'c9000000-0000-0000-0000-000000000001', 'availability_reminder', '2000-01-01T00:00:00Z');

UPDATE notification_channel_settings
  SET email_enabled = false
  WHERE id = 'c9000000-0000-0000-0000-100000000009';

SELECT isnt(
  (SELECT updated_at FROM notification_channel_settings WHERE id = 'c9000000-0000-0000-0000-100000000009'),
  '2000-01-01T00:00:00Z'::timestamptz,
  'updated_at trigger should overwrite the sentinel value on UPDATE'
);

-- ============================================================================
-- TEST CATEGORY 3: RLS (Tests 10-16)
-- ============================================================================

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('c9000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notifchannel_owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('c9000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notifchannel_staff@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('c9000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notifchannel_nonmember@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- User 10 = owner of restaurant 1
-- User 20 = staff of restaurant 1
-- User 30 = no memberships (non-member)
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('c9000000-0000-0000-0000-000000000010', 'c9000000-0000-0000-0000-000000000001', 'owner'),
  ('c9000000-0000-0000-0000-000000000020', 'c9000000-0000-0000-0000-000000000001', 'staff')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- A row on restaurant 2 that none of our test users belong to (for cross-restaurant isolation)
INSERT INTO notification_channel_settings (id, restaurant_id, notification_type)
VALUES ('c9000000-0000-0000-0000-100000000002', 'c9000000-0000-0000-0000-000000000002', 'pin_reset')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE notification_channel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants ENABLE ROW LEVEL SECURITY;

-- Test 10: Owner CAN SELECT their restaurant's settings
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "c9000000-0000-0000-0000-000000000010", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000001' AND notification_type = 'pin_reset'),
  1::bigint,
  'Owner should be able to SELECT their restaurant notification channel settings'
);

-- Test 11: Staff CAN SELECT their restaurant's settings (view-only)
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "c9000000-0000-0000-0000-000000000020", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000001' AND notification_type = 'pin_reset'),
  1::bigint,
  'Staff should be able to SELECT their restaurant notification channel settings'
);

-- Test 12: Non-member CANNOT SELECT any row (cross-restaurant isolation from the outside)
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "c9000000-0000-0000-0000-000000000030", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM notification_channel_settings),
  0::bigint,
  'Non-member should NOT be able to SELECT any notification channel settings'
);

-- Test 13: Owner of restaurant 1 does NOT see restaurant 2's row (cross-restaurant isolation)
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "c9000000-0000-0000-0000-000000000010", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*) FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000002'),
  0::bigint,
  'Owner of restaurant 1 should NOT see restaurant 2 notification channel settings'
);

-- Test 14: Owner CAN INSERT for their restaurant
SELECT lives_ok(
  $$INSERT INTO notification_channel_settings (restaurant_id, notification_type, email_enabled)
    VALUES ('c9000000-0000-0000-0000-000000000001', 'schedule_published', false)$$,
  'Owner should be able to INSERT notification channel settings for their restaurant'
);

-- Test 15: Owner CAN UPDATE for their restaurant
SELECT lives_ok(
  $$UPDATE notification_channel_settings SET email_enabled = true
    WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000001' AND notification_type = 'schedule_published'$$,
  'Owner should be able to UPDATE notification channel settings for their restaurant'
);

-- Test 16: Staff CANNOT INSERT (RLS blocks non-owner/manager writes)
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "c9000000-0000-0000-0000-000000000020", "role": "authenticated"}';

SELECT throws_ok(
  $$INSERT INTO notification_channel_settings (restaurant_id, notification_type)
    VALUES ('c9000000-0000-0000-0000-000000000001', 'availability_reminder')$$,
  '42501',
  NULL,
  'Staff should NOT be able to INSERT notification channel settings'
);

-- ============================================================================
-- TEST CATEGORY 4: Data-migration backfill from legacy notification_settings
-- (Tests 17-20)
--
-- The migration's real INSERT..SELECT ran once, at apply-time, against whatever
-- notification_settings rows existed then (none, on a fresh db:reset). To verify
-- the backfill SQL itself is correct, these tests re-run the exact same
-- statement shape against fresh fixture rows created inside this transaction.
-- Keep this in sync with the data-migration block in
-- 20260719120000_notification_channel_settings.sql.
-- ============================================================================

SET LOCAL role TO postgres;
ALTER TABLE notification_channel_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings DISABLE ROW LEVEL SECURITY;

-- Restaurant 3: legacy row with an explicit false toggle and a NULL toggle.
-- notify_shift_created/modified are nullable (added via a later ALTER TABLE with
-- no NOT NULL); the time_off_* columns are NOT NULL DEFAULT true from the
-- original table, so the NULL/COALESCE case must be exercised on a shift column.
INSERT INTO notification_settings (restaurant_id, notify_shift_created, notify_shift_modified)
VALUES ('c9000000-0000-0000-0000-000000000003', false, NULL)
ON CONFLICT (restaurant_id) DO UPDATE SET notify_shift_created = false, notify_shift_modified = NULL;

-- Pre-seed a channel row for restaurant 3 / time_off_rejected so ON CONFLICT DO
-- NOTHING can be verified not to clobber it.
INSERT INTO notification_channel_settings (restaurant_id, notification_type, email_enabled, push_enabled)
VALUES ('c9000000-0000-0000-0000-000000000003', 'time_off_rejected', false, false)
ON CONFLICT (restaurant_id, notification_type) DO NOTHING;

-- Re-run the migration's backfill statement (6 legacy-gated types) against the
-- fixtures above.
INSERT INTO notification_channel_settings (restaurant_id, notification_type, email_enabled, push_enabled)
SELECT restaurant_id, 'shift_created', COALESCE(notify_shift_created, true), COALESCE(notify_shift_created, true)
FROM notification_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003'
UNION ALL
SELECT restaurant_id, 'shift_modified', COALESCE(notify_shift_modified, true), COALESCE(notify_shift_modified, true)
FROM notification_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003'
UNION ALL
SELECT restaurant_id, 'shift_deleted', COALESCE(notify_shift_deleted, true), COALESCE(notify_shift_deleted, true)
FROM notification_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003'
UNION ALL
SELECT restaurant_id, 'time_off_requested', COALESCE(notify_time_off_request, true), COALESCE(notify_time_off_request, true)
FROM notification_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003'
UNION ALL
SELECT restaurant_id, 'time_off_approved', COALESCE(notify_time_off_approved, true), COALESCE(notify_time_off_approved, true)
FROM notification_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003'
UNION ALL
SELECT restaurant_id, 'time_off_rejected', COALESCE(notify_time_off_rejected, true), COALESCE(notify_time_off_rejected, true)
FROM notification_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003'
ON CONFLICT (restaurant_id, notification_type) DO NOTHING;

-- Test 17: A `false` legacy toggle (notify_shift_created) migrates to BOTH
-- channels off.
SELECT is(
  ROW((SELECT email_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'shift_created'),
      (SELECT push_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'shift_created')),
  ROW(false, false),
  'A false legacy toggle should migrate to email_enabled=false AND push_enabled=false'
);

-- Test 18: A NULL legacy toggle (notify_shift_modified) migrates to BOTH
-- channels on (COALESCE fail-open).
SELECT is(
  ROW((SELECT email_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'shift_modified'),
      (SELECT push_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'shift_modified')),
  ROW(true, true),
  'A NULL legacy toggle should COALESCE to email_enabled=true AND push_enabled=true'
);

-- Test 19: A legacy column with its default true (notify_time_off_approved,
-- never touched) migrates to both channels on.
SELECT is(
  ROW((SELECT email_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'time_off_approved'),
      (SELECT push_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'time_off_approved')),
  ROW(true, true),
  'A true (default) legacy toggle should migrate to both channels on'
);

-- Test 20: ON CONFLICT DO NOTHING does not clobber a pre-existing target row.
SELECT is(
  ROW((SELECT email_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'time_off_rejected'),
      (SELECT push_enabled FROM notification_channel_settings WHERE restaurant_id = 'c9000000-0000-0000-0000-000000000003' AND notification_type = 'time_off_rejected')),
  ROW(false, false),
  'ON CONFLICT DO NOTHING should not overwrite a pre-existing notification_channel_settings row'
);

-- ============================================================================
-- Cleanup
-- ============================================================================
SELECT * FROM finish();
ROLLBACK;
