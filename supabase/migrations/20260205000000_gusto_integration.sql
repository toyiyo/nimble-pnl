-- Gusto Embedded Payroll Integration
-- Creates tables and schema changes for Gusto payroll integration

-- ============================================================================
-- Table: gusto_connections
-- Stores OAuth tokens and connection info for each restaurant
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gusto_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE UNIQUE,
  company_uuid TEXT NOT NULL, -- Gusto company UUID
  company_name TEXT, -- Human-readable company name from Gusto
  access_token TEXT NOT NULL, -- Encrypted OAuth access token (company scope)
  refresh_token TEXT, -- Encrypted refresh token
  scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
  token_type TEXT DEFAULT 'Bearer',
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  last_refreshed_at TIMESTAMP WITH TIME ZONE,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  onboarding_status TEXT DEFAULT 'pending' CHECK (onboarding_status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Table: gusto_webhook_events
-- Tracks processed webhook events for idempotency
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gusto_webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_uuid TEXT NOT NULL UNIQUE, -- Gusto event UUID
  event_type TEXT NOT NULL, -- e.g., 'employee.created', 'payroll.processed'
  company_uuid TEXT NOT NULL,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  raw_payload JSONB,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Table: gusto_payroll_runs
-- Tracks payroll runs synced from Gusto
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gusto_payroll_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  gusto_payroll_uuid TEXT NOT NULL,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  check_date DATE NOT NULL,
  payroll_type TEXT, -- 'regular', 'off_cycle', 'termination'
  status TEXT NOT NULL, -- 'unprocessed', 'processed', 'pending', 'approved'
  total_gross_pay INTEGER, -- In cents
  total_net_pay INTEGER, -- In cents
  total_employer_taxes INTEGER, -- In cents
  total_employee_taxes INTEGER, -- In cents
  employee_count INTEGER,
  raw_payload JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(restaurant_id, gusto_payroll_uuid)
);

-- ============================================================================
-- Add Gusto-specific columns to employees table
-- ============================================================================
DO $$
BEGIN
  -- Add gusto_employee_uuid column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                 AND table_name = 'employees'
                 AND column_name = 'gusto_employee_uuid') THEN
    ALTER TABLE public.employees ADD COLUMN gusto_employee_uuid TEXT;
  END IF;

  -- Add gusto_synced_at column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                 AND table_name = 'employees'
                 AND column_name = 'gusto_synced_at') THEN
    ALTER TABLE public.employees ADD COLUMN gusto_synced_at TIMESTAMP WITH TIME ZONE;
  END IF;

  -- Add gusto_sync_status column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                 AND table_name = 'employees'
                 AND column_name = 'gusto_sync_status') THEN
    ALTER TABLE public.employees ADD COLUMN gusto_sync_status TEXT DEFAULT 'not_synced'
      CHECK (gusto_sync_status IN ('not_synced', 'pending', 'synced', 'error'));
  END IF;

  -- Add gusto_onboarding_status column for employee self-onboarding tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                 AND table_name = 'employees'
                 AND column_name = 'gusto_onboarding_status') THEN
    ALTER TABLE public.employees ADD COLUMN gusto_onboarding_status TEXT;
  END IF;
END $$;

