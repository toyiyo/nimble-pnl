-- Update calculate_square_daily_pnl to remove duplicate sales aggregation
-- Sales are now handled by unified_sales flow, this function only needs to handle Square labor
CREATE OR REPLACE FUNCTION public.calculate_square_daily_pnl(
  p_restaurant_id UUID,
  p_service_date DATE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_labor_cost NUMERIC := 0;
  v_total_hours NUMERIC := 0;
BEGIN
  -- Aggregate labor costs from Square shifts
  SELECT 
    COALESCE(SUM(
      CASE 
        WHEN wage_type = 'HOURLY' THEN 
          EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600 * hourly_rate
        WHEN wage_type = 'SALARY' THEN 
          annual_salary / 365  -- Rough daily allocation
        ELSE 0
      END
    ), 0),
    COALESCE(SUM(
      EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600
    ), 0)
  INTO v_total_labor_cost, v_total_hours
  FROM public.square_shifts
  WHERE restaurant_id = p_restaurant_id
    AND service_date = p_service_date
    AND status = 'CLOSED';

  -- Insert or update daily labor costs
  INSERT INTO public.daily_labor_costs (
    restaurant_id,
    date,
    source,
    hourly_wages,
    salary_wages,
    benefits,
    total_hours
  ) VALUES (
    p_restaurant_id,
    p_service_date,
    'square',
    v_total_labor_cost,
    0,
    0,
    v_total_hours
  )
  ON CONFLICT (restaurant_id, date, source)
  DO UPDATE SET
    hourly_wages = EXCLUDED.hourly_wages,
    salary_wages = EXCLUDED.salary_wages,
    benefits = EXCLUDED.benefits,
    total_hours = EXCLUDED.total_hours,
    updated_at = now();

  -- Recalculate overall daily P&L
  PERFORM public.calculate_daily_pnl(p_restaurant_id, p_service_date);

  -- Return the P&L record ID
  RETURN (
    SELECT id FROM public.daily_pnl 
    WHERE restaurant_id = p_restaurant_id 
    AND date = p_service_date
  );
END;
$$;