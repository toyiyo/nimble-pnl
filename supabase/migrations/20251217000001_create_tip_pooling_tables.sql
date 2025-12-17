-- Migration: Create tip pooling tables for settings, splits, and disputes
-- Part of Apple-style tip pooling implementation
-- See: docs/TIP_POOLING_GAP_ANALYSIS.md

-- 1. Tip Pool Settings (persist manager configuration)
CREATE TABLE IF NOT EXISTS tip_pool_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tip_source TEXT CHECK (tip_source IN ('manual', 'pos')),
  share_method TEXT CHECK (share_method IN ('hours', 'role', 'manual')),
  split_cadence TEXT CHECK (split_cadence IN ('daily', 'weekly', 'shift')),
  role_weights JSONB DEFAULT '{}'::jsonb, -- { "Server": 2, "Bartender": 3 }
  enabled_employee_ids UUID[] DEFAULT ARRAY[]::UUID[], -- Array of employee IDs who share tips
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  CONSTRAINT unique_active_settings UNIQUE(restaurant_id, active)
);

-- 2. Tip Splits (daily/weekly splits as a unit)
CREATE TABLE IF NOT EXISTS tip_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  split_date DATE NOT NULL,
  total_amount INTEGER NOT NULL DEFAULT 0, -- cents
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'archived')) DEFAULT 'draft',
  share_method TEXT CHECK (share_method IN ('hours', 'role', 'manual')),
  tip_source TEXT CHECK (tip_source IN ('manual', 'pos')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tip Split Items (individual employee allocations within a split)
CREATE TABLE IF NOT EXISTS tip_split_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL DEFAULT 0, -- cents
  hours_worked DECIMAL(5,2),
  role TEXT,
  role_weight DECIMAL(5,2),
  manually_edited BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tip Disputes (employee flagging system)
CREATE TABLE IF NOT EXISTS tip_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tip_split_id UUID REFERENCES tip_splits(id) ON DELETE SET NULL,
  dispute_type TEXT CHECK (dispute_type IN ('missing_hours', 'wrong_role', 'other')),
  message TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')) DEFAULT 'open',
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tip_pool_settings_restaurant ON tip_pool_settings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tip_pool_settings_active ON tip_pool_settings(restaurant_id, active) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_tip_splits_restaurant ON tip_splits(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tip_splits_date ON tip_splits(split_date);
CREATE INDEX IF NOT EXISTS idx_tip_splits_status ON tip_splits(status);
CREATE INDEX IF NOT EXISTS idx_tip_splits_restaurant_date ON tip_splits(restaurant_id, split_date);

CREATE INDEX IF NOT EXISTS idx_tip_split_items_split ON tip_split_items(tip_split_id);
CREATE INDEX IF NOT EXISTS idx_tip_split_items_employee ON tip_split_items(employee_id);

CREATE INDEX IF NOT EXISTS idx_tip_disputes_restaurant ON tip_disputes(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tip_disputes_employee ON tip_disputes(employee_id);
CREATE INDEX IF NOT EXISTS idx_tip_disputes_status ON tip_disputes(status);
CREATE INDEX IF NOT EXISTS idx_tip_disputes_split ON tip_disputes(tip_split_id);

-- Enable RLS
ALTER TABLE tip_pool_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_split_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_disputes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tip_pool_settings
DROP POLICY IF EXISTS "Managers can view tip pool settings" ON tip_pool_settings;
CREATE POLICY "Managers can view tip pool settings"
  ON tip_pool_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can insert tip pool settings" ON tip_pool_settings;
CREATE POLICY "Managers can insert tip pool settings"
  ON tip_pool_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can update tip pool settings" ON tip_pool_settings;
CREATE POLICY "Managers can update tip pool settings"
  ON tip_pool_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for tip_splits
DROP POLICY IF EXISTS "Managers can view tip splits" ON tip_splits;
CREATE POLICY "Managers can view tip splits"
  ON tip_splits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can insert tip splits" ON tip_splits;
CREATE POLICY "Managers can insert tip splits"
  ON tip_splits FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can update tip splits" ON tip_splits;
CREATE POLICY "Managers can update tip splits"
  ON tip_splits FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can delete tip splits" ON tip_splits;
CREATE POLICY "Managers can delete tip splits"
  ON tip_splits FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_splits.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for tip_split_items
DROP POLICY IF EXISTS "Managers can view tip split items" ON tip_split_items;
CREATE POLICY "Managers can view tip split items"
  ON tip_split_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_split_items.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Employees can view their own tip split items" ON tip_split_items;
CREATE POLICY "Employees can view their own tip split items"
  ON tip_split_items FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can insert tip split items" ON tip_split_items;
CREATE POLICY "Managers can insert tip split items"
  ON tip_split_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_split_items.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can update tip split items" ON tip_split_items;
CREATE POLICY "Managers can update tip split items"
  ON tip_split_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_split_items.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can delete tip split items" ON tip_split_items;
CREATE POLICY "Managers can delete tip split items"
  ON tip_split_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_split_items.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for tip_disputes
DROP POLICY IF EXISTS "Managers can view tip disputes" ON tip_disputes;
CREATE POLICY "Managers can view tip disputes"
  ON tip_disputes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_disputes.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Employees can view their own tip disputes" ON tip_disputes;
CREATE POLICY "Employees can view their own tip disputes"
  ON tip_disputes FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Employees can insert their own tip disputes" ON tip_disputes;
CREATE POLICY "Employees can insert their own tip disputes"
  ON tip_disputes FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can update tip disputes" ON tip_disputes;
CREATE POLICY "Managers can update tip disputes"
  ON tip_disputes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_disputes.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_tip_pooling_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_tip_pool_settings_updated_at ON tip_pool_settings;
CREATE TRIGGER update_tip_pool_settings_updated_at
  BEFORE UPDATE ON tip_pool_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_tip_pooling_updated_at();

DROP TRIGGER IF EXISTS update_tip_splits_updated_at ON tip_splits;
CREATE TRIGGER update_tip_splits_updated_at
  BEFORE UPDATE ON tip_splits
  FOR EACH ROW
  EXECUTE FUNCTION update_tip_pooling_updated_at();

DROP TRIGGER IF EXISTS update_tip_disputes_updated_at ON tip_disputes;
CREATE TRIGGER update_tip_disputes_updated_at
  BEFORE UPDATE ON tip_disputes
  FOR EACH ROW
  EXECUTE FUNCTION update_tip_pooling_updated_at();

-- Function to ensure only one active tip_pool_settings per restaurant
CREATE OR REPLACE FUNCTION ensure_single_active_tip_pool_setting()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.active = true THEN
    UPDATE tip_pool_settings
    SET active = false
    WHERE restaurant_id = NEW.restaurant_id
    AND id != NEW.id
    AND active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_single_active_tip_pool_setting_trigger ON tip_pool_settings;
CREATE TRIGGER ensure_single_active_tip_pool_setting_trigger
  BEFORE INSERT OR UPDATE ON tip_pool_settings
  FOR EACH ROW
  WHEN (NEW.active = true)
  EXECUTE FUNCTION ensure_single_active_tip_pool_setting();

-- Comments for documentation
COMMENT ON TABLE tip_pool_settings IS 'Stores tip pooling configuration per restaurant (Part 1 of Apple-style UX)';
COMMENT ON TABLE tip_splits IS 'Stores daily/weekly tip splits as a unit (Part 2: Review Screen)';
COMMENT ON TABLE tip_split_items IS 'Individual employee allocations within a tip split';
COMMENT ON TABLE tip_disputes IS 'Employee-initiated disputes about tip amounts (Part 4: Corrections)';

COMMENT ON COLUMN tip_pool_settings.role_weights IS 'JSON object mapping role names to weight multipliers, e.g., {"Server": 2, "Bartender": 3}';
COMMENT ON COLUMN tip_pool_settings.enabled_employee_ids IS 'Array of employee UUIDs who participate in tip sharing';
COMMENT ON COLUMN tip_split_items.manually_edited IS 'True if manager manually adjusted this amount (vs calculated)';
