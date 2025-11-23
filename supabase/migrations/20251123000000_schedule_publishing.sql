-- Add schedule publishing fields to shifts table
ALTER TABLE shifts 
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;

-- Create schedule_publications table to track publishing history
CREATE TABLE IF NOT EXISTS schedule_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  published_by UUID NOT NULL REFERENCES auth.users(id),
  published_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  shift_count INTEGER NOT NULL DEFAULT 0,
  notification_sent BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create schedule_change_logs table for tracking changes after publish
CREATE TABLE IF NOT EXISTS schedule_change_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL, -- 'created', 'updated', 'deleted', 'unpublished'
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  before_data JSONB,
  after_data JSONB,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_shifts_is_published ON shifts(is_published);
CREATE INDEX IF NOT EXISTS idx_shifts_published_at ON shifts(published_at);
CREATE INDEX IF NOT EXISTS idx_shifts_locked ON shifts(locked);
CREATE INDEX IF NOT EXISTS idx_schedule_publications_restaurant_id ON schedule_publications(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_schedule_publications_week_start ON schedule_publications(week_start_date);
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_restaurant_id ON schedule_change_logs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_shift_id ON schedule_change_logs(shift_id);
CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_changed_at ON schedule_change_logs(changed_at);

-- Enable Row Level Security
ALTER TABLE schedule_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_change_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for schedule_publications
CREATE POLICY "Users can view schedule publications for their restaurants"
  ON schedule_publications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_publications.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create schedule publications"
  ON schedule_publications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_publications.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- RLS Policies for schedule_change_logs
CREATE POLICY "Users can view change logs for their restaurants"
  ON schedule_change_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_change_logs.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can create change logs"
  ON schedule_change_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = schedule_change_logs.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Function to automatically log changes to published shifts
CREATE OR REPLACE FUNCTION log_shift_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log changes to published shifts
  IF (TG_OP = 'DELETE' AND OLD.is_published = true) THEN
    INSERT INTO schedule_change_logs (
      restaurant_id,
      shift_id,
      employee_id,
      change_type,
      changed_by,
      before_data
    ) VALUES (
      OLD.restaurant_id,
      OLD.id,
      OLD.employee_id,
      'deleted',
      auth.uid(),
      row_to_json(OLD)::jsonb
    );
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE' AND OLD.is_published = true) THEN
    -- If unpublishing
    IF NEW.is_published = false AND OLD.is_published = true THEN
      INSERT INTO schedule_change_logs (
        restaurant_id,
        shift_id,
        employee_id,
        change_type,
        changed_by,
        before_data,
        after_data
      ) VALUES (
        NEW.restaurant_id,
        NEW.id,
        NEW.employee_id,
        'unpublished',
        auth.uid(),
        row_to_json(OLD)::jsonb,
        row_to_json(NEW)::jsonb
      );
    ELSE
      -- Regular update to published shift
      INSERT INTO schedule_change_logs (
        restaurant_id,
        shift_id,
        employee_id,
        change_type,
        changed_by,
        before_data,
        after_data
      ) VALUES (
        NEW.restaurant_id,
        NEW.id,
        NEW.employee_id,
        'updated',
        auth.uid(),
        row_to_json(OLD)::jsonb,
        row_to_json(NEW)::jsonb
      );
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for shift changes
DROP TRIGGER IF EXISTS log_shift_changes ON shifts;
CREATE TRIGGER log_shift_changes
  AFTER UPDATE OR DELETE ON shifts
  FOR EACH ROW
  EXECUTE FUNCTION log_shift_change();

-- Function to publish a schedule for a date range
CREATE OR REPLACE FUNCTION publish_schedule(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_shift_count INTEGER;
  v_publication_id UUID;
BEGIN
  -- Count shifts to be published
  SELECT COUNT(*) INTO v_shift_count
  FROM shifts
  WHERE restaurant_id = p_restaurant_id
    AND start_time::date >= p_week_start
    AND start_time::date <= p_week_end
    AND is_published = false;

  -- Update shifts to published
  UPDATE shifts
  SET 
    is_published = true,
    locked = true,
    published_at = NOW(),
    published_by = auth.uid()
  WHERE restaurant_id = p_restaurant_id
    AND start_time::date >= p_week_start
    AND start_time::date <= p_week_end
    AND is_published = false;

  -- Create publication record
  INSERT INTO schedule_publications (
    restaurant_id,
    week_start_date,
    week_end_date,
    published_by,
    shift_count,
    notes
  ) VALUES (
    p_restaurant_id,
    p_week_start,
    p_week_end,
    auth.uid(),
    v_shift_count,
    p_notes
  ) RETURNING id INTO v_publication_id;

  RETURN v_publication_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to unpublish a schedule (for corrections)
CREATE OR REPLACE FUNCTION unpublish_schedule(
  p_restaurant_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_shift_count INTEGER;
BEGIN
  -- Update shifts to unpublished
  UPDATE shifts
  SET 
    is_published = false,
    locked = false,
    published_at = NULL,
    published_by = NULL
  WHERE restaurant_id = p_restaurant_id
    AND start_time::date >= p_week_start
    AND start_time::date <= p_week_end
    AND is_published = true;

  -- Get the count of updated rows
  GET DIAGNOSTICS v_shift_count = ROW_COUNT;

  -- Log the unpublish action
  INSERT INTO schedule_change_logs (
    restaurant_id,
    change_type,
    changed_by,
    reason
  ) VALUES (
    p_restaurant_id,
    'unpublished',
    auth.uid(),
    COALESCE(p_reason, 'Schedule unpublished for date range: ' || p_week_start || ' to ' || p_week_end)
  );

  RETURN v_shift_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment on tables and functions
COMMENT ON TABLE schedule_publications IS 'Tracks when schedules are published to employees';
COMMENT ON TABLE schedule_change_logs IS 'Audit log for all changes made to published schedules';
COMMENT ON FUNCTION publish_schedule IS 'Publishes all shifts in a date range and locks them';
COMMENT ON FUNCTION unpublish_schedule IS 'Unpublishes shifts in a date range (for corrections only)';
