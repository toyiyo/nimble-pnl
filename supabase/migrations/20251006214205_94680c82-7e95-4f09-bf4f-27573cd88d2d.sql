-- Fix the hash_invitation_token function with correct digest signature
CREATE OR REPLACE FUNCTION public.hash_invitation_token(token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN encode(digest(token, 'sha256'), 'hex');
END;
$$;