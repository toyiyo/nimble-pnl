-- =====================================================
-- SHIFT4 POS INTEGRATION DATABASE SCHEMA
-- Following the established integration patterns
-- =====================================================

-- Table: shift4_connections
-- Stores API key and merchant information for Shift4 accounts
-- Unlike OAuth integrations, Shift4 uses API Key authentication
CREATE TABLE IF NOT EXISTS public.shift4_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL, -- Shift4 merchant identifier
  secret_key TEXT NOT NULL, -- Encrypted Shift4 Secret API Key
  environment TEXT NOT NULL DEFAULT 'production', -- 'production' or 'sandbox'
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, merchant_id)
);

-- Table: shift4_charges
-- Stores charge (payment/sale) data synced from Shift4 API
CREATE TABLE IF NOT EXISTS public.shift4_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  charge_id TEXT NOT NULL, -- Shift4 charge ID (e.g., "char_...")
  merchant_id TEXT NOT NULL,
  amount INTEGER NOT NULL, -- Amount in cents (minor currency units)
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL, -- 'successful', 'failed', etc.
  refunded BOOLEAN DEFAULT false,
  captured BOOLEAN DEFAULT false,
  created_at_ts BIGINT NOT NULL, -- Unix timestamp from Shift4 API
  created_time TIMESTAMP WITH TIME ZONE, -- Converted to UTC timestamp
  service_date DATE, -- Date in restaurant's local timezone
  service_time TIME, -- Time in restaurant's local timezone
  description TEXT,
  tip_amount INTEGER DEFAULT 0, -- Tip amount in cents (from splits if available)
  raw_json JSONB, -- Full charge object from Shift4 API
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, charge_id)
);

-- Table: shift4_refunds
-- Stores refund data from Shift4 API
CREATE TABLE IF NOT EXISTS public.shift4_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  refund_id TEXT NOT NULL, -- Shift4 refund ID
  charge_id TEXT NOT NULL, -- Associated charge ID
  merchant_id TEXT NOT NULL,
  amount INTEGER NOT NULL, -- Refund amount in cents
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT,
  reason TEXT,
  created_at_ts BIGINT NOT NULL, -- Unix timestamp from Shift4 API
  created_time TIMESTAMP WITH TIME ZONE, -- Converted to UTC timestamp
  service_date DATE, -- Date in restaurant's local timezone
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, refund_id)
);

-- Table: shift4_webhook_events
-- Tracks processed webhook events for idempotency
CREATE TABLE IF NOT EXISTS public.shift4_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL, -- Shift4 event ID
  event_type TEXT NOT NULL, -- e.g., 'CHARGE_SUCCEEDED', 'CHARGE_UPDATED'
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_json JSONB,
  UNIQUE(restaurant_id, event_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shift4_connections_restaurant 
  ON public.shift4_connections(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_connections_merchant 
  ON public.shift4_connections(merchant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_charges_restaurant_date 
  ON public.shift4_charges(restaurant_id, service_date DESC);

CREATE INDEX IF NOT EXISTS idx_shift4_charges_charge_id 
  ON public.shift4_charges(charge_id);

CREATE INDEX IF NOT EXISTS idx_shift4_charges_created_ts 
  ON public.shift4_charges(created_at_ts DESC);

CREATE INDEX IF NOT EXISTS idx_shift4_refunds_restaurant 
  ON public.shift4_refunds(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_refunds_charge_id 
  ON public.shift4_refunds(charge_id);

CREATE INDEX IF NOT EXISTS idx_shift4_webhook_events_restaurant 
  ON public.shift4_webhook_events(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_shift4_webhook_events_event_id 
  ON public.shift4_webhook_events(event_id);

-- RLS Policies
ALTER TABLE public.shift4_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift4_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift4_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift4_webhook_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own restaurant's Shift4 data

-- shift4_connections policies
CREATE POLICY shift4_connections_select ON public.shift4_connections
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_connections_insert ON public.shift4_connections
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_connections_update ON public.shift4_connections
  FOR UPDATE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_connections_delete ON public.shift4_connections
  FOR DELETE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- shift4_charges policies
CREATE POLICY shift4_charges_select ON public.shift4_charges
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_charges_insert ON public.shift4_charges
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_charges_update ON public.shift4_charges
  FOR UPDATE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_charges_delete ON public.shift4_charges
  FOR DELETE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- shift4_refunds policies
CREATE POLICY shift4_refunds_select ON public.shift4_refunds
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_refunds_insert ON public.shift4_refunds
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_refunds_update ON public.shift4_refunds
  FOR UPDATE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_refunds_delete ON public.shift4_refunds
  FOR DELETE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- shift4_webhook_events policies
CREATE POLICY shift4_webhook_events_select ON public.shift4_webhook_events
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_webhook_events_insert ON public.shift4_webhook_events
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_webhook_events_update ON public.shift4_webhook_events
  FOR UPDATE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY shift4_webhook_events_delete ON public.shift4_webhook_events
  FOR DELETE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- Function: sync_shift4_to_unified_sales
-- Syncs Shift4 charges to the unified_sales table
-- Unlike Square/Clover, Shift4 doesn't provide line items, so we create synthetic entries
CREATE OR REPLACE FUNCTION sync_shift4_to_unified_sales(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
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
      (v_charge.amount - COALESCE(v_charge.tip_amount, 0)) / 100.0, -- Convert cents to dollars, exclude tip
      v_charge.service_date,
      v_charge.service_time,
      'sale',
      v_charge.raw_json,
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION sync_shift4_to_unified_sales TO authenticated;

-- Add comment
COMMENT ON FUNCTION sync_shift4_to_unified_sales IS 
  'Synchronizes Shift4 charges and refunds to the unified_sales table. ' ||
  'Note: Shift4 does not provide line-item details, so sales are aggregated at the charge level.';
