-- Harden the four shift-trade SECURITY DEFINER functions:
--   1. accept_shift_trade trusted the client-supplied p_accepting_employee_id
--      with no check that the caller (auth.uid()) owns that employee row, nor
--      (for a directed trade) that it equals target_employee_id. Add both
--      checks. Sibling functions already get this right: approve/reject check
--      p_manager_user_id = auth.uid() + role; cancel checks the caller owns
--      the offerer employee.
--   2. None of the four functions pinned SET search_path (SECURITY DEFINER
--      hardening flagged in the #609 review / Supabase advisor). Add
--      `SET search_path = public, pg_temp` to all four.
--
-- Bodies are copied verbatim from 20260105000100_create_shift_trade_functions.sql
-- (no other migration has touched these functions since), with only the two
-- changes above. Signatures reproduced EXACTLY so CREATE OR REPLACE replaces
-- the existing functions rather than silently creating overloads:
--   accept_shift_trade(UUID, UUID)
--   approve_shift_trade(UUID, UUID, TEXT DEFAULT NULL)
--   reject_shift_trade(UUID, UUID, TEXT DEFAULT NULL)
--   cancel_shift_trade(UUID, UUID)
--
-- Design: docs/superpowers/specs/2026-07-13-accept-trade-authz-design.md
-- Ticket: task_d9ab7984

-- Function to accept a shift trade
-- This checks for conflicts and updates the trade status to pending_approval
CREATE OR REPLACE FUNCTION accept_shift_trade(
  p_trade_id UUID,
  p_accepting_employee_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade shift_trades;
  v_shift shifts;
  v_conflict shifts;
BEGIN
  -- Get the trade with row lock to prevent race conditions
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Check trade is still open
  IF v_trade.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade is no longer available');
  END IF;

  -- The accepting employee must belong to the caller, be active, and be in the
  -- trade's restaurant. Prevents a direct RPC call from accepting a trade on
  -- behalf of another employee (or across restaurants). SECURITY DEFINER bypasses
  -- RLS, so this is the authorization boundary.
  IF NOT EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = p_accepting_employee_id
      AND e.user_id = auth.uid()
      AND e.is_active = true
      AND e.restaurant_id = v_trade.restaurant_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only accept a trade as yourself');
  END IF;

  -- A DIRECTED trade may be accepted only by its target.
  IF v_trade.target_employee_id IS NOT NULL
     AND p_accepting_employee_id <> v_trade.target_employee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This trade was offered to a specific employee');
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade shift_trades;
  v_shift shifts;
  v_user_role TEXT;
BEGIN
  -- Verify caller is the manager specified and has manager role
  IF p_manager_user_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT role INTO v_user_role
  FROM user_restaurants
  WHERE user_id = auth.uid()
  AND restaurant_id = (SELECT restaurant_id FROM shift_trades WHERE id = p_trade_id)
  LIMIT 1;

  IF v_user_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Manager access required');
  END IF;

  -- Get the trade with row lock
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id
  FOR UPDATE;

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade shift_trades;
  v_user_role TEXT;
BEGIN
  -- Verify caller is the manager specified and has manager role
  IF p_manager_user_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT role INTO v_user_role
  FROM user_restaurants
  WHERE user_id = auth.uid()
  AND restaurant_id = (SELECT restaurant_id FROM shift_trades WHERE id = p_trade_id)
  LIMIT 1;

  IF v_user_role NOT IN ('owner', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Manager access required');
  END IF;

  -- Get the trade with row lock
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id
  FOR UPDATE;

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade shift_trades;
BEGIN
  -- Get the trade with row lock
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- Verify the caller owns the employee record that created this trade
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = v_trade.offered_by_employee_id
    AND user_id = auth.uid()
  ) THEN
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

-- Re-grant execute permissions (grants persist across CREATE OR REPLACE, but
-- re-granting is idempotent and keeps intent explicit).
GRANT EXECUTE ON FUNCTION accept_shift_trade(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_shift_trade(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_shift_trade(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_shift_trade(UUID, UUID) TO authenticated;

-- Update comments to reflect the new authorization checks
COMMENT ON FUNCTION accept_shift_trade(UUID, UUID) IS 'Employee accepts a shift trade as themselves (target-only for directed trades), checks for conflicts, and sets status to pending_approval';
COMMENT ON FUNCTION approve_shift_trade(UUID, UUID, TEXT) IS 'Manager approves a shift trade and transfers ownership';
COMMENT ON FUNCTION reject_shift_trade(UUID, UUID, TEXT) IS 'Manager rejects a shift trade';
COMMENT ON FUNCTION cancel_shift_trade(UUID, UUID) IS 'Employee cancels their own shift trade (only if still open)';
