-- Shift Protection: review_time_off_request RPC.
--
-- Replaces the client's direct status UPDATE for approvals with a
-- SECURITY DEFINER function that computes policy findings first. The
-- guard matches the deployed manager UPDATE policy audience —
-- user_has_capability(restaurant_id, 'edit:scheduling')
-- (20260730150000_rewrite_collaborator_policies.sql) — and runs BEFORE
-- the FOR UPDATE fetch so a bad id is not an existence oracle
-- (pattern: 20260821120000_trade_approval_area_grant.sql).
--
-- At review time, warn and block behave the same: findings return as
-- {success:false, code:'policy_warning', warnings:[...]} until the
-- caller retries with p_override => true. block binds the employee
-- paths through triggers (20260903034900), not this function.
--
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md

CREATE OR REPLACE FUNCTION review_time_off_request(
  p_request_id UUID,
  p_action TEXT,
  p_override BOOLEAN DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request time_off_requests;
  v_settings staffing_settings;
  v_tz TEXT;
  v_today DATE;
  v_position TEXT;
  v_warnings jsonb := '[]'::jsonb;
  v_max_sameday INTEGER;
  v_short_shifts INTEGER;
BEGIN
  IF p_action NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid action');
  END IF;

  -- Capability check before the fetch (existence-oracle rule).
  IF NOT user_has_capability(
    (SELECT restaurant_id FROM time_off_requests WHERE id = p_request_id),
    'edit:scheduling'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: schedule manage access required');
  END IF;

  SELECT * INTO v_request
  FROM time_off_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
  END IF;

  IF p_action = 'approved' THEN
    SELECT * INTO v_settings
    FROM staffing_settings
    WHERE restaurant_id = v_request.restaurant_id;

    -- No settings row: every mode reads 'off' below via COALESCE.
    SELECT COALESCE(NULLIF(r.timezone, ''), 'UTC') INTO v_tz
    FROM restaurants r WHERE r.id = v_request.restaurant_id;
    BEGIN
      v_today := (now() AT TIME ZONE v_tz)::date;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_today := (now() AT TIME ZONE 'UTC')::date;
    END;

    -- Rule: minimum notice.
    IF COALESCE(v_settings.timeoff_notice_mode, 'off') != 'off'
       AND v_request.start_date < v_today + v_settings.timeoff_notice_days THEN
      v_warnings := v_warnings || jsonb_build_object(
        'rule', 'timeoff_notice',
        'mode', v_settings.timeoff_notice_mode,
        'message', format(
          'This restaurant asks for %s days of notice. This request starts in %s days.',
          v_settings.timeoff_notice_days,
          GREATEST(v_request.start_date - v_today, 0)
        )
      );
    END IF;

    -- Rule: same-day limit per position. Scan is bounded to 92 days.
    -- Keep the scan in sync with get_timeoff_day_counts (20260903034600)
    -- and shift_protection_timeoff_guard (20260903034900).
    IF COALESCE(v_settings.timeoff_sameday_mode, 'off') != 'off' THEN
      SELECT e.position INTO v_position
      FROM employees e WHERE e.id = v_request.employee_id;

      SELECT COALESCE(MAX(day_count), 0) INTO v_max_sameday
      FROM (
        SELECT COUNT(DISTINCT tor.employee_id) AS day_count
        FROM generate_series(
          v_request.start_date,
          LEAST(v_request.end_date, v_request.start_date + 92),
          INTERVAL '1 day'
        ) AS d
        JOIN time_off_requests tor
          ON tor.restaurant_id = v_request.restaurant_id
         AND tor.status = 'approved'
         AND tor.employee_id != v_request.employee_id
         AND tor.start_date <= d::date
         AND tor.end_date >= d::date
        WHERE EXISTS (
          SELECT 1 FROM employees oe
          WHERE oe.id = tor.employee_id
            AND oe.restaurant_id = v_request.restaurant_id
            AND oe.position = v_position
        )
        GROUP BY d::date
      ) counts;

      IF v_max_sameday >= v_settings.timeoff_sameday_limit THEN
        v_warnings := v_warnings || jsonb_build_object(
          'rule', 'timeoff_sameday',
          'mode', v_settings.timeoff_sameday_mode,
          'message', format(
            '%s other %s employees already have approved time off on a requested day (limit %s).',
            v_max_sameday, COALESCE(v_position, 'same-position'), v_settings.timeoff_sameday_limit
          )
        );
      END IF;
    END IF;

    -- Rule: coverage floor. Per-shift overlap count (design trade-off 2).
    IF COALESCE(v_settings.coverage_floor_mode, 'off') != 'off' THEN
      SELECT COUNT(*)::integer INTO v_short_shifts
      FROM (
        SELECT s.id
        FROM shifts s
        LEFT JOIN shift_templates st ON st.id = s.shift_template_id
        WHERE s.restaurant_id = v_request.restaurant_id
          AND s.employee_id = v_request.employee_id
          AND s.status IN ('scheduled', 'confirmed')
          AND (s.start_time AT TIME ZONE v_tz)::date
              BETWEEN v_request.start_date AND v_request.end_date
          AND (
            -- Same sargable bounds as get_timeoff_coverage_impact
            -- (20260903034600): keep the two copies identical.
            SELECT COUNT(DISTINCT o.employee_id)
            FROM shifts o
            WHERE o.restaurant_id = s.restaurant_id
              AND o.position = s.position
              AND o.status IN ('scheduled', 'confirmed')
              AND o.start_time < s.end_time
              AND o.start_time > s.start_time - INTERVAL '24 hours'
              AND o.end_time > s.start_time
          ) - 1 < COALESCE(st.capacity, 1)
      ) short;

      IF v_short_shifts > 0 THEN
        v_warnings := v_warnings || jsonb_build_object(
          'rule', 'coverage_floor',
          'mode', v_settings.coverage_floor_mode,
          'message', format(
            'Approval drops %s scheduled shift(s) below the template staff count.',
            v_short_shifts
          )
        );
      END IF;
    END IF;

    IF jsonb_array_length(v_warnings) > 0 AND NOT p_override THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'policy_warning',
        'warnings', v_warnings
      );
    END IF;
  END IF;

  UPDATE time_off_requests
  SET status = p_action,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION review_time_off_request(UUID, TEXT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION review_time_off_request(UUID, TEXT, BOOLEAN) IS
  'Shift Protection: approve or reject a time-off request with policy findings and an override (edit:scheduling only)';
