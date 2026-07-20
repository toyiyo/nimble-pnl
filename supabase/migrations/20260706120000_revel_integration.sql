-- =====================================================
-- REVEL POS INTEGRATION DATABASE SCHEMA
-- Partner model: partner-level secrets live in edge env vars, NOT here.
-- Per-restaurant row stores only the Revel instance subdomain + establishment id.
-- Mirrors the Toast integration schema (20251116100100_toast_integration.sql).
-- =====================================================

-- Table: revel_connections (1 row per restaurant+establishment)
CREATE TABLE IF NOT EXISTS public.revel_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_instance TEXT NOT NULL,            -- Client-Id subdomain, e.g. 'joesdiner'
  establishment_id TEXT NOT NULL DEFAULT '',  -- '' = single-establishment merchant (NULL breaks unique dedup)
  api_key_encrypted TEXT,                  -- Classic API key (AES-GCM encrypted)
  api_secret_encrypted TEXT,               -- Classic API secret (AES-GCM encrypted)
  is_active BOOLEAN NOT NULL DEFAULT true,
  connection_status TEXT NOT NULL DEFAULT 'connected',
  initial_sync_done BOOLEAN NOT NULL DEFAULT false,
  sync_cursor TIMESTAMP WITH TIME ZONE,    -- backfill progress marker
  sync_page INTEGER,                       -- pagination cursor for resumable pulls
  last_sync_time TIMESTAMP WITH TIME ZONE,
  webhook_active BOOLEAN NOT NULL DEFAULT false,
  last_error TEXT,
  last_error_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_instance, establishment_id)
);

-- Table: revel_orders
CREATE TABLE IF NOT EXISTS public.revel_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_order_id TEXT NOT NULL,
  establishment_id TEXT,
  order_number TEXT,
  order_date DATE NOT NULL,
  order_time TIME,
  sold_at TIMESTAMP WITH TIME ZONE,
  total_amount NUMERIC(10, 2),
  subtotal_amount NUMERIC(10, 2),
  tax_amount NUMERIC(10, 2),
  tip_amount NUMERIC(10, 2),
  discount_amount NUMERIC(10, 2),
  service_charge_amount NUMERIC(10, 2),
  payment_status TEXT,
  dining_option TEXT,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_order_id)
);

-- Table: revel_order_items
CREATE TABLE IF NOT EXISTS public.revel_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_order_id_fk UUID NOT NULL REFERENCES public.revel_orders(id) ON DELETE CASCADE,
  revel_order_id TEXT NOT NULL,
  revel_item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2),
  total_price NUMERIC(10, 2),
  menu_category TEXT,
  modifiers JSONB,
  is_voided BOOLEAN NOT NULL DEFAULT false,
  discount_amount NUMERIC(10, 2),
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_order_id, revel_item_id)
);

-- Table: revel_payments
CREATE TABLE IF NOT EXISTS public.revel_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_payment_id TEXT NOT NULL,
  revel_order_id TEXT NOT NULL,
  payment_type TEXT,
  amount NUMERIC(10, 2) NOT NULL,
  tip_amount NUMERIC(10, 2) DEFAULT 0,
  payment_date DATE,
  payment_status TEXT,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_payment_id)
);

-- Table: revel_webhook_events (idempotency log)
CREATE TABLE IF NOT EXISTS public.revel_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_json JSONB,
  UNIQUE(restaurant_id, event_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_revel_connections_restaurant ON public.revel_connections(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_revel_connections_instance ON public.revel_connections(revel_instance);
CREATE INDEX IF NOT EXISTS idx_revel_orders_restaurant_date ON public.revel_orders(restaurant_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_revel_orders_revel_order_id ON public.revel_orders(revel_order_id);
CREATE INDEX IF NOT EXISTS idx_revel_order_items_order ON public.revel_order_items(revel_order_id_fk);
CREATE INDEX IF NOT EXISTS idx_revel_order_items_restaurant ON public.revel_order_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_revel_payments_restaurant ON public.revel_payments(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_revel_payments_order ON public.revel_payments(revel_order_id);
CREATE INDEX IF NOT EXISTS idx_revel_webhook_events_restaurant ON public.revel_webhook_events(restaurant_id);

-- Row Level Security
ALTER TABLE public.revel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant Revel connections"
  ON public.revel_connections FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Owners/managers can insert Revel connections"
  ON public.revel_connections FOR INSERT
  WITH CHECK (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid() AND role IN ('owner', 'manager')));

CREATE POLICY "Owners/managers can update Revel connections"
  ON public.revel_connections FOR UPDATE
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid() AND role IN ('owner', 'manager')));

CREATE POLICY "Owners/managers can delete Revel connections"
  ON public.revel_connections FOR DELETE
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid() AND role IN ('owner', 'manager')));

CREATE POLICY "Users can view their restaurant Revel orders"
  ON public.revel_orders FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their restaurant Revel order items"
  ON public.revel_order_items FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their restaurant Revel payments"
  ON public.revel_payments FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their restaurant Revel webhook events"
  ON public.revel_webhook_events FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

-- =====================================================
-- RPC: revel_sync_financial_breakdown(p_order_id, p_restaurant_id)
-- Per-order sync into unified_sales, splitting sale vs tax/tip/discount adjustment rows.
-- Called by the shared processor after upserting order/items/payments.
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
  DO NOTHING;
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
    DO NOTHING;
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
    DO NOTHING;
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
    DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  RETURN v_synced_count;
END;
$$;

-- =====================================================
-- RPC: sync_revel_to_unified_sales(p_restaurant_id, p_start_date, p_end_date)
-- Bulk backfill/reconcile used by the adapter and bulk-sync cron.
-- =====================================================
-- Emits the COMPLETE financial breakdown so audits reconcile to Revel's order totals:
-- sale lines (item price + modifiers), plus header-level tax / tip / discount / service charge.
-- Identity: sum(sales) = subtotal, and sum(sales) + tax - discount = final_total. Tips sit on top.
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
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
    WHERE parent_sale_id IS NULL DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  RETURN v_synced_count;
END;
$$;

-- =====================================================
-- Table-level privileges
-- Local Supabase CLI runs migrations as `postgres`, whose default-privilege
-- entry only grants DELETE/TRUNCATE/TRIGGER/REFERENCES to authenticated/anon
-- (not SELECT/INSERT/UPDATE). Without these grants, RLS USING clauses that
-- subquery user_restaurants fail with "permission denied for table X" instead
-- of the RLS policy simply filtering rows. See migration
-- 20260628000000_grant_user_restaurants_select.sql for the full explanation;
-- new tables must carry their own grants going forward.
-- =====================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_webhook_events TO authenticated;

GRANT SELECT ON public.revel_connections TO anon;
GRANT SELECT ON public.revel_orders TO anon;
GRANT SELECT ON public.revel_order_items TO anon;
GRANT SELECT ON public.revel_payments TO anon;
GRANT SELECT ON public.revel_webhook_events TO anon;

-- service_role runs the edge functions (connect/sync/webhook write via the service key).
-- Hosted Supabase grants service_role ALL by default, but local Supabase does not — so
-- grant explicitly here or every service-role write is "permission denied" locally.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_order_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revel_webhook_events TO service_role;

-- Lock down SECURITY DEFINER RPC execution: block PUBLIC (covers anon), allow intended roles.
REVOKE ALL ON FUNCTION public.revel_sync_financial_breakdown(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_revel_to_unified_sales(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revel_sync_financial_breakdown(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_revel_to_unified_sales(uuid, date, date) TO authenticated, service_role;
