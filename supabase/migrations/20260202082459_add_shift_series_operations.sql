-- Atomic delete for shift series
CREATE OR REPLACE FUNCTION delete_shift_series(
  p_parent_id UUID,
  p_restaurant_id UUID,
  p_scope TEXT, -- 'all' or 'following'
  p_from_time TIMESTAMPTZ DEFAULT NULL -- required for 'following' scope
)
RETURNS TABLE(deleted_count INT, locked_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INT := 0;
  v_locked_count INT := 0;
BEGIN
  -- Count locked shifts first
  IF p_scope = 'following' THEN
    SELECT COUNT(*) INTO v_locked_count
    FROM shifts
    WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
      AND restaurant_id = p_restaurant_id
      AND start_time >= p_from_time
      AND locked = true;

    -- Delete unlocked shifts
    WITH deleted AS (
      DELETE FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND start_time >= p_from_time
        AND locked = false
      RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  ELSE -- 'all'
    SELECT COUNT(*) INTO v_locked_count
    FROM shifts
    WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
      AND restaurant_id = p_restaurant_id
      AND locked = true;

    -- Delete unlocked shifts
    WITH deleted AS (
      DELETE FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND locked = false
      RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  END IF;

  RETURN QUERY SELECT v_deleted_count, v_locked_count;
END;
$$;

-- Atomic update for shift series
CREATE OR REPLACE FUNCTION update_shift_series(
  p_parent_id UUID,
  p_restaurant_id UUID,
  p_scope TEXT, -- 'all' or 'following'
  p_updates JSONB,
  p_from_time TIMESTAMPTZ DEFAULT NULL -- required for 'following' scope
)
RETURNS TABLE(updated_count INT, locked_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_count INT := 0;
  v_locked_count INT := 0;
BEGIN
  -- Count locked shifts first
  IF p_scope = 'following' THEN
    SELECT COUNT(*) INTO v_locked_count
    FROM shifts
    WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
      AND restaurant_id = p_restaurant_id
      AND start_time >= p_from_time
      AND locked = true;

    -- Update unlocked shifts
    WITH updated AS (
      UPDATE shifts
      SET
        employee_id = COALESCE((p_updates->>'employee_id')::UUID, employee_id),
        position = COALESCE(p_updates->>'position', position),
        notes = CASE WHEN p_updates ? 'notes' THEN p_updates->>'notes' ELSE notes END,
        status = COALESCE(p_updates->>'status', status),
        break_duration = COALESCE((p_updates->>'break_duration')::INT, break_duration),
        updated_at = NOW()
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND start_time >= p_from_time
        AND locked = false
      RETURNING id
    )
    SELECT COUNT(*) INTO v_updated_count FROM updated;
  ELSE -- 'all'
    SELECT COUNT(*) INTO v_locked_count
    FROM shifts
    WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
      AND restaurant_id = p_restaurant_id
      AND locked = true;

    -- Update unlocked shifts
    WITH updated AS (
      UPDATE shifts
      SET
        employee_id = COALESCE((p_updates->>'employee_id')::UUID, employee_id),
        position = COALESCE(p_updates->>'position', position),
        notes = CASE WHEN p_updates ? 'notes' THEN p_updates->>'notes' ELSE notes END,
        status = COALESCE(p_updates->>'status', status),
        break_duration = COALESCE((p_updates->>'break_duration')::INT, break_duration),
        updated_at = NOW()
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND locked = false
      RETURNING id
    )
    SELECT COUNT(*) INTO v_updated_count FROM updated;
  END IF;

  RETURN QUERY SELECT v_updated_count, v_locked_count;
END;
$$;

-- Get series info (count and locked count)
CREATE OR REPLACE FUNCTION get_shift_series_info(
  p_parent_id UUID,
  p_restaurant_id UUID
)
RETURNS TABLE(series_count INT, locked_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_series_count INT := 0;
  v_locked_count INT := 0;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE locked = true)
  INTO v_series_count, v_locked_count
  FROM shifts
  WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
    AND restaurant_id = p_restaurant_id;

  RETURN QUERY SELECT v_series_count, v_locked_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION delete_shift_series TO authenticated;
GRANT EXECUTE ON FUNCTION update_shift_series TO authenticated;
GRANT EXECUTE ON FUNCTION get_shift_series_info TO authenticated;
