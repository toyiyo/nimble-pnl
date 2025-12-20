-- Drop and recreate the RLS policies with case-insensitive email comparison

-- Fix "Users can accept their own invitations" policy
DROP POLICY IF EXISTS "Users can accept their own invitations" ON invitations;

CREATE POLICY "Users can accept their own invitations" ON invitations
FOR UPDATE
USING (
  LOWER(email) = LOWER((SELECT profiles.email FROM profiles WHERE profiles.user_id = auth.uid()))
  AND status = 'pending'
  AND expires_at > now()
)
WITH CHECK (
  LOWER(email) = LOWER((SELECT profiles.email FROM profiles WHERE profiles.user_id = auth.uid()))
  AND status = 'accepted'
  AND accepted_by = auth.uid()
);

-- Fix "Users can view invitations sent to their email" policy
DROP POLICY IF EXISTS "Users can view invitations sent to their email" ON invitations;

CREATE POLICY "Users can view invitations sent to their email" ON invitations
FOR SELECT
USING (
  LOWER(email) = LOWER((SELECT profiles.email FROM profiles WHERE profiles.user_id = auth.uid()))
  AND status = 'pending'
  AND expires_at > now()
);