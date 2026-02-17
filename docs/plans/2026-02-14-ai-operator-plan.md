# AI Operator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the AI chat with evidence-backed answers, proactive insights, and action execution; add a Daily Brief page with email delivery; add an Ops Inbox page with prioritized tasks.

**Architecture:** Data layer first (new tables + SQL variance/detector functions), then AI chat tool upgrades, then two new UX surfaces (Daily Brief page, Ops Inbox page), then email delivery via Resend. All built on existing pg_cron + Edge Function infrastructure.

**Tech Stack:** PostgreSQL (migrations, RLS, SQL functions), Supabase Edge Functions (Deno), React + TypeScript, React Query, Recharts, Resend (email), OpenRouter (LLM via existing ai-caller)

**Design doc:** `docs/plans/2026-02-14-ai-operator-design.md`

---

## Task 1: Database Migration — New Tables

**Files:**
- Create: `supabase/migrations/20260214100000_ai_operator_tables.sql`

**Step 1: Write the migration**

```sql
-- =============================================================
-- AI Operator: ops_inbox_item, daily_brief, notification_preferences
-- =============================================================

-- 1. ops_inbox_item
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

-- 2. daily_brief
CREATE TABLE public.daily_brief (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  brief_date DATE NOT NULL,
  metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comparisons_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  variances_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  inbox_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative TEXT,
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  email_sent_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (restaurant_id, brief_date)
);

ALTER TABLE public.daily_brief ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_daily_brief_lookup ON public.daily_brief(restaurant_id, brief_date DESC);

CREATE POLICY "Users can view briefs for their restaurants"
  ON public.daily_brief FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = daily_brief.restaurant_id
    AND ur.user_id = auth.uid()
  ));

-- Insert/update only via service role (Edge Functions)
-- No INSERT/UPDATE/DELETE policies for regular users

-- 3. notification_preferences
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  daily_brief_email BOOLEAN NOT NULL DEFAULT true,
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
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification preferences"
  ON public.notification_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

**Step 2: Apply the migration**

Run: `npx supabase migration up` or use the Supabase MCP `apply_migration` tool.

**Step 3: Verify tables exist**

Run: `npx supabase db reset` (local) or query `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ops_inbox_item', 'daily_brief', 'notification_preferences');`

**Step 4: Commit**

```bash
git add supabase/migrations/20260214100000_ai_operator_tables.sql
git commit -m "feat: add ops_inbox_item, daily_brief, notification_preferences tables"
```

---

## Task 2: Variance Engine SQL Functions

**Files:**
- Create: `supabase/migrations/20260214200000_variance_engine.sql`

**Step 1: Write the migration**

```sql
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
```

**Step 2: Apply the migration**

Use Supabase MCP `apply_migration` or `npx supabase migration up`.

**Step 3: Verify function exists**

Run: `SELECT compute_daily_variances('some-restaurant-uuid', CURRENT_DATE - 1);` — should return `[]` if no data, or a jsonb array if data exists.

**Step 4: Commit**

```bash
git add supabase/migrations/20260214200000_variance_engine.sql
git commit -m "feat: add compute_daily_variances SQL function"
```

---

## Task 3: Anomaly Detector SQL Functions

**Files:**
- Create: `supabase/migrations/20260214300000_anomaly_detectors.sql`

**Step 1: Write the migration**

