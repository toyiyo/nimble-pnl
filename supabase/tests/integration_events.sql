-- Test: integration_events table, grants, and RLS
BEGIN;
SELECT plan(69);

SELECT has_table('public', 'integration_events', 'table exists');
SELECT has_column('public', 'integration_events', 'alert_claimed_at', 'alert_claimed_at exists');
SELECT has_column('public', 'integration_events', 'alerted_at', 'alerted_at exists');
SELECT has_column('public', 'integration_events', 'details', 'details exists');
SELECT has_index('public', 'integration_events', 'idx_integration_events_restaurant_created', 'index exists');

-- Fixtures
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'IE Restaurant A'),
  ('00000000-0000-0000-0000-00000000e002', 'IE Restaurant B');

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000e101', 'ie-owner@test.com'),
  ('00000000-0000-0000-0000-00000000e102', 'ie-manager@test.com'),
  ('00000000-0000-0000-0000-00000000e103', 'ie-chef@test.com'),
  ('00000000-0000-0000-0000-00000000e104', 'ie-staff@test.com'),
  ('00000000-0000-0000-0000-00000000e105', 'ie-kiosk@test.com'),
  ('00000000-0000-0000-0000-00000000e106', 'ie-collab@test.com'),
  ('00000000-0000-0000-0000-00000000e107', 'ie-outside@test.com'),
  ('00000000-0000-0000-0000-00000000e108', 'ie-ownerb@test.com');

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-00000000e001', 'owner'),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-00000000e001', 'manager'),
  ('00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-00000000e001', 'chef'),
  ('00000000-0000-0000-0000-00000000e104', '00000000-0000-0000-0000-00000000e001', 'staff'),
  ('00000000-0000-0000-0000-00000000e105', '00000000-0000-0000-0000-00000000e001', 'kiosk'),
  ('00000000-0000-0000-0000-00000000e106', '00000000-0000-0000-0000-00000000e001', 'collaborator_accountant'),
  ('00000000-0000-0000-0000-00000000e108', '00000000-0000-0000-0000-00000000e002', 'owner');

INSERT INTO integration_events (restaurant_id, integration, event) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'toast', 'disconnect'),
  ('00000000-0000-0000-0000-00000000e002', 'square', 'disconnect');

-- CHECK constraints
SELECT throws_ok(
  $$INSERT INTO integration_events (restaurant_id, integration, event) VALUES ('00000000-0000-0000-0000-00000000e001', 'bogus', 'disconnect')$$,
  '23514', NULL, 'integration CHECK rejects unknown value');
SELECT throws_ok(
  $$INSERT INTO integration_events (restaurant_id, integration, event) VALUES ('00000000-0000-0000-0000-00000000e001', 'toast', 'bogus')$$,
  '23514', NULL, 'event CHECK rejects unknown value');
SELECT throws_ok(
  $$INSERT INTO integration_events (restaurant_id, integration, event, reason) VALUES ('00000000-0000-0000-0000-00000000e001', 'toast', 'disconnect', 'bogus')$$,
  '23514', NULL, 'reason CHECK rejects unknown value');
SELECT throws_ok(
  $$INSERT INTO integration_events (restaurant_id, integration, event, reason_text) VALUES ('00000000-0000-0000-0000-00000000e001', 'toast', 'disconnect', repeat('x', 501))$$,
  '23514', NULL, 'reason_text CHECK rejects 501 characters');

-- Privileges
SELECT table_privs_are('public', 'integration_events', 'anon', ARRAY[]::text[], 'anon has no privileges');
SELECT table_privs_are('public', 'integration_events', 'authenticated', ARRAY['SELECT'], 'authenticated has SELECT only');

