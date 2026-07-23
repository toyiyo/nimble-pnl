-- Backfill: correct Revel sold_at timezone corruption (design doc
-- docs/superpowers/specs/2026-07-21-revel-timezone-sold-at-design.md §5b, plan T4).
--
-- Revel sends order timestamps as NAIVE establishment-local time, no offset
-- (e.g. raw_json created_date: "2026-07-19T07:32:16"). Before the source fix
-- (migration-adjacent edge-function change, plan T1-T3), `parseDateTime`
-- parsed that naive string with `new Date(raw).toISOString()` in a UTC edge
-- runtime, mislabeling the local wall-clock as UTC — `sold_at` was NOT a
-- valid instant, off by the establishment's UTC offset (5h CDT / 6h CST).
--
-- This migration recomputes `sold_at` from `raw_json` using Postgres'
-- DST-aware `AT TIME ZONE`, for every existing `revel_orders` row and its
-- linked `unified_sales` row. It is a per-restaurant, idempotent, bounded
-- operation (not one unbounded UPDATE): the aggregation trigger is suppressed
-- during the bulk `unified_sales` UPDATE and daily totals are re-aggregated
-- once per touched (restaurant_id, sale_date) — mirroring the pattern used
-- by sync_toast_to_unified_sales / _sync_focus_transactions_to_unified_sales_impl.
--
-- `sale_date` / `sale_time` / `order_date` / `order_time` are untouched —
-- those were already local-correct; only the mis-anchored `sold_at` instant
-- is wrong. Revenue/period totals key on `sale_date`, so this backfill does
-- not change any dollar figure — only intra-day hour attribution.

-- ============================================================
-- 1) revel_raw_created_date(jsonb): IMMUTABLE helper
--    Mirrors getOrderNode()/parseDateTime()'s envelope+field precedence in
--    supabase/functions/_shared/revelOrderProcessor.ts exactly, so no
--    historically-corrupted row is silently skipped by a too-narrow
--    COALESCE. Kept in lock-step with that TS logic — if the TS precedence
--    ever changes, update this function in the same PR.
--      envelope: payload.Order ?? payload.order ?? payload
--      field:    created_date ?? createdDate ?? closed_date ?? finalized_date ?? date
-- ============================================================

CREATE OR REPLACE FUNCTION public.revel_raw_created_date(p_raw_json jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    node ->> 'created_date',
    node ->> 'createdDate',
    node ->> 'closed_date',
    node ->> 'finalized_date',
    node ->> 'date'
  )
  FROM (
    -- NULLIF(..., 'null'::jsonb) converts a JSON-null envelope value (e.g.
    -- {"Order": null, "created_date": "..."}) to a genuine SQL NULL before
    -- COALESCE, matching getOrderNode()'s `??` fallthrough on JS null. Without
    -- this, `p_raw_json -> 'Order'` being JSONB null (a non-NULL SQL value)
    -- would short-circuit COALESCE and silently drop the row's created_date.
    SELECT COALESCE(
      NULLIF(p_raw_json -> 'Order', 'null'::jsonb),
      NULLIF(p_raw_json -> 'order', 'null'::jsonb),
      p_raw_json
    ) AS node
  ) _envelope;
$$;

COMMENT ON FUNCTION public.revel_raw_created_date(jsonb) IS
  'Extracts the naive local created_date string from a Revel raw_json payload, '
  'mirroring revelOrderProcessor.ts getOrderNode()/parseDateTime() envelope+field '
  'precedence (Order/order/flat payload; created_date/createdDate/closed_date/'
  'finalized_date/date). Used by the sold_at timezone backfill (2026-07-21).';

-- ============================================================
-- 2) revel_valid_tz(text): validated restaurant timezone, with fallback.
--    Single source of truth for the "is restaurants.timezone usable" check —
--    mirrors the edge-side safeTz() guard. Used by every backfill helper
--    below so the validation rule can't drift between them.
-- ============================================================

