-- Migration: Add non-hourly compensation types (salary, contractor)
-- Supports hourly, salary, and contractor payment structures
-- 
-- ARCHITECTURAL NOTE: This migration adds schema support for non-hourly employees.
-- Labor costs are calculated ON-DEMAND from source tables (see useLaborCostsFromTimeTracking hook).
-- The daily_labor_allocations table stores ONLY user-created per-job contractor payments (source='per-job').
-- 
-- ❌ DO NOT use this table for auto-generated aggregations
-- ✅ USE source tables directly: time_punches + employees + daily_labor_allocations (per-job only)

-- ============================================================================
-- STEP 1: Add compensation type fields to employees table
-- ============================================================================

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS compensation_type TEXT NOT NULL DEFAULT 'hourly'
    CHECK (compensation_type IN ('hourly', 'salary', 'contractor')),
  ADD COLUMN IF NOT EXISTS salary_amount INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pay_period_type TEXT DEFAULT NULL
    CHECK (pay_period_type IS NULL OR pay_period_type IN ('weekly', 'bi-weekly', 'semi-monthly', 'monthly')),
  ADD COLUMN IF NOT EXISTS contractor_payment_amount INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS contractor_payment_interval TEXT DEFAULT NULL
    CHECK (contractor_payment_interval IS NULL OR contractor_payment_interval IN ('weekly', 'bi-weekly', 'monthly', 'per-job')),
  ADD COLUMN IF NOT EXISTS allocate_daily BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tip_eligible BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS requires_time_punch BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS termination_date DATE DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN employees.compensation_type IS 
  'hourly: wages from time punches, salary: fixed periodic amount, contractor: fixed payment';
COMMENT ON COLUMN employees.salary_amount IS 
  'For salary employees: amount per pay period in cents';
COMMENT ON COLUMN employees.pay_period_type IS 
  'For salary employees: weekly, bi-weekly, semi-monthly, or monthly';
COMMENT ON COLUMN employees.contractor_payment_amount IS 
  'For contractors: payment amount per interval in cents';
COMMENT ON COLUMN employees.contractor_payment_interval IS 
  'For contractors: weekly, bi-weekly, monthly, or per-job';
COMMENT ON COLUMN employees.allocate_daily IS 
  'DEPRECATED - No longer used. Labor costs are calculated on-demand from source tables.';
COMMENT ON COLUMN employees.tip_eligible IS 
  'Whether employee can receive tips';
COMMENT ON COLUMN employees.requires_time_punch IS 
  'Whether employee must clock in/out (typically false for salary/contractor)';
COMMENT ON COLUMN employees.termination_date IS 
  'Date when employee was terminated. Used to determine end date for salary/contractor allocations.';

-- ============================================================================
-- STEP 2: Create daily_labor_allocations table
-- ============================================================================
-- 
-- PURPOSE: Store user-created per-job contractor payments ONLY
-- 
-- CRITICAL: This is NOT an aggregation table. Only stores source records where source='per-job'
-- Auto-generated allocations (source='auto') are DEPRECATED - calculate on-demand instead
--
-- USAGE:
--   ✅ INSERT per-job contractor payments via Payroll UI (source='per-job')
--   ✅ QUERY where source='per-job' for Dashboard labor cost calculations
--   ❌ DO NOT auto-generate allocations (no cron jobs, no Edge Functions)
--   ❌ DO NOT query source='auto' records (deprecated)

CREATE TABLE IF NOT EXISTS daily_labor_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  allocated_cost INTEGER NOT NULL DEFAULT 0, -- In cents
  compensation_type TEXT NOT NULL CHECK (compensation_type IN ('salary', 'contractor')),
  source TEXT DEFAULT 'per-job' CHECK (source IN ('auto', 'manual', 'per-job')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_employee_allocation_date UNIQUE (employee_id, date)
);

COMMENT ON TABLE daily_labor_allocations IS 
  'Stores per-job contractor payments ONLY (source=per-job). DO NOT use for auto-generated allocations. Calculate labor costs on-demand from source tables (time_punches + employees).';

COMMENT ON COLUMN daily_labor_allocations.source IS 
  'per-job: User-created contractor payment (✅ USE THIS), auto: DEPRECATED aggregation (❌ DO NOT USE), manual: Legacy';

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_daily_labor_allocations_restaurant_date 
  ON daily_labor_allocations(restaurant_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_labor_allocations_employee 
  ON daily_labor_allocations(employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_labor_allocations_date 
  ON daily_labor_allocations(date);
CREATE INDEX IF NOT EXISTS idx_daily_labor_allocations_source
  ON daily_labor_allocations(source);

-- ============================================================================
-- STEP 3: Row Level Security Policies
-- ============================================================================

ALTER TABLE daily_labor_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view allocations for their restaurants"
  ON daily_labor_allocations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert allocations for their restaurants"
  ON daily_labor_allocations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can update allocations for their restaurants"
  ON daily_labor_allocations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Users can delete allocations for their restaurants"
  ON daily_labor_allocations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = daily_labor_allocations.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- 
-- What was removed from original migrations:
-- ❌ generate_daily_labor_allocations() - No longer needed (calculate on-demand)
-- ❌ get_daily_labor_summary() - No longer needed (use useLaborCostsFromTimeTracking)
-- ❌ ensure_labor_allocations_for_date() - No longer needed (calculate on-demand)
-- ❌ calculate_daily_pnl_with_allocations() - No longer needed (use source tables)
-- ❌ backfill_labor_allocations() - No longer needed (no aggregations)
-- ❌ Cron job scheduling - No longer needed (no auto-generation)
-- 
-- What to use instead:
-- ✅ useLaborCostsFromTimeTracking hook (src/hooks/useLaborCostsFromTimeTracking.tsx)
-- ✅ usePayroll hook (src/hooks/usePayroll.tsx)
-- ✅ Query time_punches, employees, and daily_labor_allocations (source='per-job') directly
-- 
-- See: docs/LABOR_COST_CALCULATION_REFACTOR.md for full context
