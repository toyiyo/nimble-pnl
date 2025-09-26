BEGIN;

-- Drop generated columns that depend on the columns we need to alter
ALTER TABLE public.daily_pnl
  DROP COLUMN IF EXISTS gross_profit,
  DROP COLUMN IF EXISTS prime_cost,
  DROP COLUMN IF EXISTS food_cost_percentage,
  DROP COLUMN IF EXISTS labor_cost_percentage,
  DROP COLUMN IF EXISTS prime_cost_percentage;

-- Alter the column types from numeric(5,2) to numeric(12,2)
ALTER TABLE public.daily_pnl
  ALTER COLUMN net_revenue TYPE numeric(12,2),
  ALTER COLUMN food_cost   TYPE numeric(12,2),
  ALTER COLUMN labor_cost  TYPE numeric(12,2);

-- Recreate the generated columns with improved calculations
ALTER TABLE public.daily_pnl
  ADD COLUMN gross_profit numeric(12,2) GENERATED ALWAYS AS (net_revenue - food_cost - labor_cost) STORED,
  ADD COLUMN prime_cost   numeric(12,2) GENERATED ALWAYS AS (food_cost + labor_cost) STORED,
  ADD COLUMN food_cost_percentage  numeric(5,2) GENERATED ALWAYS AS (
    COALESCE(((food_cost  * 100.0) / NULLIF(net_revenue,0))::numeric(5,2), 0)
  ) STORED,
  ADD COLUMN labor_cost_percentage numeric(5,2) GENERATED ALWAYS AS (
    COALESCE(((labor_cost * 100.0) / NULLIF(net_revenue,0))::numeric(5,2), 0)
  ) STORED,
  ADD COLUMN prime_cost_percentage numeric(5,2) GENERATED ALWAYS AS (
    COALESCE((((food_cost + labor_cost) * 100.0) / NULLIF(net_revenue,0))::numeric(5,2), 0)
  ) STORED;

COMMIT;