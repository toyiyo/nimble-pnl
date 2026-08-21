-- Move the shift-trade approval audience from a fixed owner/manager role
-- check to the edit:scheduling capability, so a role granted schedule
-- management through the areas system (e.g. operations_manager) can act on
-- trades too.
--
-- Design: docs/superpowers/specs/2026-08-20-trade-approval-area-grant-design.md
--
-- Provenance (source migration for each object re-created below):
--   approve_shift_trade, reject_shift_trade
--     <- 20260713010000_harden_accept_shift_trade.sql
--   create_shift_trade_for_employee
--     <- 20260814130000_allow_draft_shift_trade.sql
--   "Managers can view all shift trades" (SELECT)
--     <- 20260104120000_create_shift_trades.sql
--   "Managers can approve or reject trades" (UPDATE)
--     <- 20260104120000_create_shift_trades.sql
--   "Managers can delete shift trades" (DELETE)
--     <- 20260105000000_fix_shift_trades_rls.sql
--
-- Every body below is copied from its source migration verbatim except for
-- the guard swap described in each block. The guard check stays BEFORE the
-- `FOR UPDATE` trade fetch in approve_shift_trade and reject_shift_trade:
-- moving it after would let an unauthorized caller learn whether a trade ID
-- exists from the error message alone (a trade-ID existence oracle).

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
BEGIN
  -- Verify caller is the manager specified
  IF p_manager_user_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Capability check replaces the owner/manager role literal check. This
  -- admits any role granted edit:scheduling (owner, manager,
  -- operations_manager, collaborator_operations_manager today), not only
  -- owner/manager. Runs before the FOR UPDATE fetch below on purpose: see
  -- the file header.
  IF NOT user_has_capability((SELECT restaurant_id FROM shift_trades WHERE id = p_trade_id), 'edit:scheduling') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: schedule manage access required');
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
BEGIN
  -- Verify caller is the manager specified
  IF p_manager_user_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Capability check replaces the owner/manager role literal check. See the
  -- matching comment in approve_shift_trade above; the ordering rule (before
  -- the FOR UPDATE fetch) is the same and for the same reason.
  IF NOT user_has_capability((SELECT restaurant_id FROM shift_trades WHERE id = p_trade_id), 'edit:scheduling') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: schedule manage access required');
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

GRANT EXECUTE ON FUNCTION approve_shift_trade(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_shift_trade(UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION approve_shift_trade(UUID, UUID, TEXT) IS 'Manager (or any role with edit:scheduling) approves a shift trade and transfers ownership';
COMMENT ON FUNCTION reject_shift_trade(UUID, UUID, TEXT) IS 'Manager (or any role with edit:scheduling) rejects a shift trade';

-- Function to let a manager post a draft trade for an employee.
--
-- The guard mirrors the approve audience on purpose: both approve and post
-- move to edit:scheduling in this migration, so the old "dead-end approval
-- queue" rationale (posting with a wider audience than approving) no longer
-- applies — the two now share the same audience.
CREATE OR REPLACE FUNCTION create_shift_trade_for_employee(
  p_restaurant_id UUID,
  p_offered_shift_id UUID,
  p_offered_by_employee_id UUID,
  p_target_employee_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts;
  v_new_trade_id UUID;
BEGIN
  -- Authorization: the caller must hold edit:scheduling for this restaurant.
  IF NOT user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Unauthorized: schedule manage access required';
  END IF;

  -- Load the offered shift. Filter by restaurant_id here, not in a separate
  -- check after the load: a cross-restaurant shift id must raise the same
  -- 'Shift not found' as a missing one, so the error never tells a caller
  -- that a given id exists in someone else's restaurant.
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = p_offered_shift_id
    AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  -- The shift must belong to the employee named as the offerer.
  IF v_shift.employee_id IS DISTINCT FROM p_offered_by_employee_id THEN
    RAISE EXCEPTION 'Shift does not belong to this employee';
  END IF;

  -- Only a live shift can be traded (allow-list, not deny-list).
  IF v_shift.status NOT IN ('scheduled', 'confirmed') THEN
    RAISE EXCEPTION 'Only a scheduled or confirmed shift can be traded';
  END IF;

  -- The offered employee must be active in this restaurant. Without this guard
  -- a manager can post a trade for a terminated employee: deactivate_employee
  -- auto-cancels only 'scheduled' shifts, so a 'confirmed' shift of an inactive
  -- employee stays tradeable.
  IF NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = p_offered_by_employee_id
      AND restaurant_id = p_restaurant_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Offered employee is not active';
  END IF;

  -- Directed trade: the target must be a different, active employee of this
  -- restaurant.
  IF p_target_employee_id IS NOT NULL THEN
    IF p_target_employee_id = p_offered_by_employee_id THEN
      RAISE EXCEPTION 'Cannot direct a trade to the same employee';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM employees
      WHERE id = p_target_employee_id
        AND restaurant_id = p_restaurant_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Target employee not found or inactive';
    END IF;
  END IF;

  -- Insert the trade. The partial unique index
  -- idx_unique_active_trade_per_shift blocks a second active trade on the same
  -- shift; translate that into a clear message instead of a raw 23505.
  BEGIN
    INSERT INTO shift_trades (
      restaurant_id,
      offered_shift_id,
      offered_by_employee_id,
      target_employee_id,
      reason,
      status
    ) VALUES (
      p_restaurant_id,
      p_offered_shift_id,
      p_offered_by_employee_id,
      p_target_employee_id,
      p_reason,
      'open'
    )
    RETURNING id INTO v_new_trade_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'This shift already has an active trade';
  END;

  RETURN v_new_trade_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_shift_trade_for_employee(UUID, UUID, UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION create_shift_trade_for_employee(UUID, UUID, UUID, UUID, TEXT) IS 'Any role with edit:scheduling posts a draft trade for an employee; mirrors the approve audience so posting and approving share one audience';

-- Re-create the three shift_trades RLS policies on the edit:scheduling
-- capability, same names, same USING semantics otherwise.
DROP POLICY IF EXISTS "Managers can view all shift trades" ON shift_trades;
DROP POLICY IF EXISTS "Managers can approve or reject trades" ON shift_trades;
DROP POLICY IF EXISTS "Managers can delete shift trades" ON shift_trades;

CREATE POLICY "Managers can view all shift trades"
  ON shift_trades FOR SELECT
  USING (user_has_capability(shift_trades.restaurant_id, 'edit:scheduling'));

CREATE POLICY "Managers can approve or reject trades"
  ON shift_trades FOR UPDATE
  USING (user_has_capability(shift_trades.restaurant_id, 'edit:scheduling'))
  WITH CHECK (
    -- Managers can update any field and set any status
    true
  );

CREATE POLICY "Managers can delete shift trades"
  ON shift_trades FOR DELETE
  USING (user_has_capability(shift_trades.restaurant_id, 'edit:scheduling'));

COMMENT ON POLICY "Managers can view all shift trades" ON shift_trades IS
  'Any role with edit:scheduling can view all shift trades in their restaurants.';

COMMENT ON POLICY "Managers can approve or reject trades" ON shift_trades IS
  'Any role with edit:scheduling can approve or reject shift trades in their restaurants.';

COMMENT ON POLICY "Managers can delete shift trades" ON shift_trades IS
  'Any role with edit:scheduling can delete any shift trades in their restaurants.';
