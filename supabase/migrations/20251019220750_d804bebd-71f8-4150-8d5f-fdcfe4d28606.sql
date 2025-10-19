-- Create stripe_events table for webhook idempotency
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stripe_events_stripe_id ON public.stripe_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_created_at ON public.stripe_events(created_at);

-- Enable RLS
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- No user policies needed - this is only accessed by edge functions with service role

-- Add comment
COMMENT ON TABLE public.stripe_events IS 'Tracks processed Stripe webhook events for idempotency';

-- Add unique constraint on stripe_financial_account_id in connected_banks if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'connected_banks_stripe_account_unique'
  ) THEN
    ALTER TABLE public.connected_banks 
    ADD CONSTRAINT connected_banks_stripe_account_unique 
    UNIQUE (stripe_financial_account_id);
  END IF;
END $$;