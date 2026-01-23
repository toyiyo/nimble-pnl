-- ============================================================================
-- Assets & Equipment Management
-- Minimal MVP with photo attachments support
-- ============================================================================

-- Asset status enum
CREATE TYPE public.asset_status_enum AS ENUM (
  'active',
  'disposed',
  'fully_depreciated'
);

-- ============================================================================
-- Main Assets Table
-- ============================================================================
CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Basic Information
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- e.g., 'Kitchen Equipment', 'Furniture & Fixtures'
  serial_number TEXT,

  -- Financial Details
  purchase_date DATE NOT NULL,
  purchase_cost NUMERIC(15, 2) NOT NULL CHECK (purchase_cost > 0),
  salvage_value NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0),

  -- Location (reuse existing inventory_locations table)
  location_id UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL,

  -- Chart of Accounts Integration
  asset_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  accumulated_depreciation_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  depreciation_expense_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,

  -- Depreciation Tracking
  accumulated_depreciation NUMERIC(15, 2) NOT NULL DEFAULT 0,
  last_depreciation_date DATE,

  -- Status
  status asset_status_enum NOT NULL DEFAULT 'active',
  disposal_date DATE,
  disposal_proceeds NUMERIC(15, 2),
  disposal_notes TEXT,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT salvage_less_than_cost CHECK (salvage_value < purchase_cost),
  CONSTRAINT valid_disposal CHECK (
    (status = 'disposed' AND disposal_date IS NOT NULL) OR
    (status != 'disposed')
  )
);

-- ============================================================================
-- Asset Photos Table (supports multiple photos per asset)
-- ============================================================================
CREATE TABLE public.asset_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- File info
  storage_path TEXT NOT NULL, -- Path in Supabase storage bucket
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,

  -- Metadata
  caption TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Depreciation Schedule Table (audit trail for posted depreciation)
-- ============================================================================
CREATE TABLE public.asset_depreciation_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Period Information
  period_start_date DATE NOT NULL,
  period_end_date DATE NOT NULL,

  -- Depreciation Amounts
  depreciation_amount NUMERIC(15, 2) NOT NULL,
  accumulated_after NUMERIC(15, 2) NOT NULL,
  net_book_value NUMERIC(15, 2) NOT NULL,

  -- Journal Entry Reference
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,

  -- Metadata
  posted_by UUID REFERENCES auth.users(id),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(asset_id, period_start_date)
);

-- ============================================================================
-- Restaurant Settings for Asset Management
-- ============================================================================
ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS capitalize_threshold_cents INTEGER DEFAULT 250000; -- $2500 default

COMMENT ON COLUMN public.restaurants.capitalize_threshold_cents IS
'Purchases above this amount (in cents) should be capitalized as assets. Default: $2500';

-- ============================================================================
-- Storage Bucket for Asset Images
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-images', 'asset-images', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX idx_assets_restaurant_id ON public.assets(restaurant_id);
CREATE INDEX idx_assets_status ON public.assets(restaurant_id, status);
CREATE INDEX idx_assets_location_id ON public.assets(location_id);
CREATE INDEX idx_assets_category ON public.assets(restaurant_id, category);
CREATE INDEX idx_assets_purchase_date ON public.assets(purchase_date);

CREATE INDEX idx_asset_photos_asset_id ON public.asset_photos(asset_id);
CREATE INDEX idx_asset_photos_restaurant_id ON public.asset_photos(restaurant_id);

CREATE INDEX idx_depreciation_schedule_asset_id ON public.asset_depreciation_schedule(asset_id);
CREATE INDEX idx_depreciation_schedule_restaurant_id ON public.asset_depreciation_schedule(restaurant_id);
CREATE INDEX idx_depreciation_schedule_period ON public.asset_depreciation_schedule(restaurant_id, period_start_date);

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_depreciation_schedule ENABLE ROW LEVEL SECURITY;

-- Assets policies
CREATE POLICY "Users can view assets for their restaurants"
  ON public.assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = assets.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners managers and accountants can manage assets"
  ON public.assets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = assets.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
    )
  );

-- Asset photos policies
CREATE POLICY "Users can view asset photos for their restaurants"
  ON public.asset_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = asset_photos.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners managers and accountants can manage asset photos"
  ON public.asset_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = asset_photos.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
    )
  );

