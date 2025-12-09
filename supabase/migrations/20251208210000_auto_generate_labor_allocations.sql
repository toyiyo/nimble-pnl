-- Migration: Add automatic trigger for daily labor allocations
-- This ensures salary and contractor allocations are created automatically
-- JUST-IN-TIME: Only creates allocations for dates that are being calculated/viewed

-- First, add termination_date to employees table if it doesn't exist
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS termination_date DATE DEFAULT NULL;

COMMENT ON COLUMN employees.termination_date IS 
  'Date when employee was terminated. Used to determine end date for salary/contractor allocations.';

-- Function to generate allocations for a single date (called by calculate_daily_pnl)
CREATE OR REPLACE FUNCTION ensure_labor_allocations_for_date(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_employee RECORD;
  v_daily_amount INTEGER;
  v_days_in_period INTEGER;
  v_count INTEGER := 0;
BEGIN
  -- Process each active salary/contractor employee
  FOR v_employee IN 
    SELECT * FROM employees 
    WHERE restaurant_id = p_restaurant_id 
    AND status = 'active'
    AND compensation_type IN ('salary', 'contractor')
    AND allocate_daily = true
    -- CRITICAL: Only allocate if date is within employee tenure
    AND (hire_date IS NULL OR hire_date <= p_date)
    AND (termination_date IS NULL OR termination_date >= p_date)
  LOOP
    -- Calculate days in pay period
    v_days_in_period := CASE 
      WHEN v_employee.compensation_type = 'salary' THEN
        CASE v_employee.pay_period_type
          WHEN 'weekly' THEN 7
          WHEN 'bi-weekly' THEN 14
          WHEN 'semi-monthly' THEN 15
          WHEN 'monthly' THEN 30
          ELSE 30
        END
      ELSE -- contractor
        CASE v_employee.contractor_payment_interval
          WHEN 'weekly' THEN 7
          WHEN 'bi-weekly' THEN 14
          WHEN 'monthly' THEN 30
          ELSE 30
        END
    END;
    
    -- Calculate daily amount
    IF v_employee.compensation_type = 'salary' THEN
      v_daily_amount := COALESCE(v_employee.salary_amount, 0) / v_days_in_period;
    ELSE
      -- Skip per-job contractors (they need manual allocation)
      IF v_employee.contractor_payment_interval = 'per-job' THEN
        CONTINUE;
      END IF;
      v_daily_amount := COALESCE(v_employee.contractor_payment_amount, 0) / v_days_in_period;
    END IF;
    
    -- Skip if no amount to allocate
    IF v_daily_amount <= 0 THEN
      CONTINUE;
    END IF;
    
    -- Generate allocation for this specific date only
    INSERT INTO daily_labor_allocations (
      restaurant_id, 
      employee_id, 
      date, 
      allocated_cost, 
      compensation_type, 
      source
    ) VALUES (
      p_restaurant_id, 
      v_employee.id, 
      p_date, 
      v_daily_amount, 
      v_employee.compensation_type, 
      'auto'
    )
    ON CONFLICT (employee_id, date) DO UPDATE SET
      allocated_cost = EXCLUDED.allocated_cost,
      compensation_type = EXCLUDED.compensation_type,
      updated_at = NOW();
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;

-- Update calculate_daily_pnl to ensure allocations exist before calculating
-- This is the KEY: allocations are created just-in-time when P&L is calculated
CREATE OR REPLACE FUNCTION calculate_daily_pnl_with_allocations(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pnl_id UUID;
BEGIN
  -- Step 1: Ensure salary/contractor allocations exist for this date
  PERFORM ensure_labor_allocations_for_date(p_restaurant_id, p_date);
  
  -- Step 2: Call the original calculate_daily_pnl function
  SELECT calculate_daily_pnl(p_restaurant_id, p_date) INTO v_pnl_id;
  
  RETURN v_pnl_id;
END;
$$;

-- Helper function for backfilling historical dates (one-time use or manual)
CREATE OR REPLACE FUNCTION backfill_labor_allocations(
  p_restaurant_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  date DATE,
  allocations_created INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_date DATE;
  v_count INTEGER;
BEGIN
  v_date := p_start_date;
  WHILE v_date <= p_end_date LOOP
    SELECT ensure_labor_allocations_for_date(p_restaurant_id, v_date) INTO v_count;
    
    date := v_date;
    allocations_created := v_count;
    RETURN NEXT;
    
    v_date := v_date + 1;
  END LOOP;
  
  RETURN;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION ensure_labor_allocations_for_date(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_daily_pnl_with_allocations(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION backfill_labor_allocations(UUID, DATE, DATE) TO authenticated;

-- Add helpful comments
COMMENT ON FUNCTION ensure_labor_allocations_for_date(UUID, DATE) IS 
  'Generates daily labor allocations for a specific date. Only creates allocations for employees who were active on that date (hire_date <= date <= termination_date). IMPORTANT: Should be called daily by a cron job (Edge Function: generate-daily-allocations).';

COMMENT ON FUNCTION calculate_daily_pnl_with_allocations(UUID, DATE) IS 
  'Wrapper around calculate_daily_pnl that ensures salary/contractor allocations exist before calculating P&L. Use this instead of calling calculate_daily_pnl directly.';

COMMENT ON FUNCTION backfill_labor_allocations(UUID, DATE, DATE) IS 
  'One-time backfill function to generate allocations for historical dates. Should be called manually or via a one-time script, not automatically.';

-- =============================================================================
-- CRON JOB SETUP - Automated Daily Allocations
-- =============================================================================
--
-- This migration creates the functions AND schedules a daily cron job.
-- 
-- The cron job will:
-- - Run every day at 2 AM
-- - Call the Edge Function: generate-daily-allocations
-- - For each restaurant
-- - Generate allocations for salary/contractor employees active TODAY
--
-- This ensures:
-- ✓ Payroll data is always up-to-date
-- ✓ Dashboard shows accurate labor costs
-- ✓ No manual intervention required
-- ✓ Allocations respect hire/termination dates
-- =============================================================================

-- Unschedule existing job if it exists (for idempotency)
DO $migration$
BEGIN
  -- Try to unschedule, ignore if doesn't exist
  PERFORM cron.unschedule('generate-daily-labor-allocations');
EXCEPTION
  WHEN OTHERS THEN
    -- Job doesn't exist, that's fine
    NULL;
END
$migration$;

-- Schedule the daily allocation generation
-- Runs at 2 AM every day
-- NOTE: This will only work in production with pg_cron enabled
-- For local development, the allocations are generated just-in-time
DO $migration$
BEGIN
  PERFORM cron.schedule(
    'generate-daily-labor-allocations',
    '0 2 * * *',
    $cron$
    select
      net.http_post(
          url:='https://ncdujvdgqtaunuyigflp.supabase.co/functions/v1/generate-daily-allocations',
          headers:='{"Content-Type": "application/json"}'::jsonb,
          body:='{"scheduled": true}'::jsonb
      ) as request_id;
    $cron$
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Cron not available in local dev, that's fine
    RAISE NOTICE 'Cron job scheduling skipped (likely local development environment)';
END
$migration$;

COMMENT ON EXTENSION pg_cron IS 
  'Cron job: generate-daily-labor-allocations runs daily at 2 AM to ensure payroll allocations are always current.';

