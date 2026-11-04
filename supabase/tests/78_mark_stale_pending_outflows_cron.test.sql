-- ============================================================================
-- Test: mark-stale-pending-outflows cron job.
--
-- Design: docs/superpowers/specs/2026-09-30-stale-pending-outflows-design.md
--         section 5.2.
--
-- Checks the cron job mark-stale-pending-outflows exists with schedule
-- 15 6 * * * and a command that calls public.mark_stale_pending_outflows().
-- Checks the grants: anon and authenticated cannot execute the function,
-- service_role can. Checks the status transitions on fixture rows, and
-- checks a second call makes no further change (idempotent).
-- ============================================================================

BEGIN;
SELECT plan(15);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------------------
-- Cron job (1-2)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'mark-stale-pending-outflows'),
  '15 6 * * *',
  'cron job mark-stale-pending-outflows runs daily at 06:15 UTC'
);

SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'mark-stale-pending-outflows')
    LIKE '%public.mark_stale_pending_outflows()%',
  'cron job mark-stale-pending-outflows calls mark_stale_pending_outflows()'
);

-- ---------------------------------------------------------------------------
-- Grants (3-5)
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.mark_stale_pending_outflows()', 'EXECUTE'),
  'anon cannot execute mark_stale_pending_outflows'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.mark_stale_pending_outflows()', 'EXECUTE'),
  'authenticated cannot execute mark_stale_pending_outflows'
);

SELECT ok(
  has_function_privilege('service_role', 'public.mark_stale_pending_outflows()', 'EXECUTE'),
  'service_role can execute mark_stale_pending_outflows'
);

-- ---------------------------------------------------------------------------
-- Fixture rows (design section 5.2)
-- ---------------------------------------------------------------------------
INSERT INTO public.restaurants (id, name)
VALUES ('78000000-0000-0000-0000-000000000001', 'Stale Outflows Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- One row per age bucket, plus a cleared row that must never change.
INSERT INTO public.pending_outflows
  (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status)
VALUES
  ('78000000-0000-0000-0000-000000000010', '78000000-0000-0000-0000-000000000001', 'Vendor today',   'check', 100, CURRENT_DATE,                          'pending'),
  ('78000000-0000-0000-0000-000000000011', '78000000-0000-0000-0000-000000000001', 'Vendor -29',     'check', 100, CURRENT_DATE - INTERVAL '29 days',    'pending'),
  ('78000000-0000-0000-0000-000000000012', '78000000-0000-0000-0000-000000000001', 'Vendor -30',     'check', 100, CURRENT_DATE - INTERVAL '30 days',    'pending'),
  ('78000000-0000-0000-0000-000000000013', '78000000-0000-0000-0000-000000000001', 'Vendor -59',     'check', 100, CURRENT_DATE - INTERVAL '59 days',    'pending'),
  ('78000000-0000-0000-0000-000000000014', '78000000-0000-0000-0000-000000000001', 'Vendor -60',     'check', 100, CURRENT_DATE - INTERVAL '60 days',    'pending'),
  ('78000000-0000-0000-0000-000000000015', '78000000-0000-0000-0000-000000000001', 'Vendor -89',     'check', 100, CURRENT_DATE - INTERVAL '89 days',    'pending'),
  ('78000000-0000-0000-0000-000000000016', '78000000-0000-0000-0000-000000000001', 'Vendor -90',     'check', 100, CURRENT_DATE - INTERVAL '90 days',    'pending'),
  ('78000000-0000-0000-0000-000000000017', '78000000-0000-0000-0000-000000000001', 'Vendor -400',    'check', 100, CURRENT_DATE - INTERVAL '400 days',   'pending'),
  ('78000000-0000-0000-0000-000000000018', '78000000-0000-0000-0000-000000000001', 'Vendor cleared', 'check', 100, CURRENT_DATE - INTERVAL '400 days',   'cleared');

-- ---------------------------------------------------------------------------
-- First call: each row moves to its expected status (6-14)
-- ---------------------------------------------------------------------------
SELECT public.mark_stale_pending_outflows();

SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000010'), 'pending',   'today stays pending');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000011'), 'pending',   '-29 days stays pending');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000012'), 'stale_30',  '-30 days becomes stale_30');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000013'), 'stale_30',  '-59 days stays stale_30');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000014'), 'stale_60',  '-60 days becomes stale_60');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000015'), 'stale_60',  '-89 days stays stale_60');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000016'), 'stale_90',  '-90 days becomes stale_90');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000017'), 'stale_90',  '-400 days becomes stale_90');
SELECT is((SELECT status FROM public.pending_outflows WHERE id = '78000000-0000-0000-0000-000000000018'), 'cleared',   'a cleared row never changes');

-- ---------------------------------------------------------------------------
-- Second call: no further change (idempotent) (15)
-- ---------------------------------------------------------------------------
SELECT public.mark_stale_pending_outflows();

SELECT is(
  (SELECT array_agg(status ORDER BY id) FROM public.pending_outflows
    WHERE restaurant_id = '78000000-0000-0000-0000-000000000001'),
  ARRAY['pending', 'pending', 'stale_30', 'stale_30', 'stale_60', 'stale_60', 'stale_90', 'stale_90', 'cleared'],
  'a second call changes no status'
);

SELECT * FROM finish();
ROLLBACK;
