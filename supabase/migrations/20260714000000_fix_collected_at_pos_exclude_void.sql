-- Exclude the negative void marker from get_unified_sales_totals.collected_at_pos.
--
-- Codex (PR #618) flagged that collected_at_pos was a bare SUM(total_price),
-- which swept in the negative adjustment_type='void' rows written by the void
-- model. A fully-voided $6 check (whose sale/tip/tax rows are deleted and a -$6
-- void marker inserted) therefore dragged collected_at_pos to -$6 instead of $0,
-- understating POS-collected / deposit totals on the POS Sales page and in
-- useMonthlyMetrics (which reads this column). This already affected the 2,658
-- existing Toast void rows (Toast writes the same adjustment_type='void' rows)
-- and would newly affect Focus voids.
--
-- Fix: exclude adjustment_type='void' from collected_at_pos only — every other
-- output of this function (revenue, discounts, voids, pass_through) already
-- guards on adjustment_type and excludes the marker. Rebuilt from the live prod
-- body; collected_at_pos is the sole change. Shipped as its own migration
-- because 20260713020000 is already merged/applied.
CREATE OR REPLACE FUNCTION public.get_unified_sales_totals(p_restaurant_id uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_search_term text DEFAULT NULL::text)
 RETURNS TABLE(total_count bigint, revenue numeric, discounts numeric, voids numeric, pass_through_amount numeric, unique_items bigint, collected_at_pos numeric, uncategorized_count bigint, pending_review_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
    AND ur.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied to restaurant';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_count,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type IS NOT NULL THEN 0
        WHEN us.item_type = 'sale' THEN us.total_price
        ELSE 0
      END
    ), 0)::NUMERIC AS revenue,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type = 'discount' THEN ABS(us.total_price)
        WHEN us.adjustment_type IS NULL AND us.item_type = 'discount' THEN ABS(us.total_price)
        ELSE 0
      END
    ), 0)::NUMERIC AS discounts,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type = 'void' THEN ABS(us.total_price)
        ELSE 0
      END
    ), 0)::NUMERIC AS voids,

    COALESCE(SUM(
      CASE
        WHEN us.adjustment_type IS NOT NULL AND us.adjustment_type NOT IN ('discount', 'void') THEN us.total_price
        WHEN us.adjustment_type IS NULL AND us.item_type NOT IN ('sale', 'discount') THEN us.total_price
        ELSE 0
      END
    ), 0)::NUMERIC AS pass_through_amount,

    COUNT(DISTINCT us.item_name)::BIGINT AS unique_items,

    -- collected_at_pos: everything the POS actually collected, EXCLUDING the
    -- synthetic negative void marker (which nets its own deleted rows and must
    -- not understate the deposit total).
    COALESCE(SUM(us.total_price) FILTER (WHERE us.adjustment_type IS DISTINCT FROM 'void'), 0)::NUMERIC AS collected_at_pos,

    COUNT(*) FILTER (
      WHERE us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NULL
    )::BIGINT AS uncategorized_count,

    COUNT(*) FILTER (
      WHERE us.is_categorized IS NOT TRUE AND us.suggested_category_id IS NOT NULL
    )::BIGINT AS pending_review_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.parent_sale_id IS NULL
    AND (p_start_date IS NULL OR us.sale_date >= p_start_date)
    AND (p_end_date IS NULL OR us.sale_date <= p_end_date)
    AND (
      p_search_term IS NULL
      OR p_search_term = ''
      OR us.item_name ILIKE '%' || p_search_term || '%'
    );
END;
$function$;

-- Re-apply grants (CREATE OR REPLACE resets ACLs in Postgres).
GRANT EXECUTE ON FUNCTION public.get_unified_sales_totals(uuid, date, date, text) TO authenticated, service_role;