```sql
-- =============================================================
-- Anomaly Detectors: detect_uncategorized_backlog,
-- detect_reconciliation_gaps, detect_metric_anomalies
-- =============================================================

-- 1. Detect uncategorized transaction backlog
CREATE OR REPLACE FUNCTION public.detect_uncategorized_backlog(
  p_restaurant_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bank_count INTEGER;
  v_pos_count INTEGER;
  v_total INTEGER;
  v_priority INTEGER;
  v_existing_id UUID;
BEGIN
  -- Count uncategorized bank transactions
  SELECT COUNT(*) INTO v_bank_count
  FROM bank_transactions
  WHERE restaurant_id = p_restaurant_id
    AND chart_of_accounts_id IS NULL;

  -- Count uncategorized POS sales
  SELECT COUNT(*) INTO v_pos_count
  FROM unified_sales
  WHERE restaurant_id = p_restaurant_id
    AND chart_of_accounts_id IS NULL;

  v_total := v_bank_count + v_pos_count;

  IF v_total = 0 THEN
    -- Auto-resolve existing open items
    UPDATE ops_inbox_item
    SET status = 'done', resolved_at = now(), resolved_by = NULL
    WHERE restaurant_id = p_restaurant_id
      AND kind IN ('uncategorized_txn', 'uncategorized_pos')
      AND status = 'open';
    RETURN 0;
  END IF;

  -- Determine priority
  v_priority := CASE
    WHEN v_total > 50 THEN 1  -- critical
    WHEN v_total > 20 THEN 2  -- high
    WHEN v_total > 5  THEN 3  -- medium
    ELSE 4                     -- low
  END;

  -- Upsert bank transaction inbox item
  IF v_bank_count > 0 THEN
    SELECT id INTO v_existing_id
    FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id
      AND kind = 'uncategorized_txn'
      AND status = 'open';

    IF v_existing_id IS NOT NULL THEN
      UPDATE ops_inbox_item
      SET title = v_bank_count || ' uncategorized bank transactions',
          description = 'Bank transactions need to be categorized for accurate P&L reporting.',
          priority = v_priority,
          meta = jsonb_build_object('count', v_bank_count)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, meta, created_by)
      VALUES (
        p_restaurant_id,
        v_bank_count || ' uncategorized bank transactions',
        'Bank transactions need to be categorized for accurate P&L reporting.',
        'uncategorized_txn',
        v_priority,
        jsonb_build_object('count', v_bank_count),
        'system'
      );
    END IF;
  END IF;

  -- Upsert POS sales inbox item
  IF v_pos_count > 0 THEN
    SELECT id INTO v_existing_id
    FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id
      AND kind = 'uncategorized_pos'
      AND status = 'open';

    IF v_existing_id IS NOT NULL THEN
      UPDATE ops_inbox_item
      SET title = v_pos_count || ' uncategorized POS sales',
          description = 'POS sales items need categories for accurate revenue breakdown.',
          priority = v_priority,
          meta = jsonb_build_object('count', v_pos_count)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, meta, created_by)
      VALUES (
        p_restaurant_id,
        v_pos_count || ' uncategorized POS sales',
        'POS sales items need categories for accurate revenue breakdown.',
        'uncategorized_pos',
        v_priority,
        jsonb_build_object('count', v_pos_count),
        'system'
      );
    END IF;
  END IF;

  RETURN v_total;
END;
$$;

-- 2. Detect metric anomalies (from variance engine)
CREATE OR REPLACE FUNCTION public.detect_metric_anomalies(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  FOR v_variance IN SELECT * FROM jsonb_array_elements(v_variances)
  LOOP
    v_flag := v_variance->>'flag';
    v_metric := v_variance->>'metric';

    IF v_flag IS NOT NULL AND v_flag != 'null' THEN
      v_priority := CASE v_flag WHEN 'critical' THEN 1 ELSE 2 END;

      -- Check for existing open item for same metric
      SELECT id INTO v_existing_id
      FROM ops_inbox_item
      WHERE restaurant_id = p_restaurant_id
        AND kind = 'anomaly'
        AND linked_entity_type = 'daily_pnl'
        AND meta->>'metric' = v_metric
        AND status = 'open';

      IF v_existing_id IS NULL THEN
        INSERT INTO ops_inbox_item (
          restaurant_id, title, description, kind, priority, status,
          linked_entity_type, evidence_json, meta, created_by
        )
        VALUES (
          p_restaurant_id,
          CASE v_metric
            WHEN 'net_revenue' THEN 'Revenue ' || CASE WHEN (v_variance->>'direction') = 'down' THEN 'dropped' ELSE 'spiked' END || ' — ' || v_flag
            WHEN 'food_cost_pct' THEN 'Food cost at ' || (v_variance->>'value') || '% — ' || v_flag
            WHEN 'labor_cost_pct' THEN 'Labor cost at ' || (v_variance->>'value') || '% — ' || v_flag
            WHEN 'prime_cost_pct' THEN 'Prime cost at ' || (v_variance->>'value') || '% — ' || v_flag
            ELSE v_metric || ' anomaly — ' || v_flag
          END,
          'Detected on ' || p_date || '. Prior day: ' || COALESCE(v_variance->>'prior_day', 'N/A') || ', 7-day avg: ' || COALESCE(v_variance->>'avg_7day', 'N/A'),
          'anomaly',
          v_priority,
          'open',
          'daily_pnl',
          jsonb_build_array(jsonb_build_object(
            'table', 'daily_pnl',
            'date', p_date,
            'summary', 'P&L for ' || p_date
          )),
          jsonb_build_object('metric', v_metric, 'value', v_variance->'value', 'flag', v_flag, 'date', p_date),
          'variance_detector'
        );
        v_count := v_count + 1;
      ELSE
        -- Update existing item with latest data
        UPDATE ops_inbox_item
        SET priority = v_priority,
            meta = jsonb_build_object('metric', v_metric, 'value', v_variance->'value', 'flag', v_flag, 'date', p_date)
        WHERE id = v_existing_id;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 3. Detect reconciliation gaps
CREATE OR REPLACE FUNCTION public.detect_reconciliation_gaps(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pos_total DECIMAL(12,2);
  v_bank_deposits DECIMAL(12,2);
  v_diff DECIMAL(12,2);
  v_tolerance DECIMAL(12,2) := 50.00;
  v_existing_id UUID;
  v_count INTEGER := 0;
BEGIN
  -- Get POS sales total for the date
  SELECT COALESCE(SUM(net_revenue), 0) INTO v_pos_total
  FROM daily_sales
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Get bank deposits (positive amounts) for the date
  SELECT COALESCE(SUM(amount), 0) INTO v_bank_deposits
  FROM bank_transactions
  WHERE restaurant_id = p_restaurant_id
    AND date = p_date
    AND amount > 0;

  -- If we have POS data but no bank deposits (or vice versa), flag it
  IF v_pos_total > 0 AND v_bank_deposits = 0 THEN
    SELECT id INTO v_existing_id
    FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id
      AND kind = 'reconciliation'
      AND meta->>'date' = p_date::text
      AND meta->>'type' = 'missing_deposit'
      AND status = 'open';

    IF v_existing_id IS NULL THEN
      INSERT INTO ops_inbox_item (
        restaurant_id, title, description, kind, priority,
        linked_entity_type, meta, created_by
      )
      VALUES (
        p_restaurant_id,
        'Missing bank deposit for ' || p_date,
        'POS shows $' || v_pos_total || ' in sales but no matching bank deposit found.',
        'reconciliation', 2,
        'bank_transaction',
        jsonb_build_object('type', 'missing_deposit', 'date', p_date, 'pos_total', v_pos_total),
        'reconciliation_check'
      );
      v_count := v_count + 1;
    END IF;

  ELSIF v_pos_total > 0 AND v_bank_deposits > 0 THEN
    v_diff := ABS(v_pos_total - v_bank_deposits);
    IF v_diff > v_tolerance THEN
      SELECT id INTO v_existing_id
      FROM ops_inbox_item
      WHERE restaurant_id = p_restaurant_id
        AND kind = 'reconciliation'
        AND meta->>'date' = p_date::text
        AND meta->>'type' = 'deposit_mismatch'
        AND status = 'open';

      IF v_existing_id IS NULL THEN
        INSERT INTO ops_inbox_item (
          restaurant_id, title, description, kind, priority,
          linked_entity_type, meta, created_by
        )
        VALUES (
          p_restaurant_id,
          'Deposit mismatch on ' || p_date || ' ($' || ROUND(v_diff, 2) || ' difference)',
          'POS total: $' || v_pos_total || ', Bank deposits: $' || v_bank_deposits || '. Difference exceeds $' || v_tolerance || ' tolerance.',
          'reconciliation',
          CASE WHEN v_diff > 500 THEN 1 WHEN v_diff > 200 THEN 2 ELSE 3 END,
          'bank_transaction',
          jsonb_build_object('type', 'deposit_mismatch', 'date', p_date, 'pos_total', v_pos_total, 'bank_deposits', v_bank_deposits, 'difference', v_diff),
          'reconciliation_check'
        );
        v_count := v_count + 1;
      END IF;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;
```

