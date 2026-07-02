-- ============================================================================
-- Migration: Add operations_manager role
--
-- Internal role with all operations EXCEPT accounting (bookkeeping) and
-- admin (settings-edit, integrations, collaborators). Can invite Staff and
-- manage employees.
--
-- Order: constraint -> user_is_internal_team -> user_has_capability -> RLS.
-- The user_has_capability body below is copied from the LIVE definition in
-- 20260129000000_add_subscription_system.sql (preserves subscription gating)
-- with 'operations_manager' added ONLY to non-accounting/non-admin branches.
-- ============================================================================

-- 1. Extend the role CHECK constraint (kiosk/collaborator precedent).
ALTER TABLE public.user_restaurants
  DROP CONSTRAINT IF EXISTS user_restaurants_role_check;

ALTER TABLE public.user_restaurants
  ADD CONSTRAINT user_restaurants_role_check
  CHECK (role IN (
    'owner', 'manager', 'operations_manager', 'chef', 'staff', 'kiosk',
    'collaborator_accountant', 'collaborator_inventory', 'collaborator_chef'
  ));

-- 2. Internal-team helper must include operations_manager, else the role can
-- only see its own user_restaurants row (empty team-management UI).
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
      AND ur.role IN ('owner', 'manager', 'operations_manager', 'chef', 'staff')
  );
$$;
COMMENT ON FUNCTION public.user_is_internal_team IS
'Check if current user is internal team (owner, manager, operations_manager, chef, or staff)';

-- 3. Replace user_has_capability with operations_manager added to
-- non-accounting/non-admin branches.
-- Source: 20260129000000_add_subscription_system.sql (live body preserved).
-- Changes: 'operations_manager' added ONLY to the branches listed below.
-- Accounting branches (transactions, banking, expenses, financial_statements,
-- chart_of_accounts, invoices, customers, pending_outflows, assets,
-- financial_intelligence) are intentionally NOT widened.
-- Admin branches (edit:settings, view:integrations, manage:integrations,
-- view:collaborators, manage:collaborators, manage:subscription) are NOT widened.
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
  v_has_role_permission BOOLEAN;
BEGIN
  -- Get user's role for this restaurant
  SELECT role INTO v_role
  FROM user_restaurants ur
  WHERE ur.restaurant_id = p_restaurant_id
    AND ur.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check role-based permission AND subscription where applicable
  RETURN CASE p_capability
    -- === SUBSCRIPTION-GATED CAPABILITIES ===

    -- AI Assistant: Role check + Pro subscription required
    -- operations_manager included: they run operations and benefit from AI
    WHEN 'view:ai_assistant' THEN
      v_role IN ('owner', 'manager', 'operations_manager') AND
      has_subscription_feature(p_restaurant_id, 'ai_assistant')

    -- Financial Intelligence: Role check + Growth+ subscription required
    -- operations_manager excluded: this is an accounting/financial surface
    WHEN 'view:financial_intelligence' THEN
      v_role IN ('owner', 'manager', 'collaborator_accountant') AND
      has_subscription_feature(p_restaurant_id, 'financial_intelligence')

    -- === ROLE-ONLY CAPABILITIES (no subscription check) ===

    -- Dashboard
    -- operations_manager included: operational role needs dashboard
    WHEN 'view:dashboard' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef')

    -- Financial capabilities (accountant surface) — NOT widened
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
    WHEN 'view:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:pending_outflows' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:assets' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:assets' THEN v_role IN ('owner', 'manager', 'collaborator_accountant')

    -- Inventory capabilities — operations_manager included
    WHEN 'view:inventory' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_chef')
    WHEN 'edit:inventory' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:inventory_audit' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_audit' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:purchase_orders' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:purchase_orders' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_inventory')
    WHEN 'view:receipt_import' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:receipt_import' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:reports' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'view:inventory_transactions' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')
    WHEN 'edit:inventory_transactions' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory')

    -- Recipe capabilities — operations_manager included
    WHEN 'view:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'edit:recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'view:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'edit:prep_recipes' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'view:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')
    WHEN 'edit:batches' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef')

    -- Operations capabilities — operations_manager included
    WHEN 'view:pos_sales' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef')
    WHEN 'view:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager', 'chef')
    WHEN 'edit:scheduling' THEN v_role IN ('owner', 'manager', 'operations_manager')
    -- view:payroll includes collaborator_accountant (payroll surface is also financial)
    -- operations_manager included for labor/payroll operations
    WHEN 'view:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant')
    WHEN 'edit:payroll' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:tips' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'edit:tips' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'edit:time_punches' THEN v_role IN ('owner', 'manager', 'operations_manager')

    -- Admin capabilities — operations_manager included for team/employee, excluded for settings-edit/integrations/collaborators
    WHEN 'view:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'manage:team' THEN v_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:employees' THEN v_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant')
    WHEN 'manage:employees' THEN v_role IN ('owner', 'manager', 'operations_manager')
    -- view:settings: all except kiosk (operations_manager passes automatically)
    WHEN 'view:settings' THEN v_role NOT IN ('kiosk')
    -- edit:settings: owner only — NOT widened
    WHEN 'edit:settings' THEN v_role IN ('owner')
    -- view:integrations: NOT widened (admin surface)
    WHEN 'view:integrations' THEN v_role IN ('owner', 'manager')
    -- manage:integrations: NOT widened (admin surface)
    WHEN 'manage:integrations' THEN v_role IN ('owner')
    -- view:collaborators: NOT widened (admin surface)
    WHEN 'view:collaborators' THEN v_role IN ('owner', 'manager')
    -- manage:collaborators: NOT widened (admin surface)
    WHEN 'manage:collaborators' THEN v_role IN ('owner', 'manager')

    -- Subscription management (owner only) — NOT widened
    WHEN 'manage:subscription' THEN v_role = 'owner'

    ELSE FALSE
  END;
