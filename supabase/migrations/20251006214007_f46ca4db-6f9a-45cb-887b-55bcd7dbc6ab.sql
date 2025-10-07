-- Enable pgcrypto extension for hashing functions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Recreate the hash_invitation_token function with proper type casting
CREATE OR REPLACE FUNCTION public.hash_invitation_token(token text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN encode(digest(token::bytea, 'sha256'::text), 'hex');
END;
$$;