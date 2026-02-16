-- =============================================================
-- Rename daily_brief → weekly_brief, update variance engine,
-- and switch cron from daily to weekly (Mondays 6 AM UTC)
-- =============================================================

-- 1. Rename table and columns
ALTER TABLE public.daily_brief RENAME TO weekly_brief;
ALTER TABLE public.weekly_brief RENAME COLUMN brief_date TO brief_week_end;

-- Rename auto-generated constraint and index
ALTER TABLE public.weekly_brief
  RENAME CONSTRAINT daily_brief_restaurant_id_brief_date_key
  TO weekly_brief_restaurant_id_brief_week_end_key;

ALTER INDEX idx_daily_brief_lookup RENAME TO idx_weekly_brief_lookup;

-- 2. Rename notification_preferences column
ALTER TABLE public.notification_preferences
  RENAME COLUMN daily_brief_email TO weekly_brief_email;

-- 3. Recreate RLS policy with correct table reference
DROP POLICY IF EXISTS "Users can view briefs for their restaurants" ON public.weekly_brief;
CREATE POLICY "Users can view briefs for their restaurants"
  ON public.weekly_brief FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = weekly_brief.restaurant_id
    AND ur.user_id = auth.uid()
  ));

-- 4. Update cron: daily → weekly (Mondays at 6 AM UTC)
DO $$
BEGIN
  PERFORM cron.unschedule('generate-daily-briefs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'generate-weekly-briefs',
  '0 6 * * 1',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/generate-weekly-brief',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- 5. Weekly variance engine (replaces daily version)
CREATE OR REPLACE FUNCTION public.compute_weekly_variances(
  p_restaurant_id UUID,
  p_week_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_week_start DATE := p_week_end - 6;
  v_this RECORD;
  v_prior RECORD;
  v_avg RECORD;
  v_result JSONB := '[]'::jsonb;
BEGIN
  -- This week: 7 days ending on p_week_end
  SELECT
    SUM(net_revenue) AS net_revenue,
    SUM(food_cost) AS food_cost,
    SUM(labor_cost) AS labor_cost,
    SUM(prime_cost) AS prime_cost,
    SUM(gross_profit) AS gross_profit,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(food_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS food_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(labor_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS labor_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(prime_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS prime_cost_percentage
  INTO v_this
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id
    AND date BETWEEN v_week_start AND p_week_end;

  IF v_this.net_revenue IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Prior week: 7 days immediately before this week
  SELECT
    SUM(net_revenue) AS net_revenue,
    SUM(food_cost) AS food_cost,
    SUM(labor_cost) AS labor_cost,
    SUM(prime_cost) AS prime_cost,
    SUM(gross_profit) AS gross_profit,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(food_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS food_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(labor_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS labor_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(prime_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS prime_cost_percentage
  INTO v_prior
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id
    AND date BETWEEN v_week_start - 7 AND v_week_start - 1;

  -- 4-week rolling average: sum of 28 days before this week, divided by 4
  SELECT
    SUM(net_revenue) / 4.0 AS net_revenue,
    SUM(food_cost) / 4.0 AS food_cost,
    SUM(labor_cost) / 4.0 AS labor_cost,
    SUM(prime_cost) / 4.0 AS prime_cost,
    SUM(gross_profit) / 4.0 AS gross_profit,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(food_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS food_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(labor_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS labor_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(prime_cost) / SUM(net_revenue) * 100)::numeric, 1)
      ELSE 0 END AS prime_cost_percentage
  INTO v_avg
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id
    AND date BETWEEN v_week_start - 28 AND v_week_start - 1;

  -- Net Revenue
  v_result := v_result || jsonb_build_object(
    'metric', 'net_revenue',
    'value', COALESCE(v_this.net_revenue, 0),
    'prior_week', COALESCE(v_prior.net_revenue, NULL),
    'delta_vs_prior', CASE WHEN v_prior.net_revenue IS NOT NULL
      THEN v_this.net_revenue - v_prior.net_revenue ELSE NULL END,
    'delta_pct_vs_prior', CASE WHEN v_prior.net_revenue IS NOT NULL AND v_prior.net_revenue != 0
      THEN ROUND(((v_this.net_revenue - v_prior.net_revenue) / v_prior.net_revenue * 100)::numeric, 1) ELSE NULL END,
    'avg_4week', COALESCE(ROUND(v_avg.net_revenue::numeric, 2), NULL),
    'delta_pct_vs_avg', CASE WHEN v_avg.net_revenue IS NOT NULL AND v_avg.net_revenue != 0
      THEN ROUND(((v_this.net_revenue - v_avg.net_revenue) / v_avg.net_revenue * 100)::numeric, 1) ELSE NULL END,
    'direction', CASE
      WHEN v_prior.net_revenue IS NOT NULL AND v_this.net_revenue > v_prior.net_revenue THEN 'up'
      WHEN v_prior.net_revenue IS NOT NULL AND v_this.net_revenue < v_prior.net_revenue THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_avg.net_revenue IS NOT NULL AND v_avg.net_revenue != 0
        AND ((v_this.net_revenue - v_avg.net_revenue) / v_avg.net_revenue * 100) < -15 THEN 'critical'
      WHEN v_avg.net_revenue IS NOT NULL AND v_avg.net_revenue != 0
        AND ((v_this.net_revenue - v_avg.net_revenue) / v_avg.net_revenue * 100) < -10 THEN 'warning'
      ELSE NULL END
  );

  -- Food Cost %
  v_result := v_result || jsonb_build_object(
    'metric', 'food_cost_pct',
    'value', COALESCE(v_this.food_cost_percentage, 0),
    'prior_week', COALESCE(v_prior.food_cost_percentage, NULL),
    'delta_vs_prior', CASE WHEN v_prior.food_cost_percentage IS NOT NULL
      THEN ROUND((v_this.food_cost_percentage - v_prior.food_cost_percentage)::numeric, 1) ELSE NULL END,
    'avg_4week', COALESCE(ROUND(v_avg.food_cost_percentage::numeric, 1), NULL),
    'direction', CASE
      WHEN v_prior.food_cost_percentage IS NOT NULL AND v_this.food_cost_percentage > v_prior.food_cost_percentage THEN 'up'
      WHEN v_prior.food_cost_percentage IS NOT NULL AND v_this.food_cost_percentage < v_prior.food_cost_percentage THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_this.food_cost_percentage > 38 THEN 'critical'
      WHEN v_this.food_cost_percentage > 33 THEN 'warning'
      ELSE NULL END
  );

  -- Labor Cost %
  v_result := v_result || jsonb_build_object(
    'metric', 'labor_cost_pct',
    'value', COALESCE(v_this.labor_cost_percentage, 0),
    'prior_week', COALESCE(v_prior.labor_cost_percentage, NULL),
    'delta_vs_prior', CASE WHEN v_prior.labor_cost_percentage IS NOT NULL
      THEN ROUND((v_this.labor_cost_percentage - v_prior.labor_cost_percentage)::numeric, 1) ELSE NULL END,
    'avg_4week', COALESCE(ROUND(v_avg.labor_cost_percentage::numeric, 1), NULL),
    'direction', CASE
      WHEN v_prior.labor_cost_percentage IS NOT NULL AND v_this.labor_cost_percentage > v_prior.labor_cost_percentage THEN 'up'
      WHEN v_prior.labor_cost_percentage IS NOT NULL AND v_this.labor_cost_percentage < v_prior.labor_cost_percentage THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_this.labor_cost_percentage > 40 THEN 'critical'
      WHEN v_this.labor_cost_percentage > 35 THEN 'warning'
      ELSE NULL END
  );

  -- Prime Cost %
  v_result := v_result || jsonb_build_object(
    'metric', 'prime_cost_pct',
    'value', COALESCE(v_this.prime_cost_percentage, 0),
    'prior_week', COALESCE(v_prior.prime_cost_percentage, NULL),
    'delta_vs_prior', CASE WHEN v_prior.prime_cost_percentage IS NOT NULL
      THEN ROUND((v_this.prime_cost_percentage - v_prior.prime_cost_percentage)::numeric, 1) ELSE NULL END,
    'avg_4week', COALESCE(ROUND(v_avg.prime_cost_percentage::numeric, 1), NULL),
    'direction', CASE
      WHEN v_prior.prime_cost_percentage IS NOT NULL AND v_this.prime_cost_percentage > v_prior.prime_cost_percentage THEN 'up'
      WHEN v_prior.prime_cost_percentage IS NOT NULL AND v_this.prime_cost_percentage < v_prior.prime_cost_percentage THEN 'down'
      ELSE 'flat' END,
    'flag', CASE
      WHEN v_this.prime_cost_percentage > 70 THEN 'critical'
      WHEN v_this.prime_cost_percentage > 65 THEN 'warning'
      ELSE NULL END
  );

  -- Gross Profit (absolute)
  v_result := v_result || jsonb_build_object(
    'metric', 'gross_profit',
    'value', COALESCE(v_this.gross_profit, 0),
    'prior_week', COALESCE(v_prior.gross_profit, NULL),
    'delta_vs_prior', CASE WHEN v_prior.gross_profit IS NOT NULL
      THEN v_this.gross_profit - v_prior.gross_profit ELSE NULL END,
    'delta_pct_vs_prior', CASE WHEN v_prior.gross_profit IS NOT NULL AND v_prior.gross_profit != 0
      THEN ROUND(((v_this.gross_profit - v_prior.gross_profit) / ABS(v_prior.gross_profit) * 100)::numeric, 1) ELSE NULL END,
    'avg_4week', COALESCE(ROUND(v_avg.gross_profit::numeric, 2), NULL),
    'direction', CASE
      WHEN v_prior.gross_profit IS NOT NULL AND v_this.gross_profit > v_prior.gross_profit THEN 'up'
      WHEN v_prior.gross_profit IS NOT NULL AND v_this.gross_profit < v_prior.gross_profit THEN 'down'
      ELSE 'flat' END,
    'flag', NULL
  );

  RETURN v_result;
END;
$$;
