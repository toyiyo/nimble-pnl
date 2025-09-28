-- Fix invitations RLS policy to avoid accessing auth.users table directly
-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can view invitations sent to their email" ON public.invitations;

-- Create a new policy that uses profiles table instead
CREATE POLICY "Users can view invitations sent to their email"
ON public.invitations
FOR SELECT
USING (
  (email = (
    SELECT profiles.email 
    FROM public.profiles 
    WHERE profiles.user_id = auth.uid()
  )::text) 
  AND (status = 'pending'::text) 
  AND (expires_at > now())
);

-- Also ensure the "Users can accept their own invitations" policy works correctly
DROP POLICY IF EXISTS "Users can accept their own invitations" ON public.invitations;

CREATE POLICY "Users can accept their own invitations"
ON public.invitations
FOR UPDATE
USING (
  (email = (
    SELECT profiles.email 
    FROM public.profiles 
    WHERE profiles.user_id = auth.uid()
  )::text) 
  AND (status = 'pending'::text) 
  AND (expires_at > now())
)
WITH CHECK (
  (email = (
    SELECT profiles.email 
    FROM public.profiles 
    WHERE profiles.user_id = auth.uid()
  )::text) 
  AND (status = 'accepted'::text) 
  AND (accepted_by = auth.uid())
);