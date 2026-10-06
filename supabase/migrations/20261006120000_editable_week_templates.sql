-- Editable week templates
-- Design: docs/superpowers/specs/2026-10-06-editable-week-templates-design.md
--
-- 1. validate_schedule_plan_template_shifts: shape check for template JSONB.
-- 2. update_schedule_plan_template: new RPC with an optimistic updated_at check.
-- 3. save/apply/delete: edit:scheduling gate, search_path, limit 5 -> 20,
--    and apply skips employees that are not active in the restaurant.
-- 4. RLS: delete the INSERT and DELETE policies. All writes go through the
--    SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- 1. Shape validator (internal: only the definer RPCs call it)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_schedule_plan_template_shifts(
  p_restaurant_id UUID,
  p_shifts JSONB
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_num NUMERIC;
  v_time_re CONSTANT TEXT := '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$';
  v_uuid_re CONSTANT TEXT := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_allowed_keys CONSTANT TEXT[] := ARRAY[
    'day_offset', 'start_time', 'end_time', 'break_duration',
    'position', 'employee_id', 'employee_name', 'notes'
  ];
BEGIN
  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' THEN
    RAISE EXCEPTION 'Invalid template shifts: expected an array';
  END IF;

  IF jsonb_array_length(p_shifts) > 500 THEN
    RAISE EXCEPTION 'Invalid template shifts: maximum of 500 shifts';
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_shifts) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'Invalid template shift: expected an object';
    END IF;

    IF NOT (ARRAY(SELECT jsonb_object_keys(v_elem)) <@ v_allowed_keys) THEN
      RAISE EXCEPTION 'Invalid template shift: unknown field';
    END IF;

    IF jsonb_typeof(v_elem->'employee_id') IS DISTINCT FROM 'string'
       OR (v_elem->>'employee_id') !~ v_uuid_re THEN
      RAISE EXCEPTION 'Invalid template shift: employee_id is required';
    END IF;

    IF jsonb_typeof(v_elem->'employee_name') = 'string' AND length(v_elem->>'employee_name') > 200 THEN
      RAISE EXCEPTION 'Invalid template shift: employee_name must be 200 characters or fewer';
    END IF;

    -- Nested checks: SQL does not promise left-to-right OR, so the type
    -- check must finish before any cast.
    IF jsonb_typeof(v_elem->'day_offset') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid template shift: day_offset must be a whole number from 0 to 6';
    END IF;
    v_num := (v_elem->>'day_offset')::numeric;
    IF v_num <> trunc(v_num) OR v_num NOT BETWEEN 0 AND 6 THEN
      RAISE EXCEPTION 'Invalid template shift: day_offset must be a whole number from 0 to 6';
    END IF;

    IF jsonb_typeof(v_elem->'start_time') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_elem->'end_time') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid template shift: start_time and end_time must be HH:MM or HH:MM:SS';
    END IF;
    IF (v_elem->>'start_time') !~ v_time_re OR (v_elem->>'end_time') !~ v_time_re THEN
      RAISE EXCEPTION 'Invalid template shift: start_time and end_time must be HH:MM or HH:MM:SS';
    END IF;

    IF (v_elem->>'start_time')::time = (v_elem->>'end_time')::time THEN
      RAISE EXCEPTION 'Invalid template shift: start_time and end_time must differ';
    END IF;

    IF jsonb_typeof(v_elem->'break_duration') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid template shift: break_duration must be a whole number from 0 to 480';
    END IF;
    v_num := (v_elem->>'break_duration')::numeric;
    IF v_num <> trunc(v_num) OR v_num NOT BETWEEN 0 AND 480 THEN
      RAISE EXCEPTION 'Invalid template shift: break_duration must be a whole number from 0 to 480';
    END IF;

    IF jsonb_typeof(v_elem->'position') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid template shift: position is required (max 100 characters)';
    END IF;
    IF length(btrim(v_elem->>'position')) = 0 OR length(v_elem->>'position') > 100 THEN
      RAISE EXCEPTION 'Invalid template shift: position is required (max 100 characters)';
    END IF;

    IF jsonb_typeof(v_elem->'notes') = 'string' AND length(v_elem->>'notes') > 500 THEN
      RAISE EXCEPTION 'Invalid template shift: notes must be 500 characters or fewer';
    END IF;
  END LOOP;

  -- One set query: every employee_id must belong to the restaurant. Inactive
  -- employees are allowed here; apply skips them.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_shifts) AS elem
    WHERE NOT EXISTS (
      SELECT 1 FROM employees e
      WHERE e.id = (elem->>'employee_id')::uuid
        AND e.restaurant_id = p_restaurant_id
    )
  ) THEN
    RAISE EXCEPTION 'Invalid template shift: employee does not belong to this restaurant';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_schedule_plan_template_shifts(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Save RPC (same signature; return value gains updated_at)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_schedule_plan_template(
  p_restaurant_id UUID,
  p_name TEXT,
  p_shifts JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_shift_count INT;
  v_name TEXT := btrim(coalesce(p_name, ''));
  v_result schedule_plan_templates%ROWTYPE;
BEGIN
  IF NOT user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Template name is required';
  END IF;
  IF length(v_name) > 100 THEN
    RAISE EXCEPTION 'Template name must be 100 characters or fewer';
  END IF;

  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' OR jsonb_array_length(p_shifts) = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty schedule template';
  END IF;
  v_shift_count := jsonb_array_length(p_shifts);

  PERFORM validate_schedule_plan_template_shifts(p_restaurant_id, p_shifts);

  -- Advisory lock keyed to restaurant_id: works even when the table is empty.
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_restaurant_id::text || '_sched_tmpl'), 1, 16))::bit(64)::bigint
  );

  SELECT count(*) INTO v_count
  FROM schedule_plan_templates
  WHERE restaurant_id = p_restaurant_id;

  IF v_count >= 20 THEN
    RAISE EXCEPTION 'Maximum of 20 schedule templates allowed. Delete one to save a new one.';
  END IF;

  INSERT INTO schedule_plan_templates (restaurant_id, name, shifts, shift_count)
  VALUES (p_restaurant_id, v_name, p_shifts, v_shift_count)
  RETURNING * INTO v_result;

  -- The full row, the same shape as a SELECT. The client uses updated_at
  -- as the next expected value for update_schedule_plan_template.
  RETURN to_jsonb(v_result);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Update RPC (new). Compare-and-set on updated_at in one statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_schedule_plan_template(
  p_restaurant_id UUID,
  p_template_id UUID,
  p_name TEXT,
  p_shifts JSONB,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := btrim(coalesce(p_name, ''));
  v_result schedule_plan_templates%ROWTYPE;
BEGIN
  IF NOT user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Expected updated_at is required';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Template name is required';
  END IF;
  IF length(v_name) > 100 THEN
    RAISE EXCEPTION 'Template name must be 100 characters or fewer';
  END IF;

  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' OR jsonb_array_length(p_shifts) = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty schedule template';
  END IF;

  PERFORM validate_schedule_plan_template_shifts(p_restaurant_id, p_shifts);

  UPDATE schedule_plan_templates
  SET name = v_name,
      shifts = p_shifts,
      shift_count = jsonb_array_length(p_shifts)
  WHERE id = p_template_id
    AND restaurant_id = p_restaurant_id
    AND updated_at = p_expected_updated_at
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM schedule_plan_templates
      WHERE id = p_template_id AND restaurant_id = p_restaurant_id
    ) THEN
      RAISE EXCEPTION 'Template was changed by another user. Reload and try again.';
    END IF;
    RAISE EXCEPTION 'Template not found';
  END IF;

  RETURN to_jsonb(v_result);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Apply RPC (same signature). Skips employees that are not active in the
