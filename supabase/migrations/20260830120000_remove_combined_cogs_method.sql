-- Remove the 'combined' COGS calculation method.
--
-- The 'combined' method summed inventory-based and financials-based COGS,
-- which double-counts cost. Migrate existing rows to a single source, then
-- tighten the CHECK constraint so 'combined' can no longer be inserted.

-- Step 1: migrate existing rows before the constraint tightens.
UPDATE restaurant_financial_settings s
SET cogs_calculation_method = CASE
  WHEN EXISTS (
    SELECT 1 FROM inventory_transactions it
    WHERE it.restaurant_id = s.restaurant_id
      AND it.transaction_type = 'usage'
  ) THEN 'inventory'
  ELSE 'financials'
END
WHERE s.cogs_calculation_method = 'combined';

-- Step 2: tighten the CHECK constraint.
ALTER TABLE restaurant_financial_settings
  DROP CONSTRAINT IF EXISTS restaurant_financial_settings_cogs_calculation_method_check;
ALTER TABLE restaurant_financial_settings
  ADD CONSTRAINT restaurant_financial_settings_cogs_calculation_method_check
  CHECK (cogs_calculation_method IN ('inventory', 'financials'));
