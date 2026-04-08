-- Schedule Plan Templates: save/apply weekly schedule snapshots

-- 1. Table
CREATE TABLE schedule_plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shifts JSONB NOT NULL,
  shift_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_plan_templates_restaurant
  ON schedule_plan_templates(restaurant_id);

CREATE TRIGGER update_schedule_plan_templates_updated_at
  BEFORE UPDATE ON schedule_plan_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. RLS
ALTER TABLE schedule_plan_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant templates"
  ON schedule_plan_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_plan_templates.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their restaurant templates"
  ON schedule_plan_templates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_plan_templates.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their restaurant templates"
  ON schedule_plan_templates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_plan_templates.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

-- 3. Save RPC — advisory lock prevents TOCTOU race on empty table
CREATE OR REPLACE FUNCTION save_schedule_plan_template(
  p_restaurant_id UUID,
  p_name TEXT,
  p_shifts JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
  v_shift_count INT;
  v_result schedule_plan_templates%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_shift_count := jsonb_array_length(p_shifts);
  IF v_shift_count = 0 THEN
    RAISE EXCEPTION 'Cannot save an empty schedule template';
  END IF;

  -- Advisory lock keyed to restaurant_id — works even when table is empty
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_restaurant_id::text || '_sched_tmpl'), 1, 16))::bit(64)::bigint
  );

  SELECT count(*) INTO v_count
  FROM schedule_plan_templates
  WHERE restaurant_id = p_restaurant_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Maximum of 5 schedule templates allowed. Delete one to save a new one.';
  END IF;

  INSERT INTO schedule_plan_templates (restaurant_id, name, shifts, shift_count)
  VALUES (p_restaurant_id, p_name, p_shifts, v_shift_count)
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'id', v_result.id,
    'name', v_result.name,
    'shift_count', v_result.shift_count,
    'created_at', v_result.created_at
  );
END;
$$;

-- 4. Apply RPC — accepts pre-computed timestamptz shifts from client (DST-safe)
-- Pattern matches copy_week_shifts: client builds timestamps, server does atomic insert.
CREATE OR REPLACE FUNCTION apply_schedule_plan_template(
  p_restaurant_id UUID,
  p_target_start TIMESTAMPTZ,
  p_target_end   TIMESTAMPTZ,
  p_shifts       JSONB,
  p_merge_mode   TEXT DEFAULT 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INT := 0;
  v_inserted_count INT := 0;
  v_total INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_total := jsonb_array_length(p_shifts);

  -- Replace mode: delete unlocked shifts in target range (same as copy_week_shifts)
  IF p_merge_mode = 'replace' THEN
    DELETE FROM shifts
    WHERE restaurant_id = p_restaurant_id
      AND locked = false
      AND start_time >= p_target_start
      AND start_time <= p_target_end;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- Insert all shifts
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
    FROM jsonb_array_elements(p_shifts) AS elem;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  ELSIF p_merge_mode = 'merge' THEN
    -- Merge: insert only non-overlapping shifts
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
    WHERE NOT EXISTS (
      SELECT 1 FROM shifts s
      WHERE s.restaurant_id = p_restaurant_id
        AND s.employee_id = (elem->>'employee_id')::uuid
        AND s.start_time < (elem->>'end_time')::timestamptz
        AND s.end_time > (elem->>'start_time')::timestamptz
    );

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  ELSE
    RAISE EXCEPTION 'Invalid merge_mode: %. Use replace or merge.', p_merge_mode;
  END IF;

  RETURN jsonb_build_object(
    'inserted_count', v_inserted_count,
    'skipped_count', v_total - v_inserted_count,
    'deleted_count', v_deleted_count
  );
END;
$$;

-- 5. Delete RPC — raises exception if not found
CREATE OR REPLACE FUNCTION delete_schedule_plan_template(
  p_restaurant_id UUID,
  p_template_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM schedule_plan_templates
  WHERE id = p_template_id AND restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;
END;
$$;
