-- Allow updates to locked (published) shift series when explicitly requested.
-- Adds p_include_locked to update_shift_series, mirroring the
-- p_include_locked param added to delete_shift_series in
-- 20260408000000_allow_delete_locked_shifts.sql.
--
-- Without this, a manager who confirms "This shift is published" for a
-- 'following' or 'all' scope edit sees the confirm dialog, but the RPC
-- silently skips every locked shift in scope anyway — the edit for a
-- 'this'-scope shift saves, but the rest of the series does not.

DROP FUNCTION IF EXISTS update_shift_series(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, INTERVAL, INTERVAL);

CREATE OR REPLACE FUNCTION update_shift_series(
  p_parent_id UUID,
  p_restaurant_id UUID,
  p_scope TEXT, -- 'all' or 'following'
  p_updates JSONB,
  p_from_time TIMESTAMPTZ DEFAULT NULL, -- required for 'following' scope
  p_start_time_delta INTERVAL DEFAULT NULL, -- optional: offset to apply to start_time
  p_end_time_delta INTERVAL DEFAULT NULL, -- optional: offset to apply to end_time
  p_include_locked BOOLEAN DEFAULT false
)
RETURNS TABLE(updated_count INT, locked_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_count INT := 0;
  v_locked_count INT := 0;
BEGIN
  -- SECURITY DEFINER bypasses RLS, so the function must check tenancy
  -- itself. Same gate as the shifts UPDATE policy.
  IF NOT public.user_has_capability(p_restaurant_id, 'edit:scheduling') THEN
    RAISE EXCEPTION 'Access denied: you cannot edit shifts for this restaurant';
  END IF;

  IF p_scope = 'following' THEN
    -- Count locked shifts that will NOT be updated (only when not force-updating)
    IF NOT p_include_locked THEN
      SELECT COUNT(*) INTO v_locked_count
      FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND start_time >= p_from_time
        AND locked = true;
    END IF;

    -- Update shifts (include locked if requested)
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
        AND (locked = false OR p_include_locked = true)
      RETURNING id
    )
    SELECT COUNT(*) INTO v_updated_count FROM updated;
  ELSE -- 'all'
    -- Count locked shifts that will NOT be updated (only when not force-updating)
    IF NOT p_include_locked THEN
      SELECT COUNT(*) INTO v_locked_count
      FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND locked = true;
    END IF;

    -- Update shifts (include locked if requested)
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
        AND (locked = false OR p_include_locked = true)
      RETURNING id
    )
    SELECT COUNT(*) INTO v_updated_count FROM updated;
  END IF;

  RETURN QUERY SELECT v_updated_count, v_locked_count;
END;
$$;

GRANT EXECUTE ON FUNCTION update_shift_series(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, INTERVAL, INTERVAL, BOOLEAN) TO authenticated;
