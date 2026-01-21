-- ============================================================================
-- Migration: Add Collaborator Roles
--
-- Adds external collaborator roles for scoped access:
-- - collaborator_accountant: Financial data access for bookkeeping
-- - collaborator_inventory: Inventory and purchasing access
-- - collaborator_chef: Recipe development access
--
-- Also creates SQL helper functions for capability-based permission checking.
-- ============================================================================

-- 1. Alter the user_restaurants.role constraint to include new collaborator roles
-- This follows the pattern established when adding 'kiosk' role
ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;

ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN (
    'owner', 'manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'
  ));

-- 2. Create helper function for role-based access checks
-- This is used by RLS policies to check if a user has specific roles
CREATE OR REPLACE FUNCTION public.user_has_role(
  p_restaurant_id UUID,
  p_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role = ANY(p_roles)
  );
$$;

COMMENT ON FUNCTION public.user_has_role IS
'Check if current user has any of the specified roles for a restaurant';

-- 3. Create helper for checking if user is internal team (not collaborator)
CREATE OR REPLACE FUNCTION public.user_is_internal_team(
  p_restaurant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'chef', 'staff')
  );
$$;

COMMENT ON FUNCTION public.user_is_internal_team IS
'Check if current user is internal team (owner, manager, chef, or staff)';

-- 4. Create helper for checking if user is a collaborator
CREATE OR REPLACE FUNCTION public.user_is_collaborator(
  p_restaurant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id = p_restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role LIKE 'collaborator_%'
  );
$$;

COMMENT ON FUNCTION public.user_is_collaborator IS
'Check if current user is a collaborator (external specialist)';

-- 5. Create capability-based access function
-- This function encodes the ROLE_CAPABILITIES mapping from TypeScript
-- IMPORTANT: Keep this in sync with src/lib/permissions/definitions.ts
CREATE OR REPLACE FUNCTION public.user_has_capability(
  p_restaurant_id UUID,
  p_capability TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Get user's role for this restaurant
  SELECT role INTO v_role
  FROM user_restaurants ur
  WHERE ur.restaurant_id = p_restaurant_id
    AND ur.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Match capability to allowed roles
  -- This MUST stay in sync with ROLE_CAPABILITIES in TypeScript
  RETURN CASE p_capability
    -- Dashboard
    WHEN 'view:dashboard' THEN v_role IN ('owner', 'manager', 'chef')
    WHEN 'view:ai_assistant' THEN v_role IN ('owner', 'manager')

    -- Financial capabilities (accountant surface)
    WHEN 'view:transactions' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:transactions' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:banking' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:banking' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:expenses' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:expenses' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:financial_statements' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:chart_of_accounts' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:chart_of_accounts' THEN v_role IN ('owner', 'collaborator_accountant')
    WHEN 'view:invoices' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:invoices' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:customers' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:customers' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:financial_intelligence' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')

    -- Inventory capabilities
    WHEN 'view:inventory' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory', 'collaborator_chef')
    WHEN 'edit:inventory' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'view:inventory_audit' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_audit' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'view:purchase_orders' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:purchase_orders' THEN v_role IN ('owner', 'manager', 'collaborator_inventory')
    WHEN 'view:receipt_import' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:receipt_import' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'view:reports' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')

    -- Recipe capabilities
    WHEN 'view:recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'edit:recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'view:prep_recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'edit:prep_recipes' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'view:batches' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')
    WHEN 'edit:batches' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_chef')

    -- Operations capabilities
    WHEN 'view:pos_sales' THEN v_role IN ('owner', 'manager', 'chef')
    WHEN 'view:scheduling' THEN v_role IN ('owner', 'manager', 'chef')
    WHEN 'edit:scheduling' THEN v_role IN ('owner', 'manager')
    WHEN 'view:payroll' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:payroll' THEN v_role IN ('owner', 'manager')
    WHEN 'view:tips' THEN v_role IN ('owner', 'manager')
    WHEN 'edit:tips' THEN v_role IN ('owner', 'manager')
    WHEN 'view:time_punches' THEN v_role IN ('owner', 'manager')
    WHEN 'edit:time_punches' THEN v_role IN ('owner', 'manager')

    -- Admin capabilities
    WHEN 'view:team' THEN v_role IN ('owner', 'manager')
    WHEN 'manage:team' THEN v_role IN ('owner', 'manager')
    WHEN 'view:employees' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'manage:employees' THEN v_role IN ('owner', 'manager')
    WHEN 'view:settings' THEN v_role NOT IN ('kiosk') -- All except kiosk
    WHEN 'edit:settings' THEN v_role IN ('owner')
    WHEN 'view:integrations' THEN v_role IN ('owner', 'manager')
    WHEN 'manage:integrations' THEN v_role IN ('owner')
    WHEN 'view:collaborators' THEN v_role IN ('owner', 'manager')
    WHEN 'manage:collaborators' THEN v_role IN ('owner', 'manager')

    ELSE FALSE
  END;
END;
$$;

COMMENT ON FUNCTION public.user_has_capability IS
'Check if current user has a specific capability for a restaurant.
Capabilities are fine-grained permissions like view:inventory, edit:recipes.
This function MUST stay in sync with ROLE_CAPABILITIES in TypeScript.';

-- 6. Add index for role-based queries performance
CREATE INDEX IF NOT EXISTS idx_user_restaurants_role
ON public.user_restaurants(restaurant_id, role);

-- 7. Update user_restaurants RLS to hide collaborators from each other
-- Collaborators should only see their own membership, not other team members
DROP POLICY IF EXISTS "Users can view their restaurant associations" ON public.user_restaurants;

CREATE POLICY "Users can view their restaurant associations"
ON public.user_restaurants
FOR SELECT
USING (
  -- Users can always see their own association
  user_id = auth.uid()
  OR
  -- Internal team can see all members (for team management)
  (
    user_is_internal_team(restaurant_id)
  )
);

-- Note: The above policy means collaborators will ONLY see their own row
-- in user_restaurants, providing the isolation we want.
