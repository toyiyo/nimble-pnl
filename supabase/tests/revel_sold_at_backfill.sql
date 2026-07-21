-- pgTAP tests for the Revel sold_at timezone backfill (design §5b, plan T4).
-- Tests migration: 20260721150000_revel_sold_at_timezone_backfill.sql
-- Covers: revel_raw_created_date() envelope/field precedence, per-restaurant
-- backfill worker (revel_orders + unified_sales correction, idempotency,
-- invalid/null-tz fallback), and the pre/post pending-count report.

BEGIN;
SELECT plan(19);

-- Setup: Disable RLS for test data creation (mirrors supabase/tests/revel_integration.sql)
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE revel_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE revel_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE revel_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- revel_raw_created_date(jsonb): envelope + field precedence
-- (mirrors getOrderNode/parseDateTime in revelOrderProcessor.ts)
-- ============================================================

-- Test 1: "Order" envelope takes precedence over "order"/flat payload
SELECT is(
  public.revel_raw_created_date('{"Order": {"created_date": "2026-07-19T07:32:16"}, "order": {"created_date": "wrong"}}'::jsonb),
  '2026-07-19T07:32:16',
  'Order envelope wins over order/flat payload'
);

-- Test 2: lowercase "order" envelope used when "Order" absent
SELECT is(
  public.revel_raw_created_date('{"order": {"created_date": "2026-07-19T07:32:16"}}'::jsonb),
  '2026-07-19T07:32:16',
  'order envelope used when Order absent'
);

-- Test 3: flat payload (no envelope) reads fields at top level
SELECT is(
  public.revel_raw_created_date('{"created_date": "2026-07-19T07:32:16"}'::jsonb),
  '2026-07-19T07:32:16',
  'flat payload (no envelope) reads created_date at top level'
);

-- Test 4: field precedence — created_date beats createdDate/closed_date/finalized_date/date
SELECT is(
  public.revel_raw_created_date('{"Order": {"createdDate": "wrong1", "closed_date": "wrong2", "created_date": "2026-07-19T07:32:16"}}'::jsonb),
  '2026-07-19T07:32:16',
  'created_date takes precedence over createdDate/closed_date'
);

-- Test 5: falls through to createdDate when created_date absent
SELECT is(
  public.revel_raw_created_date('{"Order": {"createdDate": "2026-07-19T07:32:16", "closed_date": "wrong"}}'::jsonb),
  '2026-07-19T07:32:16',
  'falls through to createdDate when created_date absent'
);

-- Test 6: falls through to date (last resort) when nothing else present
SELECT is(
  public.revel_raw_created_date('{"Order": {"date": "2026-07-19T07:32:16"}}'::jsonb),
  '2026-07-19T07:32:16',
  'falls through to date as last resort'
);

-- Test 7: NULL raw_json / no matching field returns NULL (no throw)
SELECT is(public.revel_raw_created_date(NULL), NULL, 'NULL raw_json returns NULL');
SELECT is(public.revel_raw_created_date('{"Order": {}}'::jsonb), NULL, 'no matching field returns NULL');

-- ============================================================
-- Fixtures: restaurant + revel_orders (naive local created_date in raw_json,
-- sold_at mis-stamped as if naive digits were UTC — the bug) + a linked
-- unified_sales sale row with the same corrupted sold_at + stale daily_sales.
-- ============================================================

INSERT INTO public.restaurants (id, name, timezone) VALUES
  ('22222222-2222-2222-2222-222222222221', 'Revel Backfill Chicago', 'America/Chicago'),
  ('22222222-2222-2222-2222-222222222222', 'Revel Backfill Bad TZ', 'Bogus/Zone'),
  ('22222222-2222-2222-2222-222222222223', 'Revel Backfill Null TZ', NULL)
ON CONFLICT (id) DO NOTHING;
UPDATE public.restaurants SET timezone = 'Bogus/Zone' WHERE id = '22222222-2222-2222-2222-222222222222';
UPDATE public.restaurants SET timezone = NULL WHERE id = '22222222-2222-2222-2222-222222222223';

-- Naive local created_date 2026-07-19T07:32:16 in CDT (America/Chicago, -05:00
-- in July) => true instant 2026-07-19T12:32:16Z. The pre-fix bug stored the
-- naive digits mislabeled as UTC (07:32:16Z) — reproduce that corruption here.
INSERT INTO public.revel_orders (
  id, restaurant_id, revel_order_id, order_date, order_time, sold_at, raw_json,
  subtotal_amount, total_amount
) VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-000000000001', '22222222-2222-2222-2222-222222222221',
  'order-tz-1', '2026-07-19', '07:32:16', '2026-07-19T07:32:16+00:00',
  '{"Order": {"created_date": "2026-07-19T07:32:16"}}'::jsonb,
  20.00, 20.00
);

