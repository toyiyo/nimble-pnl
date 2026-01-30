-- Add column to track when a subscription is scheduled to cancel
-- This is different from subscription_ends_at which tracks the current period end

ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS subscription_cancel_at TIMESTAMPTZ;

COMMENT ON COLUMN public.restaurants.subscription_cancel_at IS
  'When the subscription is scheduled to cancel (cancel_at_period_end). NULL if not canceling.';
