-- Create shift_trades table for shift trading/swapping functionality
-- This allows employees to offer shifts to the marketplace or specific coworkers
-- Requires manager approval before ownership changes

CREATE TABLE IF NOT EXISTS shift_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  
  -- The shift being offered for trade
  offered_shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  offered_by_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  
  -- Optional: Specific shift being requested in return (for direct swaps)
  requested_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  
  -- Optional: Target specific employee for trade (if NULL, it's "up for grabs")
  target_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  
  -- Who accepted/claimed the trade (for marketplace trades)
  accepted_by_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  
  -- Trade status workflow: open -> pending_approval -> approved/rejected/cancelled
  status TEXT NOT NULL DEFAULT 'open',
  -- Status values:
  --   'open': Posted to marketplace, awaiting acceptance
  --   'pending_approval': Accepted by employee, awaiting manager approval
  --   'approved': Manager approved, shift ownership transferred
  --   'rejected': Manager rejected the trade
  --   'cancelled': Initiating employee cancelled before acceptance
  
  -- Optional reason from employee initiating trade
  reason TEXT,
  
  -- Optional note from manager (for rejections or special cases)
  manager_note TEXT,
  
  -- Manager who approved/rejected
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_status CHECK (
    status IN ('open', 'pending_approval', 'approved', 'rejected', 'cancelled')
  ),
  
  -- Can't offer same shift multiple times as active trade
  CONSTRAINT unique_active_trade_per_shift UNIQUE (offered_shift_id, status) 
    DEFERRABLE INITIALLY DEFERRED
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shift_trades_restaurant_id ON shift_trades(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shift_trades_offered_shift ON shift_trades(offered_shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_trades_offered_by ON shift_trades(offered_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_trades_accepted_by ON shift_trades(accepted_by_employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_trades_status ON shift_trades(status);
CREATE INDEX IF NOT EXISTS idx_shift_trades_target ON shift_trades(target_employee_id);

-- Enable Row Level Security
ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies
-- ============================================================

-- Policy 1: Employees can view trades in their restaurant
-- (marketplace trades or trades targeting them specifically)
CREATE POLICY "Employees can view shift trades in their restaurant"
  ON shift_trades FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.user_id = auth.uid()
      AND employees.restaurant_id = shift_trades.restaurant_id
      AND employees.is_active = true
    )
  );

-- Policy 2: Employees can create trades for their own shifts
CREATE POLICY "Employees can create trades for their own shifts"
  ON shift_trades FOR INSERT
  WITH CHECK (
    offered_by_employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Policy 3: Employees can update their own trades (cancel, or accept if targeted)
CREATE POLICY "Employees can update trades they're involved in"
  ON shift_trades FOR UPDATE
  USING (
    -- Employee who offered the trade can cancel it
    (
      offered_by_employee_id IN (
        SELECT id FROM employees WHERE user_id = auth.uid()
      )
      AND status = 'open'
    )
    OR
    -- Employee can accept a trade (marketplace or targeted at them)
    (
      (
        target_employee_id IS NULL -- marketplace trade
        OR target_employee_id IN (
          SELECT id FROM employees WHERE user_id = auth.uid()
        )
      )
      AND status = 'open'
    )
  )
  WITH CHECK (
    -- Can only update to pending_approval or cancelled status
    status IN ('open', 'pending_approval', 'cancelled')
  );

-- Policy 4: Managers can view all trades in their restaurants
CREATE POLICY "Managers can view all shift trades"
  ON shift_trades FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.restaurant_id = shift_trades.restaurant_id
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Policy 5: Managers can approve/reject trades
CREATE POLICY "Managers can approve or reject trades"
  ON shift_trades FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.restaurant_id = shift_trades.restaurant_id
      AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    -- Managers can update any field and set any status
    true
  );

-- ============================================================
-- Triggers
-- ============================================================

-- Trigger: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_shift_trades_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shift_trades_updated_at
  BEFORE UPDATE ON shift_trades
  FOR EACH ROW
  EXECUTE FUNCTION update_shift_trades_updated_at();

-- ============================================================
-- Function: Accept Trade and Check for Conflicts
-- ============================================================

CREATE OR REPLACE FUNCTION accept_shift_trade(
  p_trade_id UUID,
  p_accepting_employee_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_trade shift_trades;
  v_offered_shift shifts;
  v_has_conflict BOOLEAN;
BEGIN
  -- Get trade details
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade is no longer available');
  END IF;

  -- Get offered shift details
  SELECT * INTO v_offered_shift
  FROM shifts
  WHERE id = v_trade.offered_shift_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  -- Check for schedule conflicts with accepting employee's existing shifts
  SELECT EXISTS (
    SELECT 1 FROM shifts
    WHERE employee_id = p_accepting_employee_id
    AND restaurant_id = v_offered_shift.restaurant_id
    AND status IN ('scheduled', 'confirmed')
    AND (
      -- Overlapping time ranges
      (start_time, end_time) OVERLAPS (v_offered_shift.start_time, v_offered_shift.end_time)
    )
  ) INTO v_has_conflict;

  IF v_has_conflict THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Schedule conflict: You already have a shift during this time'
    );
  END IF;

  -- Check for conflicts with existing availability constraints
  -- (Reuse existing check_availability function if it exists)
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'check_availability'
  ) THEN
    IF NOT check_availability(
      p_accepting_employee_id,
      v_offered_shift.start_time,
      v_offered_shift.end_time
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'You are not available during this time'
      );
    END IF;
  END IF;

  -- Update trade to pending approval
  UPDATE shift_trades
  SET 
    accepted_by_employee_id = p_accepting_employee_id,
    status = 'pending_approval',
    updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true, 'trade_id', p_trade_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION accept_shift_trade TO authenticated;

-- ============================================================
-- Function: Approve Trade (Manager Only)
-- ============================================================

CREATE OR REPLACE FUNCTION approve_shift_trade(
  p_trade_id UUID,
  p_manager_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_trade shift_trades;
  v_user_role TEXT;
BEGIN
  -- Verify user is a manager
  SELECT role INTO v_user_role
  FROM user_restaurants
  WHERE user_id = auth.uid()
  AND restaurant_id = (
    SELECT restaurant_id FROM shift_trades WHERE id = p_trade_id
  )
  LIMIT 1;

  IF v_user_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Manager access required');
  END IF;

  -- Get trade
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  IF v_trade.status != 'pending_approval' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade is not pending approval');
  END IF;

  IF v_trade.accepted_by_employee_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No employee has accepted this trade');
  END IF;

  -- Transfer shift ownership
  UPDATE shifts
  SET 
    employee_id = v_trade.accepted_by_employee_id,
    updated_at = NOW()
  WHERE id = v_trade.offered_shift_id;

  -- Update trade status
  UPDATE shift_trades
  SET 
    status = 'approved',
    manager_note = p_manager_note,
    reviewed_by = auth.uid(),
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true, 'trade_id', p_trade_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION approve_shift_trade TO authenticated;

-- ============================================================
-- Function: Reject Trade (Manager Only)
-- ============================================================

CREATE OR REPLACE FUNCTION reject_shift_trade(
  p_trade_id UUID,
  p_manager_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  -- Verify user is a manager
  SELECT role INTO v_user_role
  FROM user_restaurants
  WHERE user_id = auth.uid()
  AND restaurant_id = (
    SELECT restaurant_id FROM shift_trades WHERE id = p_trade_id
  )
  LIMIT 1;

  IF v_user_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Manager access required');
  END IF;

  -- Update trade status
  UPDATE shift_trades
  SET 
    status = 'rejected',
    manager_note = p_manager_note,
    reviewed_by = auth.uid(),
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_trade_id
  AND status = 'pending_approval';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found or not pending approval');
  END IF;

  RETURN jsonb_build_object('success', true, 'trade_id', p_trade_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reject_shift_trade TO authenticated;

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE shift_trades IS 
  'Tracks shift trade requests between employees. Supports marketplace-style "up for grabs" 
   trades and direct employee-to-employee swaps. Requires manager approval.';

COMMENT ON COLUMN shift_trades.status IS 
  'Trade workflow: open -> pending_approval -> approved/rejected/cancelled';

COMMENT ON COLUMN shift_trades.target_employee_id IS 
  'If NULL, trade is posted to marketplace. If set, trade is directed at specific employee.';

COMMENT ON FUNCTION accept_shift_trade IS 
  'Accepts a trade request and checks for schedule conflicts. Sets status to pending_approval.';

COMMENT ON FUNCTION approve_shift_trade IS 
  'Manager function to approve a trade and transfer shift ownership.';

COMMENT ON FUNCTION reject_shift_trade IS 
  'Manager function to reject a trade request.';