-- ============================================================================
-- Indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_gusto_connections_restaurant_id
  ON public.gusto_connections(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_gusto_connections_company_uuid
  ON public.gusto_connections(company_uuid);

CREATE INDEX IF NOT EXISTS idx_gusto_webhook_events_event_uuid
  ON public.gusto_webhook_events(event_uuid);
CREATE INDEX IF NOT EXISTS idx_gusto_webhook_events_company_uuid
  ON public.gusto_webhook_events(company_uuid);
CREATE INDEX IF NOT EXISTS idx_gusto_webhook_events_event_type
  ON public.gusto_webhook_events(event_type);

CREATE INDEX IF NOT EXISTS idx_gusto_payroll_runs_restaurant_id
  ON public.gusto_payroll_runs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_gusto_payroll_runs_check_date
  ON public.gusto_payroll_runs(check_date);

CREATE INDEX IF NOT EXISTS idx_employees_gusto_employee_uuid
  ON public.employees(gusto_employee_uuid)
  WHERE gusto_employee_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_gusto_sync_status
  ON public.employees(gusto_sync_status);

-- ============================================================================
-- Enable Row Level Security
-- ============================================================================
ALTER TABLE public.gusto_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gusto_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gusto_payroll_runs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (idempotent — drop if exists before creating)
DO $$
BEGIN
  -- gusto_connections SELECT policy
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Restaurant owners and managers can view Gusto connections' AND tablename = 'gusto_connections') THEN
    DROP POLICY "Restaurant owners and managers can view Gusto connections" ON public.gusto_connections;
  END IF;

  -- gusto_connections ALL policy
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Restaurant owners and managers can manage Gusto connections' AND tablename = 'gusto_connections') THEN
    DROP POLICY "Restaurant owners and managers can manage Gusto connections" ON public.gusto_connections;
  END IF;

  -- gusto_webhook_events SELECT policy
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Restaurant owners and managers can view Gusto webhook events' AND tablename = 'gusto_webhook_events') THEN
    DROP POLICY "Restaurant owners and managers can view Gusto webhook events" ON public.gusto_webhook_events;
  END IF;

  -- gusto_payroll_runs SELECT policy
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Restaurant owners and managers can view Gusto payroll runs' AND tablename = 'gusto_payroll_runs') THEN
    DROP POLICY "Restaurant owners and managers can view Gusto payroll runs" ON public.gusto_payroll_runs;
  END IF;
END $$;

CREATE POLICY "Restaurant owners and managers can view Gusto connections"
  ON public.gusto_connections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = gusto_connections.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Restaurant owners and managers can manage Gusto connections"
  ON public.gusto_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = gusto_connections.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Restaurant owners and managers can view Gusto webhook events"
  ON public.gusto_webhook_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = gusto_webhook_events.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Restaurant owners and managers can view Gusto payroll runs"
  ON public.gusto_payroll_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = gusto_payroll_runs.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS update_gusto_connections_updated_at ON public.gusto_connections;
CREATE TRIGGER update_gusto_connections_updated_at
  BEFORE UPDATE ON public.gusto_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_gusto_payroll_runs_updated_at ON public.gusto_payroll_runs;
CREATE TRIGGER update_gusto_payroll_runs_updated_at
  BEFORE UPDATE ON public.gusto_payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- Helper function to get restaurant_id from Gusto company_uuid
-- Used by webhooks to route events to the correct restaurant
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_restaurant_by_gusto_company(p_company_uuid TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id
  FROM public.gusto_connections
  WHERE company_uuid = p_company_uuid
  LIMIT 1;

  RETURN v_restaurant_id;
END;
$$;

-- Grant execute to authenticated users (will be called by Edge Functions with service role)
GRANT EXECUTE ON FUNCTION public.get_restaurant_by_gusto_company(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_restaurant_by_gusto_company(TEXT) TO service_role;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON TABLE public.gusto_connections IS 'Stores Gusto OAuth connections for restaurants using embedded payroll';
COMMENT ON TABLE public.gusto_webhook_events IS 'Tracks processed Gusto webhook events for idempotency';
COMMENT ON TABLE public.gusto_payroll_runs IS 'Stores synced payroll run data from Gusto';
COMMENT ON COLUMN public.employees.gusto_employee_uuid IS 'UUID of the corresponding employee in Gusto';
COMMENT ON COLUMN public.employees.gusto_synced_at IS 'Timestamp when employee was last synced to Gusto';
COMMENT ON COLUMN public.employees.gusto_sync_status IS 'Current sync status: not_synced, pending, synced, error';