-- RLS
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM integration_events), 1, 'owner of A reads 1 row (only A)');
SELECT is((SELECT count(*)::int FROM integration_events WHERE restaurant_id = '00000000-0000-0000-0000-00000000e002'), 0, 'owner of A reads 0 rows of B');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e102","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM integration_events), 1, 'manager reads 1 row');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e103","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM integration_events), 0, 'chef reads 0 rows');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e104","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM integration_events), 0, 'staff reads 0 rows');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e105","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM integration_events), 0, 'kiosk reads 0 rows');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e106","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM integration_events), 0, 'collaborator reads 0 rows');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e107","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM integration_events), 0, 'outside user reads 0 rows');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO integration_events (restaurant_id, integration, event) VALUES ('00000000-0000-0000-0000-00000000e001', 'toast', 'disconnect')$$,
  '42501', NULL, 'authenticated cannot INSERT');

RESET ROLE;
-- ===== disconnect_integration RPC =====
SELECT ok(NOT has_function_privilege('anon', 'public.disconnect_integration(uuid,text,text,text)', 'EXECUTE'), 'anon cannot execute disconnect_integration');
SELECT ok(has_function_privilege('authenticated', 'public.disconnect_integration(uuid,text,text,text)', 'EXECUTE'), 'authenticated can execute disconnect_integration');
SELECT ok((SELECT proconfig::text FROM pg_proc WHERE oid = 'public.disconnect_integration(uuid,text,text,text)'::regprocedure) LIKE '%search_path%', 'disconnect_integration sets search_path');

-- Connection fixtures (as postgres)
INSERT INTO revel_connections (restaurant_id, revel_instance, is_active) VALUES ('00000000-0000-0000-0000-00000000e001', 'ie-a', true), ('00000000-0000-0000-0000-00000000e002', 'ie-b', true);
INSERT INTO toast_connections (restaurant_id, client_id, client_secret_encrypted, toast_restaurant_guid, is_active) VALUES ('00000000-0000-0000-0000-00000000e001', 'c', 's', 'g', true);
INSERT INTO focus_connections (restaurant_id, store_id, is_active) VALUES ('00000000-0000-0000-0000-00000000e001', 'st', true);
INSERT INTO square_connections (id, restaurant_id, merchant_id, access_token) VALUES ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-00000000e001', 'sq-m', 'tok');
INSERT INTO square_locations (connection_id, restaurant_id, location_id) VALUES ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-00000000e001', 'loc-1');
INSERT INTO clover_connections (restaurant_id, merchant_id, access_token) VALUES ('00000000-0000-0000-0000-00000000e001', 'cl-m', 'tok');
INSERT INTO shift4_connections (restaurant_id, merchant_id) VALUES ('00000000-0000-0000-0000-00000000e001', 'm-1'), ('00000000-0000-0000-0000-00000000e001', 'm-2');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);

