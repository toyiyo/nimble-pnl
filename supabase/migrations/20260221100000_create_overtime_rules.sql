-- Create overtime_rules table for per-restaurant overtime configuration
CREATE TABLE IF NOT EXISTS overtime_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  weekly_threshold_hours NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  weekly_ot_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,
  daily_threshold_hours NUMERIC(5,2) DEFAULT NULL,
  daily_ot_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.50,
  daily_double_threshold_hours NUMERIC(5,2) DEFAULT NULL,
  daily_double_multiplier NUMERIC(3,2) NOT NULL DEFAULT 2.00,
  exclude_tips_from_ot_rate BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One config per restaurant
  CONSTRAINT overtime_rules_restaurant_id_unique UNIQUE (restaurant_id),

  -- Multipliers must be positive
  CONSTRAINT overtime_rules_weekly_multiplier_positive CHECK (weekly_ot_multiplier > 0),
  CONSTRAINT overtime_rules_daily_multiplier_positive CHECK (daily_ot_multiplier > 0),
  CONSTRAINT overtime_rules_double_multiplier_positive CHECK (daily_double_multiplier > 0),

  -- Thresholds must be non-negative
  CONSTRAINT overtime_rules_weekly_threshold_gte_zero CHECK (weekly_threshold_hours >= 0),
  CONSTRAINT overtime_rules_daily_threshold_gte_zero CHECK (daily_threshold_hours IS NULL OR daily_threshold_hours >= 0),
  CONSTRAINT overtime_rules_double_threshold_gte_zero CHECK (daily_double_threshold_hours IS NULL OR daily_double_threshold_hours >= 0),

  -- Double-time threshold must be greater than daily threshold when both set
  CONSTRAINT overtime_rules_double_gt_daily CHECK (
    daily_double_threshold_hours IS NULL
    OR daily_threshold_hours IS NULL
    OR daily_double_threshold_hours > daily_threshold_hours
  )
);

-- RLS
ALTER TABLE overtime_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their restaurant overtime rules"
  ON overtime_rules FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM restaurant_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage overtime rules"
  ON overtime_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM restaurant_users
      WHERE restaurant_users.restaurant_id = overtime_rules.restaurant_id
      AND restaurant_users.user_id = auth.uid()
      AND restaurant_users.role IN ('owner', 'manager')
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_overtime_rules_updated_at
  BEFORE UPDATE ON overtime_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index
CREATE INDEX idx_overtime_rules_restaurant_id ON overtime_rules(restaurant_id);
