-- =====================================================================
-- FOCUS POS TRANSACTION TABLES
--
-- Three item-level tables (mirror of toast_orders/items/payments) for
-- the Focus POS Lynk datafeed:
--   focus_orders        — one row per check (transaction)
--   focus_order_items   — line items (priced items + modifiers)
--   focus_payments      — payment / tender lines
--
-- Design ref: docs/superpowers/specs/2026-07-01-focus-pos-transactions-design.md §3
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. focus_orders — one row per check
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.focus_orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_date     date        NOT NULL,
  -- CheckRecord/ID — sequential per day; not globally unique alone
  focus_check_id    text        NOT NULL,
  -- Local timestamps from the datafeed XML (stored as text; tz applied at query time)
  opened_at_local   text,
  closed_at_local   text,
  order_type_id     text,
  revenue_center_id text,
  guests            integer,
  total             numeric     NOT NULL DEFAULT 0,
  discount_total    numeric     NOT NULL DEFAULT 0,
  taxable_sales     numeric     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Named constraint so ON CONFLICT (restaurant_id, business_date, focus_check_id) works
  CONSTRAINT focus_orders_unique
    UNIQUE (restaurant_id, business_date, focus_check_id)
);

-- Composite index for restaurant-date range queries (sync, unified_sales RPC)
CREATE INDEX focus_orders_rid_date_idx
  ON public.focus_orders (restaurant_id, business_date);

-- ─────────────────────────────────────────────────────────────────────
-- 2. focus_order_items — one row per priced item or modifier
--    Kitchen-comment lines (FlagsKitchenComment=Y) are NEVER stored.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.focus_order_items (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_date     date        NOT NULL,
  focus_check_id    text        NOT NULL,
  -- Unique key within the check (from XML attribute; identifies this line)
  item_key          text        NOT NULL,
  -- RecordNumber from XML → maps to menu config for recipe/inventory
  record_number     text,
  item_code         text,
  name              text,
  -- ReportGroupID — used as category in unified_sales
  report_group_id   text,
  -- Price is NULL for modifiers that inherit parent pricing
  price             numeric,
  -- Parent item_key for modifier lines (NULL for top-level items)
  parent_key        text,
  is_modifier       boolean     NOT NULL DEFAULT false,
  discount_amount   numeric     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT focus_order_items_unique
    UNIQUE (restaurant_id, business_date, focus_check_id, item_key)
);

CREATE INDEX focus_order_items_rid_date_idx
  ON public.focus_order_items (restaurant_id, business_date);

-- ─────────────────────────────────────────────────────────────────────
-- 3. focus_payments — tender / payment lines per check
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.focus_payments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_date     date        NOT NULL,
  focus_check_id    text        NOT NULL,
  -- Key uniquely identifying this payment within the check
  payment_key       text        NOT NULL,
  payment_id        text,
  -- Tender name, e.g. "VISA", "Cash"
  name              text,
  amount            numeric     NOT NULL DEFAULT 0,
  tip               numeric     NOT NULL DEFAULT 0,
  -- Last 4 digits only (PII minimisation); full PANs never stored
  card_last4        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT focus_payments_unique
    UNIQUE (restaurant_id, business_date, focus_check_id, payment_key)
);

CREATE INDEX focus_payments_rid_date_idx
  ON public.focus_payments (restaurant_id, business_date);

-- ─────────────────────────────────────────────────────────────────────
-- 4. updated_at triggers (reuse the existing focus trigger function)
-- ─────────────────────────────────────────────────────────────────────
CREATE TRIGGER focus_orders_updated_at
  BEFORE UPDATE ON public.focus_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_focus_updated_at();

CREATE TRIGGER focus_order_items_updated_at
  BEFORE UPDATE ON public.focus_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_focus_updated_at();

CREATE TRIGGER focus_payments_updated_at
  BEFORE UPDATE ON public.focus_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_focus_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 5. Row Level Security
--    Mirrors focus_daily_reports policies:
--    - SELECT: any user_restaurants member
--    - FOR ALL (INSERT/UPDATE/DELETE): owner or manager only
--    Edge functions write via the service-role client (bypasses RLS).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.focus_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_payments    ENABLE ROW LEVEL SECURITY;

-- focus_orders: member SELECT
CREATE POLICY focus_orders_select
  ON public.focus_orders
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- focus_orders: owner/manager FOR ALL
CREATE POLICY focus_orders_all
  ON public.focus_orders
  FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- focus_order_items: member SELECT
CREATE POLICY focus_order_items_select
  ON public.focus_order_items
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- focus_order_items: owner/manager FOR ALL
CREATE POLICY focus_order_items_all
  ON public.focus_order_items
  FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- focus_payments: member SELECT
CREATE POLICY focus_payments_select
  ON public.focus_payments
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- focus_payments: owner/manager FOR ALL
CREATE POLICY focus_payments_all
  ON public.focus_payments
  FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 6. Grants (edge functions use service_role; authenticated for direct queries)
-- ─────────────────────────────────────────────────────────────────────
GRANT SELECT ON public.focus_orders      TO authenticated;
GRANT SELECT ON public.focus_order_items TO authenticated;
GRANT SELECT ON public.focus_payments    TO authenticated;

GRANT ALL ON public.focus_orders      TO service_role;
GRANT ALL ON public.focus_order_items TO service_role;
GRANT ALL ON public.focus_payments    TO service_role;

-- Comments
COMMENT ON TABLE public.focus_orders IS
  'One row per Focus POS check (transaction). Parsed from the Lynk LegacyDatafeed XML.';
COMMENT ON TABLE public.focus_order_items IS
  'Line items for each Focus POS check. Kitchen-comment PII lines are never stored.';
COMMENT ON TABLE public.focus_payments IS
  'Payment/tender lines for each Focus POS check. Card numbers stored as last-4 only.';
