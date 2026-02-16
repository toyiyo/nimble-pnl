-- Migration: fix_toast_sync_timeout
-- Purpose: Fix Toast sync timeout by skipping per-row triggers during bulk sync
--          and batch-categorizing/aggregating afterwards.
--
-- Part 1: Partial index for faster rule lookups
-- Part 2: Mark matches_pos_sale_rule as STABLE (+ case-insensitive regex)
-- Part 3: Redefine trigger functions with GUC-based bypass
-- Part 4: Rewrite sync_toast_to_unified_sales(UUID) with GUC bypass
-- Part 5: Rewrite sync_toast_to_unified_sales(UUID, DATE, DATE) with GUC bypass

-- =============================================================================
-- Part 1: Partial index for faster rule lookups
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_cr_pos_active_auto
  ON categorization_rules (restaurant_id, priority DESC, created_at ASC)
  WHERE is_active = true AND auto_apply = true AND applies_to IN ('pos_sales', 'both');

-- =============================================================================
-- Part 2: Mark matches_pos_sale_rule as STABLE (+ case-insensitive regex)
-- =============================================================================

CREATE OR REPLACE FUNCTION matches_pos_sale_rule(
  p_rule_id UUID,
  p_sale JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rule RECORD;
  v_item_name TEXT;
  v_amount NUMERIC;
  v_pos_category TEXT;
BEGIN
  -- Get rule details
  SELECT * INTO v_rule
  FROM categorization_rules
  WHERE id = p_rule_id
    AND is_active = true
    AND applies_to IN ('pos_sales', 'both');

  IF v_rule.id IS NULL THEN
    RETURN false;
  END IF;

  -- Extract sale fields
  v_item_name := COALESCE(p_sale->>'item_name', '');
  v_amount := COALESCE((p_sale->>'total_price')::NUMERIC, 0);
  v_pos_category := COALESCE(p_sale->>'pos_category', '');

  -- Check item name pattern
  IF v_rule.item_name_pattern IS NOT NULL THEN
    CASE v_rule.item_name_match_type
      WHEN 'exact' THEN
        IF LOWER(v_item_name) != LOWER(v_rule.item_name_pattern) THEN
          RETURN false;
        END IF;
      WHEN 'contains' THEN
        IF POSITION(LOWER(v_rule.item_name_pattern) IN LOWER(v_item_name)) = 0 THEN
          RETURN false;
        END IF;
      WHEN 'starts_with' THEN
        IF NOT (LOWER(v_item_name) LIKE LOWER(v_rule.item_name_pattern) || '%') THEN
          RETURN false;
        END IF;
      WHEN 'ends_with' THEN
        IF NOT (LOWER(v_item_name) LIKE '%' || LOWER(v_rule.item_name_pattern)) THEN
          RETURN false;
        END IF;
      WHEN 'regex' THEN
        -- Use ~* for case-insensitive regex, consistent with other match types
        IF NOT (v_item_name ~* v_rule.item_name_pattern) THEN
          RETURN false;
        END IF;
    END CASE;
  END IF;

  -- Check POS category
  IF v_rule.pos_category IS NOT NULL THEN
    IF LOWER(v_pos_category) != LOWER(v_rule.pos_category) THEN
      RETURN false;
    END IF;
  END IF;

  -- Check amount range
  IF v_rule.amount_min IS NOT NULL AND ABS(v_amount) < v_rule.amount_min THEN
    RETURN false;
  END IF;

  IF v_rule.amount_max IS NOT NULL AND ABS(v_amount) > v_rule.amount_max THEN
    RETURN false;
  END IF;

  -- All conditions matched
  RETURN true;
END;
$$;

-- =============================================================================
-- Part 3: Redefine trigger functions with GUC-based bypass
-- Instead of ALTER TABLE DISABLE/ENABLE TRIGGER (which acquires
-- ShareRowExclusiveLock and blocks concurrent writers), use a transaction-local
-- GUC flag. Triggers check the flag and short-circuit during bulk sync.
-- =============================================================================

CREATE OR REPLACE FUNCTION auto_apply_pos_categorization_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
  v_sale_json JSONB;
  v_auto_apply BOOLEAN;
BEGIN
  -- Skip during bulk sync (GUC flag set by sync_toast_to_unified_sales)
  IF current_setting('app.skip_unified_sales_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Only process uncategorized sales
  IF NEW.is_categorized = false OR NEW.category_id IS NULL THEN
    -- Build sale JSONB for matching
    v_sale_json := jsonb_build_object(
      'item_name', NEW.item_name,
      'total_price', NEW.total_price,
      'pos_category', NEW.pos_category
    );

    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_pos_sale(NEW.restaurant_id, v_sale_json)
    LIMIT 1;

    -- If rule found, check if auto_apply is enabled
    IF v_rule.rule_id IS NOT NULL THEN
      SELECT auto_apply INTO v_auto_apply
      FROM categorization_rules
      WHERE id = v_rule.rule_id;

      IF v_auto_apply THEN
        NEW.category_id := v_rule.category_id;
        NEW.is_categorized := true;

        -- Update rule statistics
        UPDATE categorization_rules
        SET
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_unified_sales_aggregation()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip during bulk sync (GUC flag set by sync_toast_to_unified_sales)
  IF current_setting('app.skip_unified_sales_triggers', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Aggregate for the affected date
  PERFORM public.aggregate_unified_sales_to_daily(NEW.restaurant_id, NEW.sale_date::date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =============================================================================
-- Part 4: Rewrite sync_toast_to_unified_sales(UUID) — single-arg overload
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER;
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Set GUC flag to skip per-row triggers during bulk sync (transaction-local).
  -- This avoids ShareRowExclusiveLock from ALTER TABLE DISABLE TRIGGER,
  -- allowing concurrent writers to proceed without blocking.
  -- The flag auto-resets on transaction commit/rollback.
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- 0a. DELETE stale sale entries for now-voided items
  -- The upsert in Step 1 filters is_voided = false, so voided items
  -- that were previously synced as sales will never be updated/removed.
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'sale'
    AND us.external_item_id = toi.toast_item_guid
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true;

  -- 0b. DELETE stale tax entries for $0-tax orders
  -- The upsert in Step 4 filters tax_amount != 0, so orders whose tax
  -- dropped to $0 (e.g. fully comp'd) will never be updated/removed.
  DELETE FROM public.unified_sales us
  USING public.toast_orders too
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tax'
    AND us.external_item_id = too.toast_order_guid || '_tax'
    AND us.restaurant_id = too.restaurant_id
    AND (too.tax_amount IS NULL OR too.tax_amount = 0);

  -- 0c. DELETE stale discount entries for now-voided items
  -- The upsert in Step 2 filters is_voided = false, so discounts on
  -- voided items will never be updated/removed.
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'discount'
    AND us.adjustment_type = 'discount'
    AND us.external_item_id = toi.toast_item_guid || '_discount'
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true;

  -- 1. REVENUE entries (from order items at GROSS price)
  -- unit_price in toast_order_items is a LINE TOTAL (qty * per-unit price from Toast).
  -- We divide by quantity for true per-unit, and use the raw value as total_price.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price / NULLIF(toi.quantity, 0), toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'sale', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
    AND toi.is_voided = false
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 2. ITEM DISCOUNT/COMP offset entries (negative amounts)
  -- discount_amount is also a LINE TOTAL. Divide by quantity for per-unit.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_discount',
    'Discount - ' || toi.item_name, toi.quantity, -toi.discount_amount / NULLIF(toi.quantity, 0), -toi.discount_amount,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'discount', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND toi.discount_amount > 0
    AND toi.is_voided = false
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 3. VOID offset entries (negative amounts)
  -- unit_price is a LINE TOTAL. Divide by quantity for per-unit.
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_void',
    'Void - ' || toi.item_name, toi.quantity, -toi.unit_price / NULLIF(toi.quantity, 0), -toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'void', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND toi.is_voided = true
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 4. TAX entries (unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_tax',
    'Sales Tax', 1, too.tax_amount, too.tax_amount,
    too.order_date, too.order_time, 'tax', 'tax', too.raw_json, NOW()
  FROM public.toast_orders too
  WHERE too.restaurant_id = p_restaurant_id
    AND too.tax_amount IS NOT NULL
    AND too.tax_amount != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 5a. DELETE stale tip entries for denied/voided payments
  -- The upsert below won't remove rows that the query no longer selects,
  -- so we must explicitly delete tips from denied/voided payments.
  DELETE FROM public.unified_sales us
  USING public.toast_payments tp
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tip'
    AND us.external_item_id = tp.toast_payment_guid || '_tip'
    AND us.restaurant_id = tp.restaurant_id
    AND tp.payment_status IN ('DENIED', 'VOIDED');

  -- 5b. TIP entries (filter out denied/voided payments)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_tip',
    'Tip - ' || COALESCE(tp.payment_type, 'Unknown'), 1, tp.tip_amount, tp.tip_amount,
    tp.payment_date, NULL, 'tip', 'tip', tp.raw_json, NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.tip_amount IS NOT NULL
    AND tp.tip_amount != 0
    AND tp.payment_status NOT IN ('DENIED', 'VOIDED')
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 6. REFUND entries (unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_refund',
    'Refund - ' || COALESCE(tp.payment_type, 'Unknown'), 1,
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    tp.payment_date, NULL, 'refund', tp.raw_json, NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.raw_json->>'refundStatus' IN ('PARTIAL', 'FULL')
    AND (tp.raw_json->'refund'->>'refundAmount')::NUMERIC > 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- Reset GUC flag to re-enable per-row triggers
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Batch-categorize uncategorized sale rows (only when called by authenticated user;
  -- service-role callers defer categorization to the apply-categorization-rules edge function)
  IF auth.uid() IS NOT NULL THEN
    PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
  ELSE
    RAISE LOG 'sync_toast_to_unified_sales: skipping batch categorization (service-role caller, auth.uid() is NULL)';
  END IF;

  -- Batch-aggregate daily sales for all affected dates (single pass instead of per-row)
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (SELECT DISTINCT sale_date FROM public.unified_sales
        WHERE restaurant_id = p_restaurant_id AND pos_system = 'toast') d;

  RETURN v_synced_count;
END;
$$;

COMMENT ON FUNCTION sync_toast_to_unified_sales(UUID) IS
  'Syncs ALL Toast orders to unified_sales. Skips per-row triggers via GUC flag during bulk ops, then batch-categorizes and batch-aggregates after sync.';

-- =============================================================================
-- Part 5: Rewrite sync_toast_to_unified_sales(UUID, DATE, DATE) — date-range overload
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_toast_to_unified_sales(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_row_count INTEGER;
BEGIN
  -- Authorization check: skip when called from service role (auth.uid() is NULL)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Set GUC flag to skip per-row triggers during bulk sync (transaction-local)
  PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);

  -- 0a. DELETE stale sale entries for now-voided items (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'sale'
    AND us.external_item_id = toi.toast_item_guid
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date;

  -- 0b. DELETE stale tax entries for $0-tax orders (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_orders too
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tax'
    AND us.external_item_id = too.toast_order_guid || '_tax'
    AND us.restaurant_id = too.restaurant_id
    AND (too.tax_amount IS NULL OR too.tax_amount = 0)
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date;

  -- 0c. DELETE stale discount entries for now-voided items (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_order_items toi
  JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'discount'
    AND us.adjustment_type = 'discount'
    AND us.external_item_id = toi.toast_item_guid || '_discount'
    AND us.restaurant_id = toi.restaurant_id
    AND toi.is_voided = true
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date;

  -- 1. REVENUE entries at GROSS price (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid,
    toi.item_name, toi.quantity, toi.unit_price / NULLIF(toi.quantity, 0), toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'sale', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
    AND toi.is_voided = false
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 2. ITEM DISCOUNT/COMP offset entries (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_discount',
    'Discount - ' || toi.item_name, toi.quantity, -toi.discount_amount / NULLIF(toi.quantity, 0), -toi.discount_amount,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'discount', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
    AND toi.discount_amount > 0
    AND toi.is_voided = false
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 3. VOID offset entries (filtered by date)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, pos_category, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    toi.restaurant_id, 'toast', toi.toast_order_guid, toi.toast_item_guid || '_void',
    'Void - ' || toi.item_name, toi.quantity, -toi.unit_price / NULLIF(toi.quantity, 0), -toi.unit_price,
    too.order_date, too.order_time, toi.menu_category, 'discount', 'void', toi.raw_json, NOW()
  FROM public.toast_order_items toi
  INNER JOIN public.toast_orders too
    ON toi.toast_order_guid = too.toast_order_guid
    AND toi.restaurant_id = too.restaurant_id
  WHERE toi.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
    AND toi.is_voided = true
    AND toi.unit_price IS NOT NULL
    AND toi.unit_price != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    quantity = EXCLUDED.quantity,
    unit_price = EXCLUDED.unit_price,
    total_price = EXCLUDED.total_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    pos_category = EXCLUDED.pos_category,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 4. TAX entries (filtered by date, unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    too.restaurant_id, 'toast', too.toast_order_guid, too.toast_order_guid || '_tax',
    'Sales Tax', 1, too.tax_amount, too.tax_amount,
    too.order_date, too.order_time, 'tax', 'tax', too.raw_json, NOW()
  FROM public.toast_orders too
  WHERE too.restaurant_id = p_restaurant_id
    AND too.order_date >= p_start_date
    AND too.order_date <= p_end_date
    AND too.tax_amount IS NOT NULL
    AND too.tax_amount != 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 5a. DELETE stale tip entries for denied/voided payments (filtered by date)
  DELETE FROM public.unified_sales us
  USING public.toast_payments tp
  WHERE us.restaurant_id = p_restaurant_id
    AND us.pos_system = 'toast'
    AND us.item_type = 'tip'
    AND us.external_item_id = tp.toast_payment_guid || '_tip'
    AND us.restaurant_id = tp.restaurant_id
    AND tp.payment_date >= p_start_date
    AND tp.payment_date <= p_end_date
    AND tp.payment_status IN ('DENIED', 'VOIDED');

  -- 5b. TIP entries (filtered by payment_date, filter out denied/voided payments)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, adjustment_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_tip',
    'Tip - ' || COALESCE(tp.payment_type, 'Unknown'), 1, tp.tip_amount, tp.tip_amount,
    tp.payment_date, NULL, 'tip', 'tip', tp.raw_json, NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.payment_date >= p_start_date
    AND tp.payment_date <= p_end_date
    AND tp.tip_amount IS NOT NULL
    AND tp.tip_amount != 0
    AND tp.payment_status NOT IN ('DENIED', 'VOIDED')
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- 6. REFUND entries (filtered by payment_date, unchanged)
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, item_type, raw_data, synced_at
  )
  SELECT
    tp.restaurant_id, 'toast', tp.toast_order_guid, tp.toast_payment_guid || '_refund',
    'Refund - ' || COALESCE(tp.payment_type, 'Unknown'), 1,
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    -ABS(COALESCE((tp.raw_json->'refund'->>'refundAmount')::NUMERIC / 100, 0)),
    tp.payment_date, NULL, 'refund', tp.raw_json, NOW()
  FROM public.toast_payments tp
  WHERE tp.restaurant_id = p_restaurant_id
    AND tp.payment_date >= p_start_date
    AND tp.payment_date <= p_end_date
    AND tp.raw_json->>'refundStatus' IN ('PARTIAL', 'FULL')
    AND (tp.raw_json->'refund'->>'refundAmount')::NUMERIC > 0
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
  DO UPDATE SET
    item_name = EXCLUDED.item_name,
    total_price = EXCLUDED.total_price,
    unit_price = EXCLUDED.unit_price,
    sale_date = EXCLUDED.sale_date,
    sale_time = EXCLUDED.sale_time,
    raw_data = EXCLUDED.raw_data,
    synced_at = EXCLUDED.synced_at;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_synced_count := v_synced_count + v_row_count;

  -- Reset GUC flag to re-enable per-row triggers
  PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

  -- Batch-categorize uncategorized sale rows (only when called by authenticated user;
  -- service-role callers defer categorization to the apply-categorization-rules edge function)
  IF auth.uid() IS NOT NULL THEN
    PERFORM apply_rules_to_pos_sales(p_restaurant_id, 10000);
  ELSE
    RAISE LOG 'sync_toast_to_unified_sales: skipping batch categorization (service-role caller, auth.uid() is NULL)';
  END IF;

  -- Batch-aggregate daily sales for affected dates in range (single pass instead of per-row)
  PERFORM public.aggregate_unified_sales_to_daily(p_restaurant_id, d.sale_date)
  FROM (SELECT DISTINCT sale_date FROM public.unified_sales
        WHERE restaurant_id = p_restaurant_id AND pos_system = 'toast'
          AND sale_date >= p_start_date AND sale_date <= p_end_date) d;

  RETURN v_synced_count;
END;
$$;

COMMENT ON FUNCTION sync_toast_to_unified_sales(UUID, DATE, DATE) IS
  'Syncs Toast orders within date range to unified_sales. Skips per-row triggers via GUC flag during bulk ops, then batch-categorizes and batch-aggregates after sync.';
