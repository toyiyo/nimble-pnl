-- Test: integration_events table, grants, and RLS
BEGIN;
SELECT plan(24);

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
SELECT * FROM finish();
ROLLBACK;
