-- Create triggers to automatically calculate P&L when data is inserted/updated

-- Trigger for daily_sales
CREATE TRIGGER trigger_sales_pnl_calculation
  AFTER INSERT OR UPDATE ON public.daily_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_calculate_pnl();

-- Trigger for daily_food_costs  
CREATE TRIGGER trigger_food_costs_pnl_calculation
  AFTER INSERT OR UPDATE ON public.daily_food_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_calculate_pnl();

-- Trigger for daily_labor_costs
CREATE TRIGGER trigger_labor_costs_pnl_calculation
  AFTER INSERT OR UPDATE ON public.daily_labor_costs  
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_calculate_pnl();