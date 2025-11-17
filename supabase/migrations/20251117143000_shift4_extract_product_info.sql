-- Update sync_shift4_to_unified_sales to extract product information from charge data
-- This migration enhances the Shift4 sync to use product names from the charge metadata/description
-- instead of the generic "Shift4 Sale" label

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
  v_item_name TEXT;
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
      c.description,
      c.raw_json
    FROM shift4_charges c
    WHERE c.restaurant_id = p_restaurant_id
      AND c.status = 'successful'
      AND c.captured = true
      AND c.refunded = false
  LOOP
    -- Extract product name from charge data
    -- Priority: 1) metadata.product_name, 2) metadata.item_name, 3) description, 4) default
    v_item_name := 'Shift4 Sale'; -- Default fallback
    
    -- Try to get product name from metadata first
    IF v_charge.raw_json ? 'metadata' THEN
      -- Check for common product name fields in metadata
      IF v_charge.raw_json->'metadata' ? 'product_name' THEN
        v_item_name := v_charge.raw_json->'metadata'->>'product_name';
      ELSIF v_charge.raw_json->'metadata' ? 'item_name' THEN
        v_item_name := v_charge.raw_json->'metadata'->>'item_name';
      ELSIF v_charge.raw_json->'metadata' ? 'name' THEN
        v_item_name := v_charge.raw_json->'metadata'->>'name';
      ELSIF v_charge.raw_json->'metadata' ? 'product' THEN
        v_item_name := v_charge.raw_json->'metadata'->>'product';
      -- Check if metadata has lineItems array
      ELSIF v_charge.raw_json->'metadata' ? 'lineItems' 
        AND jsonb_array_length(v_charge.raw_json->'metadata'->'lineItems') > 0 THEN
        -- Get name from first line item
        v_item_name := v_charge.raw_json->'metadata'->'lineItems'->0->>'name';
      END IF;
    END IF;
    
    -- If still default, try the description field
    IF v_item_name = 'Shift4 Sale' AND v_charge.description IS NOT NULL AND v_charge.description != '' THEN
      v_item_name := v_charge.description;
    END IF;
    
    -- Fallback to checking raw_json.description if we're still at default
    IF v_item_name = 'Shift4 Sale' AND v_charge.raw_json ? 'description' THEN
      v_item_name := v_charge.raw_json->>'description';
    END IF;
    
    -- Sanitize and validate item name
    v_item_name := TRIM(v_item_name);
    IF v_item_name = '' OR v_item_name IS NULL THEN
      v_item_name := 'Shift4 Sale';
    END IF;
    
    -- Limit length to 255 characters
    IF LENGTH(v_item_name) > 255 THEN
      v_item_name := LEFT(v_item_name, 252) || '...';
    END IF;

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
      raw_data,
      synced_at
    )
    VALUES (
      p_restaurant_id,
      'shift4',
      v_charge.charge_id,
      v_charge.charge_id || '_sale',
      v_item_name, -- Use extracted item name instead of hardcoded "Shift4 Sale"
      1,
      (v_charge.amount - COALESCE(v_charge.tip_amount, 0)) / 100.0, -- Convert cents to dollars, exclude tip
      v_charge.service_date,
      v_charge.service_time,
      'sale',
      v_charge.raw_json,
      now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
    DO UPDATE SET
      item_name = EXCLUDED.item_name, -- Update item name on conflict
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
        v_charge.tip_amount / 100.0, -- Convert cents to dollars
        v_charge.service_date,
        v_charge.service_time,
        'tip',
        'tip',
        jsonb_build_object('from', 'splits', 'tipCents', v_charge.tip_amount),
        now()
      )
      ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
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
      raw_data,
      synced_at
    )
    VALUES (
      p_restaurant_id,
      'shift4',
      v_charge.charge_id,
      v_charge.refund_id,
      'Refund',
      1,
      -(v_charge.amount / 100.0), -- Negative amount in dollars
      v_charge.service_date,
      'sale', -- Refunds are still categorized as sales (negative)
      v_charge.raw_json,
      now()
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
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
