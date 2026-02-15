-- Allow users to view their own employee record for self-service portal
-- This is necessary for the Employee Portal to function for staff users
-- Without this, staff users cannot see their own employee record due to RLS

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own employee record' AND tablename = 'employees') THEN
    CREATE POLICY "Users can view their own employee record"
    ON employees
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());
  END IF;
END $$;
