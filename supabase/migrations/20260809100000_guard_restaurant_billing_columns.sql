-- ============================================================================
-- Guard the restaurant billing columns
--
-- The UPDATE policy "Owners and managers can update their restaurants"
-- (supabase/migrations/20250916223011_7793a7c0-1807-4a7e-b125-c458b98bd032.sql:56-65)
-- has no WITH CHECK clause, so it checks who writes a row but never which
-- columns. An owner or manager can set subscription_tier, subscription_status,
-- and grandfathered_until straight from the browser and unlock paid features.
-- See docs/superpowers/specs/2026-08-09-restaurant-billing-column-guard-design.md.
--
-- This trigger blocks direct writes to the ten billing/Stripe columns from
-- PostgREST end-user roles (authenticated, anon). Legitimate writers, all
-- confirmed by a repo grep in the design doc section 4:
--
--   - supabase/functions/stripe-subscription-webhook/subscription-handler.ts:208-215,
--     364, 405-410, 458, 485 (service_role via supabaseAdmin, index.ts:61-64)
--   - supabase/functions/stripe-financial-connections-session/index.ts:128, 165,
--     185, 207 (service_role via supabaseAdmin, index.ts:58-61)
--   - supabase/functions/stripe-subscription-checkout/index.ts:198
--     (service_role via supabaseAdmin, index.ts:91-94)
--   - supabase/migrations/20260129000000_add_subscription_system.sql:49-56
--     (runs as the migration role: postgres locally, supabase_admin in CI)
--
-- None of these run as authenticated or anon, so none need a bypass flag.
-- ============================================================================
CREATE OR REPLACE FUNCTION public._guard_restaurant_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     OR coalesce(
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
          ''
        ) IN ('authenticated', 'anon')
  THEN
    IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
       OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
       OR NEW.subscription_period IS DISTINCT FROM OLD.subscription_period
       OR NEW.stripe_subscription_customer_id IS DISTINCT FROM OLD.stripe_subscription_customer_id
       OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
       OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
       OR NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at
       OR NEW.grandfathered_until IS DISTINCT FROM OLD.grandfathered_until
       OR NEW.subscription_cancel_at IS DISTINCT FROM OLD.subscription_cancel_at
       OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
    THEN
      RAISE EXCEPTION 'Direct writes to restaurants billing columns are not allowed; billing changes come from Stripe'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_billing_columns_guard ON public.restaurants;
CREATE TRIGGER restaurant_billing_columns_guard
  BEFORE UPDATE ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public._guard_restaurant_billing_columns();
