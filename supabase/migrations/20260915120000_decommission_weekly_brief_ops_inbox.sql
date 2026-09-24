-- ============================================================================
-- Migration: Decommission the weekly brief and the ops inbox
--
-- Deletes the cron jobs, the queue functions, the pgmq queues, the four
-- feature tables, the two subscription-feature branches, and the two
-- permission keys. The application code for these features is deleted in
-- the same branch. Order matters: role_areas.area_key references
-- area_catalog(area_key) with RESTRICT, so the role_areas rows go first.
--
-- WARNING: Step 4 drops tables with data. The data is not recoverable
-- after this migration runs in production.
-- ============================================================================

-- ============================================================================
-- 1. Unschedule the cron jobs. cron.unschedule raises when the job does
--    not exist, so each call gets its own exception-safe block.
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('enqueue-weekly-briefs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('process-weekly-brief-queue');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Legacy monolithic job name from 20260214100000_ai_operator.sql.
DO $$
BEGIN
  PERFORM cron.unschedule('generate-weekly-briefs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ============================================================================
-- 2. Drop the functions. pgmq_delete_message was a SECURITY DEFINER RPC
--    for the deleted generate-weekly-brief-worker; it must not stay as
--    an orphan.
-- ============================================================================

DROP FUNCTION IF EXISTS public.enqueue_weekly_brief_jobs();
DROP FUNCTION IF EXISTS public.process_weekly_brief_queue();
DROP FUNCTION IF EXISTS public.pgmq_delete_message(TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.compute_daily_variances(UUID, DATE);
DROP FUNCTION IF EXISTS public.compute_weekly_variances(UUID, DATE);
DROP FUNCTION IF EXISTS public.detect_uncategorized_backlog(UUID);
DROP FUNCTION IF EXISTS public.detect_metric_anomalies(UUID, DATE);
DROP FUNCTION IF EXISTS public.detect_reconciliation_gaps(UUID, DATE);

-- ============================================================================
-- 3. Drop the pgmq queues. pgmq.drop_queue raises on a missing queue, so
--    each drop gets its own exception-safe block. The pgmq extension
--    stays installed; an extension drop is out of scope for this change.
-- ============================================================================

DO $$
BEGIN
  PERFORM pgmq.drop_queue('weekly_brief_jobs');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM pgmq.drop_queue('weekly_brief_dead_letter');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ============================================================================
-- 4. Drop the tables.
-- ============================================================================

DROP TABLE IF EXISTS public.weekly_brief_job_log;
DROP TABLE IF EXISTS public.weekly_brief;
DROP TABLE IF EXISTS public.ops_inbox_item;
DROP TABLE IF EXISTS public.notification_preferences;

-- ============================================================================
-- 5. Re-create has_subscription_feature() without the ops_inbox and
--    weekly_brief branches. The two deleted keys now fall through to the
--    ELSE FALSE branch. The rest of the body is unchanged from
--    20260217210000_gate_ops_weekly_brief_pro.sql.
-- ============================================================================

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
- financial_intelligence: Growth+
- inventory_automation: Growth+
- scheduling: Growth+
- ai_alerts: Growth+
- multi_location_dashboard: Growth+
- recipe_profitability: Growth+
- basic_pnl, basic_inventory, labor_tracking, pos_integration, bank_sync: All tiers';

-- ============================================================================
-- 6. Delete the permission rows. The trigger
--    role_areas_block_builtin_mutation raises 42501 on DELETE of a
--    builtin-role row, so disable it for the DELETE window, per the
--    precedent in 20260805120000_page_areas.sql.
-- ============================================================================

ALTER TABLE public.role_areas DISABLE TRIGGER role_areas_block_builtin_mutation;

DELETE FROM public.role_areas
WHERE area_key IN ('ops_inbox', 'weekly_brief');

ALTER TABLE public.role_areas ENABLE TRIGGER role_areas_block_builtin_mutation;

-- role_areas rows are gone, so the RESTRICT reference no longer blocks.
DELETE FROM public.area_catalog
WHERE area_key IN ('ops_inbox', 'weekly_brief');

COMMENT ON COLUMN public.area_catalog.area_key IS
'Stable key joined by role_areas and by user_has_capability''s VALUES map. One key per gateable sidebar page: 31 keys across the 5 sidebar ui_groups.';
