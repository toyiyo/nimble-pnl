-- Add time delta support to update_shift_series function
-- This allows updating start/end times for a series by applying a time offset

-- Drop old function signature first to avoid duplicate
DROP FUNCTION IF EXISTS update_shift_series(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION update_shift_series(
  p_parent_id UUID,
  p_restaurant_id UUID,
  p_scope TEXT, -- 'all' or 'following'
  p_updates JSONB,
  p_from_time TIMESTAMPTZ DEFAULT NULL, -- required for 'following' scope
  p_start_time_delta INTERVAL DEFAULT NULL, -- optional: offset to apply to start_time
  p_end_time_delta INTERVAL DEFAULT NULL -- optional: offset to apply to end_time
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
        start_time = CASE WHEN p_start_time_delta IS NOT NULL THEN start_time + p_start_time_delta ELSE start_time END,
        end_time = CASE WHEN p_end_time_delta IS NOT NULL THEN end_time + p_end_time_delta ELSE end_time END,
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
        start_time = CASE WHEN p_start_time_delta IS NOT NULL THEN start_time + p_start_time_delta ELSE start_time END,
        end_time = CASE WHEN p_end_time_delta IS NOT NULL THEN end_time + p_end_time_delta ELSE end_time END,
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION update_shift_series(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, INTERVAL, INTERVAL) TO authenticated;
