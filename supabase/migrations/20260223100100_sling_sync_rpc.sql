-- =====================================================
-- SLING SYNC RPC FUNCTION
-- Syncs sling_shifts → shifts and sling_timesheets → time_punches
-- using employee_integration_mappings for employee resolution.
-- =====================================================

CREATE OR REPLACE FUNCTION public.sync_sling_to_shifts_and_punches(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
BEGIN
  -- Defaults: last 90 days to today
  v_start := COALESCE(p_start_date, (CURRENT_DATE - INTERVAL '90 days')::DATE);
  v_end   := COALESCE(p_end_date, CURRENT_DATE);

  -- -------------------------------------------------------
  -- Step 1: Sync sling_shifts → shifts
  -- -------------------------------------------------------
  INSERT INTO public.shifts (
    restaurant_id,
    employee_id,
    start_time,
    end_time,
    break_duration,
    position,
    notes,
    status,
    source_type,
    source_id
  )
  SELECT
    ss.restaurant_id,
    eim.employee_id,
    ss.start_time,
    ss.end_time,
    COALESCE(ss.break_duration, 0),
    COALESCE(ss.position, 'Unassigned'),
    'Synced from Sling',
    CASE
      WHEN ss.status IN ('published', 'planning') THEN 'scheduled'
      ELSE COALESCE(ss.status, 'scheduled')
    END,
    'sling',
    ss.sling_shift_id::TEXT
  FROM public.sling_shifts ss
  INNER JOIN public.employee_integration_mappings eim
    ON eim.restaurant_id = ss.restaurant_id
    AND eim.integration_type = 'sling'
    AND eim.external_user_id = ss.sling_user_id::TEXT
  WHERE ss.restaurant_id = p_restaurant_id
    AND ss.sling_user_id IS NOT NULL
    AND ss.shift_date BETWEEN v_start AND v_end
    AND ss.start_time IS NOT NULL
    AND ss.end_time IS NOT NULL
    AND ss.end_time > ss.start_time  -- respect CHECK constraint on shifts
  ON CONFLICT (restaurant_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET
    employee_id    = EXCLUDED.employee_id,
    start_time     = EXCLUDED.start_time,
    end_time       = EXCLUDED.end_time,
    break_duration = EXCLUDED.break_duration,
    position       = EXCLUDED.position,
    status         = EXCLUDED.status,
    updated_at     = NOW();

  -- -------------------------------------------------------
  -- Step 2: Sync sling_timesheets → time_punches
  -- -------------------------------------------------------
  INSERT INTO public.time_punches (
    restaurant_id,
    employee_id,
    shift_id,
    punch_type,
    punch_time,
    notes,
    source_type,
    source_id
  )
  SELECT
    st.restaurant_id,
    eim.employee_id,
    s.id,  -- matched shift (may be NULL if LEFT JOIN finds nothing)
    st.punch_type,
    st.punch_time,
    'Synced from Sling',
    'sling',
    st.sling_timesheet_id::TEXT
  FROM public.sling_timesheets st
  INNER JOIN public.employee_integration_mappings eim
    ON eim.restaurant_id = st.restaurant_id
    AND eim.integration_type = 'sling'
    AND eim.external_user_id = st.sling_user_id::TEXT
  LEFT JOIN public.shifts s
    ON s.restaurant_id = st.restaurant_id
    AND s.source_type = 'sling'
    AND s.source_id = st.sling_shift_id::TEXT
  WHERE st.restaurant_id = p_restaurant_id
    AND st.punch_time::DATE BETWEEN v_start AND v_end
    AND st.punch_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')
  ON CONFLICT (restaurant_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    shift_id    = EXCLUDED.shift_id,
    punch_type  = EXCLUDED.punch_type,
    punch_time  = EXCLUDED.punch_time,
    updated_at  = NOW();
END;
$$;

-- Grant execute to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.sync_sling_to_shifts_and_punches(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_sling_to_shifts_and_punches(UUID, DATE, DATE) TO service_role;
