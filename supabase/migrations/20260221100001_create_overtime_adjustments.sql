-- Create overtime_adjustments table for manager OT classification overrides
CREATE TABLE IF NOT EXISTS overtime_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punch_date DATE NOT NULL,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('regular_to_overtime', 'overtime_to_regular')),
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0),
  reason TEXT,
  adjusted_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate adjustments for same employee/date/type
  CONSTRAINT overtime_adjustments_unique_per_date UNIQUE (restaurant_id, employee_id, punch_date, adjustment_type)
);

-- RLS
ALTER TABLE overtime_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant overtime adjustments"
  ON overtime_adjustments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = overtime_adjustments.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage overtime adjustments"
  ON overtime_adjustments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = overtime_adjustments.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Indexes
CREATE INDEX idx_overtime_adjustments_restaurant_id ON overtime_adjustments(restaurant_id);
CREATE INDEX idx_overtime_adjustments_employee_date ON overtime_adjustments(employee_id, punch_date);