-- Revel, Toast, Focus as owner
SELECT lives_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'revel', 'switching_pos', 'moving')$$, 'owner disconnects revel');
SELECT is((SELECT is_active FROM revel_connections WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001'), false, 'revel is_active is false');
SELECT is((SELECT count(*)::int FROM integration_events WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001' AND integration = 'revel' AND event = 'disconnect' AND reason = 'switching_pos' AND reason_text = 'moving' AND actor_user_id = '00000000-0000-0000-0000-00000000e101'), 1, 'revel event has reason and actor');

SELECT lives_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'toast', 'no_value', NULL)$$, 'owner disconnects toast');
SELECT is((SELECT is_active FROM toast_connections WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001'), false, 'toast is_active is false');
SELECT is((SELECT count(*)::int FROM integration_events WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001' AND integration = 'toast' AND event = 'disconnect' AND reason = 'no_value' AND actor_user_id = '00000000-0000-0000-0000-00000000e101' AND created_at > now() - interval '1 minute'), 1, 'toast event has reason and actor');

SELECT lives_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'focus', 'other', 'x')$$, 'owner disconnects focus');
SELECT is((SELECT is_active FROM focus_connections WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001'), false, 'focus is_active is false');
SELECT is((SELECT count(*)::int FROM integration_events WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001' AND integration = 'focus' AND reason = 'other' AND actor_user_id = '00000000-0000-0000-0000-00000000e101'), 1, 'focus event has reason and actor');

-- Square: rows and locations deleted, event stays
SELECT lives_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'square', NULL, NULL)$$, 'owner disconnects square');
SELECT is((SELECT count(*)::int FROM square_connections WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001'), 0, 'square connection deleted');
SELECT is((SELECT count(*)::int FROM square_locations WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001'), 0, 'square_locations deleted by cascade');
SELECT is((SELECT count(*)::int FROM integration_events WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001' AND integration = 'square'), 1, 'square event stays');

-- Shift4: two rows
SELECT lives_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'shift4', NULL, NULL)$$, 'owner disconnects shift4');
SELECT is((SELECT count(*)::int FROM shift4_connections WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001'), 0, 'both shift4 rows deleted');
SELECT is((SELECT (details->>'rows_affected')::int FROM integration_events WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001' AND integration = 'shift4'), 2, 'shift4 details.rows_affected is 2');

-- Manager allowed
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e102","role":"authenticated"}', true);

SELECT lives_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'clover', NULL, NULL)$$, 'manager disconnects clover');
SELECT is((SELECT count(*)::int FROM clover_connections WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001'), 0, 'clover connection deleted');

-- Denied roles
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e103","role":"authenticated"}', true);

SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'revel', NULL, NULL)$$, '42501', NULL, 'chef is denied');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e104","role":"authenticated"}', true);

SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'revel', NULL, NULL)$$, '42501', NULL, 'staff is denied');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e105","role":"authenticated"}', true);

SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'revel', NULL, NULL)$$, '42501', NULL, 'kiosk is denied');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e106","role":"authenticated"}', true);

SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'revel', NULL, NULL)$$, '42501', NULL, 'collaborator is denied');
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'revel', NULL, NULL)$$, '42501', NULL, 'no auth.uid() is denied');

-- Cross-tenant: owner of A calls for B
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);

SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e002', 'revel', NULL, NULL)$$, '42501', NULL, 'owner of A cannot disconnect B');
RESET ROLE;
SELECT is((SELECT is_active FROM revel_connections WHERE restaurant_id = '00000000-0000-0000-0000-00000000e002'), true, 'B revel row is unchanged');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);


-- Second call
SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'revel', NULL, NULL)$$, 'P0002', 'no active revel connection', 'second disconnect raises P0002');

-- Input checks
SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'bank', NULL, NULL)$$, '22023', NULL, 'bank raises 22023');
SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'bogus', NULL, NULL)$$, '22023', NULL, 'unknown integration raises 22023');
SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'toast', 'bogus', NULL)$$, '22023', NULL, 'invalid reason raises 22023');
SELECT throws_ok($$SELECT public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'toast', NULL, repeat('x', 501))$$, '22023', NULL, '501 characters raises 22023');

-- Empty reason and trim rules (toast is reactivated first)
RESET ROLE;
UPDATE toast_connections SET is_active = true WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);

SELECT set_config('ie.id', public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'toast', '', '  hello  ')::text, true);
SELECT is((SELECT reason IS NULL AND reason_text = 'hello' FROM integration_events WHERE id = current_setting('ie.id')::uuid), true, 'empty reason becomes NULL and text is trimmed');
RESET ROLE;
UPDATE toast_connections SET is_active = true WHERE restaurant_id = '00000000-0000-0000-0000-00000000e001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}', true);

SELECT set_config('ie.id', public.disconnect_integration('00000000-0000-0000-0000-00000000e001', 'toast', NULL, '   ')::text, true);
SELECT is((SELECT reason_text IS NULL FROM integration_events WHERE id = current_setting('ie.id')::uuid), true, 'blank reason text becomes NULL');

