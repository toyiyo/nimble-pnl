-- Create overtime_rules table for managing OT thresholds per restaurant
CREATE TABLE IF NOT EXISTS overtime_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  daily_threshold_minutes INTEGER NOT NULL DEFAULT 480, -- 8 hours default
  weekly_threshold_minutes INTEGER NOT NULL DEFAULT 2400, -- 40 hours default
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_restaurant_ot_rule UNIQUE (restaurant_id)
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_overtime_rules_restaurant_id ON overtime_rules(restaurant_id);

-- Enable Row Level Security
ALTER TABLE overtime_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for overtime_rules table
CREATE POLICY "Users can view overtime rules for their restaurants"
  ON overtime_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = overtime_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create overtime rules for their restaurants"
  ON overtime_rules FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = overtime_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update overtime rules for their restaurants"
  ON overtime_rules FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = overtime_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete overtime rules for their restaurants"
  ON overtime_rules FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = overtime_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role = 'owner'
    )
  );

-- Create trigger for updated_at
CREATE TRIGGER update_overtime_rules_updated_at
  BEFORE UPDATE ON overtime_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_updated_at();

-- Insert default overtime rules for existing restaurants
INSERT INTO overtime_rules (restaurant_id, daily_threshold_minutes, weekly_threshold_minutes, enabled)
SELECT id, 480, 2400, true
FROM restaurants
WHERE id NOT IN (SELECT restaurant_id FROM overtime_rules)
ON CONFLICT (restaurant_id) DO NOTHING;
