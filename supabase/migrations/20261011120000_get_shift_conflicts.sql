-- get_shift_conflicts: time-off and availability conflicts for every live
-- shift of one restaurant in one window. The rules stay in
-- check_timeoff_conflict and check_availability_conflict. SECURITY INVOKER,
-- so RLS on shifts and on the source tables applies to the caller.
CREATE OR REPLACE FUNCTION public.get_shift_conflicts(
  p_restaurant_id uuid, p_start timestamptz, p_end timestamptz)
RETURNS TABLE (shift_id uuid, conflict_type text, source text,
               status text, message text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_catalog
AS $$
  WITH s AS (
    SELECT id, employee_id, restaurant_id, start_time, end_time
    FROM shifts
    WHERE restaurant_id = p_restaurant_id
      AND start_time >= p_start AND start_time < p_end
      AND employee_id IS NOT NULL
      AND status NOT IN ('cancelled', 'completed')
      -- 32 days plus one day of slack. A DST change adds one hour to a real interval.
      AND p_end - p_start <= interval '33 days'
  )
  SELECT s.id, 'time_off'::text, NULL::text, t.status,
         format('Time off %s (%s to %s)', t.status, t.start_date, t.end_date)
  FROM s CROSS JOIN LATERAL
       check_timeoff_conflict(s.employee_id, s.start_time, s.end_time) t
  WHERE t.has_conflict
  UNION ALL
  SELECT s.id, 'availability'::text, a.conflict_type, NULL::text, a.message
  FROM s CROSS JOIN LATERAL
       check_availability_conflict(s.employee_id, s.restaurant_id,
                                   s.start_time, s.end_time) a
  WHERE a.has_conflict;
$$;

REVOKE ALL ON FUNCTION public.get_shift_conflicts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shift_conflicts(uuid, timestamptz, timestamptz) TO authenticated;