-- ===== record_integration_event and integration_alert_recipients =====
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.record_integration_event(uuid,text,text,uuid,text,text,jsonb)', 'EXECUTE'), 'anon cannot execute record_integration_event');
SELECT ok(NOT has_function_privilege('authenticated', 'public.record_integration_event(uuid,text,text,uuid,text,text,jsonb)', 'EXECUTE'), 'authenticated cannot execute record_integration_event');
SELECT ok(has_function_privilege('service_role', 'public.record_integration_event(uuid,text,text,uuid,text,text,jsonb)', 'EXECUTE'), 'service_role can execute record_integration_event');
SELECT ok(NOT has_function_privilege('anon', 'public.integration_alert_recipients(uuid)', 'EXECUTE'), 'anon cannot execute integration_alert_recipients');
SELECT ok(NOT has_function_privilege('authenticated', 'public.integration_alert_recipients(uuid)', 'EXECUTE'), 'authenticated cannot execute integration_alert_recipients');
SELECT ok(has_function_privilege('service_role', 'public.integration_alert_recipients(uuid)', 'EXECUTE'), 'service_role can execute integration_alert_recipients');

SET LOCAL ROLE service_role;
SELECT set_config('ie.rid', public.record_integration_event('00000000-0000-0000-0000-00000000e002', 'bank', 'disconnect', '00000000-0000-0000-0000-00000000e108', 'other', 'note', '{"institution_name":"X"}'::jsonb)::text, true);
SELECT is((SELECT details->>'institution_name' FROM integration_events WHERE id = current_setting('ie.rid')::uuid), 'X', 'record inserts an event with details');
SELECT is(public.record_integration_event('00000000-0000-0000-0000-00000000e002', 'bank', 'disconnect', '00000000-0000-0000-0000-00000000e108', 'other', 'again', '{}'::jsonb)::text, current_setting('ie.rid'), 'second call within 60 seconds returns the same id');
SELECT is((SELECT count(*)::int FROM integration_events WHERE restaurant_id = '00000000-0000-0000-0000-00000000e002' AND integration = 'bank'), 1, 'dedupe inserts no second row');
SELECT set_config('ie.b1', public.record_integration_event('00000000-0000-0000-0000-00000000e002', 'bank', 'disconnect', '00000000-0000-0000-0000-00000000e108', 'other', NULL, '{"stripe_financial_connections_account_id":"fca_1"}'::jsonb)::text, true);
SELECT isnt(public.record_integration_event('00000000-0000-0000-0000-00000000e002', 'bank', 'disconnect', '00000000-0000-0000-0000-00000000e108', 'other', NULL, '{"stripe_financial_connections_account_id":"fca_2"}'::jsonb)::text, current_setting('ie.b1'), 'a different bank account within 60 seconds inserts its own event');
SELECT is(public.record_integration_event('00000000-0000-0000-0000-00000000e002', 'bank', 'disconnect', '00000000-0000-0000-0000-00000000e108', 'other', NULL, '{"stripe_financial_connections_account_id":"fca_1"}'::jsonb)::text, current_setting('ie.b1'), 'the same bank account within 60 seconds returns the same id');
SELECT throws_ok($$SELECT public.record_integration_event('00000000-0000-0000-0000-00000000e002', 'bank', 'disconnect', NULL, 'bogus', NULL, '{}'::jsonb)$$, '22023', NULL, 'record with a bad reason raises 22023');
SELECT is((SELECT array_agg(email ORDER BY email) FROM public.integration_alert_recipients('00000000-0000-0000-0000-00000000e001')), ARRAY['ie-owner@test.com']::text[], 'recipients returns the owner only');
RESET ROLE;
SELECT ok(obj_description('public.bank_reauth_notice_recipients(uuid,text[])'::regprocedure, 'pg_proc') LIKE '%integration_alert_recipients%', 'bank_reauth_notice_recipients comment names the dependency');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
