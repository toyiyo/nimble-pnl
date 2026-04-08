-- =====================================================
-- SLING SCHEDULING INTEGRATION DATABASE SCHEMA
-- Stores Sling auth credentials, cached users, shifts,
-- timesheets, and integration-agnostic employee mappings.
-- =====================================================

-- =========================
-- 1. sling_connections
-- =========================
CREATE TABLE IF NOT EXISTS public.sling_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  auth_token TEXT,
  token_fetched_at TIMESTAMPTZ,
  sling_org_id BIGINT,
  sling_org_name TEXT,
  last_sync_time TIMESTAMPTZ,
  initial_sync_done BOOLEAN NOT NULL DEFAULT false,
  sync_cursor INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  connection_status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_connections_restaurant_id_key UNIQUE (restaurant_id)
);

-- =========================
-- 2. sling_users
-- =========================
CREATE TABLE IF NOT EXISTS public.sling_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sling_user_id BIGINT NOT NULL,
  name TEXT,
  lastname TEXT,
  email TEXT,
  position TEXT,
  is_active BOOLEAN DEFAULT true,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_users_restaurant_id_sling_user_id_key UNIQUE (restaurant_id, sling_user_id)
);

-- =========================
-- 3. sling_shifts
-- =========================
CREATE TABLE IF NOT EXISTS public.sling_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sling_shift_id BIGINT NOT NULL,
  sling_user_id BIGINT,
  shift_date DATE,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  break_duration INTEGER DEFAULT 0,
  position TEXT,
  location TEXT,
  status TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_shifts_restaurant_id_sling_shift_id_key UNIQUE (restaurant_id, sling_shift_id)
);

-- =========================
-- 4. sling_timesheets
-- =========================
CREATE TABLE IF NOT EXISTS public.sling_timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sling_timesheet_id BIGINT NOT NULL,
  sling_shift_id BIGINT,
  sling_user_id BIGINT NOT NULL,
  punch_type TEXT NOT NULL,
  punch_time TIMESTAMPTZ NOT NULL,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sling_timesheets_restaurant_id_sling_timesheet_id_key UNIQUE (restaurant_id, sling_timesheet_id)
);

-- =========================
-- 5. employee_integration_mappings
-- =========================
CREATE TABLE IF NOT EXISTS public.employee_integration_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_user_name TEXT,
  external_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT eim_restaurant_integration_external_key UNIQUE (restaurant_id, integration_type, external_user_id)
);

