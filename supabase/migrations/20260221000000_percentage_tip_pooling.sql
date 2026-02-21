-- Migration: Add percentage-based tip pooling schema
-- Introduces a "Percentage Contribution" model where servers keep most of
-- their tips and contribute configurable percentages to named pools (e.g.,
-- "Kitchen Pool 3%", "Bar Support 2%").  The contributed amounts are then
-- distributed to eligible employees via hours, role-weight, or even split.
--
-- New objects:
--   ALTER  tip_pool_settings          – add pooling_model column
--   TABLE  tip_contribution_pools     – named pools with % and share rules
--   TABLE  tip_server_earnings        – per-server earned/retained/refunded
--   TABLE  tip_pool_allocations       – per-pool contributed/distributed/refunded

-- =============================================================================
-- 1. Add pooling_model column to tip_pool_settings
-- =============================================================================
ALTER TABLE tip_pool_settings
  ADD COLUMN IF NOT EXISTS pooling_model TEXT NOT NULL DEFAULT 'full_pool';

-- Add CHECK constraint (use DO block so re-running is safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tip_pool_settings_pooling_model_check'
  ) THEN
    ALTER TABLE tip_pool_settings
      ADD CONSTRAINT tip_pool_settings_pooling_model_check
      CHECK (pooling_model IN ('full_pool', 'percentage_contribution'));
  END IF;
END $$;

COMMENT ON COLUMN tip_pool_settings.pooling_model IS 'Tip pooling model: full_pool (legacy, all tips pooled) or percentage_contribution (servers keep most, contribute % to named pools)';

