-- Allow deleting locked (published) shifts when explicitly requested.
-- Adds p_include_locked parameter to delete_shift_series function.
-- When true, locked shifts are deleted and locked_count returns 0.

-- Drop old 4-param signature to avoid overload ambiguity
DROP FUNCTION IF EXISTS delete_shift_series(UUID, UUID, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION delete_shift_series(
  p_parent_id UUID,
  p_restaurant_id UUID,
  p_scope TEXT, -- 'all' or 'following'
  p_from_time TIMESTAMPTZ DEFAULT NULL, -- required for 'following' scope
  p_include_locked BOOLEAN DEFAULT false
)
RETURNS TABLE(deleted_count INT, locked_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INT := 0;
  v_locked_count INT := 0;
BEGIN
  IF p_scope = 'following' THEN
    -- Count locked shifts that will NOT be deleted (only when not force-deleting)
    IF NOT p_include_locked THEN
      SELECT COUNT(*) INTO v_locked_count
      FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND start_time >= p_from_time
        AND locked = true;
    END IF;

    -- Delete shifts (include locked if requested)
    WITH deleted AS (
      DELETE FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND start_time >= p_from_time
        AND (locked = false OR p_include_locked = true)
      RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  ELSE -- 'all'
    -- Count locked shifts that will NOT be deleted (only when not force-deleting)
    IF NOT p_include_locked THEN
      SELECT COUNT(*) INTO v_locked_count
      FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND locked = true;
    END IF;

    -- Delete shifts (include locked if requested)
    WITH deleted AS (
      DELETE FROM shifts
      WHERE (id = p_parent_id OR recurrence_parent_id = p_parent_id)
        AND restaurant_id = p_restaurant_id
        AND (locked = false OR p_include_locked = true)
      RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  END IF;

  RETURN QUERY SELECT v_deleted_count, v_locked_count;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_shift_series TO authenticated;
