CREATE POLICY "Users can view their own employee record"
ON employees
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