CREATE OR REPLACE FUNCTION public.revel_valid_tz(p_tz text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN p_tz IN (SELECT name FROM pg_timezone_names)
              THEN p_tz ELSE 'America/Chicago' END;
$$;

COMMENT ON FUNCTION public.revel_valid_tz(text) IS
  'Validates an IANA timezone string against pg_timezone_names, falling back to '
  'America/Chicago when null/invalid — mirrors the edge-side safeTz() guard. '
  'Shared by the sold_at backfill helpers (migration 2026-07-21).';

-- ============================================================
-- 2b) revel_created_date_to_utc(text, text): naive-or-offset -> UTC instant.
--     Mirrors parseDateTime()'s hasOffset branch exactly: a created_date that
--     already carries a zone (Z / +-hh:mm / +-hhmm) is an absolute instant, so
--     cast it directly to timestamptz; only a truly naive string is interpreted
--     in the establishment tz via AT TIME ZONE. Without this branch an offset-
--     carrying historical row would be falsely flagged pending and "corrected"
--     incorrectly (re-interpreting its real instant as local).
-- ============================================================
CREATE OR REPLACE FUNCTION public.revel_created_date_to_utc(p_raw text, p_tz text)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_raw IS NULL THEN NULL
    WHEN p_raw ~* '(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN p_raw::timestamptz
    ELSE p_raw::timestamp AT TIME ZONE public.revel_valid_tz(p_tz)
  END;
$$;

COMMENT ON FUNCTION public.revel_created_date_to_utc(text, text) IS
  'Converts a Revel raw created_date to a UTC instant, mirroring '
  'revelOrderProcessor.parseDateTime: offset-carrying strings (Z/+-hh:mm) cast '
  'directly to timestamptz; naive strings are interpreted in the (validated) '
  'establishment tz. Shared by the sold_at backfill helpers (migration 2026-07-21).';

-- ============================================================
-- 3) revel_backfill_pending_count(): pre/post-flight row-count report.
--    Counts revel_orders rows whose stored sold_at still disagrees with the
--    tz-corrected value computed from raw_json (validated tz, same fallback
--    as the worker below). Callable before AND after the backfill runs —
--    should converge to 0.
-- ============================================================

CREATE OR REPLACE FUNCTION public.revel_backfill_pending_count()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::bigint
  FROM public.revel_orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE public.revel_raw_created_date(o.raw_json) IS NOT NULL
    AND o.sold_at IS DISTINCT FROM
        public.revel_created_date_to_utc(public.revel_raw_created_date(o.raw_json), r.timezone);
$$;

COMMENT ON FUNCTION public.revel_backfill_pending_count() IS
  'Count of revel_orders rows whose sold_at still disagrees with the tz-corrected '
  'value derivable from raw_json. Used for the sold_at backfill pre/post report '
  '(migration 2026-07-21) — should be 0 after the backfill runs.';

-- ============================================================
-- 4) revel_backfill_invalid_tz_restaurants(): pre-flight offender report.
--    Restaurants that have Revel orders but a null/invalid stored timezone —
--    these fall back to America/Chicago in the worker below; surfaced here so
--    the fallback isn't a silent surprise.
-- ============================================================

CREATE OR REPLACE FUNCTION public.revel_backfill_invalid_tz_restaurants()
RETURNS TABLE(restaurant_id uuid, restaurant_name text, timezone text)
LANGUAGE sql
STABLE
AS $$
  SELECT r.id, r.name, r.timezone
  FROM public.restaurants r
  WHERE r.id IN (SELECT DISTINCT ro.restaurant_id FROM public.revel_orders ro)
    AND (r.timezone IS NULL OR public.revel_valid_tz(r.timezone) <> r.timezone);
$$;

COMMENT ON FUNCTION public.revel_backfill_invalid_tz_restaurants() IS
  'Restaurants with Revel orders whose stored timezone is null or not a valid '
  'pg_timezone_names entry — the sold_at backfill falls back to America/Chicago '
  'for these. Pre-flight offender report (migration 2026-07-21).';

