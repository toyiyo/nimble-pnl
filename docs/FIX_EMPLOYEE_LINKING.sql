-- Quick fix for linking Juan Valdez (josema92@hotmail.com) to their user account
-- Run this in the Supabase SQL Editor

-- Step 1: Find the employee and user IDs
DO $$
DECLARE
  v_employee_id UUID;
  v_user_id UUID;
BEGIN
  -- Get employee ID
  SELECT id INTO v_employee_id 
  FROM employees 
  WHERE email = 'josema92@hotmail.com' 
  AND user_id IS NULL
  LIMIT 1;

  -- Get user ID from auth.users
  SELECT id INTO v_user_id 
  FROM auth.users 
  WHERE email = 'josema92@hotmail.com'
  LIMIT 1;

  -- Check if both found
  IF v_employee_id IS NULL THEN
    RAISE NOTICE 'Employee not found or already linked';
  ELSIF v_user_id IS NULL THEN
    RAISE NOTICE 'User not found';
  ELSE
    -- Link them
    UPDATE employees 
    SET user_id = v_user_id, updated_at = NOW()
    WHERE id = v_employee_id;
    
    RAISE NOTICE 'Successfully linked employee % to user %', v_employee_id, v_user_id;
  END IF;
END $$;

-- Step 2: Verify the linking worked
SELECT 
  e.id as employee_id,
  e.name,
  e.email as employee_email,
  e.user_id,
  u.email as user_email
FROM employees e
LEFT JOIN auth.users u ON e.user_id = u.id
WHERE e.email = 'josema92@hotmail.com';

-- Expected result: user_id should be populated and user_email should match employee_email