**Step 2: Apply and verify**

Same as Task 2. Test each function individually.

**Step 3: Commit**

```bash
git add supabase/migrations/20260214300000_anomaly_detectors.sql
git commit -m "feat: add anomaly detector SQL functions (uncategorized, reconciliation, metric)"
```

---

## Task 4: pgTAP Tests for SQL Functions

**Files:**
- Create: `supabase/tests/ai_operator_test.sql`

**Step 1: Write the tests**

```sql
BEGIN;
SELECT plan(8);

-- Test 1: compute_daily_variances returns empty array when no data
SELECT is(
  compute_daily_variances('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE),
  '[]'::jsonb,
  'compute_daily_variances returns empty array for nonexistent restaurant'
);

-- Test 2: ops_inbox_item table exists
SELECT has_table('public', 'ops_inbox_item', 'ops_inbox_item table exists');

-- Test 3: daily_brief table exists
SELECT has_table('public', 'daily_brief', 'daily_brief table exists');

-- Test 4: notification_preferences table exists
SELECT has_table('public', 'notification_preferences', 'notification_preferences table exists');

-- Test 5: daily_brief has unique constraint on (restaurant_id, brief_date)
SELECT has_index('public', 'daily_brief', 'daily_brief_restaurant_id_brief_date_key',
  'daily_brief has unique index on restaurant_id, brief_date');

-- Test 6: detect_uncategorized_backlog returns 0 for nonexistent restaurant
SELECT is(
  detect_uncategorized_backlog('00000000-0000-0000-0000-000000000000'::uuid),
  0,
  'detect_uncategorized_backlog returns 0 for empty restaurant'
);

-- Test 7: detect_metric_anomalies returns 0 for nonexistent restaurant
SELECT is(
  detect_metric_anomalies('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE),
  0,
  'detect_metric_anomalies returns 0 for empty restaurant'
);

-- Test 8: detect_reconciliation_gaps returns 0 for nonexistent restaurant
SELECT is(
  detect_reconciliation_gaps('00000000-0000-0000-0000-000000000000'::uuid, CURRENT_DATE),
  0,
  'detect_reconciliation_gaps returns 0 for empty restaurant'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run tests**

Run: `npm run test:db`

**Step 3: Commit**

```bash
git add supabase/tests/ai_operator_test.sql
git commit -m "test: add pgTAP tests for AI operator SQL functions"
```

---

## Task 5: useOpsInbox Hook

**Files:**
- Create: `src/hooks/useOpsInbox.ts`

**Step 1: Write the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface OpsInboxItem {
  id: string;
  restaurant_id: string;
  title: string;
  description: string | null;
  kind: 'uncategorized_txn' | 'uncategorized_pos' | 'anomaly' | 'reconciliation' | 'recommendation';
  priority: number;
  status: 'open' | 'snoozed' | 'done' | 'dismissed';
  snoozed_until: string | null;
  due_at: string | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  evidence_json: Array<{ table: string; id?: string; date?: string; summary: string }>;
  meta: Record<string, any>;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface UseOpsInboxOptions {
  status?: string;
  kind?: string;
  priority?: number;
  limit?: number;
}

export function useOpsInbox(restaurantId: string | undefined, options: UseOpsInboxOptions = {}) {
  const queryClient = useQueryClient();
  const { status = 'open', kind, priority, limit = 100 } = options;

  const query = useQuery({
    queryKey: ['ops-inbox', restaurantId, status, kind, priority],
    queryFn: async () => {
      if (!restaurantId) return [];

      let q = supabase
        .from('ops_inbox_item')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status && status !== 'all') {
        q = q.eq('status', status);
      }
      if (kind) {
        q = q.eq('kind', kind);
      }
      if (priority) {
        q = q.eq('priority', priority);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as OpsInboxItem[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ itemId, newStatus, snoozedUntil }: {
      itemId: string;
      newStatus: 'open' | 'snoozed' | 'done' | 'dismissed';
      snoozedUntil?: string;
    }) => {
      const updates: Record<string, any> = { status: newStatus };
      if (newStatus === 'snoozed' && snoozedUntil) {
        updates.snoozed_until = snoozedUntil;
      }
      if (newStatus === 'done' || newStatus === 'dismissed') {
        updates.resolved_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('ops_inbox_item')
        .update(updates)
        .eq('id', itemId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ops-inbox', restaurantId] });
    },
  });

  return {
    items: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    updateStatus: updateStatus.mutate,
    isUpdating: updateStatus.isPending,
    refetch: query.refetch,
  };
}

export function useOpsInboxCount(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['ops-inbox-count', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return { open: 0, critical: 0 };

      const { count: openCount, error: openError } = await supabase
        .from('ops_inbox_item')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open');

      const { count: criticalCount, error: critError } = await supabase
        .from('ops_inbox_item')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('status', 'open')
        .eq('priority', 1);

      if (openError || critError) throw openError || critError;
      return { open: openCount || 0, critical: criticalCount || 0 };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });
}
```

