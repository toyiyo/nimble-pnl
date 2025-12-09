-- Migration: Add RPC functions for manual contractor payments
-- These functions handle payments from daily_labor_allocations with source 'per-job' or 'manual'

-- Function to fetch manual payments
CREATE OR REPLACE FUNCTION get_manual_payments(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  id UUID,
  employee_id UUID,
  date DATE,
  allocated_cost INTEGER,
  notes TEXT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id,
    employee_id,
    date,
    allocated_cost,
    notes
  FROM daily_labor_allocations
  WHERE restaurant_id = p_restaurant_id
    AND source IN ('per-job', 'manual')
    AND date >= p_start_date
    AND date <= p_end_date
  ORDER BY date DESC;
$$;

-- Function to insert a manual payment
CREATE OR REPLACE FUNCTION insert_manual_payment(
  p_restaurant_id UUID,
  p_employee_id UUID,
  p_date DATE,
  p_amount INTEGER,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO daily_labor_allocations (
    restaurant_id,
    employee_id,
    date,
    allocated_cost,
    compensation_type,
    source,
    notes
  ) VALUES (
    p_restaurant_id,
    p_employee_id,
    p_date,
    p_amount,
    'contractor',
    'per-job',
    p_notes
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$$;

-- Function to delete a manual payment
CREATE OR REPLACE FUNCTION delete_manual_payment(
  p_payment_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted BOOLEAN := FALSE;
BEGIN
  DELETE FROM daily_labor_allocations
  WHERE id = p_payment_id
    AND source IN ('per-job', 'manual')
  RETURNING TRUE INTO v_deleted;
  
  RETURN COALESCE(v_deleted, FALSE);
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION get_manual_payments(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_manual_payment(UUID, UUID, DATE, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_manual_payment(UUID) TO authenticated;

COMMENT ON FUNCTION get_manual_payments IS 'Fetches manual contractor payments for a date range. Used by payroll to include per-job contractor payments.';
COMMENT ON FUNCTION insert_manual_payment IS 'Inserts a new manual payment for a per-job contractor.';
COMMENT ON FUNCTION delete_manual_payment IS 'Deletes a manual payment record.';
