-- Compensation history to preserve historical rates for labor calculations
-- Tracks every change with an effective date instead of overwriting employees table fields

-- ============================================================================
-- Table: employee_compensation_history
-- ============================================================================
CREATE TABLE IF NOT EXISTS employee_compensation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  compensation_type TEXT NOT NULL CHECK (compensation_type IN ('hourly', 'salary', 'contractor')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  pay_period_type TEXT NULL CHECK (pay_period_type IS NULL OR pay_period_type IN ('weekly', 'bi-weekly', 'semi-monthly', 'monthly')),
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_employee_rate_per_day UNIQUE (employee_id, effective_date)
);

COMMENT ON TABLE employee_compensation_history IS 'Immutable log of compensation changes with effective dates for accurate historical labor calculations.';
COMMENT ON COLUMN employee_compensation_history.amount_cents IS 'Compensation amount in cents (hourly rate, salary per period, or contractor payment).';
COMMENT ON COLUMN employee_compensation_history.effective_date IS 'Date the new rate takes effect. One active rate per employee per day.';

-- ============================================================================
-- Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_employee_comp_history_employee ON employee_compensation_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_comp_history_restaurant_date ON employee_compensation_history(restaurant_id, effective_date);

-- ============================================================================
-- RLS: Read/Write limited to restaurant owners/managers. No update/delete to keep history immutable.
-- ============================================================================
ALTER TABLE employee_compensation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view compensation history for their restaurants"
  ON employee_compensation_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_compensation_history.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers/owners can insert compensation history for their restaurants"
  ON employee_compensation_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_compensation_history.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Intentionally omit UPDATE/DELETE policies to keep history immutable for end users

-- ============================================================================
-- Backfill existing employees with their current rate as the initial history entry
-- ============================================================================
INSERT INTO employee_compensation_history (
  employee_id,
  restaurant_id,
  compensation_type,
  amount_cents,
  pay_period_type,
  effective_date
)
SELECT
  e.id,
  e.restaurant_id,
  e.compensation_type,
  CASE 
    WHEN e.compensation_type = 'hourly' THEN e.hourly_rate
    WHEN e.compensation_type = 'salary' THEN e.salary_amount
    WHEN e.compensation_type = 'contractor' THEN e.contractor_payment_amount
  END AS amount_cents,
  CASE WHEN e.compensation_type = 'salary' THEN e.pay_period_type ELSE NULL END AS pay_period_type,
  COALESCE(e.hire_date, e.created_at::date, CURRENT_DATE) AS effective_date
FROM employees e
WHERE
  (
    (e.compensation_type = 'hourly' AND e.hourly_rate > 0) OR
    (e.compensation_type = 'salary' AND e.salary_amount IS NOT NULL AND e.salary_amount > 0 AND e.pay_period_type IS NOT NULL) OR
    (e.compensation_type = 'contractor' AND e.contractor_payment_amount IS NOT NULL AND e.contractor_payment_amount > 0)
  )
ON CONFLICT (employee_id, effective_date) DO NOTHING;
