-- Migration: Create tip_payouts table for tracking daily cash tip disbursements
-- Prevents double-payment of tips in payroll by recording each payout

-- 1. Create the tip_payouts table
CREATE TABLE IF NOT EXISTS tip_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  payout_date     DATE NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0), -- cents
  tip_split_id    UUID REFERENCES tip_splits(id) ON DELETE SET NULL,
  notes           TEXT,
  paid_by         UUID REFERENCES auth.users(id),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Unique index to prevent duplicate payouts (handles NULL tip_split_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tip_payouts_unique_payout
  ON tip_payouts (restaurant_id, employee_id, payout_date, COALESCE(tip_split_id, '00000000-0000-0000-0000-000000000000'));

-- 3. Query indexes for performance
CREATE INDEX IF NOT EXISTS idx_tip_payouts_restaurant_date
  ON tip_payouts (restaurant_id, payout_date);

CREATE INDEX IF NOT EXISTS idx_tip_payouts_restaurant_employee_date
  ON tip_payouts (restaurant_id, employee_id, payout_date);

CREATE INDEX IF NOT EXISTS idx_tip_payouts_tip_split
  ON tip_payouts (tip_split_id);

-- 4. Enable RLS
ALTER TABLE tip_payouts ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (matching pattern from 20251217000001_create_tip_pooling_tables.sql)

-- Managers (owner/manager) can SELECT
DROP POLICY IF EXISTS "Managers can view tip payouts" ON tip_payouts;
CREATE POLICY "Managers can view tip payouts"
  ON tip_payouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers (owner/manager) can INSERT
DROP POLICY IF EXISTS "Managers can insert tip payouts" ON tip_payouts;
CREATE POLICY "Managers can insert tip payouts"
  ON tip_payouts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers (owner/manager) can UPDATE
DROP POLICY IF EXISTS "Managers can update tip payouts" ON tip_payouts;
CREATE POLICY "Managers can update tip payouts"
  ON tip_payouts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Managers (owner/manager) can DELETE
DROP POLICY IF EXISTS "Managers can delete tip payouts" ON tip_payouts;
CREATE POLICY "Managers can delete tip payouts"
  ON tip_payouts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = tip_payouts.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Employees can SELECT their own records
DROP POLICY IF EXISTS "Employees can view their own tip payouts" ON tip_payouts;
CREATE POLICY "Employees can view their own tip payouts"
  ON tip_payouts FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- 6. Trigger for updated_at (reuse existing function from tip pooling)
DROP TRIGGER IF EXISTS update_tip_payouts_updated_at ON tip_payouts;
CREATE TRIGGER update_tip_payouts_updated_at
  BEFORE UPDATE ON tip_payouts
  FOR EACH ROW
  EXECUTE FUNCTION update_tip_pooling_updated_at();

-- 7. Table and column comments
COMMENT ON TABLE tip_payouts IS 'Tracks daily cash tip disbursements to employees, preventing double-payment in payroll';
COMMENT ON COLUMN tip_payouts.id IS 'Unique identifier for the tip payout record';
COMMENT ON COLUMN tip_payouts.restaurant_id IS 'Restaurant this payout belongs to';
COMMENT ON COLUMN tip_payouts.employee_id IS 'Employee who received the tip payout';
COMMENT ON COLUMN tip_payouts.payout_date IS 'Date the tip was paid out';
COMMENT ON COLUMN tip_payouts.amount IS 'Payout amount in cents (must be positive)';
COMMENT ON COLUMN tip_payouts.tip_split_id IS 'Optional reference to the tip split that generated this payout';
COMMENT ON COLUMN tip_payouts.notes IS 'Optional notes about this payout';
COMMENT ON COLUMN tip_payouts.paid_by IS 'User (manager) who recorded this payout';
COMMENT ON COLUMN tip_payouts.created_at IS 'When this record was created';
COMMENT ON COLUMN tip_payouts.updated_at IS 'When this record was last updated (auto-managed by trigger)';
