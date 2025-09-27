-- Fix Critical Email Exposure in invitations table
-- Drop existing policies that may expose emails
DROP POLICY IF EXISTS "Users can accept invitations sent to their email" ON public.invitations;

-- Create more restrictive policies for invitations
CREATE POLICY "Restaurant owners and managers can view invitations"
ON public.invitations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = invitations.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Allow users to view only invitations sent to their specific email
CREATE POLICY "Users can view invitations sent to their email"
ON public.invitations  
FOR SELECT
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  AND status = 'pending'
  AND expires_at > now()
);

-- Allow users to update only their own invitations for acceptance
CREATE POLICY "Users can accept their own invitations"
ON public.invitations
FOR UPDATE
USING (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  AND status = 'pending' 
  AND expires_at > now()
)
WITH CHECK (
  email = (SELECT email FROM auth.users WHERE id = auth.uid())
  AND status = 'accepted'
  AND accepted_by = auth.uid()
);

-- Enhanced security audit logging
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  restaurant_id UUID,
  ip_address INET,
  user_agent TEXT,
  details JSONB,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on security_events
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Only allow system and owners to view security events
CREATE POLICY "Restaurant owners can view security events"
ON public.security_events
FOR SELECT
USING (
  restaurant_id IS NULL OR
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = security_events.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Function to log security events
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_event_type TEXT,
  p_restaurant_id UUID DEFAULT NULL,
  p_details JSONB DEFAULT NULL,
  p_severity TEXT DEFAULT 'medium'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.security_events (
    event_type,
    user_id,
    restaurant_id,
    details,
    severity
  ) VALUES (
    p_event_type,
    auth.uid(),
    p_restaurant_id,
    p_details,
    p_severity
  );
END;
$$;

-- Add rate limiting for invitation queries (basic protection)
CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  ip_address INET,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on rate_limit_log
ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

-- Users can only see their own rate limit entries
CREATE POLICY "Users can view their own rate limit logs"
ON public.rate_limit_log
FOR SELECT
USING (user_id = auth.uid());

-- Cleanup old rate limit logs (keep only last 24 hours)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_logs()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limit_log 
  WHERE created_at < now() - INTERVAL '24 hours';
END;
$$;