-- =============================================================================
-- 2. Create tip_contribution_pools table
-- =============================================================================
CREATE TABLE IF NOT EXISTS tip_contribution_pools (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id           UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  settings_id             UUID NOT NULL REFERENCES tip_pool_settings(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  contribution_percentage DECIMAL(5,2) NOT NULL CHECK (contribution_percentage > 0),
  share_method            TEXT NOT NULL CHECK (share_method IN ('hours', 'role', 'even')),
  role_weights            JSONB DEFAULT '{}'::jsonb,
  eligible_employee_ids   UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  sort_order              INTEGER NOT NULL DEFAULT 0,
  active                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 3. Create tip_server_earnings table
-- =============================================================================
CREATE TABLE IF NOT EXISTS tip_server_earnings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id    UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  earned_amount   INTEGER NOT NULL DEFAULT 0,
  retained_amount INTEGER NOT NULL DEFAULT 0,
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique: one earnings record per employee per split
CREATE UNIQUE INDEX IF NOT EXISTS idx_tip_server_earnings_split_employee
  ON tip_server_earnings (tip_split_id, employee_id);

-- =============================================================================
-- 4. Create tip_pool_allocations table
-- =============================================================================
CREATE TABLE IF NOT EXISTS tip_pool_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_split_id      UUID NOT NULL REFERENCES tip_splits(id) ON DELETE CASCADE,
  pool_id           UUID NOT NULL REFERENCES tip_contribution_pools(id) ON DELETE CASCADE,
  total_contributed INTEGER NOT NULL DEFAULT 0,
  total_distributed INTEGER NOT NULL DEFAULT 0,
  total_refunded    INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique: one allocation record per pool per split
CREATE UNIQUE INDEX IF NOT EXISTS idx_tip_pool_allocations_split_pool
  ON tip_pool_allocations (tip_split_id, pool_id);

-- =============================================================================
-- 5. Indexes for performance
-- =============================================================================

-- tip_contribution_pools
CREATE INDEX IF NOT EXISTS idx_tip_contribution_pools_restaurant
  ON tip_contribution_pools (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_tip_contribution_pools_settings
  ON tip_contribution_pools (settings_id);

CREATE INDEX IF NOT EXISTS idx_tip_contribution_pools_active
  ON tip_contribution_pools (restaurant_id, active) WHERE active = true;

-- tip_server_earnings
CREATE INDEX IF NOT EXISTS idx_tip_server_earnings_split
  ON tip_server_earnings (tip_split_id);

CREATE INDEX IF NOT EXISTS idx_tip_server_earnings_employee
  ON tip_server_earnings (employee_id);

-- tip_pool_allocations
CREATE INDEX IF NOT EXISTS idx_tip_pool_allocations_split
  ON tip_pool_allocations (tip_split_id);

CREATE INDEX IF NOT EXISTS idx_tip_pool_allocations_pool
  ON tip_pool_allocations (pool_id);

-- =============================================================================
-- 6. Enable RLS
-- =============================================================================
ALTER TABLE tip_contribution_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_server_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_pool_allocations ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 7. RLS Policies – tip_contribution_pools (managers only, all CRUD)
-- =============================================================================

-- SELECT
DROP POLICY IF EXISTS "Managers can view tip contribution pools" ON tip_contribution_pools;
CREATE POLICY "Managers can view tip contribution pools"
  ON tip_contribution_pools FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- INSERT
DROP POLICY IF EXISTS "Managers can insert tip contribution pools" ON tip_contribution_pools;
CREATE POLICY "Managers can insert tip contribution pools"
  ON tip_contribution_pools FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- UPDATE
DROP POLICY IF EXISTS "Managers can update tip contribution pools" ON tip_contribution_pools;
CREATE POLICY "Managers can update tip contribution pools"
  ON tip_contribution_pools FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- DELETE
DROP POLICY IF EXISTS "Managers can delete tip contribution pools" ON tip_contribution_pools;
CREATE POLICY "Managers can delete tip contribution pools"
  ON tip_contribution_pools FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_contribution_pools.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- =============================================================================
-- 8. RLS Policies – tip_server_earnings (managers + employee self-view)
-- =============================================================================

-- Managers SELECT (join through tip_splits for restaurant_id)
DROP POLICY IF EXISTS "Managers can view tip server earnings" ON tip_server_earnings;
CREATE POLICY "Managers can view tip server earnings"
  ON tip_server_earnings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_server_earnings.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Employees can view their own earnings
DROP POLICY IF EXISTS "Employees can view their own tip server earnings" ON tip_server_earnings;
CREATE POLICY "Employees can view their own tip server earnings"
  ON tip_server_earnings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = tip_server_earnings.employee_id
      AND employees.user_id = auth.uid()
    )
  );

-- Managers INSERT
DROP POLICY IF EXISTS "Managers can insert tip server earnings" ON tip_server_earnings;
CREATE POLICY "Managers can insert tip server earnings"
  ON tip_server_earnings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_server_earnings.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers UPDATE
DROP POLICY IF EXISTS "Managers can update tip server earnings" ON tip_server_earnings;
CREATE POLICY "Managers can update tip server earnings"
  ON tip_server_earnings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_server_earnings.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers DELETE
DROP POLICY IF EXISTS "Managers can delete tip server earnings" ON tip_server_earnings;
CREATE POLICY "Managers can delete tip server earnings"
  ON tip_server_earnings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_server_earnings.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- =============================================================================
-- 9. RLS Policies – tip_pool_allocations (managers only)
-- =============================================================================

-- Managers SELECT
DROP POLICY IF EXISTS "Managers can view tip pool allocations" ON tip_pool_allocations;
CREATE POLICY "Managers can view tip pool allocations"
  ON tip_pool_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_pool_allocations.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers INSERT
DROP POLICY IF EXISTS "Managers can insert tip pool allocations" ON tip_pool_allocations;
CREATE POLICY "Managers can insert tip pool allocations"
  ON tip_pool_allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_pool_allocations.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers UPDATE
DROP POLICY IF EXISTS "Managers can update tip pool allocations" ON tip_pool_allocations;
CREATE POLICY "Managers can update tip pool allocations"
  ON tip_pool_allocations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_pool_allocations.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers DELETE
DROP POLICY IF EXISTS "Managers can delete tip pool allocations" ON tip_pool_allocations;
CREATE POLICY "Managers can delete tip pool allocations"
  ON tip_pool_allocations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tip_splits
      JOIN user_restaurants ON user_restaurants.restaurant_id = tip_splits.restaurant_id
      WHERE tip_splits.id = tip_pool_allocations.tip_split_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- =============================================================================
-- 10. Trigger – updated_at for tip_contribution_pools
-- =============================================================================
DROP TRIGGER IF EXISTS update_tip_contribution_pools_updated_at ON tip_contribution_pools;
CREATE TRIGGER update_tip_contribution_pools_updated_at
  BEFORE UPDATE ON tip_contribution_pools
  FOR EACH ROW
  EXECUTE FUNCTION update_tip_pooling_updated_at();

-- =============================================================================
-- 11. Comments
-- =============================================================================
COMMENT ON TABLE tip_contribution_pools IS 'Named contribution pools for percentage-based tip pooling (e.g., "Kitchen Pool 3%"). Each pool defines a percentage that servers contribute from their earnings.';
COMMENT ON COLUMN tip_contribution_pools.restaurant_id IS 'Restaurant this pool belongs to';
COMMENT ON COLUMN tip_contribution_pools.settings_id IS 'Reference to the parent tip_pool_settings row';
COMMENT ON COLUMN tip_contribution_pools.name IS 'Display name for the pool (e.g., "Kitchen Support", "Bar Backup")';
COMMENT ON COLUMN tip_contribution_pools.contribution_percentage IS 'Percentage of server earnings contributed to this pool (e.g., 3.00 = 3%)';
COMMENT ON COLUMN tip_contribution_pools.share_method IS 'How pooled funds are distributed: hours (by hours worked), role (by role weights), even (equal split)';
COMMENT ON COLUMN tip_contribution_pools.role_weights IS 'JSON object mapping role names to weight multipliers when share_method is role, e.g., {"Busser": 1, "Runner": 1.5}';
COMMENT ON COLUMN tip_contribution_pools.eligible_employee_ids IS 'Array of employee UUIDs eligible to receive distributions from this pool';
COMMENT ON COLUMN tip_contribution_pools.sort_order IS 'Display ordering for pools in the UI';
COMMENT ON COLUMN tip_contribution_pools.active IS 'Whether this pool is currently active';

COMMENT ON TABLE tip_server_earnings IS 'Per-server tip earnings breakdown for percentage-contribution splits. Tracks what each server earned, retained after contributions, and any refunded amounts.';
COMMENT ON COLUMN tip_server_earnings.tip_split_id IS 'The tip split this earnings record belongs to';
COMMENT ON COLUMN tip_server_earnings.employee_id IS 'The server/employee who earned tips';
COMMENT ON COLUMN tip_server_earnings.earned_amount IS 'Total tips earned by this server (in cents)';
COMMENT ON COLUMN tip_server_earnings.retained_amount IS 'Amount retained after pool contributions (in cents)';
COMMENT ON COLUMN tip_server_earnings.refunded_amount IS 'Amount refunded from pool contributions (in cents)';

COMMENT ON TABLE tip_pool_allocations IS 'Per-pool allocation totals for a given tip split. Tracks total contributed, distributed, and refunded for each pool.';
COMMENT ON COLUMN tip_pool_allocations.tip_split_id IS 'The tip split this allocation belongs to';
COMMENT ON COLUMN tip_pool_allocations.pool_id IS 'The contribution pool this allocation is for';
COMMENT ON COLUMN tip_pool_allocations.total_contributed IS 'Total amount contributed to this pool from all servers (in cents)';
COMMENT ON COLUMN tip_pool_allocations.total_distributed IS 'Total amount distributed from this pool to eligible employees (in cents)';
COMMENT ON COLUMN tip_pool_allocations.total_refunded IS 'Total amount refunded from this pool (in cents)';
