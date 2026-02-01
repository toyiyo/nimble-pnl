-- ============================================================================
-- Add Quantity Support to Assets
-- Allows tracking multiple identical assets (e.g., 2 refrigerators at $20k each)
-- ============================================================================

-- Add new columns for quantity-based tracking
ALTER TABLE public.assets
ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15, 2);

-- Add constraint to ensure quantity is positive
ALTER TABLE public.assets
ADD CONSTRAINT assets_quantity_positive CHECK (quantity >= 1);

-- Backfill existing data: unit_cost = purchase_cost (since existing records have qty=1)
UPDATE public.assets
SET unit_cost = purchase_cost
WHERE unit_cost IS NULL;

-- Make unit_cost NOT NULL after backfill
ALTER TABLE public.assets
ALTER COLUMN unit_cost SET NOT NULL;

-- Add constraint to ensure unit_cost is positive
ALTER TABLE public.assets
ADD CONSTRAINT assets_unit_cost_positive CHECK (unit_cost > 0);

-- Update the salvage constraint to use unit_cost
-- First drop the old constraint
ALTER TABLE public.assets
DROP CONSTRAINT IF EXISTS salvage_less_than_cost;

-- Add new constraint: salvage_value must be less than total purchase_cost
-- Note: salvage_value represents the TOTAL salvage value for all units (not per-unit)
-- Example: 5 refrigerators at $2000 each with $500 total salvage value is valid ($500 < $10000)
ALTER TABLE public.assets
ADD CONSTRAINT salvage_less_than_total_cost CHECK (salvage_value < (unit_cost * quantity));

-- Create trigger function to keep purchase_cost synced with unit_cost * quantity
CREATE OR REPLACE FUNCTION public.sync_asset_purchase_cost()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate purchase_cost from unit_cost and quantity
  NEW.purchase_cost := NEW.unit_cost * NEW.quantity;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to sync purchase_cost on insert or update
DROP TRIGGER IF EXISTS sync_asset_purchase_cost_trigger ON public.assets;
CREATE TRIGGER sync_asset_purchase_cost_trigger
  BEFORE INSERT OR UPDATE OF unit_cost, quantity ON public.assets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_asset_purchase_cost();

-- Add index for quantity queries (useful for reporting)
CREATE INDEX IF NOT EXISTS idx_assets_quantity ON public.assets(restaurant_id, quantity)
WHERE quantity > 1;

-- Comments for documentation
COMMENT ON COLUMN public.assets.quantity IS 'Number of identical units (e.g., 2 refrigerators). Minimum 1.';
COMMENT ON COLUMN public.assets.unit_cost IS 'Cost per unit. Total purchase_cost = unit_cost * quantity.';
COMMENT ON FUNCTION public.sync_asset_purchase_cost() IS 'Keeps purchase_cost synced as unit_cost * quantity';

-- ============================================================================
-- Function to split an asset record for partial disposal
-- E.g., 5 chairs -> split off 2 for disposal, keep 3
-- ============================================================================
CREATE OR REPLACE FUNCTION public.split_asset(
  p_asset_id UUID,
  p_split_quantity INTEGER
)
RETURNS UUID -- Returns the new asset ID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_asset RECORD;
  v_new_asset_id UUID;
  v_remaining_quantity INTEGER;
  v_split_accumulated_depreciation NUMERIC;
BEGIN
  -- Get the original asset
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF v_asset.status = 'disposed' THEN
    RAISE EXCEPTION 'Cannot split a disposed asset';
  END IF;

  IF p_split_quantity < 1 THEN
    RAISE EXCEPTION 'Split quantity must be at least 1';
  END IF;

  IF p_split_quantity >= v_asset.quantity THEN
    RAISE EXCEPTION 'Split quantity must be less than total quantity (%)' , v_asset.quantity;
  END IF;

  v_remaining_quantity := v_asset.quantity - p_split_quantity;

  -- Calculate proportional accumulated depreciation for the split portion
  v_split_accumulated_depreciation := (v_asset.accumulated_depreciation / v_asset.quantity) * p_split_quantity;

  -- Update original asset with reduced quantity and proportional depreciation
  UPDATE public.assets
  SET
    quantity = v_remaining_quantity,
    accumulated_depreciation = v_asset.accumulated_depreciation - v_split_accumulated_depreciation,
    updated_at = NOW()
  WHERE id = p_asset_id;

  -- Create new asset record for the split portion
  INSERT INTO public.assets (
    restaurant_id,
    name,
    description,
    category,
    serial_number,
    purchase_date,
    unit_cost,
    quantity,
    purchase_cost,
    salvage_value,
    useful_life_months,
    location_id,
    asset_account_id,
    accumulated_depreciation_account_id,
    depreciation_expense_account_id,
    accumulated_depreciation,
    last_depreciation_date,
    status,
    notes
  ) VALUES (
    v_asset.restaurant_id,
    v_asset.name || ' (split)',
    v_asset.description,
    v_asset.category,
    NULL,
    v_asset.purchase_date,
    v_asset.unit_cost,
    p_split_quantity,
    v_asset.unit_cost * p_split_quantity,
    (v_asset.salvage_value / v_asset.quantity) * p_split_quantity,
    v_asset.useful_life_months,
    v_asset.location_id,
    v_asset.asset_account_id,
    v_asset.accumulated_depreciation_account_id,
    v_asset.depreciation_expense_account_id,
    v_split_accumulated_depreciation,
    v_asset.last_depreciation_date,
    v_asset.status,
    'Split from asset: ' || v_asset.name
  ) RETURNING id INTO v_new_asset_id;

  RETURN v_new_asset_id;
END;
$$;

COMMENT ON FUNCTION public.split_asset IS 'Split an asset record for partial disposal. Returns the ID of the new (split-off) asset.';
