-- Atomic copy-week-shifts RPC: deletes unlocked target-week shifts and inserts
-- new ones in a single transaction so partial failures cannot corrupt data.

CREATE OR REPLACE FUNCTION copy_week_shifts(
  p_restaurant_id uuid,
  p_target_start timestamptz,
  p_target_end   timestamptz,
  p_shifts       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count int;
  v_inserted_count int;
BEGIN
  -- 1. Delete existing non-locked shifts in the target range
  DELETE FROM shifts
  WHERE restaurant_id = p_restaurant_id
    AND locked = false
    AND start_time >= p_target_start
    AND start_time <= p_target_end;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- 2. Insert new shifts from the JSONB array
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
    'scheduled'::text,
    false,
    false
  FROM jsonb_array_elements(p_shifts) AS elem;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_count', v_deleted_count,
    'copied_count', v_inserted_count
  );
END;
$$;