**Step 2: Commit**

```bash
git add src/hooks/useOpsInbox.ts
git commit -m "feat: add useOpsInbox and useOpsInboxCount hooks"
```

---

## Task 6: useDailyBrief Hook

**Files:**
- Create: `src/hooks/useDailyBrief.ts`

**Step 1: Write the hook**

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DailyBrief {
  id: string;
  restaurant_id: string;
  brief_date: string;
  metrics_json: {
    net_revenue?: number;
    food_cost?: number;
    labor_cost?: number;
    prime_cost?: number;
    gross_profit?: number;
    food_cost_pct?: number;
    labor_cost_pct?: number;
    prime_cost_pct?: number;
  };
  comparisons_json: Record<string, any>;
  variances_json: Array<{
    metric: string;
    value: number;
    prior_day: number | null;
    delta_vs_prior: number | null;
    delta_pct_vs_prior: number | null;
    same_day_last_week: number | null;
    avg_7day: number | null;
    delta_pct_vs_avg: number | null;
    direction: 'up' | 'down' | 'flat';
    flag: 'critical' | 'warning' | null;
  }>;
  inbox_summary_json: {
    open_count?: number;
    critical_count?: number;
    top_items?: Array<{ title: string; priority: number; kind: string }>;
  };
  recommendations_json: Array<{
    title: string;
    body: string;
    impact: string;
    effort: string;
    evidence: any[];
  }>;
  narrative: string | null;
  computed_at: string;
  email_sent_at: string | null;
}

