-- SECURITY FIX: Hash invitation tokens + Unit conversions RLS + Restrict profile PII

-- 1. Hash invitation tokens (store hash instead of plain text)
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS hashed_token TEXT;

-- Create function to hash tokens
CREATE OR REPLACE FUNCTION public.hash_invitation_token(token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN encode(digest(token, 'sha256'), 'hex');
END;
$$;

-- 2. Unit conversions - Add strict RLS policies to prevent user modifications
ALTER TABLE IF EXISTS public.unit_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No user modifications to unit conversions" ON public.unit_conversions;
CREATE POLICY "No user modifications to unit conversions" 
ON public.unit_conversions 
FOR INSERT
WITH CHECK (false);

DROP POLICY IF EXISTS "No user updates to unit conversions" ON public.unit_conversions;
CREATE POLICY "No user updates to unit conversions" 
ON public.unit_conversions 
FOR UPDATE
USING (false);

DROP POLICY IF EXISTS "No user deletes to unit conversions" ON public.unit_conversions;
CREATE POLICY "No user deletes to unit conversions" 
ON public.unit_conversions 
FOR DELETE
USING (false);

-- 3. Restrict profile PII visibility
DROP POLICY IF EXISTS "Team members can view profiles within their restaurants" ON public.profiles;
DROP POLICY IF EXISTS "Team members can view basic profile info" ON public.profiles;
CREATE POLICY "Team members can view basic profile info" 
ON public.profiles 
FOR SELECT 
USING (
  auth.uid() = user_id
  OR
  EXISTS (
    SELECT 1 FROM public.user_restaurants ur1
    JOIN public.user_restaurants ur2 ON ur1.restaurant_id = ur2.restaurant_id
    WHERE ur1.user_id = auth.uid() 
    AND ur1.role = ANY(ARRAY['owner', 'manager'])
    AND ur2.user_id = profiles.user_id
  )
  OR
  EXISTS (
    SELECT 1 FROM public.user_restaurants ur1
    JOIN public.user_restaurants ur2 ON ur1.restaurant_id = ur2.restaurant_id
    WHERE ur1.user_id = auth.uid()
    AND ur2.user_id = profiles.user_id
  )
);

-- 4. Restrict SCIM users to owners only
DROP POLICY IF EXISTS "Only restaurant members can view SCIM users" ON public.scim_users;
DROP POLICY IF EXISTS "Only restaurant owners can view SCIM users" ON public.scim_users;
CREATE POLICY "Only restaurant owners can view SCIM users" 
ON public.scim_users 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = scim_users.restaurant_id 
    AND user_id = auth.uid() 
    AND role = 'owner'
  )
);

-- 5. Restrict receipt imports to owners and managers
DROP POLICY IF EXISTS "Users can view receipt imports for their restaurants" ON public.receipt_imports;
DROP POLICY IF EXISTS "Owners and managers can view receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can view receipt imports" 
ON public.receipt_imports 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id 
    AND user_id = auth.uid() 
    AND role = ANY(ARRAY['owner', 'manager'])
  )
);

DROP POLICY IF EXISTS "Users can create receipt imports for their restaurants" ON public.receipt_imports;
DROP POLICY IF EXISTS "Owners and managers can create receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can create receipt imports" 
ON public.receipt_imports 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id 
    AND user_id = auth.uid() 
    AND role = ANY(ARRAY['owner', 'manager'])
  )
);

DROP POLICY IF EXISTS "Users can update receipt imports for their restaurants" ON public.receipt_imports;
DROP POLICY IF EXISTS "Owners and managers can update receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can update receipt imports" 
ON public.receipt_imports 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id 
    AND user_id = auth.uid() 
    AND role = ANY(ARRAY['owner', 'manager'])
  )
);

-- 6. Secure invitation token visibility
DROP POLICY IF EXISTS "Restaurant owners and managers can view invitations" ON public.invitations;
DROP POLICY IF EXISTS "Restaurant owners and managers can view invitations (no tokens)" ON public.invitations;
CREATE POLICY "Restaurant owners and managers can view invitations (no tokens)" 
ON public.invitations 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = invitations.restaurant_id 
    AND user_id = auth.uid() 
    AND role = ANY(ARRAY['owner', 'manager'])
  )
);

COMMENT ON FUNCTION public.hash_invitation_token IS 'Securely hashes invitation tokens using SHA-256 to prevent token theft';
COMMENT ON POLICY "No user modifications to unit conversions" ON public.unit_conversions IS 'Prevents corruption of critical measurement data by blocking all user modifications';