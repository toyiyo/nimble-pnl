-- Add audit logging table for security events
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on audit log
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only restaurant owners and managers can view audit logs for their restaurant
CREATE POLICY "Restaurant owners can view security audit logs"
ON public.security_audit_log
FOR SELECT
USING (
  restaurant_id IS NULL OR 
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE user_restaurants.restaurant_id = security_audit_log.restaurant_id 
    AND user_restaurants.user_id = auth.uid() 
    AND user_restaurants.role IN ('owner', 'manager')
  )
);

-- Add indexes for performance
CREATE INDEX idx_security_audit_log_restaurant_id ON public.security_audit_log(restaurant_id);
CREATE INDEX idx_security_audit_log_event_type ON public.security_audit_log(event_type);
CREATE INDEX idx_security_audit_log_created_at ON public.security_audit_log(created_at);

-- Create function to clean up old audit logs (keep last 90 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.security_audit_log 
  WHERE created_at < now() - INTERVAL '90 days';
END;
$$;