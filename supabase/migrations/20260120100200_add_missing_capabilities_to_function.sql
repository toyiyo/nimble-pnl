-- ============================================================================
-- Migration: Add Missing Capabilities to user_has_capability Function
--
-- Adds the missing capability cases for:
-- - view:pending_outflows, edit:pending_outflows (financial/accountant)
-- - view:inventory_transactions, edit:inventory_transactions (inventory)
--
-- These capabilities are used by RLS policies in the previous migration.
-- ============================================================================

-- Update the user_has_capability function to include the missing capabilities
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
    WHEN 'view:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')

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
    WHEN 'view:inventory_transactions' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_transactions' THEN v_role IN ('owner', 'manager', 'chef', 'collaborator_inventory')

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
This function MUST stay in sync with ROLE_CAPABILITIES in TypeScript.
Updated to include pending_outflows and inventory_transactions capabilities.';
