-- Create time_punches table for employee clock in/out with selfie photos
CREATE TABLE IF NOT EXISTS public.time_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  punch_type TEXT NOT NULL CHECK (punch_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  punch_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  location JSONB, -- {latitude: number, longitude: number}
  device_info TEXT,
  photo_path TEXT, -- Storage path in time-clock-photos bucket
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  modified_by UUID REFERENCES auth.users(id)
);

-- Create indexes for time_punches
CREATE INDEX IF NOT EXISTS idx_time_punches_restaurant ON public.time_punches(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_employee ON public.time_punches(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_shift ON public.time_punches(shift_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_time ON public.time_punches(punch_time);
CREATE INDEX IF NOT EXISTS idx_time_punches_type ON public.time_punches(punch_type);

-- Enable RLS on time_punches
ALTER TABLE public.time_punches ENABLE ROW LEVEL SECURITY;

-- RLS policies for time_punches
DROP POLICY IF EXISTS "Users can view time punches for their restaurants" ON public.time_punches;
CREATE POLICY "Users can view time punches for their restaurants"
  ON public.time_punches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert time punches for their restaurants" ON public.time_punches;
CREATE POLICY "Users can insert time punches for their restaurants"
  ON public.time_punches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can update time punches" ON public.time_punches;
CREATE POLICY "Managers can update time punches"
  ON public.time_punches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can delete time punches" ON public.time_punches;
CREATE POLICY "Managers can delete time punches"
  ON public.time_punches FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = time_punches.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Upgrade employee_tips table to add stricter constraints
-- Add NOT NULL constraints to created_at and updated_at if they're missing
DO $$ 
BEGIN
  -- Set NOT NULL on created_at
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'employee_tips' 
    AND column_name = 'created_at'
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.employee_tips ALTER COLUMN created_at SET NOT NULL;
  END IF;

  -- Set NOT NULL on updated_at
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'employee_tips' 
    AND column_name = 'updated_at'
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.employee_tips ALTER COLUMN updated_at SET NOT NULL;
  END IF;
END $$;

-- Create indexes for employee_tips
CREATE INDEX IF NOT EXISTS idx_employee_tips_restaurant ON public.employee_tips(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_employee_tips_employee ON public.employee_tips(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_tips_shift ON public.employee_tips(shift_id);
CREATE INDEX IF NOT EXISTS idx_employee_tips_recorded ON public.employee_tips(recorded_at);

-- Enable RLS on employee_tips
ALTER TABLE public.employee_tips ENABLE ROW LEVEL SECURITY;

-- RLS policies for employee_tips
DROP POLICY IF EXISTS "Users can view tips for their restaurants" ON public.employee_tips;
CREATE POLICY "Users can view tips for their restaurants"
  ON public.employee_tips FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert tips for their restaurants" ON public.employee_tips;
CREATE POLICY "Users can insert tips for their restaurants"
  ON public.employee_tips FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Managers can update tips" ON public.employee_tips;
CREATE POLICY "Managers can update tips"
  ON public.employee_tips FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Managers can delete tips" ON public.employee_tips;
CREATE POLICY "Managers can delete tips"
  ON public.employee_tips FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_tips.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Create storage bucket for time clock photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'time-clock-photos',
  'time-clock-photos',
  false,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for time-clock-photos bucket
DROP POLICY IF EXISTS "Users can view photos for their restaurants" ON storage.objects;
CREATE POLICY "Users can view photos for their restaurants"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'time-clock-photos'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND (storage.foldername(name))[1] = user_restaurants.restaurant_id::text
    )
  );

DROP POLICY IF EXISTS "Users can upload photos for their restaurants" ON storage.objects;
CREATE POLICY "Users can upload photos for their restaurants"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'time-clock-photos'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND (storage.foldername(name))[1] = user_restaurants.restaurant_id::text
    )
  );

DROP POLICY IF EXISTS "Managers can delete photos" ON storage.objects;
CREATE POLICY "Managers can delete photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'time-clock-photos'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
      AND (storage.foldername(name))[1] = user_restaurants.restaurant_id::text
    )
  );

-- Helper function to get employee punch status
CREATE OR REPLACE FUNCTION public.get_employee_punch_status(p_employee_id UUID)
RETURNS TABLE (
  is_clocked_in BOOLEAN,
  last_punch_time TIMESTAMPTZ,
  last_punch_type TEXT,
  on_break BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH allowed_employee AS (
    SELECT e.id
    FROM public.employees e
    JOIN public.user_restaurants ur
      ON ur.restaurant_id = e.restaurant_id
    WHERE e.id = p_employee_id
      AND ur.user_id = auth.uid()
  ),
  latest_punch AS (
    SELECT tp.punch_type, tp.punch_time
    FROM public.time_punches tp
    JOIN allowed_employee ae ON tp.employee_id = ae.id
    ORDER BY tp.punch_time DESC
    LIMIT 1
  )
  SELECT
    CASE
      WHEN lp.punch_type IN ('clock_in', 'break_end') THEN true
      ELSE false
    END AS is_clocked_in,
    lp.punch_time AS last_punch_time,
    lp.punch_type AS last_punch_type,
    CASE
      WHEN lp.punch_type = 'break_start' THEN true
      ELSE false
    END AS on_break
  FROM latest_punch lp;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to calculate worked hours
CREATE OR REPLACE FUNCTION public.calculate_worked_hours(
  p_employee_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  total_hours NUMERIC,
  regular_hours NUMERIC,
  break_hours NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH allowed_employee AS (
    SELECT e.id
    FROM public.employees e
    JOIN public.user_restaurants ur
      ON ur.restaurant_id = e.restaurant_id
    WHERE e.id = p_employee_id
      AND ur.user_id = auth.uid()
  ),
  punch_pairs AS (
    SELECT
      tp.punch_time AS start_time,
      tp.punch_type,
      LEAD(tp.punch_time) OVER (ORDER BY tp.punch_time) AS end_time,
      LEAD(tp.punch_type) OVER (ORDER BY tp.punch_time) AS next_type
    FROM public.time_punches tp
    JOIN allowed_employee ae ON tp.employee_id = ae.id
    WHERE tp.punch_time BETWEEN p_start_date AND p_end_date
    ORDER BY tp.punch_time
  ),
  work_periods AS (
    SELECT
      EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 AS hours,
      CASE
        WHEN punch_type = 'clock_in' AND next_type = 'clock_out' THEN 'work'
        WHEN punch_type = 'break_start' AND next_type = 'break_end' THEN 'break'
        ELSE 'other'
      END AS period_type
    FROM punch_pairs
    WHERE end_time IS NOT NULL
  )
  SELECT
    COALESCE(SUM(hours), 0) AS total_hours,
    COALESCE(SUM(CASE WHEN period_type = 'work' THEN hours ELSE 0 END), 0) AS regular_hours,
    COALESCE(SUM(CASE WHEN period_type = 'break' THEN hours ELSE 0 END), 0) AS break_hours
  FROM work_periods;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_time_punches_updated_at ON public.time_punches;
CREATE TRIGGER update_time_punches_updated_at
  BEFORE UPDATE ON public.time_punches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_employee_tips_updated_at ON public.employee_tips;
CREATE TRIGGER update_employee_tips_updated_at
  BEFORE UPDATE ON public.employee_tips
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';