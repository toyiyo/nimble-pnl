-- get_sales_trends: single-round-trip aggregate for the POS Sales Trends panel.
-- Design: docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md §4.1
--
-- Returns one JSONB object with per-POS day/hour/weekday/product buckets so the
-- panel's POS filter re-scopes entirely client-side (no refetch on toggle).
--
-- Revenue predicate mirrors the authoritative one from get_unified_sales_totals
-- (20260302120002): parent_sale_id IS NULL AND adjustment_type IS NULL AND
-- item_type = 'sale'. Adjustment rows (tip/tax/service_charge/discount/fee/void)
-- and child splits never contribute to any bucket.
--
-- Date-range clamp: when BOTH p_start_date and p_end_date are NULL, default the
-- window to the last 90 days (matches the Toast initial-sync convention) rather
-- than scanning all history — this RPC runs four grouped scans + a product sort
-- and is GRANTed to all authenticated users. Explicit dates are honored as given.
--
-- Timezone: COALESCE(p_time_zone, 'America/Chicago') inside the body (not just
-- the arg default) — an explicit NULL from the client would otherwise make
-- `AT TIME ZONE NULL` yield NULL and silently empty by_hour.
--
-- Hour bucketing: unified_sales.sale_time is a TIME column (base migration
-- 20250925125415, never altered), so EXTRACT(HOUR FROM sale_time) needs no
-- string-parse guard — Postgres rejects invalid values at INSERT. sold_at (a
-- timestamptz) is preferred when present; sale_time is the fallback for legacy
-- rows that predate the sold_at backfill. A row with neither is omitted from
-- by_hour only (still counted in by_day/by_weekday/by_product).
--
-- orders = COUNT(DISTINCT COALESCE(external_order_id, id::text)) — defensive:
-- external_order_id is currently NOT NULL on unified_sales, but COALESCE keeps
-- this correct if that constraint is ever relaxed, without changing today's
-- behavior (COUNT(DISTINCT external_order_id) already collapses multi-line-item
-- orders into a single order).

CREATE OR REPLACE FUNCTION public.get_sales_trends(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_time_zone TEXT DEFAULT 'America/Chicago'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
  v_time_zone TEXT := COALESCE(p_time_zone, 'America/Chicago');
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  IF p_start_date IS NULL AND p_end_date IS NULL THEN
    v_start_date := CURRENT_DATE - 90;
    v_end_date := CURRENT_DATE;
  ELSE
    v_start_date := COALESCE(p_start_date, CURRENT_DATE - 90);
    v_end_date := COALESCE(p_end_date, CURRENT_DATE);
  END IF;

  WITH revenue_rows AS (
    SELECT
      us.id,
      us.sale_date,
      us.pos_system,
      us.total_price,
      us.item_name,
      us.quantity,
      us.external_order_id,
      CASE
        WHEN us.sold_at IS NOT NULL
          THEN EXTRACT(HOUR FROM (us.sold_at AT TIME ZONE v_time_zone))::int
        WHEN us.sale_time IS NOT NULL
          THEN EXTRACT(HOUR FROM us.sale_time)::int
        ELSE NULL
      END AS hour_bucket
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND us.parent_sale_id IS NULL
      AND us.adjustment_type IS NULL
      AND us.item_type = 'sale'
      -- v_start_date / v_end_date are always non-NULL here (clamped above),
      -- so a straight range predicate is exact and lets the planner use
      -- idx_unified_sales_restaurant_date without an OR-branch (Copilot #629).
      AND us.sale_date >= v_start_date
      AND us.sale_date <= v_end_date
  )
  SELECT jsonb_build_object(
    'pos_systems', (
      SELECT COALESCE(jsonb_agg(s.pos_system ORDER BY s.rev DESC), '[]'::jsonb)
      FROM (
        SELECT pos_system, COALESCE(SUM(total_price), 0) AS rev
        FROM revenue_rows
        GROUP BY pos_system
      ) s
    ),
    'by_day', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'sale_date', d.sale_date,
        'pos_system', d.pos_system,
        'revenue', ROUND(d.rev, 2),
        'orders', d.orders
      ) ORDER BY d.sale_date, d.pos_system), '[]'::jsonb)
      FROM (
        SELECT
          sale_date,
          pos_system,
          COALESCE(SUM(total_price), 0) AS rev,
          COUNT(DISTINCT COALESCE(external_order_id, id::text)) AS orders
        FROM revenue_rows
        GROUP BY sale_date, pos_system
      ) d
    ),
    'by_hour', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'hour', h.hour_bucket,
        'pos_system', h.pos_system,
        'revenue', ROUND(h.rev, 2),
        'day_count', h.day_count
      ) ORDER BY h.hour_bucket, h.pos_system), '[]'::jsonb)
      FROM (
        SELECT
          hour_bucket,
          pos_system,
          COALESCE(SUM(total_price), 0) AS rev,
          COUNT(DISTINCT sale_date) AS day_count
        FROM revenue_rows
        WHERE hour_bucket IS NOT NULL
        GROUP BY hour_bucket, pos_system
      ) h
    ),
    'by_weekday', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'dow', w.dow,
        'pos_system', w.pos_system,
        'revenue', ROUND(w.rev, 2)
      ) ORDER BY w.dow, w.pos_system), '[]'::jsonb)
      FROM (
        SELECT
          EXTRACT(DOW FROM sale_date)::int AS dow,
          pos_system,
          COALESCE(SUM(total_price), 0) AS rev
        FROM revenue_rows
        GROUP BY EXTRACT(DOW FROM sale_date)::int, pos_system
      ) w
    ),
    'by_product', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'item_name', p.item_name,
        'pos_system', p.pos_system,
        'revenue', ROUND(p.rev, 2),
        'quantity', p.qty
      ) ORDER BY p.rev DESC), '[]'::jsonb)
      FROM (
        SELECT
          item_name,
          pos_system,
          COALESCE(SUM(total_price), 0) AS rev,
          COALESCE(SUM(quantity), 0) AS qty
        FROM revenue_rows
        GROUP BY item_name, pos_system
        ORDER BY COALESCE(SUM(total_price), 0) DESC
        LIMIT 300
      ) p
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- Re-issued explicitly: CREATE OR REPLACE resets ACLs.
GRANT EXECUTE ON FUNCTION public.get_sales_trends(UUID, DATE, DATE, TEXT) TO authenticated;
