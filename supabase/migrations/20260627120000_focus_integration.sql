-- =====================================================================
-- FOCUS POS INTEGRATION DATABASE SCHEMA
-- Focus SSRS Revenue Center report → HTML parse → unified_sales
--
-- Access model: credential-gated (Option A). The restaurant's Focus portal
-- username + password are stored (password AES-GCM encrypted). Every connect
-- and sync first authenticates via the portal login; routing params
-- (report host / dbServer / dbCatalog / path) are auto-discovered from the
-- authenticated portal session. The Revenue Center report data itself is then
-- fetched from Focus's report host.
--
-- Backfill notes:
--   - sync_cursor 0…90 tracks days completed in the 90-day backfill
--     (closed interval: today excluded, incremental covers that).
--   - Edge functions write via the service-role client (RLS bypass);
--     the FOR ALL policy here covers direct frontend writes (disconnect).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. focus_connections
--    One row per restaurant. Stores report routing params only.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.focus_connections (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- Routing params are AUTO-DISCOVERED from the authenticated portal session at
  -- connect time, so they are nullable (a login-ok-but-discovery-failed connection
  -- is still saved with status='error'). SSRF guard (S1): when set, only https +
  -- *.myfocuspos.com hosts allowed.
  report_base_url    text
    CHECK (report_base_url IS NULL OR report_base_url ~ '^https://([a-z0-9-]+\.)*myfocuspos\.com(/|$)'),
  report_path        text,
  db_server          text,
  db_catalog         text,
  report_user_id     text,
  store_id           text        NOT NULL,
  -- Focus portal login (Option A, credential-gated). Password is AES-GCM
  -- encrypted at rest (via _shared/encryption.ts); never stored in plaintext.
  username           text        NOT NULL,
  password_encrypted text        NOT NULL,
  revenue_center     text,
  -- IANA timezone for tz-correct date arithmetic across the full backfill (S4)
  timezone           text        NOT NULL DEFAULT 'America/Chicago',
  last_sync_time     timestamptz,
  initial_sync_done  boolean     NOT NULL DEFAULT false,
  sync_cursor        integer     NOT NULL DEFAULT 0,
  is_active          boolean     NOT NULL DEFAULT true,
  connection_status  text        NOT NULL DEFAULT 'pending'
    CHECK (connection_status IN ('pending', 'connected', 'error', 'disconnected')),
  last_error         text,
  last_error_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Named unique constraint so ON CONFLICT (restaurant_id) works in upserts (S7)
  CONSTRAINT focus_connections_restaurant_key UNIQUE (restaurant_id)
);

-- Index for cron round-robin: LIMIT 5 ORDER BY last_sync_time ASC NULLS FIRST WHERE is_active (S5)
CREATE INDEX focus_connections_active_sync_idx
  ON public.focus_connections (last_sync_time ASC NULLS FIRST)
  WHERE is_active = true;

-- ─────────────────────────────────────────────────────────────────────
-- 2. focus_daily_reports
--    Raw parsed data per store-day, kept for audit + reprocess.
--    Edge functions upsert here; the 5-min cron RPC reads from here
--    to produce unified_sales rows.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.focus_daily_reports (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_date       date        NOT NULL,
  revenue_center      text        NOT NULL DEFAULT '',
  net_sales           numeric,
  total_tax           numeric,
  subtotal_discounts  numeric,
  retained_tips       numeric,
  refunds             numeric,
  total_sales         numeric,
  total_payments      numeric,
  items_json          jsonb       NOT NULL DEFAULT '[]',
  payments_json       jsonb       NOT NULL DEFAULT '[]',
  order_types_json    jsonb       NOT NULL DEFAULT '[]',
  raw_totals_json     jsonb       NOT NULL DEFAULT '{}',
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  -- Idempotent: re-fetch the same day replaces the row
  CONSTRAINT focus_daily_reports_unique
    UNIQUE (restaurant_id, business_date, revenue_center)
);

-- restaurant_id first for all restaurant-scoped queries (S8)
CREATE INDEX focus_daily_reports_rid_date_idx
  ON public.focus_daily_reports (restaurant_id, business_date);

-- ─────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger for focus_connections
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_focus_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER focus_connections_updated_at
  BEFORE UPDATE ON public.focus_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_focus_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Row Level Security
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.focus_connections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_daily_reports    ENABLE ROW LEVEL SECURITY;

-- focus_connections: any restaurant member can SELECT
CREATE POLICY focus_conn_select
  ON public.focus_connections
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- focus_connections: owner/manager can INSERT, UPDATE, DELETE
CREATE POLICY focus_conn_all
  ON public.focus_connections
  FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

-- focus_daily_reports: any restaurant member can SELECT
CREATE POLICY focus_reports_select
  ON public.focus_daily_reports
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

-- focus_daily_reports: owner/manager can INSERT, UPDATE, DELETE
CREATE POLICY focus_reports_all
  ON public.focus_daily_reports
  FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );
