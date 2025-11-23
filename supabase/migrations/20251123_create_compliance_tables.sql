-- Create compliance_rules table for configurable labor law rules
CREATE TABLE IF NOT EXISTS compliance_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL, -- 'minor_restrictions', 'clopening', 'rest_period', 'shift_length', 'overtime'
  rule_config JSONB NOT NULL, -- Flexible config for different rule types
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create compliance_violations table to track violations
CREATE TABLE IF NOT EXISTS compliance_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  violation_details JSONB NOT NULL, -- Details about what was violated
  severity TEXT NOT NULL DEFAULT 'warning', -- 'warning', 'error', 'critical'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'resolved', 'overridden'
  override_reason TEXT,
  overridden_by UUID REFERENCES auth.users(id),
  overridden_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_compliance_rules_restaurant_id ON compliance_rules(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_rules_rule_type ON compliance_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_compliance_violations_restaurant_id ON compliance_violations(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_violations_shift_id ON compliance_violations(shift_id);
CREATE INDEX IF NOT EXISTS idx_compliance_violations_employee_id ON compliance_violations(employee_id);
CREATE INDEX IF NOT EXISTS idx_compliance_violations_status ON compliance_violations(status);
CREATE INDEX IF NOT EXISTS idx_compliance_violations_created_at ON compliance_violations(created_at);

-- Enable Row Level Security
ALTER TABLE compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_violations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for compliance_rules table
CREATE POLICY "Users can view compliance rules for their restaurants"
  ON compliance_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = compliance_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create compliance rules for their restaurants"
  ON compliance_rules FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = compliance_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update compliance rules for their restaurants"
  ON compliance_rules FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = compliance_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete compliance rules for their restaurants"
  ON compliance_rules FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = compliance_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role = 'owner'
    )
  );

-- RLS Policies for compliance_violations table
CREATE POLICY "Users can view compliance violations for their restaurants"
  ON compliance_violations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = compliance_violations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create compliance violations for their restaurants"
  ON compliance_violations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = compliance_violations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update compliance violations for their restaurants"
  ON compliance_violations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = compliance_violations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_compliance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_compliance_rules_updated_at
  BEFORE UPDATE ON compliance_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_compliance_updated_at();

CREATE TRIGGER update_compliance_violations_updated_at
  BEFORE UPDATE ON compliance_violations
  FOR EACH ROW
  EXECUTE FUNCTION update_compliance_updated_at();

-- Add birth_date column to employees table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name='employees' AND column_name='birth_date') THEN
    ALTER TABLE employees ADD COLUMN birth_date DATE;
  END IF;
END $$;

-- Create function to check for compliance violations
CREATE OR REPLACE FUNCTION check_shift_compliance(
  p_shift_id UUID,
  p_restaurant_id UUID,
  p_employee_id UUID,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
) RETURNS JSONB AS $$
DECLARE
  v_violations JSONB := '[]'::JSONB;
  v_rule RECORD;
  v_employee RECORD;
  v_shift_duration_hours NUMERIC;
  v_previous_shift RECORD;
  v_age INTEGER;
BEGIN
  -- Get employee details
  SELECT * INTO v_employee FROM employees WHERE id = p_employee_id;
  
  -- Calculate shift duration in hours
  v_shift_duration_hours := EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600.0;
  
  -- Calculate employee age if birth_date exists
  IF v_employee.birth_date IS NOT NULL THEN
    v_age := DATE_PART('year', AGE(p_start_time::DATE, v_employee.birth_date));
  END IF;
  
  -- Check each enabled rule
  FOR v_rule IN 
    SELECT * FROM compliance_rules 
    WHERE restaurant_id = p_restaurant_id 
    AND enabled = true
  LOOP
    -- Check minor restrictions
    IF v_rule.rule_type = 'minor_restrictions' AND v_age IS NOT NULL THEN
      IF v_age < 18 AND (v_rule.rule_config->>'max_hours_per_day')::NUMERIC < v_shift_duration_hours THEN
        v_violations := v_violations || jsonb_build_object(
          'rule_type', 'minor_restrictions',
          'severity', 'error',
          'message', format('Minor (%s years old) exceeds maximum hours per day: %.1f > %s', 
                           v_age, v_shift_duration_hours, v_rule.rule_config->>'max_hours_per_day')
        );
      END IF;
    END IF;
    
    -- Check shift length limits
    IF v_rule.rule_type = 'shift_length' THEN
      IF v_shift_duration_hours > (v_rule.rule_config->>'max_hours')::NUMERIC THEN
        v_violations := v_violations || jsonb_build_object(
          'rule_type', 'shift_length',
          'severity', 'warning',
          'message', format('Shift exceeds maximum length: %.1f > %s hours', 
                           v_shift_duration_hours, v_rule.rule_config->>'max_hours')
        );
      END IF;
      
      IF v_shift_duration_hours < (v_rule.rule_config->>'min_hours')::NUMERIC THEN
        v_violations := v_violations || jsonb_build_object(
          'rule_type', 'shift_length',
          'severity', 'warning',
          'message', format('Shift below minimum length: %.1f < %s hours', 
                           v_shift_duration_hours, v_rule.rule_config->>'min_hours')
        );
      END IF;
    END IF;
    
    -- Check clopening and rest periods
    IF v_rule.rule_type IN ('clopening', 'rest_period') THEN
      -- Find the most recent shift before this one
      SELECT * INTO v_previous_shift
      FROM shifts
      WHERE employee_id = p_employee_id
      AND restaurant_id = p_restaurant_id
      AND end_time < p_start_time
      AND id != p_shift_id
      ORDER BY end_time DESC
      LIMIT 1;
      
      IF v_previous_shift.id IS NOT NULL THEN
        DECLARE
          v_hours_between NUMERIC;
        BEGIN
          v_hours_between := EXTRACT(EPOCH FROM (p_start_time - v_previous_shift.end_time)) / 3600.0;
          
          IF v_hours_between < (v_rule.rule_config->>'min_hours_between_shifts')::NUMERIC THEN
            v_violations := v_violations || jsonb_build_object(
              'rule_type', v_rule.rule_type,
              'severity', 'error',
              'message', format('Insufficient rest period: %.1f hours < %s hours required', 
                               v_hours_between, v_rule.rule_config->>'min_hours_between_shifts'),
              'previous_shift_end', v_previous_shift.end_time,
              'hours_between', v_hours_between
            );
          END IF;
        END;
      END IF;
    END IF;
  END LOOP;
  
  RETURN v_violations;
END;
$$ LANGUAGE plpgsql;

-- Insert default compliance rules for new restaurants
-- Note: These will need to be created per restaurant via the UI
-- This is just an example of what the rules might look like

COMMENT ON TABLE compliance_rules IS 'Configurable labor law compliance rules per restaurant';
COMMENT ON TABLE compliance_violations IS 'Track compliance violations and overrides';
COMMENT ON FUNCTION check_shift_compliance IS 'Check a shift against all enabled compliance rules';
