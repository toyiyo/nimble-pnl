-- Fix the recurrence_parent_id foreign key to use SET NULL instead of CASCADE
-- This prevents locked child shifts from being deleted when the parent is deleted
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_recurrence_parent_id_fkey;
ALTER TABLE shifts ADD CONSTRAINT shifts_recurrence_parent_id_fkey
  FOREIGN KEY (recurrence_parent_id) REFERENCES shifts(id) ON DELETE SET NULL;

-- Revert delete_shift_series to simpler logic (now that FK won't cascade delete)
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

GRANT EXECUTE ON FUNCTION delete_shift_series TO authenticated;