-- ============================================================
-- 5) revel_backfill_sold_at_for_restaurant(uuid): per-restaurant worker.
--    - Validates restaurants.timezone via revel_valid_tz() (fallback
--      America/Chicago), exactly mirroring the edge-side safeTz() guard —
--      a non-null-but-invalid tz string would otherwise make AT TIME ZONE
--      raise and abort.
--    - UPDATEs revel_orders.sold_at with an IS DISTINCT FROM guard
--      (idempotent, bounded to actually-changed rows).
--    - Suppresses app.skip_unified_sales_triggers around the unified_sales
--      UPDATE so trigger_unified_sales_aggregation doesn't fire per row.
--    - Re-aggregates once per distinct (restaurant_id, sale_date) actually
--      touched by this call (via UPDATE ... RETURNING), via
--      aggregate_unified_sales_to_daily — not per row, and not a rescan of
--      the restaurant's entire Revel sale_date history.
--    Callable directly (idempotent — safe to re-run for a single restaurant
--    at any time, e.g. after a misconfigured timezone is corrected).
-- ============================================================

CREATE OR REPLACE FUNCTION public.revel_backfill_sold_at_for_restaurant(p_restaurant_id uuid)
RETURNS TABLE(orders_updated integer, unified_sales_updated integer, dates_reaggregated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_orders_updated integer := 0;
  v_sales_updated integer := 0;
  v_dates integer := 0;
  v_sale_date date;
  v_touched_dates date[];
BEGIN
  SELECT public.revel_valid_tz(r.timezone)
  INTO v_tz
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- No matching restaurant row: still fall back so a stray/orphaned
  -- restaurant_id on revel_orders never aborts the run.
  IF v_tz IS NULL THEN
    v_tz := 'America/Chicago';
  END IF;

  -- ── revel_orders: recompute sold_at from raw_json in the validated tz ──
  UPDATE public.revel_orders o
  SET sold_at = public.revel_created_date_to_utc(public.revel_raw_created_date(o.raw_json), v_tz),
      updated_at = now()
  WHERE o.restaurant_id = p_restaurant_id
    AND public.revel_raw_created_date(o.raw_json) IS NOT NULL
    AND o.sold_at IS DISTINCT FROM
        public.revel_created_date_to_utc(public.revel_raw_created_date(o.raw_json), v_tz);
  GET DIAGNOSTICS v_orders_updated = ROW_COUNT;

  -- ── unified_sales: propagate the corrected instant, trigger suppressed ──
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  WITH updated AS (
    UPDATE public.unified_sales u
    SET sold_at = o.sold_at
    FROM public.revel_orders o
    WHERE u.pos_system = 'revel'
      AND u.restaurant_id = p_restaurant_id
      AND o.restaurant_id = p_restaurant_id
      AND u.external_order_id = o.revel_order_id
      AND u.sold_at IS DISTINCT FROM o.sold_at
    RETURNING u.sale_date
  )
  SELECT array_agg(DISTINCT sale_date), count(*)
  INTO v_touched_dates, v_sales_updated
  FROM updated;

  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- ── Re-aggregate once per distinct (restaurant_id, sale_date) actually
  -- touched by THIS call's unified_sales UPDATE above (via RETURNING), not
  -- every historical Revel sale_date the restaurant has ever had — otherwise
  -- an idempotent no-op re-run (0 rows changed) still pays the cost of
  -- rescanning + re-aggregating the restaurant's entire Revel sales history.
  IF v_touched_dates IS NOT NULL THEN
    FOREACH v_sale_date IN ARRAY v_touched_dates LOOP
      PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, v_sale_date);
      v_dates := v_dates + 1;
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_orders_updated, v_sales_updated, v_dates;
END;
$$;

COMMENT ON FUNCTION public.revel_backfill_sold_at_for_restaurant(uuid) IS
  'Per-restaurant worker for the Revel sold_at timezone backfill (2026-07-21). '
  'Idempotent — safe to re-run. Validates timezone against pg_timezone_names '
  '(fallback America/Chicago), suppresses the unified_sales aggregation trigger '
  'during the bulk UPDATE, and re-aggregates daily totals once per date actually '
  'touched by that UPDATE. Restricted to service_role — not an app-facing RPC '
  '(no auth.uid() ownership check; intended for the migration driver / ops use only).';

