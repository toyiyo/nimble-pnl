-- =====================================================
-- SHIFT PLANNER: TEMPLATE-BASED SCHEDULE BUILDING
-- Extends shift_templates, adds week templates,
-- template slots, and schedule slots.
-- =====================================================

-- =========================
-- 1. Extend shift_templates
-- =========================
-- Add color and description for visual scheduling
ALTER TABLE public.shift_templates ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.shift_templates ADD COLUMN IF NOT EXISTS description TEXT;

-- Make day_of_week nullable (shift definitions are now day-agnostic;
-- the day is assigned via week_template_slots instead)
ALTER TABLE public.shift_templates ALTER COLUMN day_of_week DROP NOT NULL;

-- Make position nullable (can be inherited from week_template_slot)
ALTER TABLE public.shift_templates ALTER COLUMN position DROP NOT NULL;

-- =========================
-- 2. Make shifts.employee_id nullable
-- =========================
-- Template-generated shifts start with no employee assigned.
-- The existing NOT NULL constraint must be relaxed.
ALTER TABLE public.shifts ALTER COLUMN employee_id DROP NOT NULL;

-- =========================
-- 3. week_templates
-- =========================
CREATE TABLE IF NOT EXISTS public.week_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 4. week_template_slots
-- =========================
CREATE TABLE IF NOT EXISTS public.week_template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_template_id UUID NOT NULL REFERENCES public.week_templates(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  position TEXT,
  headcount INTEGER NOT NULL DEFAULT 1 CHECK (headcount > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 5. schedule_slots
-- =========================
CREATE TABLE IF NOT EXISTS public.schedule_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  week_template_slot_id UUID REFERENCES public.week_template_slots(id) ON DELETE SET NULL,
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  slot_index INTEGER NOT NULL DEFAULT 0,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unfilled'
    CHECK (status IN ('unfilled', 'assigned', 'confirmed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- 6. Indexes
-- =========================
-- week_templates
CREATE INDEX IF NOT EXISTS idx_week_templates_restaurant_id
  ON public.week_templates(restaurant_id);

-- week_template_slots
CREATE INDEX IF NOT EXISTS idx_week_template_slots_week_template_id
  ON public.week_template_slots(week_template_id);
CREATE INDEX IF NOT EXISTS idx_week_template_slots_shift_template_id
  ON public.week_template_slots(shift_template_id);

-- schedule_slots
CREATE INDEX IF NOT EXISTS idx_schedule_slots_restaurant_id
  ON public.schedule_slots(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_restaurant_week
  ON public.schedule_slots(restaurant_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_schedule_slots_shift_id
  ON public.schedule_slots(shift_id);

-- Prevent duplicate schedule generation via race condition
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_slots_unique_per_week
  ON public.schedule_slots(restaurant_id, week_start_date, week_template_slot_id, slot_index);

-- =========================
-- 7. Enable RLS
-- =========================
ALTER TABLE public.week_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_slots ENABLE ROW LEVEL SECURITY;

-- =========================
-- 8. RLS Policies — week_templates
-- =========================
CREATE POLICY "Users can view week templates for their restaurants"
  ON public.week_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners/managers can insert week templates"
  ON public.week_templates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can update week templates"
  ON public.week_templates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can delete week templates"
  ON public.week_templates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = week_templates.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- =========================
-- 9. RLS Policies — week_template_slots
-- =========================
-- week_template_slots does not have restaurant_id directly;
-- access is derived via its parent week_template.

CREATE POLICY "Users can view week template slots for their restaurants"
  ON public.week_template_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
        AND ur.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners/managers can insert week template slots"
  ON public.week_template_slots FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can update week template slots"
  ON public.week_template_slots FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can delete week template slots"
  ON public.week_template_slots FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.week_templates wt
      JOIN public.user_restaurants ur ON ur.restaurant_id = wt.restaurant_id
      WHERE wt.id = week_template_slots.week_template_id
        AND ur.user_id = auth.uid()
        AND ur.role IN ('owner', 'manager')
    )
  );

-- =========================
-- 10. RLS Policies — schedule_slots
-- =========================
CREATE POLICY "Users can view schedule slots for their restaurants"
  ON public.schedule_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners/managers can insert schedule slots"
  ON public.schedule_slots FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can update schedule slots"
  ON public.schedule_slots FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners/managers can delete schedule slots"
  ON public.schedule_slots FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_slots.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- =========================
-- 11. Service role bypass for edge functions
-- =========================
GRANT ALL ON public.week_templates TO service_role;
GRANT ALL ON public.week_template_slots TO service_role;
GRANT ALL ON public.schedule_slots TO service_role;

-- =========================
-- 12. Triggers — updated_at
-- =========================
-- Reuse the existing update_scheduling_updated_at() function
-- from 20251114100000_create_scheduling_tables.sql

CREATE TRIGGER update_week_templates_updated_at
  BEFORE UPDATE ON public.week_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_week_template_slots_updated_at
  BEFORE UPDATE ON public.week_template_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

CREATE TRIGGER update_schedule_slots_updated_at
  BEFORE UPDATE ON public.schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

-- =========================
-- 13. RPC: generate_schedule_from_template
-- =========================
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
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Validate week template belongs to this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM public.week_templates
    WHERE id = p_week_template_id
      AND restaurant_id = p_restaurant_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Week template not found for this restaurant');
  END IF;

  -- Validate week_start_date is a Monday
  IF EXTRACT(ISODOW FROM p_week_start_date) != 1 THEN
    RETURN json_build_object('success', false, 'error', 'week_start_date must be a Monday');
  END IF;

  -- Check if schedule already exists for this week + restaurant
  SELECT COUNT(*) INTO v_existing_count
  FROM public.schedule_slots
  WHERE restaurant_id = p_restaurant_id
    AND week_start_date = p_week_start_date;

  IF v_existing_count > 0 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Schedule already exists for this week. Delete it first to regenerate.'
    );
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

-- =========================
-- 14. RPC: delete_generated_schedule
-- =========================
CREATE OR REPLACE FUNCTION public.delete_generated_schedule(
  p_restaurant_id UUID,
  p_week_start_date DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_ids UUID[];
  v_slots_deleted INTEGER;
BEGIN
  -- Validate caller has owner/manager role for this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM public.user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'manager')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Collect shift IDs linked to schedule_slots for this week (template-generated only)
  SELECT ARRAY_AGG(ss.shift_id) INTO v_shift_ids
  FROM public.schedule_slots ss
  JOIN public.shifts s ON s.id = ss.shift_id
  WHERE ss.restaurant_id = p_restaurant_id
    AND ss.week_start_date = p_week_start_date
    AND s.source_type = 'template';

  IF v_shift_ids IS NULL OR array_length(v_shift_ids, 1) IS NULL THEN
    RETURN json_build_object(
      'success', true,
      'slots_deleted', 0
    );
  END IF;

  v_slots_deleted := array_length(v_shift_ids, 1);

  -- Delete only template-generated schedule_slots
  DELETE FROM public.schedule_slots
  WHERE restaurant_id = p_restaurant_id
    AND week_start_date = p_week_start_date
    AND shift_id = ANY(v_shift_ids);

  -- Delete the linked shifts
  DELETE FROM public.shifts
  WHERE id = ANY(v_shift_ids);

  RETURN json_build_object(
    'success', true,
    'slots_deleted', v_slots_deleted
  );
END;
$$;
