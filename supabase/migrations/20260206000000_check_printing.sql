-- Check settings (persistent per-restaurant configuration)
CREATE TABLE public.check_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE UNIQUE,

  -- Business info (printed on check)
  business_name TEXT NOT NULL,
  business_address_line1 TEXT,
  business_address_line2 TEXT,
  business_city TEXT,
  business_state TEXT,
  business_zip TEXT,

  -- Bank info
  bank_name TEXT,

  -- Check numbering
  next_check_number INTEGER NOT NULL DEFAULT 1001,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_check_settings_restaurant ON public.check_settings(restaurant_id);

-- Enable RLS
ALTER TABLE public.check_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies (match pending_outflows pattern)
CREATE POLICY "Users can view check settings for their restaurants"
  ON public.check_settings
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners/managers can insert check settings"
  ON public.check_settings
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can update check settings"
  ON public.check_settings
  FOR UPDATE
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_check_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_check_settings_updated_at
  BEFORE UPDATE ON public.check_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_check_settings_updated_at();

-- Atomically claim and increment the next check number
-- Returns the starting check number that was claimed
CREATE OR REPLACE FUNCTION claim_check_numbers(
  p_restaurant_id UUID,
  p_count INTEGER DEFAULT 1
)
RETURNS INTEGER AS $$
DECLARE
  v_start_number INTEGER;
BEGIN
  -- Input validation
  IF p_count < 1 OR p_count > 100 THEN
    RAISE EXCEPTION 'Check count must be between 1 and 100';
  END IF;

  -- Authorization: caller must be owner/manager of this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = p_restaurant_id
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
  END IF;

  UPDATE public.check_settings
  SET next_check_number = next_check_number + p_count,
      updated_at = NOW()
  WHERE restaurant_id = p_restaurant_id
  RETURNING next_check_number - p_count INTO v_start_number;

  IF v_start_number IS NULL THEN
    RAISE EXCEPTION 'Check settings not found for restaurant %', p_restaurant_id;
  END IF;

  RETURN v_start_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check audit log (append-only, immutable)
CREATE TABLE public.check_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Check details
  check_number INTEGER NOT NULL,
  payee_name TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  issue_date DATE NOT NULL,
  memo TEXT,

  -- Audit fields
  action TEXT NOT NULL CHECK (action IN ('printed', 'voided', 'reprinted')),
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Related records
  pending_outflow_id UUID REFERENCES public.pending_outflows(id) ON DELETE SET NULL,

  -- Void tracking
  void_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_check_audit_restaurant ON public.check_audit_log(restaurant_id);
CREATE INDEX idx_check_audit_check_number ON public.check_audit_log(restaurant_id, check_number);
CREATE INDEX idx_check_audit_performed_at ON public.check_audit_log(performed_at DESC);

-- Enable RLS
ALTER TABLE public.check_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS: anyone in restaurant can view, only owner/manager can insert
CREATE POLICY "Users can view check audit log for their restaurants"
  ON public.check_audit_log
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners/managers can insert audit records"
  ON public.check_audit_log
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.user_restaurants
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
    )
  );

-- No UPDATE or DELETE policies - audit logs are immutable
