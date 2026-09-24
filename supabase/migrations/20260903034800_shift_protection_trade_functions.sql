-- Shift Protection: re-checks and an override for the trade RPCs.
--
-- Provenance (source migration for each body below):
--   approve_shift_trade <- 20260821120000_trade_approval_area_grant.sql
--     (capability guard; the FOR UPDATE ordering and its existence-oracle
--     rationale carry over unchanged)
--   accept_shift_trade  <- 20260713010000_harden_accept_shift_trade.sql
--
-- approve_shift_trade gains a fourth argument, p_override. CREATE OR
-- REPLACE with a new argument list would create an OVERLOAD next to the
-- 3-argument version and make PostgREST calls ambiguous, so the old
-- signature is dropped first, and EXECUTE is re-granted (a DROP removes
-- the grant).
--
-- New findings, computed after the existing status/accepter checks:
--   shift_started    — now() is at or past the shift start
--   inside_deadline  — trade_deadline_mode != 'off' and the shift starts
--                      inside trade_deadline_hours
--   overlap          — the accepter holds an overlapping shift (the
--                      accept-time check, re-run at approval)
--   timeoff_conflict — check_timeoff_conflict returns a row for the
--                      accepter (matches approved AND pending requests;
--                      SECURITY INVOKER inside this DEFINER body reads as
--                      the owner, which is the intent)
-- Findings + p_override=false => {success:false, code:'policy_warning',
-- warnings:[...]}. warn and block behave the same here; block binds the
-- employee paths (accept below, and the 20260903034900 triggers).
--
-- accept_shift_trade gains one refusal: trade_deadline_mode = 'block'
-- and the shift starts inside the window.
--
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md

DROP FUNCTION IF EXISTS approve_shift_trade(UUID, UUID, TEXT);

CREATE FUNCTION approve_shift_trade(
  p_trade_id UUID,
  p_manager_user_id UUID,
  p_manager_note TEXT DEFAULT NULL,
  p_override BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade shift_trades;
  v_shift shifts;
  v_settings staffing_settings;
  v_conflict shifts;
  v_timeoff RECORD;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  -- Verify caller is the manager specified
  IF p_manager_user_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Capability check before the FOR UPDATE fetch (existence-oracle rule,
  -- see 20260821120000).
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

  SELECT * INTO v_shift
  FROM shifts
  WHERE id = v_trade.offered_shift_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
  END IF;

  -- The trade INSERT policy does not bind offered_shift_id to the trade's
  -- restaurant. Re-check here: this SECURITY DEFINER body must never
  -- transfer another tenant's shift.
  IF v_shift.restaurant_id != v_trade.restaurant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Shift does not belong to this restaurant');
  END IF;

  -- ---- Policy findings (Shift Protection) ----

  IF now() >= v_shift.start_time THEN
    v_warnings := v_warnings || jsonb_build_object(
      'rule', 'shift_started', 'mode', 'warn',
      'message', 'This shift already started.'
    );
  END IF;

  SELECT * INTO v_settings
  FROM staffing_settings
  WHERE restaurant_id = v_trade.restaurant_id;

  IF COALESCE(v_settings.trade_deadline_mode, 'off') != 'off'
     AND now() >= v_shift.start_time
         - make_interval(hours => v_settings.trade_deadline_hours)
     AND now() < v_shift.start_time THEN
    v_warnings := v_warnings || jsonb_build_object(
      'rule', 'trade_deadline', 'mode', v_settings.trade_deadline_mode,
      'message', format(
        'This shift starts inside the %s-hour trade window.',
        v_settings.trade_deadline_hours
      )
    );
  END IF;

  -- Re-run the accept-time overlap check: the accepter can gain a shift
  -- between accept and approval.
  SELECT * INTO v_conflict
  FROM shifts
  WHERE employee_id = v_trade.accepted_by_employee_id
    AND id != v_trade.offered_shift_id
    AND status IN ('scheduled', 'confirmed')
    AND (start_time, end_time) OVERLAPS (v_shift.start_time, v_shift.end_time);

  IF FOUND THEN
    v_warnings := v_warnings || jsonb_build_object(
      'rule', 'overlap', 'mode', 'warn',
      'message', 'The accepting employee already has a shift during this time.'
    );
  END IF;

  SELECT * INTO v_timeoff
  FROM check_timeoff_conflict(
    v_trade.accepted_by_employee_id, v_shift.start_time, v_shift.end_time
  )
  LIMIT 1;

  IF FOUND THEN
    v_warnings := v_warnings || jsonb_build_object(
      'rule', 'timeoff_conflict', 'mode', 'warn',
      'message', 'The accepting employee has approved or pending time off during this shift.'
    );
  END IF;

  IF jsonb_array_length(v_warnings) > 0 AND NOT p_override THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'policy_warning',
      'warnings', v_warnings
    );
  END IF;

  -- ---- End policy findings ----

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

GRANT EXECUTE ON FUNCTION approve_shift_trade(UUID, UUID, TEXT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION approve_shift_trade(UUID, UUID, TEXT, BOOLEAN) IS
  'Manager (edit:scheduling) approves a shift trade; policy findings return as policy_warning until p_override is true';

-- accept_shift_trade: body from 20260713010000, plus the block-mode
-- deadline refusal after the directed-target check.
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
  v_settings staffing_settings;
BEGIN
  -- Get the trade with row lock to prevent race conditions
  SELECT * INTO v_trade
  FROM shift_trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Trade not found');
  END IF;

  -- The accepting employee must belong to the caller, be active, and be in the
  -- trade's restaurant. Prevents a direct RPC call from accepting a trade on
  -- behalf of another employee (or across restaurants). SECURITY DEFINER bypasses
  -- RLS, so this is the authorization boundary. This check runs BEFORE the
  -- status check so a probing outsider cannot read a trade's status from the
  -- error message.
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

  -- Shift Protection: block-mode deadline. warn mode does not change the
  -- accept; the client shows the finding. A caller with edit:scheduling
  -- is exempt, matching the trigger guards and the create RPC.
  SELECT * INTO v_settings
  FROM staffing_settings
  WHERE restaurant_id = v_trade.restaurant_id;

  IF COALESCE(v_settings.trade_deadline_mode, 'off') = 'block'
     AND now() >= v_shift.start_time
         - make_interval(hours => v_settings.trade_deadline_hours)
     AND NOT user_has_capability(v_trade.restaurant_id, 'edit:scheduling') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format(
        'This trade closed: the shift starts inside the %s-hour trade window.',
        v_settings.trade_deadline_hours
      )
    );
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

GRANT EXECUTE ON FUNCTION accept_shift_trade(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION accept_shift_trade(UUID, UUID) IS
  'Employee accepts a shift trade as themselves; refused in block mode inside the trade deadline window';
