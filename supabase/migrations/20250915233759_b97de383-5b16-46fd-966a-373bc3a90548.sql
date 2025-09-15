-- Fix the function search path security issue
CREATE OR REPLACE FUNCTION public.cleanup_expired_invitations()
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invitations 
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' 
  AND expires_at < now();
END;
$$;