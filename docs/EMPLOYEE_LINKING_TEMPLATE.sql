-- TEMPLATE: Manual Employee-to-User Account Linking
-- =====================================================
-- 
-- ⚠️  SECURITY WARNING: This script handles Personally Identifiable Information (PII)
-- ⚠️  Only run this in a secure environment (Supabase SQL Editor with proper access controls)
-- ⚠️  Do NOT commit this file with real email addresses or names
-- 
-- PURPOSE: Link an employee record to their user account when automatic linking fails
-- WHEN TO USE: After employee accepts invitation but employee.user_id remains NULL
-- 
-- PREREQUISITES:
--   1. Employee record exists in the employees table
--   2. User has completed signup in auth.users
--   3. Both records use the same email address
--   4. Employee record is not already linked (user_id IS NULL)
-- 
-- INSTRUCTIONS:
--   1. Replace 'employee@example.com' below with the actual employee's email address
--   2. Review the queries carefully before executing
--   3. Run in Supabase SQL Editor (Database > SQL Editor)
--   4. Verify the result in Step 2
--   5. Do NOT save this file with real email addresses
-- 
-- =====================================================

-- Step 1: Find the employee and user IDs, then link them
DO $$
DECLARE
  v_employee_id UUID;
  v_user_id UUID;
  v_target_email TEXT := 'employee@example.com'; -- ⚠️  REPLACE with actual email
BEGIN
  -- Get employee ID
  SELECT id INTO v_employee_id 
  FROM employees 
  WHERE email = v_target_email 
  AND user_id IS NULL
  LIMIT 1;

  -- Get user ID from auth.users
  SELECT id INTO v_user_id 
  FROM auth.users 
  WHERE email = v_target_email
  LIMIT 1;

  -- Check if both found
  IF v_employee_id IS NULL THEN
    RAISE NOTICE 'Employee not found or already linked for email: %', v_target_email;
  ELSIF v_user_id IS NULL THEN
    RAISE NOTICE 'User account not found for email: %', v_target_email;
  ELSE
    -- Link them
    UPDATE employees 
    SET user_id = v_user_id, updated_at = NOW()
    WHERE id = v_employee_id;
    
    RAISE NOTICE 'Successfully linked employee % to user % for email: %', v_employee_id, v_user_id, v_target_email;
  END IF;
END $$;

-- Step 2: Verify the linking worked
-- ⚠️  REPLACE 'employee@example.com' with the actual email used in Step 1
SELECT 
  e.id as employee_id,
  e.name,
  e.email as employee_email,
  e.user_id,
  u.email as user_email
FROM employees e
LEFT JOIN auth.users u ON e.user_id = u.id
WHERE e.email = 'employee@example.com'; -- ⚠️  REPLACE with actual email

-- Expected result: 
--   - user_id should be populated (not NULL)
--   - user_email should match employee_email
--   - If user_id is still NULL, check that:
--     * The employee exists and email is correct
--     * The user completed signup in auth.users
--     * Both records use exactly the same email address

-- ALTERNATIVE: Use the helper function (requires migration 20251115_link_employee_to_user_helper.sql)
-- SELECT * FROM link_employee_to_user(
--   'employee-uuid-here'::UUID,  -- Get from employees table
--   'user-uuid-here'::UUID        -- Get from auth.users table
-- );
