-- Fix sync_shift4_to_unified_sales to work with partial unique index
-- The unified_sales table has a partial unique index that requires parent_sale_id to be NULL
-- for the constraint to apply. We need to explicitly set parent_sale_id = NULL in inserts.

DROP FUNCTION IF EXISTS sync_shift4_to_unified_sales(UUID);

CREATE OR REPLACE FUNCTION sync_shift4_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_charge RECORD;
BEGIN
  -- Process each charge and create unified sales entries
  FOR v_charge IN
    SELECT 
      c.charge_id,
      c.amount,
      c.currency,
      c.status,
      c.service_date,
      c.service_time,
      c.tip_amount,
      c.created_time,
      c.raw_json
    FROM shift4_charges c
    WHERE c.restaurant_id = p_restaurant_id
      AND c.status = 'successful'
      AND c.captured = true
      AND c.refunded = false
  LOOP
    -- Create main sale entry (total collected minus tip)
    -- Shift4 amount includes tip, so we subtract it for the base sale amount
    INSERT INTO unified_sales (
      restaurant_id,
      pos_system,
      external_order_id,
      external_item_id,
      item_name,
      quantity,
      total_price,
      sale_date,
      sale_time,
      item_type,
      parent_sale_id,
      raw_data,
      synced_at
    )
    VALUES (
      p_restaurant_id,
      'shift4',
      v_charge.charge_id,
      v_charge.charge_id || '_sale',
      'Shift4 Sale',
      1,
      (v_charge.amount - COALESCE(v_charge.tip_amount, 0)) / 100.0,
      v_charge.service_date,
      v_charge.service_time,
      'sale',
      NULL,
      v_charge.raw_json,
      now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
    DO UPDATE SET
      total_price = EXCLUDED.total_price,
      sale_date = EXCLUDED.sale_date,
      sale_time = EXCLUDED.sale_time,
      raw_data = EXCLUDED.raw_data,
      synced_at = now();

    v_synced_count := v_synced_count + 1;

    -- Create tip entry if tip amount exists
    IF v_charge.tip_amount IS NOT NULL AND v_charge.tip_amount > 0 THEN
      INSERT INTO unified_sales (
        restaurant_id,
        pos_system,
        external_order_id,
        external_item_id,
        item_name,
        quantity,
        total_price,
        sale_date,
        sale_time,
        item_type,
        adjustment_type,
        parent_sale_id,
        raw_data,
        synced_at
      )
      VALUES (
        p_restaurant_id,
        'shift4',
        v_charge.charge_id,
        v_charge.charge_id || '_tip',
        'Tips',
        1,
        v_charge.tip_amount / 100.0,
        v_charge.service_date,
        v_charge.service_time,
        'tip',
        'tip',
        NULL,
        jsonb_build_object('from', 'splits', 'tipCents', v_charge.tip_amount),
        now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
      WHERE parent_sale_id IS NULL
      DO UPDATE SET
        total_price = EXCLUDED.total_price,
        sale_date = EXCLUDED.sale_date,
        sale_time = EXCLUDED.sale_time,
        raw_data = EXCLUDED.raw_data,
        synced_at = now();

      v_synced_count := v_synced_count + 1;
    END IF;
  END LOOP;

  -- Process refunds
  FOR v_charge IN
    SELECT 
      r.refund_id,
      r.charge_id,
      r.amount,
      r.service_date,
      r.created_time,
      r.raw_json
    FROM shift4_refunds r
    WHERE r.restaurant_id = p_restaurant_id
  LOOP
    -- Create refund entry (negative amount)
    INSERT INTO unified_sales (
      restaurant_id,
      pos_system,
      external_order_id,
      external_item_id,
      item_name,
      quantity,
      total_price,
      sale_date,
      item_type,
      parent_sale_id,
      raw_data,
      synced_at
    )
    VALUES (
      p_restaurant_id,
      'shift4',
      v_charge.charge_id,
      v_charge.refund_id,
      'Shift4 Refund',
      1,
      -(v_charge.amount / 100.0),
      v_charge.service_date,
      'sale',
      NULL,
      v_charge.raw_json,
      now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    WHERE parent_sale_id IS NULL
    DO UPDATE SET
      total_price = EXCLUDED.total_price,
      sale_date = EXCLUDED.sale_date,
      raw_data = EXCLUDED.raw_data,
      synced_at = now();

    v_synced_count := v_synced_count + 1;
  END LOOP;

  RETURN v_synced_count;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_shift4_to_unified_sales TO authenticated;