END;
$$;

COMMENT ON FUNCTION public.user_has_capability IS
'Check if current user has a specific capability for a restaurant.
Integrates both role-based permissions AND subscription tier checks.

Subscription-gated capabilities:
- view:ai_assistant: Requires Pro tier (owner, manager, operations_manager)
- view:financial_intelligence: Requires Growth+ tier (owner, manager, collaborator_accountant)

operations_manager has full operational access (inventory, recipes, scheduling,
payroll, tips, time_punches, team, employees) but NO accounting (transactions,
banking, expenses, financial_statements, chart_of_accounts, invoices, customers,
pending_outflows, assets, financial_intelligence) and NO admin beyond team/employee
management (no edit:settings, view:integrations, manage:integrations,
view:collaborators, manage:collaborators, manage:subscription).

This function MUST stay in sync with ROLE_CAPABILITIES in TypeScript.';

-- ============================================================================
-- 4. Residual hardcoded-role-list operational policies
--
-- The collaborator migration (20260120100100) converted the major operational
-- tables to user_has_capability()-based RLS, so operations_manager is already
-- covered there via the function above. The tables below still use hardcoded
-- role IN ('owner', 'manager') or user_has_role(['owner','manager']) expressions
-- and must be widened to include operations_manager.
--
-- Rule: drop the old policy by exact name, recreate with
--   role IN ('owner', 'manager', 'operations_manager')  or
--   user_has_role(..., ARRAY['owner','manager','operations_manager'])
-- ============================================================================

-- -------------------------------------------------------------------------
-- employees: "Owners and managers can manage employees"
-- Source: 20260120100100_update_rls_for_collaborators.sql
-- Uses user_has_role(['owner','manager']). Widen to include operations_manager.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can manage employees" ON public.employees;
CREATE POLICY "Owners and managers can manage employees"
ON public.employees
FOR ALL
USING (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager']))
WITH CHECK (user_has_role(restaurant_id, ARRAY['owner', 'manager', 'operations_manager']));

-- -------------------------------------------------------------------------
-- receipt_imports: view / insert / update policies
-- Source: 20251006212711_4eb82642-...
-- Uses role = ANY(ARRAY['owner','manager']). Widen to include operations_manager.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can view receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can view receipt imports"
ON public.receipt_imports
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id
      AND user_id = auth.uid()
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager'])
  )
);

DROP POLICY IF EXISTS "Owners and managers can create receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can create receipt imports"
ON public.receipt_imports
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id
      AND user_id = auth.uid()
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager'])
  )
);

DROP POLICY IF EXISTS "Owners and managers can update receipt imports" ON public.receipt_imports;
CREATE POLICY "Owners and managers can update receipt imports"
ON public.receipt_imports
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = receipt_imports.restaurant_id
      AND user_id = auth.uid()
      AND role = ANY(ARRAY['owner', 'manager', 'operations_manager'])
  )
);

-- -------------------------------------------------------------------------
-- schedule_publications: "Managers can create schedule publications"
-- Source: 20251123000000_schedule_publishing.sql
-- Uses role IN ('owner','manager'). Widen to include operations_manager.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can create schedule publications" ON public.schedule_publications;
CREATE POLICY "Managers can create schedule publications"
ON public.schedule_publications
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = schedule_publications.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- tip_pool_settings: view / insert / update policies
-- Source: 20251217000001_create_tip_pooling_tables.sql
-- Uses role IN ('owner','manager'). Widen to include operations_manager.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can view tip pool settings"
ON public.tip_pool_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can insert tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can insert tip pool settings"
ON public.tip_pool_settings
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

DROP POLICY IF EXISTS "Managers can update tip pool settings" ON public.tip_pool_settings;
CREATE POLICY "Managers can update tip pool settings"
ON public.tip_pool_settings
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = tip_pool_settings.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- -------------------------------------------------------------------------
-- overtime_rules: "Owners and managers can manage overtime rules"
-- Source: 20260221200000_create_overtime_rules.sql
-- Uses role IN ('owner','manager'). Widen to include operations_manager.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and managers can manage overtime rules" ON public.overtime_rules;
CREATE POLICY "Owners and managers can manage overtime rules"
ON public.overtime_rules
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = overtime_rules.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager', 'operations_manager')
  )
);

-- ============================================================================
-- NOTE: Tables NOT changed here (all already capability-gated or intentionally
-- excluded from operations_manager):
--   - products, recipes, prep_recipes, production_runs, inventory_transactions,
--     purchase_orders, invoices, customers, pending_outflows:
--       already migrated to user_has_capability() in 20260120100100.
--   - bank_transactions, chart_of_accounts, financial_statement_cache,
--     connected_banks: accounting surface — operations_manager is correctly
--     excluded via user_has_capability().
--   - unified_sales INSERT: remains owner/manager only (no edit:pos_sales).
--   - tip_splits, tip_split_items, tip_disputes (20251217000001),
--     tip_contribution_pools, tip_server_earnings, tip_pool_allocations
--     (20260221000000), tip_payouts (20260218000000),
--     overtime_adjustments (20260221200001),
--     non_hourly_compensation_allocations / daily_labor_allocations
--     (20251205164747), employee_compensation_history INSERT (20251216093000),
--     time_punches manager-write (20251127100000),
--     staffing_settings (20260306000000), open_shift_claims managers_view +
--     managers_review (20260412145842):
--       covered by operations_manager having edit:tips / edit:payroll /
--       edit:time_punches / edit:scheduling via user_has_capability() which is
--       already in effect via those tables' existing capability-gated policies,
--       OR widened as a follow-up (tracked in plan Task 6 step 3 continuation).
-- ============================================================================
