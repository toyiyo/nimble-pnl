-- Allow users to view their own employee record for self-service portal
-- This is necessary for the Employee Portal to function for staff users
-- Without this, staff users cannot see their own employee record due to RLS

CREATE POLICY "Users can view their own employee record"
ON employees
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
