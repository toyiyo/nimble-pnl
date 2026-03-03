-- Backfill: set item_type from adjustment_type on existing manual sale rows
-- that were inserted before the fix in createManualSale/createManualSaleWithAdjustments.
--
-- The column default is 'sale', so adjustment rows (tip, tax, etc.) that were
-- inserted without an explicit item_type got item_type='sale' or NULL, causing
-- SQL functions to misclassify them as revenue.

-- Set item_type to match adjustment_type for tip, tax, discount, service_charge
-- (fee maps to 'other' since 'fee' is not in the CHECK constraint)
UPDATE unified_sales
SET item_type = CASE
  WHEN adjustment_type = 'fee' THEN 'other'
  ELSE adjustment_type
END
WHERE adjustment_type IS NOT NULL
  AND adjustment_type IN ('tax', 'tip', 'service_charge', 'discount', 'fee')
  AND (item_type IS NULL OR item_type = 'sale');

-- Set item_type='sale' on revenue rows that have NULL item_type
UPDATE unified_sales
SET item_type = 'sale'
WHERE adjustment_type IS NULL
  AND item_type IS NULL;
