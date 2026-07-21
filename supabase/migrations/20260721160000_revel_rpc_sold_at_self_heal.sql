-- =====================================================
-- Revel RPC self-heal (durability) — T5 of the sold_at timezone fix
--
-- Both revel_sync_financial_breakdown and sync_revel_to_unified_sales insert into
-- unified_sales with ON CONFLICT ... DO NOTHING, so a future re-sync of an existing
-- order refreshes revel_orders.sold_at but never propagates the corrected instant
-- into an already-present unified_sales row (Toast's RPC already self-heals this
-- way: see 20260529130000_unified_sales_sold_at.sql).
--
-- Change every unified_sales insert block's conflict clause from DO NOTHING to
-- DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at) —
-- updating ONLY sold_at, so user categorization (category_id, is_categorized,
-- suggested_category_id, ...) is preserved on every other column.
--
-- Function bodies are otherwise byte-identical to 20260706120000_revel_integration.sql.
-- =====================================================

CREATE OR REPLACE FUNCTION public.revel_sync_financial_breakdown(
  p_order_id TEXT,
  p_restaurant_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_rows INTEGER := 0;
  v_order public.revel_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  SELECT * INTO v_order
  FROM public.revel_orders
  WHERE restaurant_id = p_restaurant_id AND revel_order_id = p_order_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- 1) Sale line items (item_type = 'sale')
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id,
    oi.item_name, oi.quantity, oi.unit_price, oi.total_price,
    v_order.order_date, v_order.order_time, v_order.sold_at, oi.menu_category,
    'sale', oi.raw_json, now()
  FROM public.revel_order_items oi
  WHERE oi.restaurant_id = p_restaurant_id
    AND oi.revel_order_id = p_order_id
    AND oi.is_voided = false
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 2) Tax adjustment row (item_type = 'tax')
  IF COALESCE(v_order.tax_amount, 0) <> 0 THEN
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system, external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at
    )
    VALUES (
      p_restaurant_id, 'revel', p_order_id, p_order_id || ':tax',
      'Tax', 1, v_order.tax_amount, v_order.tax_amount,
      v_order.order_date, v_order.order_time, v_order.sold_at, 'tax', 'tax', now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  -- 3) Tip adjustment row (item_type = 'tip')
  IF COALESCE(v_order.tip_amount, 0) <> 0 THEN
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system, external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at
    )
    VALUES (
      p_restaurant_id, 'revel', p_order_id, p_order_id || ':tip',
      'Tip', 1, v_order.tip_amount, v_order.tip_amount,
      v_order.order_date, v_order.order_time, v_order.sold_at, 'tip', 'tip', now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  -- 4) Discount adjustment row (item_type = 'discount', negative amount)
  IF COALESCE(v_order.discount_amount, 0) <> 0 THEN
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system, external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at
    )
    VALUES (
      p_restaurant_id, 'revel', p_order_id, p_order_id || ':discount',
      'Discount', 1, -abs(v_order.discount_amount), -abs(v_order.discount_amount),
      v_order.order_date, v_order.order_time, v_order.sold_at, 'discount', 'discount', now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  -- 5) Service charge / auto-gratuity row (item_type = 'service_charge').
  -- Mirrors block 5 of sync_revel_to_unified_sales so webhook orders carry the same
  -- component as backfilled ones — otherwise auto-grat/fee orders diverge by channel.
  IF COALESCE(v_order.service_charge_amount, 0) <> 0 THEN
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system, external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at
    )
    VALUES (
      p_restaurant_id, 'revel', p_order_id, p_order_id || ':service_charge',
      'Service Charge', 1, v_order.service_charge_amount, v_order.service_charge_amount,
      v_order.order_date, v_order.order_time, v_order.sold_at, 'service_charge', 'service_charge', now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
    DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  RETURN v_synced_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_revel_to_unified_sales(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_rows INTEGER := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- 1) Sale rows: non-voided line items (total_price includes modifiers)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id,
    oi.item_name, oi.quantity, oi.unit_price, oi.total_price,
    o.order_date, o.order_time, o.sold_at, oi.menu_category, 'sale', oi.raw_json, now()
  FROM public.revel_order_items oi
  INNER JOIN public.revel_orders o ON oi.revel_order_id_fk = o.id
  WHERE oi.restaurant_id = p_restaurant_id
    AND oi.is_voided = false
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 2) Per-order reconciliation to Revel's authoritative header subtotal.
  --    Revel removes/refunds some items from the subtotal without an item-level flag;
  --    this labeled line makes each order's sale total match the POS exactly.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, synced_at)
  SELECT g.restaurant_id, 'revel', g.revel_order_id, g.revel_order_id || ':reconcile', 'POS sales adjustment',
         1, g.adj, g.adj, g.order_date, g.order_time, g.sold_at, 'sale', now()
  FROM (
    SELECT o.restaurant_id, o.revel_order_id, o.order_date, o.order_time, o.sold_at,
           round(COALESCE(o.subtotal_amount,0) - COALESCE(sum(oi.total_price) FILTER (WHERE oi.is_voided = false), 0), 2) AS adj
    FROM public.revel_orders o
    LEFT JOIN public.revel_order_items oi ON oi.revel_order_id_fk = o.id
    WHERE o.restaurant_id = p_restaurant_id
      AND (p_start_date IS NULL OR o.order_date >= p_start_date)
      AND (p_end_date IS NULL OR o.order_date <= p_end_date)
    GROUP BY o.restaurant_id, o.revel_order_id, o.order_date, o.order_time, o.sold_at, o.subtotal_amount
  ) g
  WHERE g.adj <> 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 3) Tax (header)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':tax', 'Tax',
         1, o.tax_amount, o.tax_amount, o.order_date, o.order_time, o.sold_at, 'tax', 'tax', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.tax_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 3) Tip / gratuity (header; on top of final_total)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':tip', 'Tip',
         1, o.tip_amount, o.tip_amount, o.order_date, o.order_time, o.sold_at, 'tip', 'tip', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.tip_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 4) Discount (header; stored negative)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':discount', 'Discount',
         1, -abs(o.discount_amount), -abs(o.discount_amount), o.order_date, o.order_time, o.sold_at, 'discount', 'discount', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.discount_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 5) Service charge (header)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at)
  SELECT o.restaurant_id, 'revel', o.revel_order_id, o.revel_order_id || ':service_charge', 'Service Charge',
         1, o.service_charge_amount, o.service_charge_amount, o.order_date, o.order_time, o.sold_at, 'service_charge', 'service_charge', now()
  FROM public.revel_orders o
  WHERE o.restaurant_id = p_restaurant_id AND COALESCE(o.service_charge_amount, 0) <> 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 6/7/8) Informational adjustment lines (Voided / Returned / Refunds). These mirror Revel's
  -- Sales Summary "Adjustments" section. They use item_type 'other'/'refund' (NOT 'sale'), so
  -- they never enter Net Sales — which stays exact — but are available for the audit/report.
  -- Split rule: a voided item whose order was refunded (has a negative payment) = "Returned";
  -- otherwise = "Voided". Refunds = payments with a negative amount.

  -- 6) Voided items (voided, order NOT refunded)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at)
  SELECT oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id || ':void', 'Voided item - ' || oi.item_name,
         oi.quantity, -oi.unit_price, -oi.total_price, o.order_date, o.order_time, o.sold_at, oi.menu_category, 'other', oi.raw_json, now()
  FROM public.revel_order_items oi
  JOIN public.revel_orders o ON oi.revel_order_id_fk = o.id
  WHERE oi.restaurant_id = p_restaurant_id AND oi.is_voided = true
    AND NOT EXISTS (SELECT 1 FROM public.revel_payments p
                    WHERE p.restaurant_id = oi.restaurant_id AND p.revel_order_id = oi.revel_order_id
                      AND (p.raw_json->>'amount')::numeric < 0)
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 7) Returned items (voided, order WAS refunded)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at)
  SELECT oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id || ':return', 'Returned item - ' || oi.item_name,
         oi.quantity, -oi.unit_price, -oi.total_price, o.order_date, o.order_time, o.sold_at, oi.menu_category, 'other', oi.raw_json, now()
  FROM public.revel_order_items oi
  JOIN public.revel_orders o ON oi.revel_order_id_fk = o.id
  WHERE oi.restaurant_id = p_restaurant_id AND oi.is_voided = true
    AND EXISTS (SELECT 1 FROM public.revel_payments p
                WHERE p.restaurant_id = oi.restaurant_id AND p.revel_order_id = oi.revel_order_id
                  AND (p.raw_json->>'amount')::numeric < 0)
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 8) Refunds (payments with a negative amount)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id, item_name,
    quantity, unit_price, total_price, sale_date, sale_time, sold_at, item_type, raw_data, synced_at)
  SELECT p.restaurant_id, 'revel', p.revel_order_id, p.revel_payment_id || ':refund', 'Refund',
         1, (p.raw_json->>'amount')::numeric, (p.raw_json->>'amount')::numeric, o.order_date, o.order_time, o.sold_at, 'refund', p.raw_json, now()
  FROM public.revel_payments p
  JOIN public.revel_orders o ON p.revel_order_id = o.revel_order_id AND p.restaurant_id = o.restaurant_id
  WHERE p.restaurant_id = p_restaurant_id AND (p.raw_json->>'amount')::numeric < 0
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET sold_at = COALESCE(EXCLUDED.sold_at, unified_sales.sold_at);
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  RETURN v_synced_count;
END;
$$;