-- ============================================================
-- 5b) Lock down RPC execution. These are one-time migration/ops helpers
--    (invoked by the DO block below, or manually by an operator after
--    correcting a restaurant's timezone) — not app-facing RPCs. Postgres
--    grants EXECUTE to PUBLIC by default for new functions, and this project
--    has not altered that default, so without this every authenticated (and
--    possibly anon) client could call them directly via PostgREST:
--      - revel_backfill_sold_at_for_restaurant is SECURITY DEFINER and would
--        let any caller force an RLS-bypassing write against a restaurant_id
--        they don't own.
--      - revel_backfill_pending_count / revel_backfill_invalid_tz_restaurants
--        are SECURITY INVOKER (bounded by RLS) but still shouldn't be part of
--        the app-facing RPC surface; the latter also returns restaurant_name
--        across all restaurants with Revel orders.
--    Mirrors the REVOKE/GRANT pattern already used for the Revel sync RPCs
--    (20260706120000_revel_integration.sql).
-- ============================================================

REVOKE ALL ON FUNCTION public.revel_backfill_sold_at_for_restaurant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revel_backfill_pending_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revel_backfill_invalid_tz_restaurants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revel_backfill_sold_at_for_restaurant(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revel_backfill_pending_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.revel_backfill_invalid_tz_restaurants() TO service_role;

-- ============================================================
-- 6) Driver: run the backfill for every restaurant with Revel orders now.
--    Bounded per-restaurant DO loop (not one unbounded UPDATE), per design
--    §5b risk mitigation. Emits a pre/post pending-row report plus an
--    invalid/null-tz offender report via RAISE NOTICE/WARNING.
--
--    A DO block is a SINGLE statement, so the whole historical backfill runs
--    under one statement_timeout. On the first prod deploy (1345+ orders across
--    all restaurants + per-date re-aggregation) that exceeded the default
--    timeout and the migration was cancelled (SQLSTATE 57014) and rolled back —
--    halting the entire migration pipeline. Disable the per-statement timeout
--    for this one-time data backfill (standard pattern for heavy data
--    migrations), then restore it. sold_at is not an input to any daily
--    aggregate, so this only affects intra-day hour attribution, not totals.
-- ============================================================

SET statement_timeout = 0;

DO $$
DECLARE
  rec RECORD;
  v_result RECORD;
  v_offender RECORD;
  v_pre bigint;
  v_post bigint;
  v_total_orders integer := 0;
  v_total_sales integer := 0;
BEGIN
  v_pre := public.revel_backfill_pending_count();
  RAISE NOTICE 'revel sold_at backfill: % revel_orders rows need correction (pre-flight)', v_pre;

  FOR rec IN
    SELECT DISTINCT restaurant_id FROM public.revel_orders
  LOOP
    SELECT * INTO v_result
    FROM public.revel_backfill_sold_at_for_restaurant(rec.restaurant_id);

    v_total_orders := v_total_orders + v_result.orders_updated;
    v_total_sales := v_total_sales + v_result.unified_sales_updated;

    RAISE NOTICE
      'revel sold_at backfill: restaurant % -> % revel_orders, % unified_sales rows corrected, % dates re-aggregated',
      rec.restaurant_id, v_result.orders_updated, v_result.unified_sales_updated, v_result.dates_reaggregated;
  END LOOP;

  v_post := public.revel_backfill_pending_count();
  RAISE NOTICE
    'revel sold_at backfill: done — % revel_orders / % unified_sales rows corrected total; % rows still mismatched (post-flight, expect 0)',
    v_total_orders, v_total_sales, v_post;

  IF v_post > 0 THEN
    RAISE WARNING
      'revel sold_at backfill: % rows did not converge after the backfill — investigate raw_json coverage',
      v_post;
  END IF;

  FOR v_offender IN SELECT * FROM public.revel_backfill_invalid_tz_restaurants() LOOP
    RAISE WARNING
      'revel sold_at backfill: restaurant % (%) has invalid/null timezone "%" — fell back to America/Chicago',
      v_offender.restaurant_id, v_offender.restaurant_name, v_offender.timezone;
  END LOOP;
END $$;

-- Restore the default per-statement timeout for any migrations that follow.
RESET statement_timeout;