INSERT INTO public.unified_sales (
  restaurant_id, pos_system, external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price, sale_date, sale_time, sold_at
) VALUES (
  '22222222-2222-2222-2222-222222222221', 'revel', 'order-tz-1', 'order-tz-1:item-1',
  'Burger', 1, 20.00, 20.00, '2026-07-19', '07:32:16', '2026-07-19T07:32:16+00:00'
);

-- Same-shaped row under the invalid-tz restaurant — must fall back to
-- America/Chicago (no throw), matching the edge-side safeTz() fallback.
INSERT INTO public.revel_orders (
  id, restaurant_id, revel_order_id, order_date, order_time, sold_at, raw_json,
  subtotal_amount, total_amount
) VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-000000000002', '22222222-2222-2222-2222-222222222222',
  'order-tz-2', '2026-07-19', '09:00:00', '2026-07-19T09:00:00+00:00',
  '{"Order": {"created_date": "2026-07-19T09:00:00"}}'::jsonb,
  10.00, 10.00
);

-- ============================================================
-- revel_backfill_pending_count(): pre-flight visibility
-- ============================================================

-- Test 8: pending count reflects the two mis-stamped rows above (pre-flight)
SELECT is(public.revel_backfill_pending_count(), 2::bigint,
  'pending count reports mismatched rows before backfill runs');

-- ============================================================
-- revel_backfill_sold_at_for_restaurant(): per-restaurant worker
-- ============================================================

-- Test 9: corrects revel_orders.sold_at to the true UTC instant (valid tz)
SELECT * FROM public.revel_backfill_sold_at_for_restaurant('22222222-2222-2222-2222-222222222221');
SELECT is(
  (SELECT sold_at FROM public.revel_orders WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'),
  '2026-07-19T12:32:16+00:00'::timestamptz,
  'revel_orders.sold_at corrected to true UTC instant (CDT -05:00)'
);

-- Test 10: propagates the corrected instant to the linked unified_sales row
SELECT is(
  (SELECT sold_at FROM public.unified_sales
   WHERE restaurant_id = '22222222-2222-2222-2222-222222222221' AND external_order_id = 'order-tz-1'),
  '2026-07-19T12:32:16+00:00'::timestamptz,
  'unified_sales.sold_at propagated from corrected revel_orders.sold_at'
);

-- Test 11: order_date/order_time/sale_date/sale_time are untouched (local-correct already)
SELECT is(
  (SELECT order_time::text FROM public.revel_orders WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'),
  '07:32:16',
  'order_time left untouched by the backfill'
);

-- Test 12: re-aggregation ran without error and produced a daily_sales row
-- (sale_date-keyed, so gross_revenue is unaffected by the sold_at fix —
-- proves the auditor path was never broken, per design §3).
SELECT is(
  (SELECT gross_revenue FROM public.daily_sales
   WHERE restaurant_id = '22222222-2222-2222-2222-222222222221' AND date = '2026-07-19' AND source = 'unified_pos'),
  20.00::numeric,
  'daily_sales re-aggregated once for the touched sale_date, revenue unchanged'
);

-- Test 13: idempotent — a second run updates zero rows
SELECT is(
  (SELECT orders_updated FROM public.revel_backfill_sold_at_for_restaurant('22222222-2222-2222-2222-222222222221')),
  0,
  'second run against the same restaurant is a no-op (IS DISTINCT FROM guard)'
);

-- Test 14: invalid tz ("Bogus/Zone") falls back to America/Chicago, no throw
SELECT lives_ok(
  $$ SELECT public.revel_backfill_sold_at_for_restaurant('22222222-2222-2222-2222-222222222222') $$,
  'invalid restaurants.timezone does not abort the backfill (falls back to America/Chicago)'
);
SELECT is(
  (SELECT sold_at FROM public.revel_orders WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'),
  '2026-07-19T14:00:00+00:00'::timestamptz,
  'invalid-tz restaurant computed as if America/Chicago (CDT -05:00)'
);

-- Test 15: pending count is 0 once both restaurants have been processed
SELECT is(public.revel_backfill_pending_count(), 0::bigint,
  'pending count converges to 0 after backfill (post-flight)');

-- ============================================================
-- revel_backfill_invalid_tz_restaurants(): pre-flight offender report
-- ============================================================

-- Test 16: lists the Bogus/Zone restaurant (has revel_orders + invalid tz)
SELECT is(
  (SELECT count(*)::int FROM public.revel_backfill_invalid_tz_restaurants()
   WHERE restaurant_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'invalid-tz restaurant with revel_orders is reported'
);

-- Test 17: does NOT list the null-tz restaurant, which has no revel_orders rows
-- (report is scoped to restaurants that actually have Revel data, per design §5b)
SELECT is(
  (SELECT count(*)::int FROM public.revel_backfill_invalid_tz_restaurants()
   WHERE restaurant_id = '22222222-2222-2222-2222-222222222223'),
  0,
  'restaurant with no revel_orders is not reported even if timezone is null'
);

SELECT * FROM finish();
ROLLBACK;
