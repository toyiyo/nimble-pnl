-- bulk_set_employee_availability
-- Replaces (delete + insert) availability rows for the supplied employees on the
-- supplied days. Designed to be idempotent and to support future multi-window
-- availability (multiple JSONB elements with the same day_of_week).
--
-- Safety:
--   - SECURITY DEFINER + explicit user_has_restaurant_access(..., true) check
--     enforces caller must be owner/manager.
--   - Inline tenant validator ensures employee_ids belong to p_restaurant_id.
--   - is_available REQUIRED in every JSONB element; closed-day rows cannot be
--     silently flipped to available.
--
-- Note: composite index is in 20260521133931_bulk_set_employee_availability_index.sql
--       (split because CREATE INDEX CONCURRENTLY cannot run inside a transaction)

CREATE OR REPLACE FUNCTION public.bulk_set_employee_availability(
  p_restaurant_id  UUID,
  p_employee_ids   UUID[],
  p_availability   JSONB
)
RETURNS TABLE (
  employees_updated INTEGER,
  rows_inserted     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_inserted     INTEGER := 0;
  v_employees_updated INTEGER := 0;
  v_unique_ids        UUID[];
BEGIN
  -- Authz: caller must be owner/manager of the restaurant
  IF NOT public.user_has_restaurant_access(p_restaurant_id, true) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Empty-array guard
  IF array_length(p_employee_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0::INTEGER, 0::INTEGER;
    RETURN;
  END IF;

  -- Dedupe input. Duplicates would otherwise be multiplied by the
  -- unnest × jsonb_array_elements cross join, inserting duplicate rows
  -- and inflating rows_inserted / employees_updated counts.
  SELECT array_agg(DISTINCT eid)
  INTO v_unique_ids
  FROM unnest(p_employee_ids) AS eid;

  -- day_of_week range check
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_availability) AS elem
    WHERE (elem->>'day_of_week')::int NOT BETWEEN 0 AND 6
  ) THEN
    RAISE EXCEPTION 'invalid_day_of_week' USING ERRCODE = '22003';
  END IF;

  -- is_available REQUIRED (boolean, present in every element)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_availability) AS elem
    WHERE NOT (elem ? 'is_available')
       OR jsonb_typeof(elem->'is_available') != 'boolean'
  ) THEN
    RAISE EXCEPTION 'is_available_required' USING ERRCODE = '22004';
  END IF;

  -- Tenant validation: every employee_id belongs to p_restaurant_id
  IF EXISTS (
    SELECT 1 FROM unnest(v_unique_ids) AS eid
    WHERE NOT EXISTS (
      SELECT 1 FROM employees
      WHERE id = eid AND restaurant_id = p_restaurant_id
    )
  ) THEN
    RAISE EXCEPTION 'employee_not_in_restaurant' USING ERRCODE = '23503';
  END IF;

  -- Atomic delete + insert. Days NOT in p_availability are untouched.
  -- IN de-duplicates day_of_week, so callers may pass multiple windows per day.
  WITH days_to_replace AS (
    SELECT (elem->>'day_of_week')::int AS day_of_week
    FROM jsonb_array_elements(p_availability) AS elem
  ),
  deleted AS (
    DELETE FROM employee_availability
    WHERE restaurant_id = p_restaurant_id
      AND employee_id = ANY(v_unique_ids)
      AND day_of_week IN (SELECT day_of_week FROM days_to_replace)
    RETURNING 1
  ),
  inserted AS (
    INSERT INTO employee_availability
      (restaurant_id, employee_id, day_of_week, start_time, end_time, is_available)
    SELECT
      p_restaurant_id,
      eid,
      (a->>'day_of_week')::int,
      (a->>'start_time')::time,
      (a->>'end_time')::time,
      (a->>'is_available')::boolean
    FROM unnest(v_unique_ids) AS eid
    CROSS JOIN jsonb_array_elements(p_availability) AS a
    RETURNING 1
  )
  SELECT
    COUNT(*) FILTER (WHERE TRUE)::INTEGER,
    array_length(v_unique_ids, 1)
  INTO v_rows_inserted, v_employees_updated
  FROM inserted;

  RETURN QUERY SELECT v_employees_updated, v_rows_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_set_employee_availability(UUID, UUID[], JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bulk_set_employee_availability(UUID, UUID[], JSONB) TO authenticated;
