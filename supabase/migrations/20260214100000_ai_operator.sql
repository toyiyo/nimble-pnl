-- =============================================================
-- AI Operator: tables, variance engine, anomaly detectors,
-- daily sales RPC, and weekly brief cron
-- =============================================================

-- ========================
-- 1. ops_inbox_item
-- ========================

CREATE TABLE public.ops_inbox_item (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('uncategorized_txn', 'uncategorized_pos', 'anomaly', 'reconciliation', 'recommendation')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'snoozed', 'done', 'dismissed')),
  snoozed_until TIMESTAMP WITH TIME ZONE,
  due_at TIMESTAMP WITH TIME ZONE,
  linked_entity_type TEXT,
  linked_entity_id UUID,
  evidence_json JSONB DEFAULT '[]'::jsonb,
  meta JSONB DEFAULT '{}'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.ops_inbox_item ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ops_inbox_restaurant_status ON public.ops_inbox_item(restaurant_id, status);
CREATE INDEX idx_ops_inbox_priority ON public.ops_inbox_item(restaurant_id, priority) WHERE status = 'open';
CREATE INDEX idx_ops_inbox_kind ON public.ops_inbox_item(restaurant_id, kind);
CREATE INDEX idx_ops_inbox_snoozed ON public.ops_inbox_item(snoozed_until) WHERE status = 'snoozed';

CREATE POLICY "Users can view inbox items for their restaurants"
  ON public.ops_inbox_item FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
  ));

CREATE POLICY "Managers and owners can insert inbox items"
  ON public.ops_inbox_item FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager')
  ));

CREATE POLICY "Managers and owners can update inbox items"
  ON public.ops_inbox_item FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
    AND ur.role IN ('owner', 'manager')
  ));

CREATE POLICY "Owners can delete inbox items"
  ON public.ops_inbox_item FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = ops_inbox_item.restaurant_id
    AND ur.user_id = auth.uid()
    AND ur.role = 'owner'
  ));

-- ========================
-- 2. weekly_brief
-- ========================

CREATE TABLE public.weekly_brief (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  brief_week_end DATE NOT NULL,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comparisons_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  variances_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  inbox_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative TEXT,
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  email_sent_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (restaurant_id, brief_week_end)
);

ALTER TABLE public.weekly_brief ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_weekly_brief_lookup ON public.weekly_brief(restaurant_id, brief_week_end DESC);

CREATE POLICY "Users can view briefs for their restaurants"
  ON public.weekly_brief FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = weekly_brief.restaurant_id
    AND ur.user_id = auth.uid()
  ));

-- ========================
-- 3. notification_preferences
-- ========================

CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  weekly_brief_email BOOLEAN NOT NULL DEFAULT true,
  brief_send_time TIME NOT NULL DEFAULT '07:00',
  inbox_digest_email BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, restaurant_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notification preferences"
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
        AND ur.restaurant_id = notification_preferences.restaurant_id
    )
  );

CREATE POLICY "Users can update their own notification preferences"
  ON public.notification_preferences FOR UPDATE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
        AND ur.restaurant_id = notification_preferences.restaurant_id
    )
  );

CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ========================
-- 4. Daily variance engine
-- ========================

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
  SELECT net_revenue, food_cost, labor_cost, prime_cost, gross_profit,
         food_cost_percentage, labor_cost_percentage, prime_cost_percentage
  INTO v_today
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  IF v_today IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT net_revenue, food_cost, labor_cost, prime_cost, gross_profit,
         food_cost_percentage, labor_cost_percentage, prime_cost_percentage
  INTO v_prior
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date = p_date - 1;

  SELECT net_revenue, food_cost, labor_cost, prime_cost, gross_profit,
         food_cost_percentage, labor_cost_percentage, prime_cost_percentage
  INTO v_week_ago
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date = p_date - 7;

  SELECT
    AVG(net_revenue) AS net_revenue, AVG(food_cost) AS food_cost,
    AVG(labor_cost) AS labor_cost, AVG(prime_cost) AS prime_cost,
    AVG(gross_profit) AS gross_profit, AVG(food_cost_percentage) AS food_cost_percentage,
    AVG(labor_cost_percentage) AS labor_cost_percentage,
    AVG(prime_cost_percentage) AS prime_cost_percentage
  INTO v_avg
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id
    AND date BETWEEN p_date - 7 AND p_date - 1;

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

  -- Gross Profit
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