-- Depreciation schedule policies
CREATE POLICY "Users can view depreciation schedule for their restaurants"
  ON public.asset_depreciation_schedule FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = asset_depreciation_schedule.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners managers and accountants can manage depreciation"
  ON public.asset_depreciation_schedule FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = asset_depreciation_schedule.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
    )
  );

-- Storage policies for asset-images bucket
CREATE POLICY "Users can view asset images for their restaurants"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND (
        split_part(name, '/', 2) = user_restaurants.restaurant_id::text
        OR name LIKE ('restaurants/' || user_restaurants.restaurant_id || '/%')
      )
    )
  );

CREATE POLICY "Owners managers and accountants can upload asset images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND (
        split_part(name, '/', 2) = user_restaurants.restaurant_id::text
        OR name LIKE ('restaurants/' || user_restaurants.restaurant_id || '/%')
      )
    )
  );

CREATE POLICY "Owners managers and accountants can update asset images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND (
        split_part(name, '/', 2) = user_restaurants.restaurant_id::text
        OR name LIKE ('restaurants/' || user_restaurants.restaurant_id || '/%')
      )
    )
  );

CREATE POLICY "Owners managers and accountants can delete asset images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'asset-images'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'collaborator_accountant')
      AND (
        split_part(name, '/', 2) = user_restaurants.restaurant_id::text
        OR name LIKE ('restaurants/' || user_restaurants.restaurant_id || '/%')
      )
    )
  );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Update updated_at timestamp on assets
CREATE TRIGGER update_assets_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Ensure only one primary photo per asset
CREATE OR REPLACE FUNCTION public.ensure_single_primary_photo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.asset_photos
    SET is_primary = false
    WHERE asset_id = NEW.asset_id
      AND id != NEW.id
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_single_primary_photo_trigger
  AFTER INSERT OR UPDATE OF is_primary ON public.asset_photos
  FOR EACH ROW
  WHEN (NEW.is_primary = true)
  EXECUTE FUNCTION public.ensure_single_primary_photo();

-- ============================================================================
-- Functions
-- ============================================================================