export function useDailyBrief(restaurantId: string | undefined, date?: string) {
  const briefDate = date || new Date(Date.now() - 86400000).toISOString().split('T')[0]; // yesterday

  return useQuery({
    queryKey: ['daily-brief', restaurantId, briefDate],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await supabase
        .from('daily_brief')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('brief_date', briefDate)
        .maybeSingle();

      if (error) throw error;
      return data as DailyBrief | null;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}

export function useDailyBriefHistory(restaurantId: string | undefined, limit = 14) {
  return useQuery({
    queryKey: ['daily-brief-history', restaurantId, limit],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('daily_brief')
        .select('id, brief_date, metrics_json, narrative, computed_at')
        .eq('restaurant_id', restaurantId)
        .order('brief_date', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });
}
```

**Step 2: Commit**

```bash
git add src/hooks/useDailyBrief.ts
git commit -m "feat: add useDailyBrief and useDailyBriefHistory hooks"
```

---

## Task 7: Ops Inbox Page

**Files:**
- Create: `src/pages/OpsInbox.tsx`
- Modify: `src/App.tsx` — add route

**Step 1: Build the page**

Build `src/pages/OpsInbox.tsx` with:
- Header: "Ops Inbox" with count badge from `useOpsInboxCount`
- Apple-style underline tabs: All Open | Critical | Snoozed | Resolved
- Virtualized list using `@tanstack/react-virtual` (follow pattern from `src/components/banking/BankTransactionList.tsx`)
- Memoized `InboxItemCard` component with:
  - Priority badge (color-coded: 1=red, 2=orange, 3=yellow, 4/5=muted)
  - Title (text-[14px] font-medium), description (text-[13px] text-muted-foreground)
  - Time ago (using relative time)
  - Actions: View Details, Snooze dropdown, Dismiss, Ask AI button
- Loading/empty/error states per CLAUDE.md rules
- "Ask AI" button: calls `openChat()` from `AiChatContext` and pre-fills message

Follow Apple/Notion styling from CLAUDE.md:
- Cards: `rounded-xl border border-border/40 bg-background`
- Tabs: underline style with `h-[2px] bg-foreground` indicator
- Buttons: `h-9 rounded-lg text-[13px] font-medium`

**Step 2: Add route**

In `src/App.tsx`, add:
```typescript
import OpsInbox from '@/pages/OpsInbox';
// Inside routes:
<Route path="/ops-inbox" element={<ProtectedRoute><OpsInbox /></ProtectedRoute>} />
```

**Step 3: Add navigation link**

Add "Ops Inbox" to the sidebar navigation (look at existing nav structure in the layout component).

**Step 4: Verify**

Run: `npm run dev` — navigate to `/ops-inbox`, verify it renders with empty state.

**Step 5: Commit**

```bash
git add src/pages/OpsInbox.tsx src/App.tsx
git commit -m "feat: add Ops Inbox page with virtualized list and filtering"
```

---

## Task 8: Daily Brief Page

**Files:**
- Create: `src/pages/DailyBrief.tsx`
- Modify: `src/App.tsx` — add route

**Step 1: Build the page**

Build `src/pages/DailyBrief.tsx` with:
- Date picker at top (defaults to yesterday, browsable via left/right arrows)
- **Metrics row**: 4-6 cards using existing metric card patterns. Each shows:
  - Label (text-[12px] uppercase tracking-wider)
  - Value (text-[22px] font-semibold)
  - Delta badge (green up arrow / red down arrow + percentage)
- **What Changed section**: Cards for each variance with `flag != null`
  - Metric name, value, delta description, direction indicator
  - Clickable → navigates to relevant page
- **Narrative section**: The LLM-generated paragraph in a subtle card
- **Top Actions**: 3 recommendation cards with title, body, "Take action" CTA
- **Open Issues**: Count linking to `/ops-inbox`
- Empty state when no brief exists for selected date: "No brief generated for this date"

Uses `useDailyBrief(restaurantId, selectedDate)` hook.

Follow Apple/Notion styling. Use `rounded-xl border border-border/40` cards. No emojis.

**Step 2: Add route**

```typescript
import DailyBrief from '@/pages/DailyBrief';
<Route path="/daily-brief" element={<ProtectedRoute><DailyBrief /></ProtectedRoute>} />
```

**Step 3: Verify**

Run: `npm run dev` — navigate to `/daily-brief`, verify empty state renders.

**Step 4: Commit**

```bash
git add src/pages/DailyBrief.tsx src/App.tsx
git commit -m "feat: add Daily Brief page with metrics, variances, and narrative"
```

---

## Task 9: Generate Daily Brief Edge Function

**Files:**
- Create: `supabase/functions/generate-daily-brief/index.ts`

**Step 1: Write the Edge Function**

This function:
1. Queries all restaurants with opted-in users
2. For each restaurant (max 10 per run):
   - Calls `compute_daily_variances` via RPC
   - Calls all 3 anomaly detectors via RPC
   - Queries open `ops_inbox_item` count
   - Generates top 3 recommendations from variances (deterministic: highest flag priority)
   - Calls LLM via `callAIWithFallback` to generate narrative
   - Inserts `daily_brief` row
3. Returns summary of generated briefs

Use existing patterns from `supabase/functions/_shared/ai-caller.ts` for LLM calls.
Use `createClient` with service role key (this runs on cron, not user context).

The narrative prompt:
```
You are a restaurant financial analyst. Summarize yesterday's performance in 3-4 sentences.
ONLY reference the numbers provided below. Do not invent or estimate any figures.
Write in a direct, professional tone. Lead with the most important change.

Restaurant: {name}
Date: {date}
Metrics: {metrics_json}
Variances: {variances_json}
Open issues: {inbox_summary}
```

**Step 2: Test locally**

Run: `npm run functions:serve`
Then: `curl -X POST http://localhost:54321/functions/v1/generate-daily-brief -H "Authorization: Bearer $SERVICE_ROLE_KEY"`

**Step 3: Commit**

```bash
git add supabase/functions/generate-daily-brief/index.ts
git commit -m "feat: add generate-daily-brief Edge Function with LLM narrative"
```

---

## Task 10: Send Daily Brief Email Edge Function

**Files:**
- Create: `supabase/functions/send-daily-brief-email/index.ts`

**Step 1: Write the Edge Function**

This function:
1. Accepts `{ restaurant_id, brief_date }` in request body
2. Fetches the `daily_brief` row
3. Fetches opted-in users from `notification_preferences`
4. Fetches user emails from `profiles`
5. Sends HTML email via Resend HTTP API (`https://api.resend.com/emails`)
6. Updates `daily_brief.email_sent_at`

Email HTML template: clean, minimal design with:
- Key numbers grid (4 metrics)
- Delta badges (color-coded)
- Narrative paragraph
- Top 3 inbox items as bullet list
- "View Full Brief" CTA button pointing to `/daily-brief?date={brief_date}`

Secret: `RESEND_API_KEY` (stored via `supabase secrets set`)

**Step 2: Wire into generate-daily-brief**

After inserting the brief row, call `send-daily-brief-email` via `fetch` to the same Supabase functions URL, or inline the email sending in the generator.

**Step 3: Commit**

```bash
git add supabase/functions/send-daily-brief-email/index.ts
git commit -m "feat: add send-daily-brief-email Edge Function via Resend"
```

---

## Task 11: Cron Job for Daily Brief

**Files:**
- Create: `supabase/migrations/20260214400000_daily_brief_cron.sql`

**Step 1: Write the migration**

```sql
-- Schedule daily brief generation at 6:00 AM UTC
SELECT cron.schedule(
  'generate-daily-briefs',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/generate-daily-brief',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Step 2: Apply and verify**

**Step 3: Commit**

```bash
git add supabase/migrations/20260214400000_daily_brief_cron.sql
git commit -m "feat: add pg_cron job for daily brief generation at 6 AM UTC"
```

---

## Task 12: Notification Preferences Settings UI

**Files:**
- Create: `src/hooks/useNotificationPreferences.ts`
- Modify: Settings page to add Daily Brief section

**Step 1: Write the hook**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useNotificationPreferences(restaurantId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notification-preferences', restaurantId, user?.id],
    queryFn: async () => {
      if (!restaurantId || !user?.id) return null;
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId && !!user?.id,
  });

  const upsert = useMutation({
    mutationFn: async (prefs: { daily_brief_email?: boolean; brief_send_time?: string }) => {
      if (!restaurantId || !user?.id) throw new Error('Missing context');
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: user.id,
          restaurant_id: restaurantId,
          ...prefs,
        }, { onConflict: 'user_id,restaurant_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences', restaurantId] });
    },
  });

  return {
    preferences: query.data,
    isLoading: query.isLoading,
    updatePreferences: upsert.mutate,
    isUpdating: upsert.isPending,
  };
}
```

**Step 2: Add to Settings page**

Find the Settings page (`src/pages/Settings.tsx` or equivalent). Add a "Daily Brief" section with:
- Toggle switch: "Receive daily brief email" (default on)
- Uses `useNotificationPreferences` hook

**Step 3: Commit**

```bash
git add src/hooks/useNotificationPreferences.ts src/pages/Settings.tsx
git commit -m "feat: add notification preferences hook and Daily Brief settings toggle"
```

---

## Task 13: AI Chat — Evidence-Backed Tool Responses

**Files:**
- Modify: `supabase/functions/ai-execute-tool/index.ts` — add `evidence` to tool responses
- Modify: `supabase/functions/_shared/tools-registry.ts` — update tool descriptions
- Modify: `supabase/functions/ai-chat-stream/index.ts` — update system prompt

**Step 1: Update tool handlers**

In `ai-execute-tool/index.ts`, update each tool handler to include an `evidence` array in its return value. For example, `get_kpis`:

```typescript
// After fetching daily_pnl data:
return {
  ok: true,
  data: { /* existing data */ },
  evidence: [
    { table: 'daily_pnl', id: pnlRow.id, date: pnlRow.date, label: `Daily P&L ${pnlRow.date}` },
  ],
};
```

Do this for all existing tool handlers: `get_kpis`, `get_sales_summary`, `get_labor_costs`, `get_bank_transactions`, `get_financial_intelligence`, etc.

**Step 2: Update system prompt**

In `ai-chat-stream/index.ts`, add to the system message:
```
When citing data, reference the evidence provided by tools.
Format: "Based on [evidence label] — [key figure]."
Never state a number that wasn't provided by a tool result.
```

**Step 3: Update tool descriptions**

In `tools-registry.ts`, append to each tool's description: "Returns evidence references for cited data."

**Step 4: Commit**

```bash
git add supabase/functions/ai-execute-tool/index.ts supabase/functions/_shared/tools-registry.ts supabase/functions/ai-chat-stream/index.ts
git commit -m "feat: add evidence references to all AI tool responses"
```

---

## Task 14: AI Chat — Proactive Insights Tool

**Files:**
- Modify: `supabase/functions/_shared/tools-registry.ts` — add `get_proactive_insights` tool definition
- Modify: `supabase/functions/ai-execute-tool/index.ts` — add handler
- Modify: `supabase/functions/ai-chat-stream/index.ts` — update system prompt for auto-injection

**Step 1: Add tool definition**

```typescript
{
  name: 'get_proactive_insights',
  description: 'Check for urgent operational items and recent daily brief. Call this at the start of conversations to surface important issues proactively.',
  parameters: {
    type: 'object',
    properties: {
      include_brief: {
        type: 'boolean',
        description: 'Include latest daily brief summary (default: true)',
        default: true
      }
    }
  }
}
```

Available to all roles (viewer+).

**Step 2: Add handler**

In `ai-execute-tool/index.ts`:
- Query top 5 open `ops_inbox_item` ordered by priority
- Query latest `daily_brief` (yesterday or most recent)
- Return structured payload with insights array and brief summary

**Step 3: Update system prompt**

Add to system message in `ai-chat-stream/index.ts`:
```
At the start of a new conversation, call get_proactive_insights to check for urgent items.
If there are critical or high priority items, mention them briefly before responding to the user's question.
```

**Step 4: Commit**

```bash
git add supabase/functions/_shared/tools-registry.ts supabase/functions/ai-execute-tool/index.ts supabase/functions/ai-chat-stream/index.ts
git commit -m "feat: add get_proactive_insights tool with auto-injection at session start"
```

---

## Task 15: AI Chat — Action Execution Tools

**Files:**
- Modify: `supabase/functions/_shared/tools-registry.ts` — add action tools
- Modify: `supabase/functions/ai-execute-tool/index.ts` — add handlers

**Step 1: Add tool definitions**

Add these tools (owner/manager only):

- `batch_categorize_transactions`: params `{ transaction_ids: string[], category_id: string, preview: boolean, confirmed: boolean }`
- `batch_categorize_pos_sales`: params `{ sale_ids: string[], category_id: string, preview: boolean, confirmed: boolean }`
- `link_invoice_to_transaction`: params `{ invoice_id: string, transaction_id: string, preview: boolean, confirmed: boolean }`
- `create_categorization_rule`: params `{ rule_name: string, pattern_type: string, pattern_value: string, category_id: string, preview: boolean, confirmed: boolean }`
- `resolve_inbox_item`: params `{ item_id: string, resolution: 'done' | 'dismissed' }`

**Step 2: Add handlers with preview pattern**

Each action tool handler:
1. If `preview: true`: query the affected records, return a summary of what would change, store preview state
2. If `confirmed: true`: execute the change, return result with evidence
3. If neither: return error "Must call with preview: true first"

Example for `batch_categorize_transactions`:
```typescript
async function executeBatchCategorizeTransactions(args, restaurantId, supabase) {
  const { transaction_ids, category_id, preview, confirmed } = args;

  if (preview) {
    // Fetch transactions and category name
    const { data: txns } = await supabase
      .from('bank_transactions')
      .select('id, description, amount, date')
      .eq('restaurant_id', restaurantId)
      .in('id', transaction_ids);

    const { data: category } = await supabase
      .from('chart_of_accounts')
      .select('name')
      .eq('id', category_id)
      .single();

    return {
      ok: true,
      data: {
        action: 'batch_categorize_transactions',
        preview: true,
        count: txns?.length || 0,
        category_name: category?.name,
        sample_transactions: txns?.slice(0, 5),
        message: `Will categorize ${txns?.length} transactions as "${category?.name}".`,
      },
    };
  }

  if (confirmed) {
    const { error } = await supabase
      .from('bank_transactions')
      .update({ chart_of_accounts_id: category_id })
      .eq('restaurant_id', restaurantId)
      .in('id', transaction_ids);

    if (error) throw error;

    return {
      ok: true,
      data: {
        action: 'batch_categorize_transactions',
        executed: true,
        count: transaction_ids.length,
        message: `Successfully categorized ${transaction_ids.length} transactions.`,
      },
      evidence: [{ table: 'bank_transactions', summary: `${transaction_ids.length} transactions categorized` }],
    };
  }

  return { ok: false, error: { code: 'PREVIEW_REQUIRED', message: 'Call with preview: true first' } };
}
```

**Step 3: Commit**

```bash
git add supabase/functions/_shared/tools-registry.ts supabase/functions/ai-execute-tool/index.ts
git commit -m "feat: add action execution tools with preview-first approval pattern"
```

---

## Task 16: Dashboard Integration — Ops Inbox Badge

**Files:**
- Modify: `src/pages/Index.tsx` — add inbox count badge

**Step 1: Add inbox badge**

At the top of the dashboard (near the header area), add a small badge/link:
```typescript
import { useOpsInboxCount } from '@/hooks/useOpsInbox';

// Inside component:
const { data: inboxCount } = useOpsInboxCount(restaurantId);

// In JSX, near the header:
{inboxCount && inboxCount.open > 0 && (
  <Link to="/ops-inbox" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
    <Inbox className="h-4 w-4 text-muted-foreground" />
    <span className="text-[13px] font-medium">{inboxCount.open} items</span>
    {inboxCount.critical > 0 && (
      <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive font-medium">
        {inboxCount.critical} critical
      </span>
    )}
  </Link>
)}
```

**Step 2: Add Daily Brief link**

Similarly, add a "View today's brief" link near the dashboard header that navigates to `/daily-brief`.

**Step 3: Commit**

```bash
git add src/pages/Index.tsx
git commit -m "feat: add Ops Inbox badge and Daily Brief link to dashboard"
```

---

## Task 17: Supabase Type Generation

**Step 1: Generate updated types**

After all migrations are applied, regenerate TypeScript types so the new tables are available to the hooks.

Run: `npx supabase gen types typescript --local > src/integrations/supabase/types.ts`

Or use the Supabase MCP `generate_typescript_types` tool.

**Step 2: Verify hooks compile**

Run: `npm run build` — should compile without type errors for the new hooks.

**Step 3: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase TypeScript types for new tables"
```

---

## Task 18: Final Integration Test

**Step 1: Verify end-to-end flow locally**

1. Start local Supabase: `npm run db:start`
2. Apply migrations: `npx supabase db reset`
3. Start dev server: `npm run dev`
4. Start edge functions: `npm run functions:serve`
5. Navigate to `/ops-inbox` — should show empty state
6. Navigate to `/daily-brief` — should show "no brief" for yesterday
7. Trigger brief generation manually: `curl -X POST http://localhost:54321/functions/v1/generate-daily-brief -H "Authorization: Bearer $SERVICE_ROLE_KEY"`
8. Refresh `/daily-brief` — should show generated brief
9. Check `/ops-inbox` — should show any detected items
10. Open AI chat — should proactively mention insights if items exist

**Step 2: Run all tests**

Run: `npm run test && npm run test:db`

**Step 3: Build check**

Run: `npm run build` — should succeed.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration test findings"
```