-- ========================
-- 5. Weekly variance engine
-- ========================

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
  -- This week (7 days ending on p_week_end)
  SELECT
    SUM(net_revenue) AS net_revenue, SUM(food_cost) AS food_cost,
    SUM(labor_cost) AS labor_cost, SUM(prime_cost) AS prime_cost,
    SUM(gross_profit) AS gross_profit,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(food_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS food_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(labor_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS labor_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(prime_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS prime_cost_percentage
  INTO v_this
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date BETWEEN v_week_start AND p_week_end;

  IF v_this.net_revenue IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Prior week (7 days before this week)
  SELECT
    SUM(net_revenue) AS net_revenue, SUM(food_cost) AS food_cost,
    SUM(labor_cost) AS labor_cost, SUM(prime_cost) AS prime_cost,
    SUM(gross_profit) AS gross_profit,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(food_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS food_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(labor_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS labor_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(prime_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS prime_cost_percentage
  INTO v_prior
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date BETWEEN v_week_start - 7 AND v_week_start - 1;

  -- 4-week rolling average (28 days before this week, divided by 4)
  SELECT
    SUM(net_revenue) / 4.0 AS net_revenue, SUM(food_cost) / 4.0 AS food_cost,
    SUM(labor_cost) / 4.0 AS labor_cost, SUM(prime_cost) / 4.0 AS prime_cost,
    SUM(gross_profit) / 4.0 AS gross_profit,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(food_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS food_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(labor_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS labor_cost_percentage,
    CASE WHEN SUM(net_revenue) > 0
      THEN ROUND((SUM(prime_cost) / SUM(net_revenue) * 100)::numeric, 1) ELSE 0 END AS prime_cost_percentage
  INTO v_avg
  FROM daily_pnl
  WHERE restaurant_id = p_restaurant_id AND date BETWEEN v_week_start - 28 AND v_week_start - 1;

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

  -- Gross Profit
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

-- ========================
-- 6. Anomaly detectors
-- ========================

-- Detect uncategorized transaction backlog
CREATE OR REPLACE FUNCTION public.detect_uncategorized_backlog(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_bank_count INTEGER;
  v_pos_count INTEGER;
  v_total INTEGER;
  v_priority INTEGER;
  v_existing_id UUID;
BEGIN
  SELECT COUNT(*) INTO v_bank_count
  FROM bank_transactions WHERE restaurant_id = p_restaurant_id AND category_id IS NULL;

  SELECT COUNT(*) INTO v_pos_count
  FROM unified_sales WHERE restaurant_id = p_restaurant_id AND category_id IS NULL;

  v_total := v_bank_count + v_pos_count;

  IF v_total = 0 THEN
    UPDATE ops_inbox_item SET status = 'done', resolved_at = now(), resolved_by = NULL
    WHERE restaurant_id = p_restaurant_id
      AND kind IN ('uncategorized_txn', 'uncategorized_pos') AND status = 'open';
    RETURN 0;
  END IF;

  v_priority := CASE
    WHEN v_total > 50 THEN 1
    WHEN v_total > 20 THEN 2
    WHEN v_total > 5  THEN 3
    ELSE 4
  END;

  IF v_bank_count > 0 THEN
    SELECT id INTO v_existing_id FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id AND kind = 'uncategorized_txn' AND status = 'open';

    IF v_existing_id IS NOT NULL THEN
      UPDATE ops_inbox_item SET
        title = v_bank_count || ' uncategorized bank transactions',
        description = 'Bank transactions need to be categorized for accurate P&L reporting.',
        priority = v_priority, meta = jsonb_build_object('count', v_bank_count)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, meta, created_by)
      VALUES (p_restaurant_id, v_bank_count || ' uncategorized bank transactions',
        'Bank transactions need to be categorized for accurate P&L reporting.',
        'uncategorized_txn', v_priority, jsonb_build_object('count', v_bank_count), 'system');
    END IF;
  END IF;

  IF v_pos_count > 0 THEN
    SELECT id INTO v_existing_id FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id AND kind = 'uncategorized_pos' AND status = 'open';

    IF v_existing_id IS NOT NULL THEN
      UPDATE ops_inbox_item SET
        title = v_pos_count || ' uncategorized POS sales',
        description = 'POS sales items need categories for accurate revenue breakdown.',
        priority = v_priority, meta = jsonb_build_object('count', v_pos_count)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, meta, created_by)
      VALUES (p_restaurant_id, v_pos_count || ' uncategorized POS sales',
        'POS sales items need categories for accurate revenue breakdown.',
        'uncategorized_pos', v_priority, jsonb_build_object('count', v_pos_count), 'system');
    END IF;
  END IF;

  RETURN v_total;
END;
$$;

-- Detect metric anomalies
CREATE OR REPLACE FUNCTION public.detect_metric_anomalies(p_restaurant_id UUID, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_variances JSONB;
  v_variance JSONB;
  v_count INTEGER := 0;
  v_existing_id UUID;
  v_flag TEXT;
  v_metric TEXT;
  v_priority INTEGER;
BEGIN
  v_variances := compute_daily_variances(p_restaurant_id, p_date);

  FOR v_variance IN SELECT * FROM jsonb_array_elements(v_variances) LOOP
    v_flag := v_variance->>'flag';
    v_metric := v_variance->>'metric';

    IF v_flag IS NOT NULL AND v_flag != 'null' THEN
      v_priority := CASE v_flag WHEN 'critical' THEN 1 ELSE 2 END;

      SELECT id INTO v_existing_id FROM ops_inbox_item
      WHERE restaurant_id = p_restaurant_id AND kind = 'anomaly'
        AND linked_entity_type = 'daily_pnl' AND meta->>'metric' = v_metric AND status = 'open';

      IF v_existing_id IS NULL THEN
        INSERT INTO ops_inbox_item (
          restaurant_id, title, description, kind, priority, status,
          linked_entity_type, evidence_json, meta, created_by
        ) VALUES (
          p_restaurant_id,
          CASE v_metric
            WHEN 'net_revenue' THEN 'Revenue ' || CASE WHEN (v_variance->>'direction') = 'down' THEN 'dropped' ELSE 'spiked' END || ' — ' || v_flag
            WHEN 'food_cost_pct' THEN 'Food cost at ' || (v_variance->>'value') || '% — ' || v_flag
            WHEN 'labor_cost_pct' THEN 'Labor cost at ' || (v_variance->>'value') || '% — ' || v_flag
            WHEN 'prime_cost_pct' THEN 'Prime cost at ' || (v_variance->>'value') || '% — ' || v_flag
            ELSE v_metric || ' anomaly — ' || v_flag
          END,
          'Detected on ' || p_date || '. Prior day: ' || COALESCE(v_variance->>'prior_day', 'N/A') || ', 7-day avg: ' || COALESCE(v_variance->>'avg_7day', 'N/A'),
          'anomaly', v_priority, 'open', 'daily_pnl',
          jsonb_build_array(jsonb_build_object('table', 'daily_pnl', 'date', p_date, 'summary', 'P&L for ' || p_date)),
          jsonb_build_object('metric', v_metric, 'value', v_variance->'value', 'flag', v_flag, 'date', p_date),
          'variance_detector'
        );
        v_count := v_count + 1;
      ELSE
        UPDATE ops_inbox_item SET priority = v_priority,
          meta = jsonb_build_object('metric', v_metric, 'value', v_variance->'value', 'flag', v_flag, 'date', p_date)
        WHERE id = v_existing_id;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Detect reconciliation gaps
CREATE OR REPLACE FUNCTION public.detect_reconciliation_gaps(p_restaurant_id UUID, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_pos_total DECIMAL(12,2);
  v_bank_deposits DECIMAL(12,2);
  v_diff DECIMAL(12,2);
  v_tolerance DECIMAL(12,2) := 50.00;
  v_existing_id UUID;
  v_count INTEGER := 0;
BEGIN
  SELECT COALESCE(SUM(net_revenue), 0) INTO v_pos_total
  FROM daily_sales WHERE restaurant_id = p_restaurant_id AND date = p_date;

  SELECT COALESCE(SUM(amount), 0) INTO v_bank_deposits
  FROM bank_transactions
  WHERE restaurant_id = p_restaurant_id AND transaction_date::date = p_date AND amount > 0;

  IF v_pos_total > 0 AND v_bank_deposits = 0 THEN
    SELECT id INTO v_existing_id FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id AND kind = 'reconciliation'
      AND meta->>'date' = p_date::text AND meta->>'type' = 'missing_deposit' AND status = 'open';

    IF v_existing_id IS NULL THEN
      INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, linked_entity_type, meta, created_by)
      VALUES (p_restaurant_id, 'Missing bank deposit for ' || p_date,
        'POS shows $' || v_pos_total || ' in sales but no matching bank deposit found.',
        'reconciliation', 2, 'bank_transaction',
        jsonb_build_object('type', 'missing_deposit', 'date', p_date, 'pos_total', v_pos_total),
        'reconciliation_check');
      v_count := v_count + 1;
    END IF;

  ELSIF v_pos_total > 0 AND v_bank_deposits > 0 THEN
    v_diff := ABS(v_pos_total - v_bank_deposits);
    IF v_diff > v_tolerance THEN
      SELECT id INTO v_existing_id FROM ops_inbox_item
      WHERE restaurant_id = p_restaurant_id AND kind = 'reconciliation'
        AND meta->>'date' = p_date::text AND meta->>'type' = 'deposit_mismatch' AND status = 'open';

      IF v_existing_id IS NULL THEN
        INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, linked_entity_type, meta, created_by)
        VALUES (p_restaurant_id,
          'Deposit mismatch on ' || p_date || ' ($' || ROUND(v_diff, 2) || ' difference)',
          'POS total: $' || v_pos_total || ', Bank deposits: $' || v_bank_deposits || '. Difference exceeds $' || v_tolerance || ' tolerance.',
          'reconciliation',
          CASE WHEN v_diff > 500 THEN 1 WHEN v_diff > 200 THEN 2 ELSE 3 END,
          'bank_transaction',
          jsonb_build_object('type', 'deposit_mismatch', 'date', p_date, 'pos_total', v_pos_total, 'bank_deposits', v_bank_deposits, 'difference', v_diff),
          'reconciliation_check');
        v_count := v_count + 1;
      END IF;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;

-- ========================
-- 7. Daily sales totals RPC
-- ========================

CREATE OR REPLACE FUNCTION public.get_daily_sales_totals(
  p_restaurant_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS TABLE (sale_date DATE, total_revenue DECIMAL, transaction_count BIGINT)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT us.sale_date,
    COALESCE(SUM(us.total_price), 0) AS total_revenue,
    COUNT(*) AS transaction_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NULL
    AND us.item_type = 'sale'
    AND NOT EXISTS (SELECT 1 FROM unified_sales child WHERE child.parent_sale_id = us.id)
  GROUP BY us.sale_date
  ORDER BY us.sale_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_sales_totals(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_daily_sales_totals IS
'Aggregates daily sales totals from unified_sales for break-even analysis.
Returns one row per date with total revenue and transaction count.
Excludes adjustments (tax/tips/discounts), non-sale items, and parent sales with splits.';

-- ========================
-- 8. Weekly brief cron (Mondays 6 AM UTC)
-- ========================

DO $$
BEGIN
  PERFORM cron.unschedule('generate-daily-briefs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('generate-weekly-briefs');
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
