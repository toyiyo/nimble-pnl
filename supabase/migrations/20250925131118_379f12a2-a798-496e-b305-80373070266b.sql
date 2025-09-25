-- Update daily_sales to aggregate from unified_sales
-- This function will be called to populate daily_sales from unified_sales data
CREATE OR REPLACE FUNCTION aggregate_unified_sales_to_daily(p_restaurant_id UUID, p_date DATE)
RETURNS VOID AS $$
BEGIN
  -- Insert or update daily_sales from unified_sales
  INSERT INTO public.daily_sales (
    restaurant_id,
    date,
    source,
    gross_revenue,
    discounts,
    comps,
    transaction_count
  )
  SELECT 
    p_restaurant_id,
    p_date,
    'unified_pos' as source,
    COALESCE(SUM(total_price), 0) as gross_revenue,
    0 as discounts, -- Can be enhanced later with discount data from POS
    0 as comps,     -- Can be enhanced later with comp data from POS
    COUNT(DISTINCT external_order_id) as transaction_count
  FROM unified_sales
  WHERE restaurant_id = p_restaurant_id 
    AND sale_date = p_date
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    gross_revenue = EXCLUDED.gross_revenue,
    discounts = EXCLUDED.discounts,
    comps = EXCLUDED.comps,
    transaction_count = EXCLUDED.transaction_count,
    updated_at = now();

  -- Also calculate P&L for this date
  PERFORM public.calculate_daily_pnl(p_restaurant_id, p_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to automatically update daily_sales when unified_sales changes
CREATE OR REPLACE FUNCTION trigger_unified_sales_aggregation()
RETURNS TRIGGER AS $$
BEGIN
  -- Aggregate for the affected date
  PERFORM public.aggregate_unified_sales_to_daily(NEW.restaurant_id, NEW.sale_date::date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add trigger to unified_sales table
DROP TRIGGER IF EXISTS trigger_unified_sales_to_daily ON public.unified_sales;
CREATE TRIGGER trigger_unified_sales_to_daily
  AFTER INSERT OR UPDATE OR DELETE ON public.unified_sales
  FOR EACH ROW
  EXECUTE FUNCTION trigger_unified_sales_aggregation();