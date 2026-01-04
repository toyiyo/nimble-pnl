-- Create function to get user details from auth.users for audit trail
-- This is needed because profiles table may not have all users (deleted or not synced)
CREATE OR REPLACE FUNCTION get_users_by_ids(user_ids UUID[])
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.email::TEXT,
    (u.raw_user_meta_data->>'full_name')::TEXT as full_name
  FROM auth.users u
  WHERE u.id = ANY(user_ids);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_users_by_ids(UUID[]) TO authenticated;

COMMENT ON FUNCTION get_users_by_ids IS 'Fetches user details from auth.users for audit trail display. Falls back when profiles table does not have the user.';