-- =========================
-- 6. Source tracking columns on existing tables
-- =========================
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual';
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS source_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_source_dedup
  ON public.shifts(restaurant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE public.time_punches ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual';
ALTER TABLE public.time_punches ADD COLUMN IF NOT EXISTS source_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_punches_source_dedup
  ON public.time_punches(restaurant_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- =========================
-- 7. Indexes
-- =========================

-- sling_connections
CREATE INDEX IF NOT EXISTS idx_sling_connections_restaurant
  ON public.sling_connections(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_connections_status
  ON public.sling_connections(connection_status);
CREATE INDEX IF NOT EXISTS idx_sling_connections_active
  ON public.sling_connections(is_active) WHERE is_active = true;

-- sling_users
CREATE INDEX IF NOT EXISTS idx_sling_users_restaurant
  ON public.sling_users(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_users_sling_user_id
  ON public.sling_users(sling_user_id);
CREATE INDEX IF NOT EXISTS idx_sling_users_restaurant_active
  ON public.sling_users(restaurant_id, is_active) WHERE is_active = true;

-- sling_shifts
CREATE INDEX IF NOT EXISTS idx_sling_shifts_restaurant
  ON public.sling_shifts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_shifts_restaurant_date
  ON public.sling_shifts(restaurant_id, shift_date DESC);
CREATE INDEX IF NOT EXISTS idx_sling_shifts_sling_user
  ON public.sling_shifts(sling_user_id);
CREATE INDEX IF NOT EXISTS idx_sling_shifts_date_range
  ON public.sling_shifts(start_time, end_time);

-- sling_timesheets
CREATE INDEX IF NOT EXISTS idx_sling_timesheets_restaurant
  ON public.sling_timesheets(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_sling_timesheets_sling_user
  ON public.sling_timesheets(sling_user_id);
CREATE INDEX IF NOT EXISTS idx_sling_timesheets_punch_time
  ON public.sling_timesheets(punch_time DESC);
CREATE INDEX IF NOT EXISTS idx_sling_timesheets_shift
  ON public.sling_timesheets(sling_shift_id) WHERE sling_shift_id IS NOT NULL;

-- employee_integration_mappings
CREATE INDEX IF NOT EXISTS idx_employee_integration_mappings_restaurant
  ON public.employee_integration_mappings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_employee_integration_mappings_employee
  ON public.employee_integration_mappings(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_integration_mappings_type
  ON public.employee_integration_mappings(integration_type);
CREATE INDEX IF NOT EXISTS idx_employee_integration_mappings_lookup
  ON public.employee_integration_mappings(restaurant_id, integration_type, external_user_id);

-- =========================
-- 8. Row Level Security
-- =========================
ALTER TABLE public.sling_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sling_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sling_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sling_timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_integration_mappings ENABLE ROW LEVEL SECURITY;

-- ---- sling_connections ----
-- View: all restaurant members
CREATE POLICY "Users can view sling connections for their restaurants"
  ON public.sling_connections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = sling_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- Manage: owner/manager only
CREATE POLICY "Owners/managers can insert sling connections"
  ON public.sling_connections FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = sling_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can update sling connections"
  ON public.sling_connections FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = sling_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can delete sling connections"
  ON public.sling_connections FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = sling_connections.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- ---- sling_users ----
CREATE POLICY "Users can view sling users for their restaurants"
  ON public.sling_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = sling_users.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- ---- sling_shifts ----
CREATE POLICY "Users can view sling shifts for their restaurants"
  ON public.sling_shifts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = sling_shifts.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- ---- sling_timesheets ----
CREATE POLICY "Users can view sling timesheets for their restaurants"
  ON public.sling_timesheets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = sling_timesheets.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- ---- employee_integration_mappings ----
-- View: all restaurant members
CREATE POLICY "Users can view integration mappings for their restaurants"
  ON public.employee_integration_mappings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_integration_mappings.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- Manage: owner/manager only
CREATE POLICY "Owners/managers can insert integration mappings"
  ON public.employee_integration_mappings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_integration_mappings.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can update integration mappings"
  ON public.employee_integration_mappings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_integration_mappings.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can delete integration mappings"
  ON public.employee_integration_mappings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_integration_mappings.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- =========================
-- 9. Service role bypass for edge functions
-- =========================
GRANT ALL ON public.sling_connections TO service_role;
GRANT ALL ON public.sling_users TO service_role;
GRANT ALL ON public.sling_shifts TO service_role;
GRANT ALL ON public.sling_timesheets TO service_role;
GRANT ALL ON public.employee_integration_mappings TO service_role;

-- =========================
-- 10. Triggers — updated_at
-- =========================
CREATE OR REPLACE FUNCTION update_sling_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sling_connections_updated_at
  BEFORE UPDATE ON public.sling_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_sling_updated_at();

CREATE TRIGGER update_sling_users_updated_at
  BEFORE UPDATE ON public.sling_users
  FOR EACH ROW
  EXECUTE FUNCTION update_sling_updated_at();

CREATE TRIGGER update_sling_shifts_updated_at
  BEFORE UPDATE ON public.sling_shifts
  FOR EACH ROW
  EXECUTE FUNCTION update_sling_updated_at();

CREATE TRIGGER update_sling_timesheets_updated_at
  BEFORE UPDATE ON public.sling_timesheets
  FOR EACH ROW
  EXECUTE FUNCTION update_sling_updated_at();

CREATE TRIGGER update_employee_integration_mappings_updated_at
  BEFORE UPDATE ON public.employee_integration_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_sling_updated_at();
