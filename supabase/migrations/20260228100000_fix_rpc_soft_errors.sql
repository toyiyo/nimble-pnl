-- =====================================================
-- FIX: generate_schedule_from_template soft errors
-- Replace JSON-based error returns with RAISE EXCEPTION
-- so that the Supabase client surfaces them as real errors.
-- =====================================================

CREATE OR REPLACE FUNCTION public.generate_schedule_from_template(
  p_restaurant_id UUID,
  p_week_template_id UUID,
  p_week_start_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot RECORD;
  v_shift_id UUID;
  v_schedule_slot_id UUID;
  v_actual_date DATE;
  v_start_ts TIMESTAMPTZ;
  v_end_ts TIMESTAMPTZ;
  v_position TEXT;
  v_slots_created INTEGER := 0;
  v_existing_count INTEGER;
  v_headcount_idx INTEGER;
BEGIN
  -- Validate caller has owner/manager role for this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to generate schedules for this restaurant';
  END IF;

  -- Validate week template belongs to this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM public.week_templates
    WHERE id = p_week_template_id
      AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Week template not found for this restaurant';
  END IF;

  -- Validate week_start_date is a Monday
  IF EXTRACT(ISODOW FROM p_week_start_date) != 1 THEN
    RAISE EXCEPTION 'Week start date must be a Monday';
  END IF;

  -- Check if schedule already exists for this week + restaurant
  SELECT COUNT(*) INTO v_existing_count
  FROM public.schedule_slots
  WHERE restaurant_id = p_restaurant_id
    AND week_start_date = p_week_start_date;

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Schedule already exists for this week. Delete it first to regenerate.';
  END IF;

  -- Iterate through all slots in the week template
  FOR v_slot IN
    SELECT
      wts.id AS slot_id,
      wts.day_of_week,
      wts.position AS slot_position,
      wts.headcount,
      st.start_time,
      st.end_time,
      st.break_duration,
      st.position AS template_position,
      st.restaurant_id AS template_restaurant_id
    FROM public.week_template_slots wts
    JOIN public.shift_templates st ON st.id = wts.shift_template_id
    WHERE wts.week_template_id = p_week_template_id
    ORDER BY wts.day_of_week, wts.sort_order
  LOOP
    -- Calculate actual date from week_start_date + day_of_week offset
    -- week starts Monday (day_of_week: 0=Sun, 1=Mon, ..., 6=Sat)
    -- Monday = +0, Tuesday = +1, ..., Saturday = +5, Sunday = +6
    CASE v_slot.day_of_week
      WHEN 1 THEN v_actual_date := p_week_start_date;          -- Monday
      WHEN 2 THEN v_actual_date := p_week_start_date + 1;      -- Tuesday
      WHEN 3 THEN v_actual_date := p_week_start_date + 2;      -- Wednesday
      WHEN 4 THEN v_actual_date := p_week_start_date + 3;      -- Thursday
      WHEN 5 THEN v_actual_date := p_week_start_date + 4;      -- Friday
      WHEN 6 THEN v_actual_date := p_week_start_date + 5;      -- Saturday
      WHEN 0 THEN v_actual_date := p_week_start_date + 6;      -- Sunday
      ELSE v_actual_date := p_week_start_date;
    END CASE;

    -- Build timestamps from date + time
    v_start_ts := v_actual_date + v_slot.start_time;
    v_end_ts := v_actual_date + v_slot.end_time;

    -- If end_time <= start_time, the shift crosses midnight
    IF v_end_ts <= v_start_ts THEN
      v_end_ts := v_end_ts + INTERVAL '1 day';
    END IF;

    -- Determine position: slot override > template position > fallback
    v_position := COALESCE(v_slot.slot_position, v_slot.template_position, 'General');

    -- Create one shift + schedule_slot per headcount unit
    FOR v_headcount_idx IN 0 .. (v_slot.headcount - 1) LOOP
      -- Create the shift row (unassigned)
      INSERT INTO public.shifts (
        restaurant_id,
        employee_id,
        start_time,
        end_time,
        break_duration,
        position,
        status,
        source_type,
        source_id
      ) VALUES (
        p_restaurant_id,
        NULL,
        v_start_ts,
        v_end_ts,
        COALESCE(v_slot.break_duration, 0),
        v_position,
        'scheduled',
        'template',
        v_slot.slot_id::TEXT || '-' || p_week_start_date::TEXT || '-' || v_headcount_idx::TEXT
      )
      RETURNING id INTO v_shift_id;

      -- Create the schedule_slot row
      INSERT INTO public.schedule_slots (
        restaurant_id,
        week_template_slot_id,
        shift_id,
        week_start_date,
        slot_index,
        employee_id,
        status
      ) VALUES (
        p_restaurant_id,
        v_slot.slot_id,
        v_shift_id,
        p_week_start_date,
        v_headcount_idx,
        NULL,
        'unfilled'
      );

      v_slots_created := v_slots_created + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'slots_created', v_slots_created
  );
END;
$$;