-- Calculate depreciation for an asset (preview only, does not post)
CREATE OR REPLACE FUNCTION public.calculate_asset_depreciation(
  p_asset_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS TABLE (
  monthly_depreciation NUMERIC,
  months_in_period INTEGER,
  depreciation_amount NUMERIC,
  new_accumulated NUMERIC,
  net_book_value NUMERIC,
  is_fully_depreciated BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_asset RECORD;
  v_depreciable_amount NUMERIC;
  v_monthly_rate NUMERIC;
  v_months INTEGER;
  v_depreciation NUMERIC;
  v_new_accumulated NUMERIC;
  v_remaining NUMERIC;
BEGIN
  -- Get asset details
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF v_asset.status = 'disposed' THEN
    RAISE EXCEPTION 'Cannot calculate depreciation for disposed asset';
  END IF;

  -- Calculate depreciable amount
  v_depreciable_amount := v_asset.purchase_cost - v_asset.salvage_value;

  -- Calculate monthly depreciation rate (straight-line)
  v_monthly_rate := v_depreciable_amount / v_asset.useful_life_months;

  -- Calculate months in period
  v_months := EXTRACT(YEAR FROM AGE(p_period_end, p_period_start)) * 12
             + EXTRACT(MONTH FROM AGE(p_period_end, p_period_start)) + 1;

  -- Calculate depreciation for this period
  v_depreciation := v_monthly_rate * v_months;

  -- Cap at remaining depreciable amount
  v_remaining := v_depreciable_amount - v_asset.accumulated_depreciation;
  IF v_depreciation > v_remaining THEN
    v_depreciation := v_remaining;
  END IF;

  IF v_depreciation < 0 THEN
    v_depreciation := 0;
  END IF;

  v_new_accumulated := v_asset.accumulated_depreciation + v_depreciation;

  RETURN QUERY SELECT
    v_monthly_rate,
    v_months,
    v_depreciation,
    v_new_accumulated,
    v_asset.purchase_cost - v_new_accumulated,
    v_new_accumulated >= v_depreciable_amount;
END;
$$;

-- Post depreciation (creates journal entry and updates asset)
CREATE OR REPLACE FUNCTION public.post_asset_depreciation(
  p_asset_id UUID,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS UUID -- Returns journal_entry_id
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_asset RECORD;
  v_calc RECORD;
  v_entry_number TEXT;
  v_journal_entry_id UUID;
  v_schedule_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- Get asset
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Check if already posted for this period
  IF EXISTS (
    SELECT 1 FROM public.asset_depreciation_schedule
    WHERE asset_id = p_asset_id
      AND period_start_date = p_period_start
  ) THEN
    RAISE EXCEPTION 'Depreciation already posted for this period';
  END IF;

  -- Calculate depreciation
  SELECT * INTO v_calc
  FROM public.calculate_asset_depreciation(p_asset_id, p_period_start, p_period_end);

  IF v_calc.depreciation_amount <= 0 THEN
    RAISE EXCEPTION 'No depreciation to post (asset may be fully depreciated)';
  END IF;

  -- Check that accounts are set
  IF v_asset.depreciation_expense_account_id IS NULL
     OR v_asset.accumulated_depreciation_account_id IS NULL THEN
    RAISE EXCEPTION 'Asset must have depreciation expense and accumulated depreciation accounts set';
  END IF;

  -- Generate entry number
  SELECT 'DEP-' || TO_CHAR(p_period_end, 'YYYYMMDD') || '-' ||
         LPAD(COALESCE(
           (SELECT COUNT(*) + 1 FROM public.journal_entries
            WHERE restaurant_id = v_asset.restaurant_id
            AND entry_number LIKE 'DEP-' || TO_CHAR(p_period_end, 'YYYYMMDD') || '%')::TEXT,
           '1'
         ), 4, '0')
  INTO v_entry_number;

  -- Create journal entry
  INSERT INTO public.journal_entries (
    restaurant_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    total_debit,
    total_credit,
    created_by
  ) VALUES (
    v_asset.restaurant_id,
    v_entry_number,
    p_period_end,
    'Depreciation: ' || v_asset.name || ' (' || TO_CHAR(p_period_start, 'Mon YYYY') || ' - ' || TO_CHAR(p_period_end, 'Mon YYYY') || ')',
    'asset_depreciation',
    p_asset_id,
    v_calc.depreciation_amount,
    v_calc.depreciation_amount,
    v_user_id
  ) RETURNING id INTO v_journal_entry_id;

  -- Create journal entry lines
  -- Debit: Depreciation Expense
  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description
  ) VALUES (
    v_journal_entry_id,
    v_asset.depreciation_expense_account_id,
    v_calc.depreciation_amount,
    0,
    'Depreciation expense for ' || v_asset.name
  );

  -- Credit: Accumulated Depreciation
  INSERT INTO public.journal_entry_lines (
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description
  ) VALUES (
    v_journal_entry_id,
    v_asset.accumulated_depreciation_account_id,
    0,
    v_calc.depreciation_amount,
    'Accumulated depreciation for ' || v_asset.name
  );

  -- Record in depreciation schedule
  INSERT INTO public.asset_depreciation_schedule (
    asset_id,
    restaurant_id,
    period_start_date,
    period_end_date,
    depreciation_amount,
    accumulated_after,
    net_book_value,
    journal_entry_id,
    posted_by
  ) VALUES (
    p_asset_id,
    v_asset.restaurant_id,
    p_period_start,
    p_period_end,
    v_calc.depreciation_amount,
    v_calc.new_accumulated,
    v_calc.net_book_value,
    v_journal_entry_id,
    v_user_id
  );

  -- Update asset
  UPDATE public.assets
  SET
    accumulated_depreciation = v_calc.new_accumulated,
    last_depreciation_date = p_period_end,
    status = CASE
      WHEN v_calc.is_fully_depreciated THEN 'fully_depreciated'::asset_status_enum
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = p_asset_id;

  RETURN v_journal_entry_id;
END;
$$;

COMMENT ON FUNCTION public.calculate_asset_depreciation IS 'Calculate straight-line depreciation for an asset (preview only)';
COMMENT ON FUNCTION public.post_asset_depreciation IS 'Post depreciation for an asset, creating journal entry and updating schedule';
