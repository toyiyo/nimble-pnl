-- ============================================================================
-- Migration: Add Subscription System
--
-- Implements three-tier subscription model for EasyShiftHQ:
-- - Starter ($99/mo): Basic P&L and inventory
-- - Growth ($199/mo): Advanced operations, scheduling, basic AI alerts
-- - Pro ($299/mo): Full AI Assistant, enterprise features
--
-- Key features:
-- - Per-restaurant subscription tracking
-- - 14-day Growth trial for new restaurants
-- - 1-year Pro grandfathering for existing restaurants
-- - Feature gating via has_subscription_feature() function
-- - Integration with user_has_capability() for AI and Financial Intelligence
-- ============================================================================

-- 1. Add subscription columns to restaurants table
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'starter'
    CHECK (subscription_tier IN ('starter', 'growth', 'pro')),
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'grandfathered')),
  ADD COLUMN IF NOT EXISTS subscription_period TEXT NOT NULL DEFAULT 'monthly'
    CHECK (subscription_period IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS stripe_subscription_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grandfathered_until TIMESTAMPTZ;

-- Add unique constraints for Stripe IDs (allow NULL but unique when set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_stripe_subscription_customer_id
  ON public.restaurants(stripe_subscription_customer_id)
  WHERE stripe_subscription_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_stripe_subscription_id
  ON public.restaurants(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Index for subscription status queries
CREATE INDEX IF NOT EXISTS idx_restaurants_subscription_status
  ON public.restaurants(subscription_status);

CREATE INDEX IF NOT EXISTS idx_restaurants_subscription_tier
  ON public.restaurants(subscription_tier);

-- 2. Grandfather ALL existing restaurants to Pro tier for 1 year
-- This runs only for restaurants that existed before this migration
UPDATE public.restaurants
SET
  subscription_tier = 'pro',
  subscription_status = 'grandfathered',
  grandfathered_until = NOW() + INTERVAL '1 year',
  trial_ends_at = NULL  -- Grandfathered restaurants don't have trials
WHERE subscription_status = 'trialing'  -- Only update those with default status
  AND stripe_subscription_id IS NULL;   -- And no active Stripe subscription

-- 3. Create function to check subscription-gated features
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
    -- For past_due, allow 3-day grace period before blocking
    IF v_status = 'past_due' THEN
      -- Allow basic features during past_due grace period
      v_effective_tier := 'starter';
    ELSE
      -- Canceled = no access to premium features
      v_effective_tier := 'starter';
    END IF;
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

-- 4. Create function to get effective subscription tier
CREATE OR REPLACE FUNCTION public.get_effective_subscription_tier(
  p_restaurant_id UUID
)
RETURNS TEXT
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
BEGIN
  SELECT
    subscription_tier,
    subscription_status,
    grandfathered_until,
    trial_ends_at
  INTO v_tier, v_status, v_grandfathered_until, v_trial_ends_at
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF v_tier IS NULL THEN
    RETURN NULL;
  END IF;

  -- Grandfathered = Pro until expiry
  IF v_status = 'grandfathered' THEN
    IF v_grandfathered_until IS NULL OR NOW() <= v_grandfathered_until THEN
      RETURN 'pro';
    ELSE
      RETURN 'starter';
    END IF;
  END IF;

  -- Trialing = Growth until expiry
  IF v_status = 'trialing' THEN
    IF v_trial_ends_at IS NULL OR NOW() <= v_trial_ends_at THEN
      RETURN 'growth';
    ELSE
      RETURN NULL;  -- Trial expired, no tier
    END IF;
  END IF;

  -- Active or past_due = actual tier
  IF v_status IN ('active', 'past_due') THEN
    RETURN v_tier;
  END IF;

  -- Canceled = starter (basic access)
  IF v_status = 'canceled' THEN
    RETURN 'starter';
  END IF;

  RETURN v_tier;
END;
$$;

COMMENT ON FUNCTION public.get_effective_subscription_tier IS
'Get the effective subscription tier for a restaurant, accounting for
grandfathering, trials, and subscription status.';

-- 5. Update user_has_capability to integrate subscription checks
-- This adds subscription gating for AI Assistant and Financial Intelligence
CREATE OR REPLACE FUNCTION public.user_has_capability(
  p_restaurant_id UUID,
  p_capability TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_has_role_permission BOOLEAN;
BEGIN
  -- Get user's role for this restaurant
  SELECT role INTO v_role
  FROM user_restaurants ur
  WHERE ur.restaurant_id = p_restaurant_id
    AND ur.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check role-based permission AND subscription where applicable
  RETURN CASE p_capability
    -- === SUBSCRIPTION-GATED CAPABILITIES ===

    -- AI Assistant: Role check + Pro subscription required
    WHEN 'view:ai_assistant' THEN
      v_role IN ('owner', 'manager') AND
      has_subscription_feature(p_restaurant_id, 'ai_assistant')

    -- Financial Intelligence: Role check + Growth+ subscription required
    WHEN 'view:financial_intelligence' THEN
      v_role IN ('owner', 'manager', 'collaborator_accountant') AND
      has_subscription_feature(p_restaurant_id, 'financial_intelligence')

    -- === ROLE-ONLY CAPABILITIES (no subscription check) ===

    -- Dashboard
    WHEN 'view:dashboard' THEN v_role IN ('owner', 'manager', 'chef')

    -- Financial capabilities (accountant surface)
    WHEN 'view:transactions' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:transactions' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:banking' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:banking' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:expenses' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:expenses' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:financial_statements' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:chart_of_accounts' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:chart_of_accounts' THEN v_role IN ('owner', 'collaborator_accountant')
    WHEN 'view:invoices' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:invoices' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:customers' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:customers' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:assets' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:assets' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')

    -- Inventory capabilities
    WHEN 'view:inventory' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory', 'collaborator_chef')
    WHEN 'edit:inventory' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'view:inventory_audit' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_audit' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'view:purchase_orders' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:purchase_orders' THEN v_role IN ('owner', 'manager', 'collaborator_inventory')
    WHEN 'view:receipt_import' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:receipt_import' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'view:reports' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'view:inventory_transactions' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_transactions' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')

    -- Recipe capabilities
    WHEN 'view:recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'edit:recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'view:prep_recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'edit:prep_recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'view:batches' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'edit:batches' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')

    -- Operations capabilities
    WHEN 'view:pos_sales' THEN v_role IN ('owner', 'manager', 'chef')
    WHEN 'view:scheduling' THEN v_role IN ('owner', 'manager', 'chef')
    WHEN 'edit:scheduling' THEN v_role IN ('owner', 'manager')
    WHEN 'view:payroll' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:payroll' THEN v_role IN ('owner', 'manager')
    WHEN 'view:tips' THEN v_role IN ('owner', 'manager')
    WHEN 'edit:tips' THEN v_role IN ('owner', 'manager')
    WHEN 'view:time_punches' THEN v_role IN ('owner', 'manager')
    WHEN 'edit:time_punches' THEN v_role IN ('owner', 'manager')

    -- Admin capabilities
    WHEN 'view:team' THEN v_role IN ('owner', 'manager')
    WHEN 'manage:team' THEN v_role IN ('owner', 'manager')
    WHEN 'view:employees' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'manage:employees' THEN v_role IN ('owner', 'manager')
    WHEN 'view:settings' THEN v_role NOT IN ('kiosk')
    WHEN 'edit:settings' THEN v_role IN ('owner')
    WHEN 'view:integrations' THEN v_role IN ('owner', 'manager')
    WHEN 'manage:integrations' THEN v_role IN ('owner')
    WHEN 'view:collaborators' THEN v_role IN ('owner', 'manager')
    WHEN 'manage:collaborators' THEN v_role IN ('owner', 'manager')

    -- Subscription management (owner only)
    WHEN 'manage:subscription' THEN v_role = 'owner'

    ELSE FALSE
  END;
END;
$$;

COMMENT ON FUNCTION public.user_has_capability IS
'Check if current user has a specific capability for a restaurant.
Integrates both role-based permissions AND subscription tier checks.

Subscription-gated capabilities:
- view:ai_assistant: Requires Pro tier
- view:financial_intelligence: Requires Growth+ tier

All other capabilities are role-based only.
This function MUST stay in sync with ROLE_CAPABILITIES in TypeScript.';

-- 6. Update create_restaurant_with_owner to set up trial for new restaurants
-- First, drop the old 4-parameter version if it exists (original migration had no timezone param)
DROP FUNCTION IF EXISTS public.create_restaurant_with_owner(text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_restaurant_with_owner(
  restaurant_name text,
  restaurant_address text DEFAULT NULL::text,
  restaurant_phone text DEFAULT NULL::text,
  restaurant_cuisine_type text DEFAULT NULL::text,
  restaurant_timezone text DEFAULT 'America/Chicago'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_restaurant_id UUID;
  existing_restaurant_id UUID;
BEGIN
  -- Serialize concurrent creations for the same user + restaurant name
  PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text || coalesce(restaurant_name, '')));

  -- If an identical restaurant was just created by this user, return it instead
  SELECT r.id INTO existing_restaurant_id
  FROM public.restaurants r
  JOIN public.user_restaurants ur ON ur.restaurant_id = r.id
  WHERE ur.user_id = auth.uid()
    AND lower(r.name) = lower(restaurant_name)
    AND r.created_at > now() - interval '5 seconds'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF existing_restaurant_id IS NOT NULL THEN
    RETURN existing_restaurant_id;
  END IF;

  -- Insert restaurant with 14-day Growth trial
  INSERT INTO public.restaurants (
    name, address, phone, cuisine_type, timezone,
    subscription_tier, subscription_status, trial_ends_at
  )
  VALUES (
    restaurant_name, restaurant_address, restaurant_phone,
    restaurant_cuisine_type, restaurant_timezone,
    'growth',           -- Trial starts at Growth tier
    'trialing',         -- Status indicates trial period
    NOW() + INTERVAL '14 days'  -- 14-day trial
  )
  RETURNING id INTO new_restaurant_id;

  -- Link restaurant to current user as owner
  INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
  VALUES (auth.uid(), new_restaurant_id, 'owner');

  RETURN new_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.create_restaurant_with_owner(text, text, text, text, text) IS
'Create a new restaurant and link it to the current user as owner.
New restaurants start with a 14-day Growth tier trial.
Includes deduplication and concurrency protection.';

-- 7. Create function to calculate volume discount
CREATE OR REPLACE FUNCTION public.get_volume_discount_percent(
  p_location_count INTEGER
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_location_count >= 11 THEN 0.15  -- 15% off
    WHEN p_location_count >= 6 THEN 0.10   -- 10% off
    WHEN p_location_count >= 3 THEN 0.05   -- 5% off
    ELSE 0
  END::NUMERIC;
$$;

COMMENT ON FUNCTION public.get_volume_discount_percent IS
'Get volume discount percentage based on number of locations.
3-5 locations: 5% off
6-10 locations: 10% off
11+ locations: 15% off';

-- 8. Create function to count owner's restaurants for volume pricing
CREATE OR REPLACE FUNCTION public.get_owner_restaurant_count(
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM user_restaurants ur
  WHERE ur.user_id = p_user_id
    AND ur.role = 'owner';
$$;

COMMENT ON FUNCTION public.get_owner_restaurant_count IS
'Count how many restaurants the user owns (for volume discount calculation).';

-- 9. Grant permissions
GRANT EXECUTE ON FUNCTION public.has_subscription_feature TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_subscription_tier TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_volume_discount_percent TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_restaurant_count TO authenticated;

-- Service role needs full access for webhook updates
GRANT ALL ON public.restaurants TO service_role;
