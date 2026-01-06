-- Create functions for shift trade operations

-- Function to accept a shift trade
-- This checks for conflicts and updates the trade status to pending_approval
CREATE OR REPLACE FUNCTION accept_shift_trade(
  p_trade_id UUID,
  p_accepting_employee_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade shift_trades;
  v_shift shifts;
  v_conflict shifts;
BEGIN
  -- Get the trade
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Check trade is still open
  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade is no longer available');
  END IF;

  -- Get the shift details
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = v_trade.offered_shift_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  -- Check for conflicts with accepting employee's existing shifts
  SELECT * INTO v_conflict
  FROM shifts
  WHERE employee_id = p_accepting_employee_id
    AND status IN ('scheduled', 'confirmed')
    AND (
      -- Overlapping shifts
      (start_time, end_time) OVERLAPS (v_shift.start_time, v_shift.end_time)
    );

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'You already have a shift scheduled during this time'
    );
  END IF;

  -- Update the trade
  UPDATE shift_trades
  SET 
    accepted_by_employee_id = p_accepting_employee_id,
    status = 'pending_approval',
    updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Function to approve a shift trade (manager)
-- This transfers shift ownership and updates trade status
CREATE OR REPLACE FUNCTION approve_shift_trade(
  p_trade_id UUID,
  p_manager_user_id UUID,
  p_manager_note TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade shift_trades;
  v_shift shifts;
BEGIN
  -- Get the trade
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Check trade is pending approval
  IF v_trade.status != 'pending_approval' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade is not pending approval');
  END IF;

  -- Check accepting employee is set
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
    reviewed_by = p_manager_user_id,
    reviewed_at = NOW(),
    manager_note = p_manager_note,
    updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Function to reject a shift trade (manager)
CREATE OR REPLACE FUNCTION reject_shift_trade(
  p_trade_id UUID,
  p_manager_user_id UUID,
  p_manager_note TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade shift_trades;
BEGIN
  -- Get the trade
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Check trade is pending approval
  IF v_trade.status != 'pending_approval' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade is not pending approval');
  END IF;

  -- Update trade status
  UPDATE shift_trades
  SET 
    status = 'rejected',
    reviewed_by = p_manager_user_id,
    reviewed_at = NOW(),
    manager_note = p_manager_note,
    updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Function to cancel a shift trade (employee who created it)
CREATE OR REPLACE FUNCTION cancel_shift_trade(
  p_trade_id UUID,
  p_employee_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade shift_trades;
BEGIN
  -- Get the trade
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Check employee is the one who created the trade
  IF v_trade.offered_by_employee_id != p_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only cancel your own trades');
  END IF;

  -- Check trade is still open (can't cancel after accepted)
  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot cancel trade after it has been accepted');
  END IF;

  -- Update trade status
  UPDATE shift_trades
  SET 
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION accept_shift_trade(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_shift_trade(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_shift_trade(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_shift_trade(UUID, UUID) TO authenticated;

-- Add comments
COMMENT ON FUNCTION accept_shift_trade(UUID, UUID) IS 'Employee accepts a shift trade, checks for conflicts, and sets status to pending_approval';
COMMENT ON FUNCTION approve_shift_trade(UUID, UUID, TEXT) IS 'Manager approves a shift trade and transfers ownership';
COMMENT ON FUNCTION reject_shift_trade(UUID, UUID, TEXT) IS 'Manager rejects a shift trade';
COMMENT ON FUNCTION cancel_shift_trade(UUID, UUID) IS 'Employee cancels their own shift trade (only if still open)';
