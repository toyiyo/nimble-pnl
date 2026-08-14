-- Draft-shift trade.
--
-- Delete the is_published guard from create_shift_trade_for_employee. PR #744
-- added the guard so a trade could not point at a shift that can still change
-- or disappear. The draft-trade design lifts it as a product decision:
-- docs/superpowers/specs/2026-08-14-draft-shift-trade-design.md. The UI and
-- the notification now mark a draft trade as tentative, and the
-- ON DELETE CASCADE on offered_shift_id deletes the trade with the shift.
-- Every other guard stays.
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
  v_user_role TEXT;
  v_shift shifts;
  v_new_trade_id UUID;
BEGIN
  -- Authorization: the caller must be an owner or a manager of this restaurant.
  -- This mirrors the approve_shift_trade audience on purpose: the same person
  -- who approves the trade may post it. It is NOT the edit:scheduling
  -- capability, which also admits operations_manager and would create a
  -- dead-end approval queue.
  SELECT role INTO v_user_role
  FROM user_restaurants
  WHERE user_id = auth.uid()
    AND restaurant_id = p_restaurant_id
  LIMIT 1;

  -- v_user_role is NULL when the caller has no membership for this restaurant.
  -- `NULL NOT IN (...)` evaluates to NULL, not TRUE, so a plain NOT IN check
  -- would fail OPEN and let any authenticated user post a trade. Reject NULL
  -- first.
  IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Only an owner or a manager can post a trade for an employee';
  END IF;

  -- Load the offered shift.
  SELECT * INTO v_shift
  FROM shifts
  WHERE id = p_offered_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  -- The shift must belong to this restaurant.
  IF v_shift.restaurant_id != p_restaurant_id THEN
    RAISE EXCEPTION 'Shift does not belong to this restaurant';
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
