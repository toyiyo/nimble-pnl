-- Shift Protection: read RPCs for the UI.
--
-- Three SECURITY DEFINER, STABLE functions with pinned search_path:
--   * get_shift_protection_settings — the eight policy knobs, readable by
--     restaurant members AND active employees. Needed because employees
--     hold no staffing_settings SELECT grant (member-only RLS,
--     20260306000000_create_staffing_settings.sql).
--   * get_timeoff_day_counts — per-day counts of other approved same-
--     position requests, for the employee dialog warning. Counts only,
--     no names. Both guard branches bind to p_restaurant_id so a caller
--     cannot point the function at another tenant.
--   * get_timeoff_coverage_impact — per-shift coverage before/after for
--     the manager approval queue. Capability-gated with the pre-fetch
--     subquery pattern (no request-id existence oracle,
--     20260821120000_trade_approval_area_grant.sql).
--
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md

CREATE OR REPLACE FUNCTION get_shift_protection_settings(p_restaurant_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Members and active employees of this restaurant may read the rules.
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM employees e
    WHERE e.restaurant_id = p_restaurant_id
      AND e.user_id = auth.uid()
      AND e.is_active = true
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT jsonb_build_object(
    'trade_deadline_mode', s.trade_deadline_mode,
    'trade_deadline_hours', s.trade_deadline_hours,
    'trade_auto_expire', s.trade_auto_expire,
    'timeoff_notice_mode', s.timeoff_notice_mode,
    'timeoff_notice_days', s.timeoff_notice_days,
    'timeoff_sameday_mode', s.timeoff_sameday_mode,
    'timeoff_sameday_limit', s.timeoff_sameday_limit,
    'coverage_floor_mode', s.coverage_floor_mode
  ) INTO v_result
  FROM staffing_settings s
  WHERE s.restaurant_id = p_restaurant_id;

  -- No settings row yet: return the column defaults. Keep this copy in
  -- sync with 20260903034500 and SHIFT_PROTECTION_DEFAULTS
  -- (src/lib/shiftProtection.ts).
  IF v_result IS NULL THEN
    v_result := jsonb_build_object(
      'trade_deadline_mode', 'off',
      'trade_deadline_hours', 24,
      'trade_auto_expire', false,
      'timeoff_notice_mode', 'off',
      'timeoff_notice_days', 7,
      'timeoff_sameday_mode', 'off',
      'timeoff_sameday_limit', 2,
      'coverage_floor_mode', 'off'
    );
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION get_timeoff_day_counts(
  p_restaurant_id UUID,
  p_employee_id UUID,
  p_start DATE,
  p_end DATE
)
RETURNS TABLE (day DATE, approved_count INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_position TEXT;
BEGIN
  -- Guard. Both branches bind to p_restaurant_id: the caller owns the
  -- employee row IN THIS RESTAURANT, or holds edit:scheduling for it.
  IF NOT EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = p_employee_id
      AND e.user_id = auth.uid()
      AND e.restaurant_id = p_restaurant_id
      AND e.is_active = true
  ) AND NOT user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- One shared cap across the three same-day scans: this guard, the
  -- review_time_off_request scan, and the trigger scan all stop at a
  -- 92-day span.
  IF p_end < p_start OR p_end - p_start > 92 THEN
    RAISE EXCEPTION 'Invalid date range';
  END IF;

  SELECT e.position INTO v_position
  FROM employees e
  WHERE e.id = p_employee_id
    AND e.restaurant_id = p_restaurant_id;

  IF v_position IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  -- Same-day scan. Keep in sync with the copies in
  -- review_time_off_request (20260903034700) and
  -- shift_protection_timeoff_guard (20260903034900).
  RETURN QUERY
  SELECT d::date AS day,
         COUNT(DISTINCT tor.employee_id)::integer AS approved_count
  FROM generate_series(p_start, p_end, INTERVAL '1 day') AS d
  LEFT JOIN time_off_requests tor
    ON tor.restaurant_id = p_restaurant_id
   AND tor.status = 'approved'
   AND tor.employee_id != p_employee_id
   AND tor.start_date <= d::date
   AND tor.end_date >= d::date
   AND EXISTS (
     SELECT 1 FROM employees oe
     WHERE oe.id = tor.employee_id
       AND oe.position = v_position
   )
  GROUP BY d::date
  ORDER BY d::date;
END;
$$;

CREATE OR REPLACE FUNCTION get_timeoff_coverage_impact(p_request_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request time_off_requests;
  v_tz TEXT;
  v_shifts jsonb;
  v_overlapping INTEGER;
BEGIN
  -- Capability check BEFORE the fetch: a bad id must not become an
  -- existence oracle (pattern: 20260821120000, approve_shift_trade).
  IF NOT user_has_capability(
    (SELECT restaurant_id FROM time_off_requests WHERE id = p_request_id),
    'edit:scheduling'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: schedule manage access required';
  END IF;

  SELECT * INTO v_request FROM time_off_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  SELECT COALESCE(NULLIF(r.timezone, ''), 'UTC') INTO v_tz
  FROM restaurants r
  WHERE r.id = v_request.restaurant_id;

  -- A garbage timezone makes AT TIME ZONE raise; degrade to UTC once here
  -- instead of failing inside the query (pattern: 20260723180000).
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- Per affected shift: required staff from the linked template (else 1),
  -- distinct same-position headcount overlapping the window, and the
  -- headcount after this employee leaves. Overlap count, not sweep-line —
  -- a stated design trade-off.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'shift_id', x.id,
    'shift_date', x.local_date,
    'position', x.position,
    'start_time', x.start_time,
    'end_time', x.end_time,
    'required', x.required,
    'current_count', x.current_count,
    'after_count', x.current_count - 1
  ) ORDER BY x.start_time), '[]'::jsonb) INTO v_shifts
  FROM (
    SELECT s.id, s.position, s.start_time, s.end_time,
           (s.start_time AT TIME ZONE v_tz)::date AS local_date,
           COALESCE(st.capacity, 1) AS required,
           (
             -- Sargable time bounds replace OVERLAPS so the
             -- (restaurant_id, position, start_time) index prunes the
             -- scan. The 24-hour lower bound assumes no shift is longer
             -- than a day; a longer shift drops out of the count, which
             -- is acceptable for a warning preview.
             SELECT COUNT(DISTINCT o.employee_id)::integer
             FROM shifts o
             WHERE o.restaurant_id = s.restaurant_id
               AND o.position = s.position
               AND o.status IN ('scheduled', 'confirmed')
               AND o.start_time < s.end_time
               AND o.start_time > s.start_time - INTERVAL '24 hours'
               AND o.end_time > s.start_time
           ) AS current_count
    FROM shifts s
    LEFT JOIN shift_templates st ON st.id = s.shift_template_id
    WHERE s.restaurant_id = v_request.restaurant_id
      AND s.employee_id = v_request.employee_id
      AND s.status IN ('scheduled', 'confirmed')
      AND (s.start_time AT TIME ZONE v_tz)::date BETWEEN v_request.start_date AND v_request.end_date
  ) x;

  SELECT COUNT(*)::integer INTO v_overlapping
  FROM time_off_requests tor
  WHERE tor.restaurant_id = v_request.restaurant_id
    AND tor.id != v_request.id
    AND tor.employee_id != v_request.employee_id
    AND tor.status = 'approved'
    AND tor.start_date <= v_request.end_date
    AND tor.end_date >= v_request.start_date;

  RETURN jsonb_build_object(
    'success', true,
    'shifts', v_shifts,
    'overlapping_approved', v_overlapping
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_shift_protection_settings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_timeoff_day_counts(UUID, UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_timeoff_coverage_impact(UUID) TO authenticated;

COMMENT ON FUNCTION get_shift_protection_settings(UUID) IS
  'Shift Protection: policy knobs for members and active employees of the restaurant';
COMMENT ON FUNCTION get_timeoff_day_counts(UUID, UUID, DATE, DATE) IS
  'Shift Protection: per-day counts of other approved same-position time off (counts only)';
COMMENT ON FUNCTION get_timeoff_coverage_impact(UUID) IS
  'Shift Protection: per-shift coverage impact of a time-off approval (edit:scheduling only)';