--    restaurant, in both modes. skipped_count = total - inserted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_schedule_plan_template(
  p_restaurant_id UUID,
  p_target_start TIMESTAMPTZ,
  p_target_end   TIMESTAMPTZ,
  p_shifts       JSONB,
  p_merge_mode   TEXT DEFAULT 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INT := 0;
  v_inserted_count INT := 0;
  v_total INT;
BEGIN
  IF NOT user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_merge_mode NOT IN ('replace', 'merge') THEN
    RAISE EXCEPTION 'Invalid merge_mode: %. Use replace or merge.', p_merge_mode;
  END IF;

  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' THEN
    RAISE EXCEPTION 'Invalid shifts: expected an array';
  END IF;
  v_total := jsonb_array_length(p_shifts);

  IF p_merge_mode = 'replace' THEN
    DELETE FROM shifts
    WHERE restaurant_id = p_restaurant_id
      AND locked = false
      AND start_time >= p_target_start
      AND start_time <= p_target_end;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  END IF;

  INSERT INTO shifts (
    restaurant_id, employee_id, start_time, end_time,
    break_duration, position, notes, status, is_published, locked
  )
  SELECT
    p_restaurant_id,
    (elem->>'employee_id')::uuid,
    (elem->>'start_time')::timestamptz,
    (elem->>'end_time')::timestamptz,
    (elem->>'break_duration')::int,
    elem->>'position',
    NULLIF(elem->>'notes', 'null'),
    'scheduled',
    false,
    false
  FROM jsonb_array_elements(p_shifts) AS elem
  JOIN employees e
    ON e.id = (elem->>'employee_id')::uuid
   AND e.restaurant_id = p_restaurant_id
   AND e.is_active
  WHERE p_merge_mode = 'replace'
     OR NOT EXISTS (
       SELECT 1 FROM shifts s
       WHERE s.restaurant_id = p_restaurant_id
         AND s.employee_id = (elem->>'employee_id')::uuid
         AND s.start_time < (elem->>'end_time')::timestamptz
         AND s.end_time > (elem->>'start_time')::timestamptz
     );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'inserted_count', v_inserted_count,
    'skipped_count', v_total - v_inserted_count,
    'deleted_count', v_deleted_count
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Delete RPC (same signature)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_schedule_plan_template(
  p_restaurant_id UUID,
  p_template_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM schedule_plan_templates
  WHERE id = p_template_id AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.save_schedule_plan_template(UUID, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_schedule_plan_template(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_schedule_plan_template(UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_schedule_plan_template(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_schedule_plan_template(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_schedule_plan_template(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_schedule_plan_template(UUID, TIMESTAMPTZ, TIMESTAMPTZ, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_schedule_plan_template(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS: writes only through the RPCs
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert their restaurant templates" ON public.schedule_plan_templates;
DROP POLICY IF EXISTS "Users can delete their restaurant templates" ON public.schedule_plan_templates;

-- ---------------------------------------------------------------------------
-- 8. Clean existing rows. The old save path did not check day_offset, and an
--    edge-of-week shift can compute to -1 or 7. The editor reads day_offset as
--    an index 0-6, so delete those elements. A row with only bad elements
--    stays as it is (an empty array is not a valid template); the client
--    ignores bad offsets on read.
-- ---------------------------------------------------------------------------
WITH cleaned AS (
  SELECT t.id,
         jsonb_agg(elem ORDER BY ord) AS shifts
  FROM schedule_plan_templates t
  CROSS JOIN LATERAL jsonb_array_elements(t.shifts) WITH ORDINALITY AS x(elem, ord)
  WHERE CASE WHEN jsonb_typeof(elem->'day_offset') = 'number'
             THEN (elem->>'day_offset')::numeric BETWEEN 0 AND 6
                  AND (elem->>'day_offset')::numeric = trunc((elem->>'day_offset')::numeric)
             ELSE false END
  GROUP BY t.id
)
UPDATE schedule_plan_templates t
SET shifts = c.shifts,
    shift_count = jsonb_array_length(c.shifts)
FROM cleaned c
WHERE c.id = t.id
  AND jsonb_array_length(c.shifts) < jsonb_array_length(t.shifts);
