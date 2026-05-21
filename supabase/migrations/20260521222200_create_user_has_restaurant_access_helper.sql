-- create_user_has_restaurant_access_helper
--
-- Hotfix: the earlier migration 20251123100050_create_availability_tables.sql
-- (which defined this helper) was authored before our Supabase migration
-- pipeline was in place, so it never ran against production. Production was
-- bootstrapped via the Supabase SQL editor with inlined RLS checks instead.
--
-- 20260521133930_bulk_set_employee_availability.sql calls
-- public.user_has_restaurant_access(p_restaurant_id, true). Without this
-- helper present in production, the RPC fails at call time with
--   42883 function public.user_has_restaurant_access(uuid, boolean) does not exist
--
-- This migration is purely additive: CREATE OR REPLACE is idempotent both
-- locally (where the function already exists with this signature) and in
-- production (where it doesn't exist yet). Definition matches the original
-- in 20251123100050_create_availability_tables.sql exactly, with the addition
-- of an explicit SET search_path = public (Supabase security advisor).

CREATE OR REPLACE FUNCTION public.user_has_restaurant_access(
  p_restaurant_id        UUID,
  p_require_manager_role BOOLEAN DEFAULT false
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE user_restaurants.restaurant_id = p_restaurant_id
      AND user_restaurants.user_id       = auth.uid()
      AND (
        NOT p_require_manager_role
        OR user_restaurants.role IN ('owner', 'manager')
      )
  );
END;
$$;
