-- =============================================================
-- Variance Engine: compute_daily_variances
-- =============================================================

CREATE OR REPLACE FUNCTION public.compute_daily_variances(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today RECORD;
  v_prior RECORD;
  v_week_ago RECORD;
  v_avg RECORD;
  v_result JSONB := '[]'::jsonb;
BEGIN
  -- Get today's P&L
  SELECT net_revenue, food_cost, labor_cost, prime_cost, gross_profit,
         food_cost_percentage, labor_cost_percentage, prime_cost_percentage
  INTO v_today
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  IF v_today IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Get prior day P&L
  SELECT net_revenue, food_cost, labor_cost, prime_cost, gross_profit,
         food_cost_percentage, labor_cost_percentage, prime_cost_percentage
  INTO v_prior
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date = p_date - 1;

  -- Get same day last week
  SELECT net_revenue, food_cost, labor_cost, prime_cost, gross_profit,
         food_cost_percentage, labor_cost_percentage, prime_cost_percentage
  INTO v_week_ago
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date = p_date - 7;

  -- Get 7-day rolling average (excluding today)
  SELECT
    AVG(net_revenue) AS net_revenue,
    AVG(food_cost) AS food_cost,
    AVG(labor_cost) AS labor_cost,
    AVG(prime_cost) AS prime_cost,
    AVG(gross_profit) AS gross_profit,
    AVG(food_cost_percentage) AS food_cost_percentage,
    AVG(labor_cost_percentage) AS labor_cost_percentage,
    AVG(prime_cost_percentage) AS prime_cost_percentage
  INTO v_avg
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id
    AND date BETWEEN p_date - 7 AND p_date - 1;

  -- Build variance array for each metric
  -- Net Revenue
  v_result := v_result || jsonb_build_object(
    'metric', 'net_revenue',
    'value', COALESCE(v_today.net_revenue, 0),
    'prior_day', COALESCE(v_prior.net_revenue, NULL),
    'delta_vs_prior', CASE WHEN v_prior.net_revenue IS NOT NULL
      THEN v_today.net_revenue - v_prior.net_revenue ELSE NULL END,
    'delta_pct_vs_prior', CASE WHEN v_prior.net_revenue IS NOT NULL AND v_prior.net_revenue != 0
      THEN ROUND(((v_today.net_revenue - v_prior.net_revenue) / v_prior.net_revenue * 100)::numeric, 1) ELSE NULL END,
    'same_day_last_week', COALESCE(v_week_ago.net_revenue, NULL),
    'avg_7day', COALESCE(ROUND(v_avg.net_revenue::numeric, 2), NULL),
    'delta_pct_vs_avg', CASE WHEN v_avg.net_revenue IS NOT NULL AND v_avg.net_revenue != 0
      THEN ROUND(((v_today.net_revenue - v_avg.net_revenue) / v_avg.net_revenue * 100)::numeric, 1) ELSE NULL END,
    'direction', CASE
      WHEN v_prior.net_revenue IS NOT NULL AND v_today.net_revenue > v_prior.net_revenue THEN 'up'
      WHEN v_prior.net_revenue IS NOT NULL AND v_today.net_revenue < v_prior.net_revenue THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_avg.net_revenue IS NOT NULL AND v_avg.net_revenue != 0
        AND ((v_today.net_revenue - v_avg.net_revenue) / v_avg.net_revenue * 100) < -15 THEN 'critical'
      WHEN v_avg.net_revenue IS NOT NULL AND v_avg.net_revenue != 0
        AND ((v_today.net_revenue - v_avg.net_revenue) / v_avg.net_revenue * 100) < -10 THEN 'warning'
      ELSE NULL END
  );

  -- Food Cost %
  v_result := v_result || jsonb_build_object(
    'metric', 'food_cost_pct',
    'value', COALESCE(v_today.food_cost_percentage, 0),
    'prior_day', COALESCE(v_prior.food_cost_percentage, NULL),
    'delta_vs_prior', CASE WHEN v_prior.food_cost_percentage IS NOT NULL
      THEN ROUND((v_today.food_cost_percentage - v_prior.food_cost_percentage)::numeric, 1) ELSE NULL END,
    'same_day_last_week', COALESCE(v_week_ago.food_cost_percentage, NULL),
    'avg_7day', COALESCE(ROUND(v_avg.food_cost_percentage::numeric, 1), NULL),
    'direction', CASE
      WHEN v_prior.food_cost_percentage IS NOT NULL AND v_today.food_cost_percentage > v_prior.food_cost_percentage THEN 'up'
      WHEN v_prior.food_cost_percentage IS NOT NULL AND v_today.food_cost_percentage < v_prior.food_cost_percentage THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_today.food_cost_percentage > 38 THEN 'critical'
      WHEN v_today.food_cost_percentage > 33 THEN 'warning'
      ELSE NULL END
  );

  -- Labor Cost %
  v_result := v_result || jsonb_build_object(
    'metric', 'labor_cost_pct',
    'value', COALESCE(v_today.labor_cost_percentage, 0),
    'prior_day', COALESCE(v_prior.labor_cost_percentage, NULL),
    'delta_vs_prior', CASE WHEN v_prior.labor_cost_percentage IS NOT NULL
      THEN ROUND((v_today.labor_cost_percentage - v_prior.labor_cost_percentage)::numeric, 1) ELSE NULL END,
    'same_day_last_week', COALESCE(v_week_ago.labor_cost_percentage, NULL),
    'avg_7day', COALESCE(ROUND(v_avg.labor_cost_percentage::numeric, 1), NULL),
    'direction', CASE
      WHEN v_prior.labor_cost_percentage IS NOT NULL AND v_today.labor_cost_percentage > v_prior.labor_cost_percentage THEN 'up'
      WHEN v_prior.labor_cost_percentage IS NOT NULL AND v_today.labor_cost_percentage < v_prior.labor_cost_percentage THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_today.labor_cost_percentage > 40 THEN 'critical'
      WHEN v_today.labor_cost_percentage > 35 THEN 'warning'
      ELSE NULL END
  );

  -- Prime Cost %
  v_result := v_result || jsonb_build_object(
    'metric', 'prime_cost_pct',
    'value', COALESCE(v_today.prime_cost_percentage, 0),
    'prior_day', COALESCE(v_prior.prime_cost_percentage, NULL),
    'delta_vs_prior', CASE WHEN v_prior.prime_cost_percentage IS NOT NULL
      THEN ROUND((v_today.prime_cost_percentage - v_prior.prime_cost_percentage)::numeric, 1) ELSE NULL END,
    'same_day_last_week', COALESCE(v_week_ago.prime_cost_percentage, NULL),
    'avg_7day', COALESCE(ROUND(v_avg.prime_cost_percentage::numeric, 1), NULL),
    'direction', CASE
      WHEN v_prior.prime_cost_percentage IS NOT NULL AND v_today.prime_cost_percentage > v_prior.prime_cost_percentage THEN 'up'
      WHEN v_prior.prime_cost_percentage IS NOT NULL AND v_today.prime_cost_percentage < v_prior.prime_cost_percentage THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_today.prime_cost_percentage > 70 THEN 'critical'
      WHEN v_today.prime_cost_percentage > 65 THEN 'warning'
      ELSE NULL END
  );

  -- Gross Profit (absolute)
  v_result := v_result || jsonb_build_object(
    'metric', 'gross_profit',
    'value', COALESCE(v_today.gross_profit, 0),
    'prior_day', COALESCE(v_prior.gross_profit, NULL),
    'delta_vs_prior', CASE WHEN v_prior.gross_profit IS NOT NULL
      THEN v_today.gross_profit - v_prior.gross_profit ELSE NULL END,
    'delta_pct_vs_prior', CASE WHEN v_prior.gross_profit IS NOT NULL AND v_prior.gross_profit != 0
      THEN ROUND(((v_today.gross_profit - v_prior.gross_profit) / ABS(v_prior.gross_profit) * 100)::numeric, 1) ELSE NULL END,
    'avg_7day', COALESCE(ROUND(v_avg.gross_profit::numeric, 2), NULL),
    'direction', CASE
      WHEN v_prior.gross_profit IS NOT NULL AND v_today.gross_profit > v_prior.gross_profit THEN 'up'
      WHEN v_prior.gross_profit IS NOT NULL AND v_today.gross_profit < v_prior.gross_profit THEN 'down'
      ELSE 'flat' END,
    'flag', NULL
  );

  RETURN v_result;
END;
$$;
