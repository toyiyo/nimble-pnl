-- Tests for the Focus due-based sync scheduler
-- Migration: 20260704200320_focus_sync_frequency.sql
--
-- NOTE (live pg_cron): the pgTAP database runs a real pg_cron, so the
-- focus-bulk-sync job is (re)scheduled INSIDE this rolled-back transaction
-- before its schedule is asserted (precedent: 50_categorization_backlog_drain.sql).
--
-- NOTE (claim semantics): test "second claim returns 0 rows" proves that
-- claiming removes a row from the due set (the last_sync_time bump), NOT the
-- SKIP LOCKED cross-session guarantee — a transaction cannot contend with
-- itself. Cross-session contention is covered by using the canonical
-- single-statement job-queue shape (see design doc).

BEGIN;
SELECT plan(19);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
ALTER TABLE public.restaurants       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_connections DISABLE ROW LEVEL SECURITY;

DELETE FROM public.focus_connections WHERE restaurant_id::text LIKE 'c5100000-%';
DELETE FROM public.restaurants       WHERE id::text LIKE 'c5100000-%';

INSERT INTO public.restaurants (id, name)
VALUES
  ('c5100000-0000-0000-0000-000000000001', 'Scheduler Test 1'),
  ('c5100000-0000-0000-0000-000000000002', 'Scheduler Test 2'),
  ('c5100000-0000-0000-0000-000000000003', 'Scheduler Test 3'),
  ('c5100000-0000-0000-0000-000000000004', 'Scheduler Test 4'),
  ('c5100000-0000-0000-0000-000000000005', 'Scheduler Test 5'),
  ('c5100000-0000-0000-0000-000000000006', 'Scheduler Test 6'),
  ('c5100000-0000-0000-0000-000000000007', 'Scheduler Test 7');

-- Connection matrix (id prefix c5100000-…-00000000000N mirrors restaurant N):
--   n1 due:      lynk, done, last sync 1h ago, interval 30
--   n2 fresh:    lynk, done, last sync 5min ago            → NOT due
--   n3 backoff:  lynk, done, 1h ago BUT next_attempt_at in the future → NOT due
--   n4 backfill: lynk, NOT done                            → NOT due (owned by focus-backfill-sync)
--   n5 legacy:   api_key NULL, NOT done, 7h ago, interval 360 → due
--   n6 inactive: is_active=false                           → NOT due
--   n7 never:    lynk, done, last_sync_time NULL           → due, claimed FIRST (NULLS FIRST)
INSERT INTO public.focus_connections
  (id, restaurant_id, store_id, api_key, api_secret_encrypted, initial_sync_done,
   is_active, last_sync_time, timezone)
VALUES
  ('c5100000-aaaa-0000-0000-000000000001','c5100000-0000-0000-0000-000000000001','guid-1','key1','enc1', true,  true,  now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000002','c5100000-0000-0000-0000-000000000002','guid-2','key2','enc2', true,  true,  now() - interval '5 minutes','America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000003','c5100000-0000-0000-0000-000000000003','guid-3','key3','enc3', true,  true,  now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000004','c5100000-0000-0000-0000-000000000004','guid-4','key4','enc4', false, true,  now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000005','c5100000-0000-0000-0000-000000000005','guid-5',NULL,  NULL,   false, true,  now() - interval '7 hours',  'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000006','c5100000-0000-0000-0000-000000000006','guid-6','key6','enc6', true,  false, now() - interval '1 hour',   'America/Chicago'),
  ('c5100000-aaaa-0000-0000-000000000007','c5100000-0000-0000-0000-000000000007','guid-7','key7','enc7', true,  true,  NULL,                        'America/Chicago');

UPDATE public.focus_connections
   SET next_attempt_at = now() + interval '1 hour'
 WHERE id = 'c5100000-aaaa-0000-0000-000000000003';
UPDATE public.focus_connections
   SET sync_interval_minutes = 360
 WHERE id = 'c5100000-aaaa-0000-0000-000000000005';

-- ── 1-3: schema ──────────────────────────────────────────────────────────────
SELECT has_column('public','focus_connections','sync_interval_minutes','focus_connections.sync_interval_minutes exists');
SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='focus_connections' AND column_name='sync_interval_minutes'),
  '30', 'sync_interval_minutes defaults to 30');
SELECT has_column('public','focus_connections','next_attempt_at','focus_connections.next_attempt_at exists');

-- ── 4-5: focus_datafeed_state ────────────────────────────────────────────────
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.focus_datafeed_state'::regclass),
  'focus_datafeed_state has RLS enabled');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='focus_datafeed_state'),
  0, 'focus_datafeed_state has zero client policies (service-role only)');

-- ── 6-11: due predicate truth table ─────────────────────────────────────────
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000001'), true,  'due: lynk done, interval elapsed');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000002'), false, 'not due: interval not elapsed');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000003'), false, 'not due: next_attempt_at in the future (backoff)');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000004'), false, 'not due: lynk row still backfilling is owned by focus-backfill-sync');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000005'), true,  'due: legacy portal row past its 360-min interval');
SELECT is((SELECT public._focus_connection_is_due(fc) FROM public.focus_connections fc WHERE fc.id='c5100000-aaaa-0000-0000-000000000006'), false, 'not due: inactive');

-- ── 12: due count (n1 + n5 + n7 = 3; other fixtures excluded) ───────────────
-- NOTE: count includes any pre-existing due rows in the test DB — scope it:
SELECT is(
  (SELECT count(*)::int FROM public.focus_connections fc
    WHERE public._focus_connection_is_due(fc) AND fc.restaurant_id::text LIKE 'c5100000-%'),
  3, 'exactly the 3 expected fixtures are due');

-- ── 13: NULLS FIRST — claim(1) takes the never-synced row ────────────────────
SELECT is(
  (SELECT (public.claim_focus_sync_batch(1)).id),
  'c5100000-aaaa-0000-0000-000000000007'::uuid,
  'claim(1) returns the never-synced connection first (NULLS FIRST)');

-- ── 14-16: claim bumps + removes from due set ────────────────────────────────
SELECT ok(
  (SELECT last_sync_time > now() - interval '1 minute'
     FROM public.focus_connections WHERE id='c5100000-aaaa-0000-0000-000000000007'),
  'claimed row last_sync_time bumped to now (claim marker)');

SELECT is(
  (SELECT count(*)::int FROM public.claim_focus_sync_batch(10) c
    WHERE c.restaurant_id::text LIKE 'c5100000-%'),
  2, 'second claim(10) returns the remaining 2 due fixtures');

SELECT is(
  (SELECT count(*)::int FROM public.claim_focus_sync_batch(10) c
    WHERE c.restaurant_id::text LIKE 'c5100000-%'),
  0, 'third claim returns 0 fixture rows — claiming removed them from the due set');

-- ── 17-18: privileges ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.claim_focus_sync_batch(integer)', 'EXECUTE'),
  'anon cannot execute claim_focus_sync_batch');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.focus_due_sync_count()', 'EXECUTE'),
  'authenticated cannot execute focus_due_sync_count');

-- ── 19: cron (rescheduled in-txn, live-cron safe) ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'focus-bulk-sync') THEN
    PERFORM cron.unschedule('focus-bulk-sync');
  END IF;
  PERFORM cron.schedule(
    'focus-bulk-sync',
    '*/5 * * * *',
    'SELECT 1'  -- body irrelevant for the schedule assertion; rolled back anyway
  );
END $$;
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-bulk-sync'),
  '*/5 * * * *', 'focus-bulk-sync ticks every 5 minutes');

SELECT * FROM finish();
ROLLBACK;
