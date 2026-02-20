-- ============================================================================
-- Migration: Gate ops_inbox and weekly_brief behind Pro subscription
--
-- Adds ops_inbox and weekly_brief as Pro-only features in
-- has_subscription_feature() and filters enqueue_weekly_brief_jobs()
-- to only enqueue jobs for Pro-subscribed restaurants.
-- ============================================================================

-- 1. Re-create has_subscription_feature() with ops_inbox and weekly_brief
CREATE OR REPLACE FUNCTION public.has_subscription_feature(
  p_restaurant_id UUID,
  p_feature TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier TEXT;
  v_status TEXT;
  v_grandfathered_until TIMESTAMPTZ;
  v_trial_ends_at TIMESTAMPTZ;
  v_effective_tier TEXT;
BEGIN
  -- Get restaurant subscription info
  SELECT
    subscription_tier,
    subscription_status,
    grandfathered_until,
    trial_ends_at
  INTO v_tier, v_status, v_grandfathered_until, v_trial_ends_at
  FROM restaurants
  WHERE id = p_restaurant_id;

  -- If restaurant not found, deny access
  IF v_tier IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Determine effective tier based on status
  v_effective_tier := v_tier;

  -- Handle grandfathered status
  IF v_status = 'grandfathered' THEN
    IF v_grandfathered_until IS NULL OR NOW() <= v_grandfathered_until THEN
      -- Still in grace period, use Pro tier
      v_effective_tier := 'pro';
    ELSE
      -- Grace period expired, downgrade to actual tier (starter by default)
      v_effective_tier := 'starter';
      v_status := 'active';  -- Treat as normal subscription
    END IF;
  END IF;

  -- Handle trial status
  IF v_status = 'trialing' THEN
    IF v_trial_ends_at IS NULL OR NOW() <= v_trial_ends_at THEN
      -- Still in trial, use trial tier (growth)
      v_effective_tier := 'growth';
    ELSE
      -- Trial expired, block access until subscription
      RETURN FALSE;
    END IF;
  END IF;

  -- Handle inactive subscriptions
  IF v_status IN ('canceled', 'past_due') THEN
    -- Canceled or past_due: downgrade to starter (basic features only)
    v_effective_tier := 'starter';
  END IF;

  -- Feature tier requirements
  -- Returns TRUE if the effective tier meets or exceeds the feature requirement
  RETURN CASE p_feature
    -- Pro-only features
    WHEN 'ai_assistant' THEN v_effective_tier = 'pro'
    WHEN 'ops_inbox' THEN v_effective_tier = 'pro'
    WHEN 'weekly_brief' THEN v_effective_tier = 'pro'

    -- Growth+ features (Growth and Pro)
    WHEN 'financial_intelligence' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'inventory_automation' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'scheduling' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'ai_alerts' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'multi_location_dashboard' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'recipe_profitability' THEN v_effective_tier IN ('growth', 'pro')

    -- Starter+ features (all tiers)
    WHEN 'basic_pnl' THEN TRUE
    WHEN 'basic_inventory' THEN TRUE
    WHEN 'labor_tracking' THEN TRUE
    WHEN 'pos_integration' THEN TRUE
    WHEN 'bank_sync' THEN TRUE

    -- Unknown feature = deny
    ELSE FALSE
  END;
END;
$$;

COMMENT ON FUNCTION public.has_subscription_feature IS
'Check if a restaurant has access to a subscription-gated feature.
Handles grandfathering (Pro for 1 year), trials (Growth for 14 days),
and tier-based access control.

Features:
- ai_assistant: Pro only
- ops_inbox: Pro only
- weekly_brief: Pro only
- financial_intelligence: Growth+
- inventory_automation: Growth+
- scheduling: Growth+
- ai_alerts: Growth+
- multi_location_dashboard: Growth+
- recipe_profitability: Growth+
- basic_pnl, basic_inventory, labor_tracking, pos_integration, bank_sync: All tiers';

-- 2. Re-create enqueue_weekly_brief_jobs() to filter by Pro subscription
CREATE OR REPLACE FUNCTION public.enqueue_weekly_brief_jobs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_week_end DATE;
  v_dow INTEGER;
  v_restaurant RECORD;
  v_msg_id BIGINT;
  v_enqueued INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  -- Compute the most recent completed week ending on Sunday.
  -- DOW: 0=Sunday, 1=Monday, ..., 6=Saturday
  v_dow := EXTRACT(DOW FROM CURRENT_DATE)::integer;

  IF v_dow = 1 THEN
    -- Monday (cron day): last Sunday = yesterday
    v_week_end := CURRENT_DATE - 1;
  ELSIF v_dow = 0 THEN
    -- Sunday: go back 7 days to get LAST completed Sunday
    v_week_end := CURRENT_DATE - 7;
  ELSE
    -- Any other day: subtract DOW to get last Sunday
    v_week_end := CURRENT_DATE - v_dow;
  END IF;

  FOR v_restaurant IN
    SELECT id FROM public.restaurants
    WHERE public.has_subscription_feature(id, 'weekly_brief')
  LOOP
    -- Skip if brief already exists for this restaurant + week
    IF EXISTS (
      SELECT 1 FROM public.weekly_brief wb
      WHERE wb.restaurant_id = v_restaurant.id
        AND wb.brief_week_end = v_week_end
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Enqueue the job
    v_msg_id := pgmq.send(
      'weekly_brief_jobs',
      jsonb_build_object(
        'restaurant_id', v_restaurant.id,
        'brief_week_end', v_week_end
      )
    );

    -- Log the enqueue
    INSERT INTO public.weekly_brief_job_log (
      restaurant_id, brief_week_end, status, attempt, msg_id
    ) VALUES (
      v_restaurant.id, v_week_end, 'queued', 1, v_msg_id
    );

    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'enqueued', v_enqueued,
    'skipped', v_skipped,
    'week_end', v_week_end
  );
END;
$$;
