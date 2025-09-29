-- Function to aggregate inventory usage to daily food costs
CREATE OR REPLACE FUNCTION public.aggregate_inventory_usage_to_daily_food_costs(
  p_restaurant_id UUID, 
  p_date DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_food_cost NUMERIC := 0;
BEGIN
  -- Calculate total food cost from inventory usage transactions for the day
  SELECT COALESCE(ABS(SUM(total_cost)), 0) INTO v_total_food_cost
  FROM public.inventory_transactions
  WHERE restaurant_id = p_restaurant_id
    AND created_at::date = p_date
    AND transaction_type = 'usage'
    AND total_cost < 0;  -- Negative values represent inventory reduction

  -- Insert or update daily food costs (total_food_cost is a generated column)
  INSERT INTO public.daily_food_costs (
    restaurant_id,
    date,
    source,
    inventory_adjustments,
    purchases
  ) VALUES (
    p_restaurant_id,
    p_date,
    'inventory_usage',
    v_total_food_cost,
    0
  )
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    inventory_adjustments = EXCLUDED.inventory_adjustments,
    updated_at = now();

  -- Recalculate P&L for this date
  PERFORM public.calculate_daily_pnl(p_restaurant_id, p_date);
END;
$$;

-- Trigger function to aggregate inventory usage when transactions are created
CREATE OR REPLACE FUNCTION public.trigger_aggregate_inventory_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only aggregate for usage transactions (POS sales)
  IF NEW.transaction_type = 'usage' THEN
    PERFORM public.aggregate_inventory_usage_to_daily_food_costs(
      NEW.restaurant_id,
      NEW.created_at::date
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on inventory_transactions
DROP TRIGGER IF EXISTS trigger_aggregate_inventory_to_food_costs ON public.inventory_transactions;
CREATE TRIGGER trigger_aggregate_inventory_to_food_costs
AFTER INSERT ON public.inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION public.trigger_aggregate_inventory_usage();

-- Backfill existing inventory transactions to populate historical food costs
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT DISTINCT restaurant_id, created_at::date as transaction_date
    FROM public.inventory_transactions
    WHERE transaction_type = 'usage'
    ORDER BY created_at::date
  LOOP
    PERFORM public.aggregate_inventory_usage_to_daily_food_costs(r.restaurant_id, r.transaction_date);
  END LOOP;
END $$;